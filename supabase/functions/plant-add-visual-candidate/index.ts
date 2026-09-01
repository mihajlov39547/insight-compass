// Adds a Visual Second Opinion candidate as a NON-confirmed alternative
// identification for a plant case. Server-side validated: ownership, opinion
// linkage and candidate provenance are all checked before insert.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROVIDER = 'serpapi_google_ai_mode';
const SOURCE = 'visual_second_opinion';
const BASE_RANK = 900;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. Authenticate
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const caseId = String((body as any)?.caseId || '');
    const visualOpinionId = String((body as any)?.visualOpinionId || '');
    const name = String((body as any)?.name || '').trim().slice(0, 200);
    const scientificNameIn = String((body as any)?.scientificName || '').trim().slice(0, 200);
    const commonNameIn = String((body as any)?.commonName || '').trim().slice(0, 200);
    const supportLevel = String((body as any)?.supportLevel || '').trim();
    const reason = String((body as any)?.reason || '').trim().slice(0, 1000);

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(caseId) || !uuid.test(visualOpinionId) || !name) {
      return jsonResponse({ error: 'invalid_input' }, 400);
    }
    if (supportLevel && !['strong', 'moderate', 'weak'].includes(supportLevel)) {
      return jsonResponse({ error: 'invalid_input' }, 400);
    }

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

    // 2. Ownership of the case
    const { data: pcase } = await admin
      .from('plant_cases')
      .select('id,user_id')
      .eq('id', caseId)
      .maybeSingle();
    if (!pcase) return jsonResponse({ error: 'not_found' }, 404);
    if ((pcase as any).user_id !== userId) return jsonResponse({ error: 'forbidden' }, 403);

    // 3. Visual opinion belongs to same case + user
    const { data: opinion } = await admin
      .from('plant_case_visual_opinions')
      .select('id,case_id,user_id,mode,structured_result')
      .eq('id', visualOpinionId)
      .maybeSingle();
    if (!opinion) return jsonResponse({ error: 'not_found' }, 404);
    if ((opinion as any).case_id !== caseId || (opinion as any).user_id !== userId) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    // 4. Candidate must exist in the stored structured result
    const candidates: any[] = Array.isArray((opinion as any).structured_result?.visualCandidates)
      ? (opinion as any).structured_result.visualCandidates
      : [];
    const match = candidates.find((c) => {
      const keys = [c?.name, c?.scientificName, c?.commonName].map(norm).filter(Boolean);
      return keys.includes(norm(name)) || (!!scientificNameIn && keys.includes(norm(scientificNameIn)));
    });
    if (!match) return jsonResponse({ error: 'candidate_not_found' }, 422);
    if (match.matchesConfirmedPlant) return jsonResponse({ error: 'candidate_is_confirmed_plant' }, 409);

    const scientific = String(match.scientificName || scientificNameIn || match.name || name).trim();
    const common = (match.commonName || commonNameIn || null) as string | null;
    const level = ['strong', 'moderate', 'weak'].includes(String(match.supportLevel))
      ? String(match.supportLevel)
      : supportLevel || 'weak';
    const notes = (match.reason || reason || null) as string | null;

    // 7. Duplicate guard (case + provider + scientific name)
    const { data: existing } = await admin
      .from('plant_identifications')
      .select('id,scientific_name')
      .eq('case_id', caseId)
      .eq('provider', PROVIDER);
    const dupe = (existing ?? []).find((r: any) => norm(r.scientific_name) === norm(scientific));
    if (dupe) return jsonResponse({ ok: true, duplicate: true, id: (dupe as any).id });

    // 5. Rank after existing provider candidates
    const { data: ranks } = await admin
      .from('plant_identifications')
      .select('rank')
      .eq('case_id', caseId)
      .order('rank', { ascending: false })
      .limit(1);
    const maxRank = Number((ranks?.[0] as any)?.rank ?? 0);
    const rank = Math.max(BASE_RANK, maxRank + 1);

    const { data: inserted, error: insErr } = await admin
      .from('plant_identifications')
      .insert({
        case_id: caseId,
        user_id: userId,
        provider: PROVIDER,
        project: SOURCE,
        rank,
        score: null,
        scientific_name: scientific,
        scientific_name_without_author: scientific,
        common_name: common,
        genus: scientific.split(/\s+/)[0] ?? null,
        is_confirmed: false, // 6. never auto-confirm
        raw_result: {
          source_type: SOURCE,
          support_level: level,
          notes,
          visual_opinion_id: visualOpinionId,
        },
      })
      .select('id')
      .single();
    if (insErr || !inserted) return jsonResponse({ error: 'insert_failed' }, 500);

    return jsonResponse({ ok: true, id: (inserted as any).id, duplicate: false });
  } catch (_e) {
    return jsonResponse({ error: 'unexpected_error' }, 500);
  }
});
