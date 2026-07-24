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

// Strip page boilerplate / navigation fragments frequently returned by
// Tavily-style scrapes so care cards don't display debug-like text.
function stripBoilerplate(input: string): string {
  if (!input) return '';
  let t = String(input);
  // Remove leading field-label prefixes like "Title:", "Description:", etc.
  t = t.replace(/\b(Title|Description|Summary|URL|Author|Published|Source|Menu|Show\s*Menu|Plant\s*Details?|Home|Sign\s*In)\s*[:—–-]\s*/gi, ' ');
  // Drop lone navigation-y tokens.
  t = t.replace(/\b(Show Menu|Plant Detail|Skip to (?:main )?content|Read more|Toggle navigation)\b/gi, ' ');
  // Strip markdown heading markers and horizontal-rule lines.
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^[=\-*_]{3,}\s*$/gm, '');
  // Collapse breadcrumb separators.
  t = t.replace(/\s*[|›»]\s*/g, ' ');
  // Strip stray bracketed edit/citation refs.
  t = t.replace(/\[(edit|citation needed|\d+)\]/gi, '');
  return t.replace(/\s+/g, ' ').trim();
}

function trimToSentence(s: string, max = 260): string {
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut).trim() + '…';
}

function hostFamily(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    return parts.slice(-2).join('.');
  } catch {
    return '';
  }
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
  return kept.join(' ').slice(0, maxLen);
}

// Turn structured Perenual boolean/object fields into readable phrases. Booleans
// that would surface as bare "true"/"false"/"0"/"1" are converted or omitted.
function boolPhrase(field: string, val: unknown): string | null {
  const truthy = val === true || val === 1 || val === '1';
  const falsy = val === false || val === 0 || val === '0';
  if (!truthy && !falsy) return null;
  const map: Record<string, [string, string | null]> = {
    edible_fruit: ['Edible fruit: yes', null],
    poisonous_to_humans: ['Reported toxic to humans in this source', null],
    poisonous_to_pets: ['Reported toxic to pets in this source', null],
    drought_tolerant: ['Considered drought tolerant', null],
    salt_tolerant: ['Considered salt tolerant', null],
  };
  const entry = map[field];
  if (!entry) return null;
  return truthy ? entry[0] : entry[1];
}

function fmtWaterBenchmark(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const val = (v as any).value;
  const unit = (v as any).unit;
  if (val == null || val === '' || val === 0 || val === '0') return null;
  return `Watering benchmark: ${val}${unit ? ' ' + String(unit).toLowerCase() : ''}`;
}

function fmtPruningCount(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const amount = (v as any).amount;
  const interval = (v as any).interval;
  if (!amount || amount === 0) return null;
  const n = Number(amount);
  return `Prune approximately ${amount} time${n > 1 ? 's' : ''}${interval ? ` per ${interval}` : ''}`;
}

