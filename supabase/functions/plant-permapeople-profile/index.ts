// Permapeople plant profile enrichment (read-only).
//
// Called after a plant identification is confirmed. Searches Permapeople by
// scientific name (then common name), ranks the candidates, fetches the full
// plant record and stores a normalized profile in
// `plant_case_external_profiles` under provider = 'permapeople'.
//
// This function never creates or updates plants in Permapeople, and never
// touches the Plant AI scan usage counter (text lookup, not image scan).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PP_BASE = 'https://permapeople.org/api';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface PermaPlant {
  id: number;
  type?: string | null;
  scientific_name?: string | null;
  name?: string | null;
  description?: string | null;
  link?: string | null;
  slug?: string | null;
  parent_id?: number | null;
  version?: number | null;
  images?: { thumb?: string | null; title?: string | null } | null;
  data?: Array<{ key?: string; value?: string | null }> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Resolves the Permapeople credentials. The user may have stored both values in
 * PERMAPEOPLE_API_KEY (as "id:secret" / "id|secret" / JSON), or as two secrets.
 */
function resolveCredentials(): { keyId: string; keySecret: string } | null {
  const combined = (Deno.env.get('PERMAPEOPLE_API_KEY') || '').trim();
  const explicitId = (Deno.env.get('PERMAPEOPLE_KEY_ID') || '').trim();
  const explicitSecret = (Deno.env.get('PERMAPEOPLE_KEY_SECRET') || '').trim();

  if (explicitId && explicitSecret) return { keyId: explicitId, keySecret: explicitSecret };
  // Most common setup here: KEY_ID holds the id, API_KEY holds the secret.
  if (explicitId && combined && !/[:|]/.test(combined)) {
    return { keyId: explicitId, keySecret: combined };
  }
  if (combined) {
    if (combined.startsWith('{')) {
      try {
        const parsed = JSON.parse(combined);
        const id = String(parsed?.keyId ?? parsed?.key_id ?? parsed?.id ?? '').trim();
        const secret = String(parsed?.keySecret ?? parsed?.key_secret ?? parsed?.secret ?? '').trim();
        if (id && secret) return { keyId: id, keySecret: secret };
      } catch {
        // fall through
      }
    }
    const parts = combined.split(/[:|]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { keyId: parts[0], keySecret: parts.slice(1).join(':') };
    if (explicitId) return { keyId: explicitId, keySecret: combined };
  }
  if (explicitId && explicitSecret) return { keyId: explicitId, keySecret: explicitSecret };
  return null;
}

async function ppFetch(
  path: string,
  creds: { keyId: string; keySecret: string },
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`${PP_BASE}${path}`, {
      method: init?.method ?? 'GET',
      signal: controller.signal,
      headers: {
        'x-permapeople-key-id': creds.keyId,
        'x-permapeople-key-secret': creds.keySecret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) {
    console.warn('[permapeople] fetch failed', path, (e as Error).name);
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const genusOf = (s: string | null | undefined) => norm(s).split(' ')[0] ?? '';
function stripAuthor(sci: string): string {
  const parts = sci.trim().split(/\s+/);
  return parts.length <= 2 ? sci.trim() : `${parts[0]} ${parts[1]}`;
}

type MatchConfidence = 'high' | 'medium' | 'low';

function rankMatch(
  items: PermaPlant[],
  scientificName: string,
  commonName: string | null,
): { plant: PermaPlant; confidence: MatchConfidence } | null {
  const list = (items ?? []).filter((p) => p && typeof p.id === 'number');
  if (list.length === 0) return null;
  const sci = norm(stripAuthor(scientificName));
  const sciFull = norm(scientificName);
  const common = norm(commonName);
  const genus = genusOf(sci);

  const isSpecies = (p: PermaPlant) => (p.type ?? 'Plant') !== 'Variety';

  const exact = list.filter((p) => norm(p.scientific_name) === sci || norm(p.scientific_name) === sciFull);
  if (exact.length > 0) {
    return { plant: exact.find(isSpecies) ?? exact[0], confidence: 'high' };
  }
  if (genus) {
    const sameGenus = list.filter((p) => genusOf(p.scientific_name) === genus);
    if (sameGenus.length > 0) {
      return { plant: sameGenus.find(isSpecies) ?? sameGenus[0], confidence: 'medium' };
    }
  }
  if (common) {
    const byCommon = list.filter((p) => norm(p.name) === common);
    if (byCommon.length > 0) {
      return { plant: byCommon.find(isSpecies) ?? byCommon[0], confidence: 'low' };
    }
  }
  return { plant: list.find(isSpecies) ?? list[0], confidence: 'low' };
}

function normalizePermapeopleData(
  data: Array<{ key?: string; value?: string | null }> | null | undefined,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const item of data ?? []) {
    if (!item?.key) continue;
    out[item.key] = item.value ?? null;
  }
  return out;
}

function buildNormalized(plant: PermaPlant) {
  const attrs = normalizePermapeopleData(plant.data);
  return {
    attributes: attrs,
    family: attrs['Family'] ?? null,
    waterRequirement: attrs['Water requirement'] ?? null,
    lightRequirement: attrs['Light requirement'] ?? null,
    soilType: attrs['Soil type'] ?? null,
    hardinessZone: attrs['USDA Hardiness zone'] ?? null,
    growth: attrs['Growth'] ?? null,
    layer: attrs['Layer'] ?? null,
    edible: attrs['Edible'] ?? null,
    edibleParts: attrs['Edible parts'] ?? null,
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

    const creds = resolveCredentials();
    if (!creds) return json({ error: 'missing_permapeople_credentials' }, 503);

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const caseId = String(body?.caseId || body?.plantCaseId || '');
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

    let scientificName = typeof body?.scientificName === 'string' ? body.scientificName.trim() : '';
    let commonName = typeof body?.commonName === 'string' ? body.commonName.trim() : '';

    const identId = (pc as any).confirmed_identification_id as string | null;
    if (identId) {
      const { data: ident } = await admin
        .from('plant_identifications')
        .select('scientific_name, scientific_name_without_author, common_name')
        .eq('id', identId)
        .maybeSingle();
      if (ident) {
        scientificName =
          (ident as any).scientific_name_without_author ||
          (ident as any).scientific_name ||
          scientificName;
        commonName = (ident as any).common_name || commonName;
      }
    }
    if (!scientificName && !commonName) return json({ error: 'no_confirmed_identification' }, 400);

    // Cache lookup.
    if (!force) {
      const { data: cached } = await admin
        .from('plant_case_external_profiles')
        .select('*')
        .eq('case_id', caseId)
        .eq('provider', 'permapeople')
        .maybeSingle();
      if (cached && (cached as any).fetched_at) {
        const age = Date.now() - new Date((cached as any).fetched_at).getTime();
        if (age < CACHE_TTL_MS) {
          return json({ ok: true, profile: cached, cached: true });
        }
      }
    }

    const queries = [
      scientificName ? stripAuthor(scientificName) : '',
      scientificName && stripAuthor(scientificName) !== scientificName ? scientificName : '',
      commonName,
    ].filter(Boolean);

    let match: { plant: PermaPlant; confidence: MatchConfidence } | null = null;
    for (const q of queries) {
      const res = await ppFetch('/search', creds, {
        method: 'POST',
        body: { q },
      });
      console.log('[permapeople] search', {
        status: res.status,
        ok: res.ok,
        results: Array.isArray(res.data?.plants) ? res.data.plants.length : null,
      });
      if (res.status === 401) {
        console.warn('[permapeople] auth rejected');
        return json({ error: 'permapeople_unauthorized' }, 502);
      }
      if (!res.ok) continue;
      const items = (res.data?.plants ?? []) as PermaPlant[];
      const ranked = rankMatch(items, scientificName || q, commonName || null);
      if (ranked) {
        // A common-name-only query can never be better than "low".
        if (!scientificName && ranked.confidence === 'high') ranked.confidence = 'medium';
        match = ranked;
        if (ranked.confidence === 'high') break;
      }
    }

    if (!match) {
      console.log('[permapeople] no match', { caseId, provider: 'permapeople', status: 'no_match' });
      return json({ ok: false, error: 'no_permapeople_match' }, 404);
    }

    // Fetch the full record (search results can be partial).
    let plant = match.plant;
    const detail = await ppFetch(`/plants/${plant.id}`, creds);
    if (detail.ok && detail.data && typeof detail.data?.id === 'number') {
      plant = detail.data as PermaPlant;
    }

    const normalized = buildNormalized(plant);
    const sourceUrl = plant.link
      ? `https://permapeople.org${plant.link.startsWith('/') ? '' : '/'}${plant.link}`
      : plant.slug
        ? `https://permapeople.org/plants/${plant.slug}`
        : null;

    const payload = {
      user_id: userId,
      case_id: caseId,
      provider: 'permapeople',
      provider_plant_id: String(plant.id),
      scientific_name: plant.scientific_name ?? null,
      common_name: plant.name ?? null,
      family: normalized.family,
      genus: plant.scientific_name ? plant.scientific_name.trim().split(/\s+/)[0] : null,
      type: plant.type ?? 'Plant',
      match_confidence: match.confidence,
      source_url: sourceUrl,
      image_thumb_url: plant.images?.thumb ?? null,
      image_title_url: plant.images?.title ?? null,
      profile_payload: {
        id: plant.id,
        type: plant.type ?? null,
        scientific_name: plant.scientific_name ?? null,
        name: plant.name ?? null,
        description: plant.description ?? null,
        link: plant.link ?? null,
        slug: plant.slug ?? null,
        parent_id: plant.parent_id ?? null,
        version: plant.version ?? null,
        images: { thumb: plant.images?.thumb ?? null, title: plant.images?.title ?? null },
        data: plant.data ?? [],
        created_at: plant.created_at ?? null,
        updated_at: plant.updated_at ?? null,
        queriedScientificName: scientificName || null,
        queriedCommonName: commonName || null,
      },
      normalized_data: normalized,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: upsertErr } = await admin
      .from('plant_case_external_profiles')
      .upsert(payload, { onConflict: 'case_id,provider' })
      .select('*')
      .single();
    if (upsertErr) {
      console.error('[permapeople] save failed', upsertErr.message);
      return json({ error: 'profile_save_failed' }, 500);
    }

    console.log('[permapeople] stored', {
      caseId,
      provider: 'permapeople',
      status: 'ok',
      matchConfidence: match.confidence,
    });

    return json({ ok: true, profile: saved, cached: false });
  } catch (e) {
    console.error('[plant-permapeople-profile] fatal', (e as Error).message);
    return json({ error: 'internal_error' }, 500);
  }
});
