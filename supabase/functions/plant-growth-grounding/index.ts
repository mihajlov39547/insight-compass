// Plant Advisor — grow-guidance grounding.
// For `improve_growth` cases, gathers grounded care/growth information from:
//   1) existing Trefle profile (plant_species_profiles) as botanical baseline
//   2) Perenual API (species-list + species/details + species-care-guide-list)
//   3) Tavily web search (curated queries; filtered to authoritative sources)
// The result is normalized into care categories and persisted to
// `plant_case_grounding_contexts`. Successful grounding is cached (7d).
//
// Safety: this function does NOT recommend fertilizer/pesticide/fungicide/
// herbicide product names, doses, mixing rates, or spray schedules. It stores
// raw provider data and lightweight, product-word-stripped summaries. The
// chat layer enforces final safety boundaries in its system prompt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PERENUAL_BASE = 'https://perenual.com/api';
const TAVILY_URL = 'https://api.tavily.com/search';

// Confidence threshold below which we flag species-specific guidance as
// uncertain. Kept as a named constant so future tuning is centralised.
const GROWTH_CONFIDENCE_WARNING_THRESHOLD = 0.5;

const MAX_WEB_SOURCES = 5;

// Product / chemistry vocabulary we scrub from stored summaries so we never
// surface product names, doses, mixing rates, or spray schedules.
const PRODUCT_WORD_PATTERN =
  /\b(fertili[sz]er|pesticide|fungicide|herbicide|insecticide|miticide|weed[- ]?killer|spray|neem oil|copper spray|bordeaux|round\s*up|glyphosate|imidacloprid|malathion|permethrin|dose|dosage|mixing rate|application rate|active ingredient|npk\s*\d+[-–]\d+[-–]\d+)\b/gi;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type AuthorityScore = 'high' | 'medium' | 'low';
type SourceType =
  | 'university_extension'
  | 'botanical_garden'
  | 'government'
  | 'plant_database'
  | 'horticulture_site'
  | 'other';

interface CareCategory {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  sources: Array<{ provider: string; title?: string; url?: string }>;
}

interface SourceEntry {
  provider: 'trefle' | 'perenual' | 'web';
  title: string;
  url: string | null;
  fetchedAt: string;
  summary: string;
  fields?: Record<string, unknown> | null;
  careCategories?: string[];
  sourceType?: SourceType;
  authorityScore?: AuthorityScore;
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 15000): Promise<any | null> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...(init || {}), signal: controller.signal });
    if (!r.ok) {
      console.warn('[grounding] non-ok', r.status, url);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn('[grounding] fetch failed', (e as Error).message, url);
    return null;
  } finally {
    clearTimeout(to);
  }
}

function normStr(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function joinArr(v: unknown): string | null {
  if (Array.isArray(v)) {
    const arr = v
      .map((x) => (typeof x === 'string' ? x : x?.description ?? x?.value ?? x?.name ?? null))
      .filter((x): x is string => !!x && typeof x === 'string');
    return arr.length ? arr.join(', ') : null;
  }
  return normStr(v);
}

function scrubProductWords(input: string): string {
  if (!input) return input;
  // Replace product/chemistry terms with a neutral placeholder, then collapse
  // whitespace and orphaned punctuation.
  return input
    .replace(PRODUCT_WORD_PATTERN, '[general care]')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function dedupeAndJoin(parts: string[], maxLen = 1200): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of parts) {
    const cleaned = scrubProductWords(String(raw || '').trim());
    if (!cleaned) continue;
    const key = cleaned.toLowerCase().slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(cleaned);
  }
  return kept.join('\n\n').slice(0, maxLen);
}