function fmtHardiness(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const min = (v as any).min;
  const max = (v as any).max;
  if (min == null && max == null) return null;
  return `USDA hardiness zones ${min ?? '?'}–${max ?? '?'}`;
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

    // 3) Tavily web grounding — plant-specific queries first, then narrower
    // care queries. Rank by plant relevance > care relevance > authority.
    // Care cards require BOTH plant relevance and category relevance.
    const webDebug: Array<{
      query: string;
      url: string;
      title: string;
      score: number | null;
      matchedPlantTerms: string[];
      matchedCareTerms: string[];
      authorityScore: AuthorityScore | null;
      acceptedForSources: boolean;
      acceptedForCareCards: boolean;
      rejectionReason?: string;
    }> = [];
    let tavilyAnswer: string | null = null;

    // Care keyword taxonomy (used both for tagging and for care-card gating).
    const CARE_KEYWORDS: Array<[string, readonly string[]]> = [
      ['watering', ['water', 'irrigat', 'moist', 'drought']],
      ['sunlight', ['sun', 'shade', 'light', 'partial', 'full sun']],
      ['soil', ['soil', 'ph', 'drain', 'loam', 'sandy', 'clay']],
      ['pruning', ['prun', 'trim', 'cut back']],
      ['hardiness', ['hardin', 'zone', 'climate', 'frost', 'cold-hardy']],
      ['fruiting', ['fruit', 'harvest', 'yield', 'flower', 'bloom', 'berry']],
    ];

    // Plant-term matcher: prefer scientific + common name tokens.
    const plantTerms: string[] = [];
    if (primarySci) plantTerms.push(primarySci.toLowerCase());
    if (primaryCommon) plantTerms.push(primaryCommon.toLowerCase());
    if (genus) plantTerms.push(genus.toLowerCase());
    // Also accept genus token from scientific name if present.
    if (primarySci) {
      const g = primarySci.split(/\s+/)[0];
      if (g && !plantTerms.includes(g.toLowerCase())) plantTerms.push(g.toLowerCase());
    }
    const matchPlantTerms = (hay: string): string[] =>
      plantTerms.filter((t) => t && hay.includes(t));

    if (tavilyKey && (primarySci || primaryCommon)) {
      const sci = primarySci || '';
      const common = primaryCommon || '';
      const label = sci && common ? `${sci} / ${common}` : sci || common;

      // 1st: simple plant-specific query. 2nd+: narrower care queries.
      const queries: Array<{ q: string; depth: 'basic' | 'advanced'; answer: 'basic' | 'advanced' | false; max: number }> = [
        { q: label, depth: 'advanced', answer: 'advanced', max: 5 },
      ];
      const base = [sci, common].filter(Boolean).join(' ').trim();
      if (base) {
        queries.push({ q: `${base} care`, depth: 'basic', answer: false, max: 5 });
        queries.push({ q: `${base} growing conditions`, depth: 'basic', answer: false, max: 5 });
        queries.push({ q: `${base} pruning sunlight soil watering`, depth: 'basic', answer: false, max: 5 });
        queries.push({ q: `${base} extension`, depth: 'basic', answer: false, max: 5 });
      }

      const seen = new Set<string>();
      const primary: Array<SourceEntry & { _plantMatches: string[]; _score: number }> = [];
      const background: Array<SourceEntry & { _plantMatches: string[]; _score: number }> = [];

      for (const { q: query, depth, answer, max } of queries) {
        const resp = await fetchJson(TAVILY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            search_depth: depth,
            max_results: max,
            include_answer: answer,
          }),
        }, 15000);

        if (!tavilyAnswer && typeof resp?.answer === 'string' && resp.answer.trim()) {
          tavilyAnswer = resp.answer.trim();
        }

        const results = Array.isArray(resp?.results) ? resp.results : [];
        for (const r of results) {
          const url: string | null = normStr(r.url);
          if (!url) continue;
          const title = normStr(r.title) || url;
          const snippet = normStr(r.content) || '';
          const score = typeof r?.score === 'number' ? r.score : null;
          const hay = `${title} ${snippet}`.toLowerCase();
          const cls = classifySource(url, title, snippet);
          const plantMatches = matchPlantTerms(hay);
          const cats: string[] = [];
          for (const [cat, keys] of CARE_KEYWORDS) {
            if (keys.some((k) => hay.includes(k))) cats.push(cat);
          }

          const dbg = {
            query,
            url,
            title,
            score,
            matchedPlantTerms: plantMatches,
            matchedCareTerms: cats,
            authorityScore: cls?.authorityScore ?? null,
            acceptedForSources: false,
            acceptedForCareCards: false,
            rejectionReason: undefined as string | undefined,
          };

          if (seen.has(url)) {
            dbg.rejectionReason = 'duplicate';
            webDebug.push(dbg);
            continue;
          }
          if (!cls) {
            dbg.rejectionReason = 'blocked_domain_or_path';
            webDebug.push(dbg);
            seen.add(url);
            continue;
          }
          seen.add(url);

          const cleanedSnippet = trimToSentence(
            scrubProductWords(stripBoilerplate(snippet)),
            360,
          );
          const entry: SourceEntry & { _plantMatches: string[]; _score: number } = {
            provider: 'web',
            title: stripBoilerplate(title).slice(0, 200) || url,
            url,
            fetchedAt: new Date().toISOString(),
            summary: cleanedSnippet,
            careCategories: cats,
            sourceType: cls.sourceType,
            authorityScore: cls.authorityScore,
            _plantMatches: plantMatches,
            _score: score ?? 0,
          };

          if (plantMatches.length > 0) {
            dbg.acceptedForSources = true;
            dbg.acceptedForCareCards = cats.length > 0;
            primary.push(entry);
          } else {
            dbg.rejectionReason = 'no_plant_term_match';
            background.push(entry);
          }
          webDebug.push(dbg);
        }
      }

      // If Tavily returned an answer, expose it as a general summary source
      // (not tied to any care category — those still require category evidence).
      if (tavilyAnswer) {
        sources.push({
          provider: 'web',
          title: `Web summary: ${label}`,
          url: null,
          fetchedAt: new Date().toISOString(),
          summary: trimToSentence(scrubProductWords(stripBoilerplate(tavilyAnswer)), 600),
          careCategories: [],
          sourceType: 'other',
          authorityScore: 'medium',
        });
      }

      // Rank: plant relevance first (already partitioned), then care-category
      // count, then authority, then Tavily score.
      const rankPrimary = (a: typeof primary[number], b: typeof primary[number]) => {
        const catDiff = (b.careCategories?.length ?? 0) - (a.careCategories?.length ?? 0);
        if (catDiff !== 0) return catDiff;
        const authDiff = authorityRank(b.authorityScore) - authorityRank(a.authorityScore);
        if (authDiff !== 0) return authDiff;
        return (b._score ?? 0) - (a._score ?? 0);
      };
      primary.sort(rankPrimary);
      background.sort((a, b) => authorityRank(b.authorityScore) - authorityRank(a.authorityScore));

      // Push only plant-relevant results into the primary sources list.
      for (const p of primary.slice(0, MAX_WEB_SOURCES)) {
        const { _plantMatches, _score, ...rest } = p;
        sources.push(rest);
      }
      // Stash background candidates via debug payload (available for future UI).
      (webDebug as any).__background = background.slice(0, 5).map(({ _plantMatches, _score, ...rest }) => rest);
    }

    // Normalize care categories: build clean, user-facing summaries composed
    // primarily from structured Perenual fields + at most one snippet per
    // domain family from authoritative web sources. Raw Tavily snippets are
    // never dumped verbatim into cards.
    const perenualSrc = sources.find((s) => s.provider === 'perenual');
    const pFields = (perenualSrc?.fields ?? {}) as any;
    const pCare = pFields.careSections ?? {};
    const webByCat = (cat: string) =>
      sources.filter((s) => s.provider === 'web' && s.careCategories?.includes(cat));

    const buildCat = (
      cat: string,
      structuredParts: (string | null | undefined)[],
    ): CareCategory | null => {
      const structured = structuredParts
        .map((p) => (p == null ? '' : String(p).trim()))
        .filter((p) => p && p !== 'true' && p !== 'false' && p !== '0' && p !== '1');
      const webItems = webByCat(cat);
      const srcs: CareCategory['sources'] = [];
      const parts: string[] = [];
      if (structured.length) {
        parts.push(structured.join('. ') + (structured[structured.length - 1]!.endsWith('.') ? '' : '.'));
        srcs.push({ provider: 'perenual', title: perenualSrc?.title, url: perenualSrc?.url ?? undefined });
      }
      // Prefer higher-authority web items first, and use at most one snippet
      // per host family so we don't repeat the same domain inside one card.
      const sortedWeb = [...webItems].sort(
        (a, b) => authorityRank(b.authorityScore) - authorityRank(a.authorityScore),
      );
      const seenHosts = new Set<string>();
      for (const w of sortedWeb) {
        const family = hostFamily(w.url);
        if (family && seenHosts.has(family)) continue;
        if (family) seenHosts.add(family);
        const cleaned = trimToSentence(scrubProductWords(stripBoilerplate(w.summary || '')), 260);
        if (cleaned && cleaned.length >= 40) {
          parts.push(cleaned);
          srcs.push({ provider: 'web', title: w.title, url: w.url ?? undefined });
          if (parts.length >= (structured.length ? 2 : 3)) break;
        }
      }
      const summary = dedupeAndJoin(parts, 900);
      if (!summary || summary.length < 20) return null;
      const confidence: CareCategory['confidence'] =
        structured.length && sortedWeb.some((w) => w.authorityScore === 'high')
          ? 'medium'
          : srcs.length >= 2
            ? 'medium'
            : 'low';
      return { summary, confidence, sources: srcs };
    };

    const normalizedCare: Record<string, CareCategory | null> = {
      watering: buildCat('watering', [
        pFields.watering && `Watering need: ${String(pFields.watering).toLowerCase()}`,
        pCare.watering,
        fmtWaterBenchmark(pFields.watering_general_benchmark),
        boolPhrase('drought_tolerant', pFields.drought_tolerant),
      ]),
      sunlight: buildCat('sunlight', [
        pFields.sunlight && `Preferred exposure: ${pFields.sunlight}`,
        pCare.sunlight,
      ]),
      soil: buildCat('soil', [
        pFields.soil && `Preferred soil: ${pFields.soil}`,
        boolPhrase('salt_tolerant', pFields.salt_tolerant),
        pCare.soil,
      ]),
      pruning: buildCat('pruning', [
        pFields.pruning_month && `Typical pruning months: ${pFields.pruning_month}`,
        fmtPruningCount(pFields.pruning_count),
        pCare.pruning,
      ]),
      hardinessClimate: buildCat('hardiness', [
        fmtHardiness(pFields.hardiness),
        pCare.hardiness,
      ]),
      growthRateMaintenance: buildCat('growth', [
        pFields.growth_rate && `Growth rate: ${pFields.growth_rate}`,
        pFields.maintenance && `Maintenance: ${pFields.maintenance}`,
        pFields.care_level && `Care level: ${pFields.care_level}`,
      ]),
      fruitingHarvest: buildCat('fruiting', [
        pFields.harvest_season && `Harvest season: ${pFields.harvest_season}`,
        boolPhrase('edible_fruit', pFields.edible_fruit),
      ]),
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
        tavilyAnswer,
        webDebug,
        webBackgroundSources: (webDebug as any).__background ?? [],
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
