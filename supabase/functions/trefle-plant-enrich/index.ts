// Trefle plant profile enrichment. Called after a plant identification is
// confirmed. Fetches profile data from Trefle server-side using
// TREFLE_API_KEY and caches it in `plant_species_profiles`.
//
// This function does NOT touch the Plant AI scan usage counter — Trefle is a
// text/profile lookup provider, not an image identification/diagnosis provider.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TREFLE_BASE = 'https://trefle.io/api/v1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface TrefleSearchItem {
  id: number;
  slug: string | null;
  scientific_name: string | null;
  common_name: string | null;
  family: string | null;
  family_common_name?: string | null;
  genus: string | null;
  rank?: string | null;
  status?: string | null;
  year?: number | null;
  author?: string | null;
  bibliography?: string | null;
  image_url: string | null;
  links?: { self?: string; plant?: string; species?: string; genus?: string };
}

async function trefleGet(path: string, token: string): Promise<any | null> {
  const sep = path.includes('?') ? '&' : '?';
  const url = path.startsWith('http') ? `${path}${sep}token=${encodeURIComponent(token)}` : `${TREFLE_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      console.warn('[trefle] non-ok', resp.status, path);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('[trefle] fetch failed', (e as Error).message);
    return null;
  }
}

function normalizeName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function pickBestMatch(items: TrefleSearchItem[], scientificName: string): TrefleSearchItem | null {
  if (!items || items.length === 0) return null;
  const target = normalizeName(scientificName);
  const exact = items.find(
    (i) => normalizeName(i.scientific_name) === target,
  );
  if (exact) return exact;
  const accepted = items.find((i) => (i.status || '').toLowerCase() === 'accepted');
  if (accepted) return accepted;
  return items[0];
}

function stripAuthor(scientificName: string): string {
  // Rough: keep first two whitespace-separated tokens (Genus species).
  const parts = scientificName.trim().split(/\s+/);
  if (parts.length <= 2) return scientificName.trim();
  return `${parts[0]} ${parts[1]}`;
}

function normalizeProfile(match: TrefleSearchItem, detail: any): Record<string, unknown> {
  const data = detail?.data ?? detail ?? {};
  const mainSpecies = data.main_species ?? data;
  const growth = mainSpecies?.growth ?? data?.growth ?? null;
  const specifications = mainSpecies?.specifications ?? data?.specifications ?? null;
  const images = mainSpecies?.images ?? data?.images ?? null;
  const imagesByOrgan: Record<string, Array<{ id?: number; url?: string; copyright?: string }>> = {};
  if (images && typeof images === 'object') {
    for (const [organ, arr] of Object.entries(images)) {
      if (Array.isArray(arr)) {
        imagesByOrgan[organ] = arr.slice(0, 8).map((im: any) => ({
          id: im?.id,
          url: im?.image_url ?? im?.url,
          copyright: im?.copyright ?? null,
        }));
      }
    }
  }

  return {
    provider: 'trefle',
    trefleId: data?.id ?? match.id ?? null,
    slug: data?.slug ?? match.slug ?? null,
    scientificName: data?.scientific_name ?? match.scientific_name ?? null,
    commonName: data?.common_name ?? match.common_name ?? null,
    family: data?.family ?? match.family ?? null,
    familyCommonName: data?.family_common_name ?? match.family_common_name ?? null,
    genus: data?.genus ?? match.genus ?? null,
    rank: data?.rank ?? match.rank ?? null,
    status: data?.status ?? match.status ?? null,
    year: data?.year ?? match.year ?? null,
    author: data?.author ?? match.author ?? null,
    bibliography: data?.bibliography ?? match.bibliography ?? null,
    synonyms: Array.isArray(mainSpecies?.synonyms)
      ? mainSpecies.synonyms.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean)
      : [],
    commonNames: mainSpecies?.common_names ?? null,
    imageUrl: data?.image_url ?? mainSpecies?.image_url ?? match.image_url ?? null,
    imagesByOrgan,
    distributions: mainSpecies?.distributions ?? data?.distributions ?? null,
    duration: mainSpecies?.duration ?? null,
    edible: mainSpecies?.edible ?? null,
    ediblePart: mainSpecies?.edible_part ?? null,
    vegetable: mainSpecies?.vegetable ?? null,
    toxicity: specifications?.toxicity ?? mainSpecies?.toxicity ?? null,
    specifications,
    growth,
    sources: mainSpecies?.sources ?? data?.sources ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const trefleToken = Deno.env.get('TREFLE_API_KEY');
    if (!trefleToken) return json({ error: 'missing_trefle_token' }, 503);

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const caseId = String(body?.plantCaseId || '');
    const explicitIdentId = body?.identificationId ? String(body.identificationId) : null;
    const force = !!body?.force;
    if (!caseId) return json({ error: 'missing_case_id' }, 400);

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

    const { data: pc } = await admin
      .from('plant_cases')
      .select('id, user_id, confirmed_identification_id')
      .eq('id', caseId)
      .maybeSingle();
    if (!pc) return json({ error: 'case_not_found' }, 404);
    if ((pc as any).user_id !== userId) return json({ error: 'forbidden' }, 403);

    const identId = explicitIdentId || (pc as any).confirmed_identification_id;
    if (!identId) return json({ error: 'no_confirmed_identification' }, 400);

    const { data: ident } = await admin
      .from('plant_identifications')
      .select('id, case_id, scientific_name, scientific_name_without_author, common_name, genus, family, is_confirmed')
      .eq('id', identId)
      .maybeSingle();
    if (!ident || (ident as any).case_id !== caseId) return json({ error: 'identification_not_found' }, 404);

    // Cache lookup by identification_id.
    if (!force) {
      const { data: cached } = await admin
        .from('plant_species_profiles')
        .select('*')
        .eq('identification_id', identId)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached && (cached as any).fetched_at) {
        const age = Date.now() - new Date((cached as any).fetched_at).getTime();
        if (age < CACHE_TTL_MS) {
          return json({ ok: true, profile: cached, cached: true });
        }
      }
    }

    const sciFull =
      (ident as any).scientific_name_without_author ||
      (ident as any).scientific_name ||
      '';
    const sciStripped = stripAuthor(sciFull);
    const commonName = (ident as any).common_name as string | null;
    const genus = (ident as any).genus as string | null;

    // Strategy 1: exact scientific name.
    let match: TrefleSearchItem | null = null;
    for (const q of [sciFull, sciStripped, [genus, commonName].filter(Boolean).join(' ')].filter(Boolean)) {
      const searchRes = await trefleGet(`/plants/search?q=${encodeURIComponent(q)}`, trefleToken);
      const items = (searchRes?.data ?? []) as TrefleSearchItem[];
      match = pickBestMatch(items, sciFull || q);
      if (match) break;
    }

    if (!match) {
      return json({ ok: false, error: 'no_trefle_match' }, 404);
    }

    // Prefer species detail if available; fall back to plant detail.
    const speciesLink = match.links?.species || match.links?.self;
    const plantLink = match.links?.plant;
    let detail = speciesLink ? await trefleGet(speciesLink, trefleToken) : null;
    if (!detail && plantLink) detail = await trefleGet(plantLink, trefleToken);

    const profile = normalizeProfile(match, detail);

    // Upsert (delete + insert to keep it simple).
    await admin
      .from('plant_species_profiles')
      .delete()
      .eq('identification_id', identId);

    const { data: inserted, error: insErr } = await admin
      .from('plant_species_profiles')
      .insert({
        case_id: caseId,
        user_id: userId,
        identification_id: identId,
        provider: 'trefle',
        provider_id: profile.trefleId ? String(profile.trefleId) : null,
        slug: profile.slug ?? null,
        scientific_name: profile.scientificName ?? null,
        common_name: profile.commonName ?? null,
        family: profile.family ?? null,
        genus: profile.genus ?? null,
        status: profile.status ?? null,
        rank: profile.rank ?? null,
        profile,
        fetched_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insErr) {
      console.error('[trefle] insert failed', insErr.message);
      return json({ error: 'profile_save_failed' }, 500);
    }

    return json({ ok: true, profile: inserted, cached: false });
  } catch (e) {
    console.error('[trefle-plant-enrich] fatal', (e as Error).message);
    return json({ error: 'internal_error' }, 500);
  }
});