// Domain-based source classification for Tavily web results.
const DOMAIN_RULES: Array<{ match: RegExp; type: SourceType; score: AuthorityScore }> = [
  // University extensions and .edu horticulture programs.
  { match: /(^|\.)extension\.[a-z-]+\.edu$/i, type: 'university_extension', score: 'high' },
  { match: /(^|\.)[a-z-]+\.edu$/i, type: 'university_extension', score: 'high' },
  { match: /extension\./i, type: 'university_extension', score: 'high' },
  // Government agriculture / research.
  { match: /(^|\.)usda\.gov$/i, type: 'government', score: 'high' },
  { match: /\.gov(\.[a-z]{2})?$/i, type: 'government', score: 'high' },
  { match: /\.gc\.ca$/i, type: 'government', score: 'high' },
  { match: /\.europa\.eu$/i, type: 'government', score: 'high' },
  // Botanical gardens & major plant institutions.
  { match: /kew\.org$/i, type: 'botanical_garden', score: 'high' },
  { match: /missouribotanicalgarden\.org$/i, type: 'botanical_garden', score: 'high' },
  { match: /rhs\.org\.uk$/i, type: 'botanical_garden', score: 'high' },
  { match: /bbg\.org$/i, type: 'botanical_garden', score: 'high' },
  { match: /nybg\.org$/i, type: 'botanical_garden', score: 'high' },
  { match: /botanicalgarden/i, type: 'botanical_garden', score: 'high' },
  // Reputable plant databases.
  { match: /perenual\.com$/i, type: 'plant_database', score: 'medium' },
  { match: /trefle\.io$/i, type: 'plant_database', score: 'medium' },
  { match: /powo\.science\.kew\.org$/i, type: 'plant_database', score: 'high' },
  { match: /gbif\.org$/i, type: 'plant_database', score: 'high' },
  { match: /wikipedia\.org$/i, type: 'plant_database', score: 'medium' },
  // Reputable horticulture sites (curated shortlist).
  { match: /gardenersworld\.com$/i, type: 'horticulture_site', score: 'medium' },
  { match: /almanac\.com$/i, type: 'horticulture_site', score: 'medium' },
  { match: /gardeningknowhow\.com$/i, type: 'horticulture_site', score: 'medium' },
  { match: /finegardening\.com$/i, type: 'horticulture_site', score: 'medium' },
];

// Domains we skip outright — ecommerce, product catalogs, forums, and
// low-signal SEO farms.
const BLOCKED_HOST_PATTERN =
  /(amazon\.|ebay\.|walmart\.|homedepot\.|lowes\.|etsy\.|aliexpress\.|shopify|reddit\.com|quora\.com|pinterest\.|facebook\.com|tiktok\.com|houzz\.com)/i;

// URL-path hints for product / chemistry pages we skip even on otherwise OK
// domains.
const BLOCKED_PATH_PATTERN =
  /(product|shop|cart|checkout|fertili[sz]er|pesticide|fungicide|herbicide|insecticide|weed-?killer|spray-?guide|buy-?online)/i;

function classifySource(url: string, title: string, snippet: string):
  | { sourceType: SourceType; authorityScore: AuthorityScore }
  | null {
  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (BLOCKED_HOST_PATTERN.test(host)) return null;
  if (BLOCKED_PATH_PATTERN.test(path)) return null;

  const hay = `${title} ${snippet}`.toLowerCase();
  // Skip content clearly focused on product/chemistry recommendations.
  if (/(best\s+fertili[sz]er|top\s+\d+\s+fertili[sz]er|which\s+pesticide|spray\s+schedule)/i.test(hay)) {
    return null;
  }

  for (const rule of DOMAIN_RULES) {
    if (rule.match.test(host)) {
      return { sourceType: rule.type, authorityScore: rule.score };
    }
  }
  // Unknown domain — allow but as low authority.
  return { sourceType: 'other', authorityScore: 'low' };
}

function authorityRank(a: AuthorityScore | undefined): number {
  if (a === 'high') return 3;
  if (a === 'medium') return 2;
  if (a === 'low') return 1;
  return 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const perenualKey = Deno.env.get('PERENUAL_API_KEY') || '';
    const tavilyKey = Deno.env.get('TAVILY_API_KEY') || '';

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const caseId = String(body?.caseId || '');
    const force = !!body?.force;
    if (!caseId) return json({ error: 'missing_case_id' }, 400);

    const admin = createClient(supaUrl, serviceKey);

    const { data: pc, error: pcErr } = await admin
      .from('plant_cases')
      .select('id, user_id, title, user_goal, location_text, crop_context, notes, confirmed_identification_id, confirmed_scientific_name, confirmed_common_name')
      .eq('id', caseId)
      .maybeSingle();
    if (pcErr) return json({ error: 'case_lookup_failed' }, 500);
    if (!pc || pc.user_id !== userId) return json({ error: 'case_not_found' }, 404);
    if (pc.user_goal !== 'improve_growth') return json({ error: 'wrong_goal' }, 400);

    // Cache check
    if (!force) {
      const { data: cached } = await admin
        .from('plant_case_grounding_contexts')
        .select('*')
        .eq('case_id', caseId)
        .eq('goal', 'improve_growth')
        .eq('status', 'success')
        .order('fetched_at', { ascending: false })
        .limit(1);
      const row = (cached as any[] | null)?.[0];
      if (row && Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS) {
        return json({ ok: true, cached: true, grounding: row });
      }
    }

    // Load confirmed identification (for score / uncertainty)
    let identConfidence: number | null = null;
    let scientificName = pc.confirmed_scientific_name || null;
    let scientificNameNoAuthor: string | null = null;
    let commonName = pc.confirmed_common_name || null;
    let genus: string | null = null;
    if (pc.confirmed_identification_id) {
      const { data: ident } = await admin
        .from('plant_identifications')
        .select('score, scientific_name, scientific_name_without_author, common_name, genus')
        .eq('id', pc.confirmed_identification_id)
        .maybeSingle();
      if (ident) {
        identConfidence = (ident as any).score ?? null;
        scientificName = scientificName || (ident as any).scientific_name;
        scientificNameNoAuthor = (ident as any).scientific_name_without_author || null;
        commonName = commonName || (ident as any).common_name;
        genus = (ident as any).genus || null;
      }
    }

    const primarySci = scientificNameNoAuthor || scientificName || null;
    const primaryCommon = commonName || null;
    if (!primarySci && !primaryCommon) {
      return json({ error: 'no_plant_reference' }, 400);
    }

    const confidenceWarning =
      identConfidence != null && identConfidence < GROWTH_CONFIDENCE_WARNING_THRESHOLD;
    const sources: SourceEntry[] = [];

    // 1) Trefle baseline (already cached in plant_species_profiles)
    const { data: profRows } = await admin
      .from('plant_species_profiles')
      .select('*')
      .eq('case_id', caseId)
      .order('fetched_at', { ascending: false })
      .limit(1);
    const profile = (profRows as any[] | null)?.[0] ?? null;
    if (profile?.profile) {
      const p = profile.profile;
      const trefleSummaryParts: string[] = [];
      if (p.growth?.description) trefleSummaryParts.push(String(p.growth.description));
      if (p.specifications) {
        const spec = p.specifications;
        if (spec.growth_habit) trefleSummaryParts.push(`Habit: ${joinArr(spec.growth_habit)}`);
      }
      sources.push({
        provider: 'trefle',
        title: `Trefle: ${p.scientificName || primarySci || primaryCommon}`,
        url: null,
        fetchedAt: profile.fetched_at,
        summary: scrubProductWords(trefleSummaryParts.join('. ')).slice(0, 800) || 'Trefle botanical baseline data.',
        fields: {
          scientificName: p.scientificName,
          commonName: p.commonName,
          family: p.family,
          genus: p.genus,
          duration: p.duration,
          edible: p.edible,
          ediblePart: p.ediblePart,
          toxicity: p.toxicity,
          growth: p.growth,
          specifications: p.specifications,
        },
      });
    }

    // 2) Perenual
    let perenualDetails: any = null;
    let perenualCare: any[] = [];
    let perenualSpeciesId: number | null = null;
    if (perenualKey) {
      const tries: string[] = [];
      if (primarySci) tries.push(primarySci);
      if (scientificName && scientificName !== primarySci) tries.push(scientificName);
      if (primaryCommon) tries.push(primaryCommon);
      if (genus && primaryCommon) tries.push(`${genus} ${primaryCommon}`);
      let match: any = null;
      for (const q of tries) {
        const listUrl = `${PERENUAL_BASE}/v2/species-list?key=${encodeURIComponent(perenualKey)}&q=${encodeURIComponent(q)}`;
        const listData = await fetchJson(listUrl);
        const items = Array.isArray(listData?.data) ? listData.data : [];
        if (items.length > 0) {
          const qLower = q.toLowerCase();
          match =
            items.find((it: any) => {
              const arr = Array.isArray(it.scientific_name) ? it.scientific_name : [it.scientific_name];
              return arr.some((s: any) => typeof s === 'string' && s.toLowerCase().includes(qLower));
            }) || items[0];
          if (match) break;
        }
      }
      if (match?.id) {
        perenualSpeciesId = Number(match.id) || null;
        const detUrl = `${PERENUAL_BASE}/v2/species/details/${match.id}?key=${encodeURIComponent(perenualKey)}`;
        perenualDetails = await fetchJson(detUrl);
        const careUrl = `${PERENUAL_BASE}/species-care-guide-list?key=${encodeURIComponent(perenualKey)}&species_id=${match.id}`;
        const careData = await fetchJson(careUrl);
        perenualCare = Array.isArray(careData?.data) ? careData.data : [];
      }
      if (perenualDetails) {
        const d = perenualDetails;
        const careSections: Record<string, string> = {};
        for (const guide of perenualCare) {
          const secs = Array.isArray(guide?.section) ? guide.section : [];
          for (const s of secs) {
            const t = typeof s?.type === 'string' ? s.type.toLowerCase() : null;
            const desc = normStr(s?.description);
            if (t && desc) {
              const cleaned = scrubProductWords(desc);
              careSections[t] = careSections[t] ? `${careSections[t]}\n\n${cleaned}` : cleaned;
            }
          }
        }
        // Best-effort public-facing Perenual URL for the matched species.
        const perenualPublicUrl = perenualSpeciesId
          ? `https://perenual.com/plant-database-search-finder-guide/species/${perenualSpeciesId}`
          : null;
        sources.push({
          provider: 'perenual',
          title: `Perenual: ${normStr(joinArr(d.common_name)) || normStr(joinArr(d.scientific_name)) || primarySci || primaryCommon}`,
          url: perenualPublicUrl,
          fetchedAt: new Date().toISOString(),
          summary: scrubProductWords(normStr(d.description) || '').slice(0, 800),
          fields: {
            common_name: joinArr(d.common_name),
            scientific_name: joinArr(d.scientific_name),
            family: normStr(d.family),
            genus: normStr(d.genus),
            cycle: normStr(d.cycle),
            watering: normStr(d.watering),
            watering_general_benchmark: d.watering_general_benchmark ?? null,
            sunlight: joinArr(d.sunlight),
            pruning_month: joinArr(d.pruning_month),
            pruning_count: d.pruning_count ?? null,
            care_level: normStr(d.care_level),
            maintenance: normStr(d.maintenance),
            soil: joinArr(d.soil),
            growth_rate: normStr(d.growth_rate),
            drought_tolerant: d.drought_tolerant ?? null,
            salt_tolerant: d.salt_tolerant ?? null,
            pest_susceptibility: joinArr(d.pest_susceptibility),
            hardiness: d.hardiness ?? null,
            harvest_season: normStr(d.harvest_season),
            edible_fruit: d.edible_fruit ?? null,
            poisonous_to_humans: d.poisonous_to_humans ?? null,
            poisonous_to_pets: d.poisonous_to_pets ?? null,
            careSections,
          },
        });
      }
    }

    // 3) Tavily web grounding — curated queries, filtered + ranked by authority.
    if (tavilyKey && (primarySci || primaryCommon)) {
      const q = primarySci || primaryCommon!;
      const queries = [
        `${q} growing conditions watering sunlight pruning site:.edu OR site:.gov OR extension`,
        `${q} care guide soil pruning`,
      ];
      if (pc.location_text) queries.push(`${q} garden care ${pc.location_text}`);
      const seen = new Set<string>();
      const candidateWeb: SourceEntry[] = [];
      for (const query of queries) {
        const resp = await fetchJson(TAVILY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            search_depth: 'basic',
            max_results: 6,
            include_answer: false,
          }),
        }, 12000);
        const results = Array.isArray(resp?.results) ? resp.results : [];
        for (const r of results) {
          const url: string | null = normStr(r.url);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          const title = normStr(r.title) || url;
          const snippet = normStr(r.content) || '';
          const cls = classifySource(url, title, snippet);
          if (!cls) continue; // filtered out
          const cats: string[] = [];
          const hay = `${title} ${snippet}`.toLowerCase();
          for (const [cat, keys] of [
            ['watering', ['water', 'irrigat']],
            ['sunlight', ['sun', 'light', 'shade']],
            ['soil', ['soil', 'ph', 'drain']],
            ['pruning', ['prun', 'trim']],
            ['hardiness', ['hardin', 'zone', 'climate', 'frost']],
            ['fruiting', ['fruit', 'harvest', 'yield', 'flower']],
          ] as const) {
            if (keys.some((k) => hay.includes(k))) cats.push(cat);
          }
          candidateWeb.push({
            provider: 'web',
            title,
            url,
            fetchedAt: new Date().toISOString(),
            summary: scrubProductWords(snippet).slice(0, 500),
            careCategories: cats,
            sourceType: cls.sourceType,
            authorityScore: cls.authorityScore,
          });
        }
      }
      // Rank by authority desc, keep the best 3–5.
      candidateWeb.sort((a, b) => authorityRank(b.authorityScore) - authorityRank(a.authorityScore));
      sources.push(...candidateWeb.slice(0, MAX_WEB_SOURCES));
    }

    // Normalize care categories: aggregate short summaries by category from
    // Perenual care sections + Perenual fields + web snippets tagged with the category.
    const perenualSrc = sources.find((s) => s.provider === 'perenual');
    const pFields = (perenualSrc?.fields ?? {}) as any;
    const pCare = pFields.careSections ?? {};
    const webByCat = (cat: string) =>
      sources.filter((s) => s.provider === 'web' && s.careCategories?.includes(cat));

    const buildCat = (
      cat: string,
      perenualParts: (string | null | undefined)[],
    ): CareCategory | null => {
      const perenualText = perenualParts.map((p) => (p == null ? '' : String(p))).filter(Boolean).join(' · ');
      const webItems = webByCat(cat);
      const srcs: CareCategory['sources'] = [];
      const parts: string[] = [];
      if (perenualText) {
        parts.push(perenualText);
        srcs.push({ provider: 'perenual', title: perenualSrc?.title, url: perenualSrc?.url ?? undefined });
      }
      // Prefer higher-authority web items first.
      const sortedWeb = [...webItems].sort(
        (a, b) => authorityRank(b.authorityScore) - authorityRank(a.authorityScore),
      );
      for (const w of sortedWeb.slice(0, 3)) {
        if (w.summary) parts.push(w.summary);
        srcs.push({ provider: 'web', title: w.title, url: w.url ?? undefined });
      }
      const summary = dedupeAndJoin(parts, 1200);
      if (!summary) return null;
      const confidence: CareCategory['confidence'] =
        perenualText && sortedWeb.some((w) => w.authorityScore === 'high')
          ? 'medium'
          : srcs.length >= 2
            ? 'medium'
            : 'low';
      return { summary, confidence, sources: srcs };
    };

    const normalizedCare: Record<string, CareCategory | null> = {
      watering: buildCat('watering', [pFields.watering, pCare.watering, pFields.watering_general_benchmark && `Benchmark: ${JSON.stringify(pFields.watering_general_benchmark)}`]),
      sunlight: buildCat('sunlight', [pFields.sunlight, pCare.sunlight]),
      soil: buildCat('soil', [pFields.soil]),
      pruning: buildCat('pruning', [pFields.pruning_month && `Pruning months: ${pFields.pruning_month}`, pFields.pruning_count && `Pruning count: ${JSON.stringify(pFields.pruning_count)}`, pCare.pruning]),
      hardinessClimate: buildCat('hardiness', [pFields.hardiness && `Hardiness zones: ${JSON.stringify(pFields.hardiness)}`]),
      growthRateMaintenance: buildCat('growth', [pFields.growth_rate && `Growth rate: ${pFields.growth_rate}`, pFields.maintenance && `Maintenance: ${pFields.maintenance}`, pFields.care_level && `Care level: ${pFields.care_level}`]),
      fruitingHarvest: buildCat('fruiting', [pFields.harvest_season && `Harvest season: ${pFields.harvest_season}`, pFields.edible_fruit != null && `Edible fruit: ${pFields.edible_fruit}`]),
    };

    const limitations: string[] = [];
    if (confidenceWarning) {
      limitations.push('Plant identification confidence is low; exact species-specific care may be uncertain.');
    }
    if (!perenualDetails) limitations.push('No structured Perenual care record was found for this plant.');
    if (!sources.some((s) => s.provider === 'web')) limitations.push('No authoritative web sources were retrieved for this grounding pass.');
    limitations.push('Local soil, irrigation, and microclimate conditions were not measured.');

    const anySource = sources.length > 0;
    const status: 'success' | 'partial' | 'error' = !anySource
      ? 'error'
      : perenualDetails && sources.some((s) => s.provider === 'web')
        ? 'success'
        : 'partial';

    const grounding = {
      caseId: pc.id,
      plant: {
        confirmedCommonName: primaryCommon,
        confirmedScientificName: primarySci,
        identificationConfidence: identConfidence,
        confidenceWarning,
      },
      location: {
        text: pc.location_text || null,
        cropContext: pc.crop_context || null,
      },
      sources,
      normalizedCare,
      limitations,
    };

    const insertRow = {
      user_id: userId,
      case_id: caseId,
      goal: 'improve_growth',
      status,
      primary_scientific_name: primarySci,
      primary_common_name: primaryCommon,
      location_text: pc.location_text || null,
      provider_payload: {
        perenual: perenualDetails ?? null,
        perenualCareGuides: perenualCare,
        perenualSpeciesId,
      },
      normalized_summary: {
        plant: grounding.plant,
        location: grounding.location,
        normalizedCare,
        limitations,
      },
      sources,
      error_code: null,
      error_message: null,
      fetched_at: new Date().toISOString(),
    };

    const { data: inserted, error: insErr } = await admin
      .from('plant_case_grounding_contexts')
      .insert(insertRow)
      .select('*')
      .single();
    if (insErr) {
      console.error('[grounding] insert failed', insErr.message);
      return json({ error: 'persist_failed', reason: insErr.message }, 500);
    }

    return json({ ok: true, cached: false, grounding: inserted });
  } catch (e) {
    console.error('[plant-growth-grounding] fatal', (e as Error).message);
    return json({ error: 'internal_error' }, 500);
  }
});
