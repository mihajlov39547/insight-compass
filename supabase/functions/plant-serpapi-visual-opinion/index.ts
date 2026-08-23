// @ts-nocheck
// SerpAPI Google AI Mode — visual SECOND OPINION for Plant Advisor.
//
// This is NOT the primary provider: Pl@ntNet remains the plant identification
// authority and Pl@ntNet diseases remains the structured diagnosis provider.
// This function only adds visual context: obvious wrong-image detection, a
// second interpretation, photo-quality / missing-photo guidance and diagnosis
// verification support.
//
// Never returns chemical treatment specifics, and never surfaces the identity
// of a person: non-plant images are normalized to "not a plant".
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { fetchDriveFileMedia, readDriveEnv } from '../_shared/plant-drive.ts';
import {
  normalizeSerpAiModeResult,
  type VisualOpinionMode,
} from '../_shared/plant-visual-opinion.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const PROVIDER = 'serpapi_google_ai_mode';
const SERPAPI_URL = 'https://serpapi.com/search.json';
const BUCKET = 'plant-case-images';
const TEMP_BUCKET = 'plant-identification-temp';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNED_URL_TTL_S = 900;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const IDENTIFY_ROLE_PREFERENCE = ['whole_plant', 'leaf', 'flower', 'fruit', 'stem', 'bark', 'other', 'auto', 'root'];
const DIAGNOSE_ROLE_PREFERENCE = ['leaf', 'fruit', 'stem', 'flower', 'whole_plant', 'bark', 'other', 'auto', 'root'];

type PlanId = 'free' | 'basic' | 'premium' | 'enterprise';
function normalizePlan(v: unknown): PlanId {
  if (v === 'basic' || v === 'premium' || v === 'enterprise' || v === 'free') return v;
  return 'free';
}
function monthlyLimitForPlan(plan: PlanId): number {
  if (plan === 'basic') return 25;
  if (plan === 'premium') return 100;
  if (plan === 'enterprise') return 1000;
  return 3;
}

function buildQuery(
  mode: VisualOpinionMode,
  lang: 'en' | 'sr',
  plantName: string | null,
  scientificName: string | null,
  diagnosisName: string | null,
): string {
  if (mode === 'identify') {
    if (!plantName && !scientificName) {
      return lang === 'sr'
        ? 'Identifikuj ovu biljku. Ako slika ne prikazuje biljku, jasno to reci. Ako biljka ne može pouzdano da se identifikuje, objasni koje dodatne fotografije su potrebne. Ne daj savete za tretman.'
        : 'Identify this plant. If the image does not show a plant, say that clearly. If the plant cannot be identified reliably, explain what additional photos are needed. Do not give treatment advice.';
    }
    const common = plantName || scientificName;
    const sci = scientificName || plantName;
    return lang === 'sr'
      ? `Ovaj slučaj trenutno identifikuje biljku kao ${common} (${sci}). Pregledaj sliku kao drugo mišljenje. Reci da li slika deluje usklađeno sa tom biljkom, navedi moguće alternative ako su vidljive i napiši koji detalji/fotografije su potrebni za proveru. Ne daj savete za tretman.`
      : `This case currently identifies the plant as ${common} (${sci}). Review the image as a second opinion. Say whether the image appears consistent with that plant, mention possible alternatives if visible, and list what details/photos are needed to verify. Do not give treatment advice.`;
  }

  const name = plantName || scientificName || (lang === 'sr' ? 'biljci' : 'plant');
  if (diagnosisName) {
    return lang === 'sr'
      ? `Trenutno potvrđena dijagnoza je ${diagnosisName}. Pregledaj sliku kao drugo mišljenje za biljku ${name}. Reci da li vidljivi dokazi deluju usklađeno sa tom dijagnozom, da li druga kategorija problema deluje verovatnije i koje fotografije/dokazi su potrebni za proveru. Ne daj hemijska uputstva za tretman.`
      : `The current confirmed diagnosis is ${diagnosisName}. Review the image as a second opinion for ${name}. Say whether the visible evidence appears consistent with that diagnosis, whether another problem category seems more plausible, and what photos/evidence are needed to verify. Do not provide chemical treatment instructions.`;
  }
  return lang === 'sr'
    ? `Identifikuj vidljiv problem ili simptome bolesti na biljci ${name}. Ako slika ne prikazuje biljku ili simptomi nisu vidljivi, jasno to reci. Fokusiraj se na vidljive simptome, moguće kategorije problema i koje fotografije/dokazi su potrebni dalje. Ne navodi pesticide, fungicide, herbicide, aktivne materije, doze, mešanje, raspored prskanja ili hemijska uputstva za primenu.`
    : `Identify the visible plant problem or disease symptoms on this ${name}. If the image does not show a plant or symptoms are not visible, say that clearly. Focus on visible symptoms, likely problem categories, and what photos/evidence are needed next. Do not provide pesticide, fungicide, herbicide, active ingredient, dose, mixing rate, spray schedule, or chemical application instructions.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supaUrl || !serviceKey || !anonKey) return json({ error: 'server_misconfigured' }, 500);

  // Reuse the project's existing SerpAPI secret name; SERPAPI_API_KEY is a fallback.
  const serpKey = (Deno.env.get('SERPAPI_KEY') || Deno.env.get('SERPAPI_API_KEY') || '').trim();

  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'unauthorized' }, 401);
    const userClient = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const caseId = String(body?.caseId || '');
    const mode: VisualOpinionMode = body?.mode === 'diagnose' ? 'diagnose' : 'identify';
    const imageId = body?.imageId ? String(body.imageId) : null;
    const force = body?.force === true;
    if (!caseId) return json({ error: 'missing_case_id' }, 400);

    const admin = createClient(supaUrl, serviceKey);

    const { data: pc, error: pcErr } = await admin
      .from('plant_cases')
      .select('id, user_id, user_goal, location_text, crop_context, notes, confirmed_identification_id')
      .eq('id', caseId)
      .maybeSingle();
    if (pcErr) return json({ error: 'case_lookup_failed' }, 500);
    if (!pc) return json({ error: 'case_not_found' }, 404);
    if (pc.user_id !== userId) return json({ error: 'forbidden' }, 403);

    // Existing (cached) opinion.
    const { data: existing } = await admin
      .from('plant_case_visual_opinions')
      .select('*')
      .eq('case_id', caseId)
      .eq('provider', PROVIDER)
      .eq('mode', mode)
      .maybeSingle();

    if (
      existing &&
      !force &&
      existing.status === 'success' &&
      Date.now() - new Date(existing.fetched_at).getTime() < CACHE_TTL_MS
    ) {
      return json({ ok: true, cached: true, opinion: existing });
    }

    if (!serpKey) return json({ error: 'missing_serpapi_key' }, 503);

    // Language / country come from the Plant Advisor identification language.
    const { data: profile } = await admin
      .from('profiles')
      .select('plan, plant_identification_language')
      .eq('id', userId)
      .maybeSingle();
    const lang: 'en' | 'sr' = profile?.plant_identification_language === 'sr' ? 'sr' : 'en';
    const country = lang === 'sr' ? 'rs' : 'us';
    const plan = normalizePlan(profile?.plan);

    // Monthly usage allowance (separate from the Plant AI scan quota).
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: usedCount } = await admin
      .from('visual_second_opinion_runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', monthStart.toISOString());
    const limit = monthlyLimitForPlan(plan);
    if ((usedCount ?? 0) >= limit) {
      return json({ error: 'monthly_limit_reached', used: usedCount ?? 0, limit }, 429);
    }

    // Confirmed identification / diagnosis for prompt shaping.
    const [{ data: idents }, { data: diags }] = await Promise.all([
      admin
        .from('plant_identifications')
        .select('id, scientific_name, scientific_name_without_author, common_name, is_confirmed, rank')
        .eq('case_id', caseId)
        .order('rank', { ascending: true })
        .limit(10),
      admin
        .from('plant_diagnoses')
        .select('id, name, is_confirmed, rank')
        .eq('case_id', caseId)
        .order('rank', { ascending: true })
        .limit(10),
    ]);
    const confirmedIdent = (idents ?? []).find((i: any) => i.is_confirmed) ?? null;
    const confirmedDiag = (diags ?? []).find((d: any) => d.is_confirmed) ?? null;

    if (mode === 'diagnose' && !confirmedIdent) {
      return json({ error: 'no_confirmed_identification' }, 400);
    }

    // Pick the best image for the task.
    let q = admin
      .from('plant_case_images')
      .select('id, storage_mode, drive_file_id, staging_storage_path, storage_path, mime_type, image_role, original_filename')
      .eq('case_id', caseId)
      .neq('upload_status', 'deleted');
    if (imageId) q = q.eq('id', imageId);
    const { data: imagesRaw, error: imgErr } = await q;
    if (imgErr) return json({ error: 'db_error' }, 500);
    const images = ((imagesRaw as any[]) ?? []).filter((i) =>
      ALLOWED_MIMES.has((i.mime_type || '').toLowerCase()),
    );
    if (images.length === 0) return json({ error: 'no_usable_image' }, 400);

    const pref = mode === 'diagnose' ? DIAGNOSE_ROLE_PREFERENCE : IDENTIFY_ROLE_PREFERENCE;
    const picked = [...images].sort((a, b) => {
      const ai = pref.indexOf((a.image_role || 'auto').toLowerCase());
      const bi = pref.indexOf((b.image_role || 'auto').toLowerCase());
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    })[0];

    // SerpAPI must be able to fetch the image, so publish a short-lived signed
    // copy in the temp bucket instead of exposing the private originals.
    const { env: driveEnv } = readDriveEnv();
    let bytes: Uint8Array | null = null;
    if (picked.storage_mode === 'google_drive' && picked.drive_file_id && driveEnv) {
      try {
        const resp = await fetchDriveFileMedia(driveEnv, picked.drive_file_id);
        if (resp.ok) bytes = new Uint8Array(await resp.arrayBuffer());
      } catch {
        bytes = null;
      }
    }
    if (!bytes) {
      const path = picked.staging_storage_path || picked.storage_path;
      if (path) {
        const { data: blob } = await admin.storage.from(BUCKET).download(path);
        if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
      }
    }
    if (!bytes) return json({ error: 'image_download_failed' }, 502);

    const mime = (picked.mime_type || 'image/jpeg').toLowerCase();
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const tempPath = `${userId}/${caseId}/visual-${mode}-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(TEMP_BUCKET)
      .upload(tempPath, new Blob([bytes], { type: mime }), { contentType: mime, upsert: true });
    if (upErr) return json({ error: 'temp_upload_failed' }, 500);

    const cleanup = async () => {
      try {
        await admin.storage.from(TEMP_BUCKET).remove([tempPath]);
      } catch (e) {
        console.warn('[visual-opinion] temp cleanup failed', (e as Error).message);
      }
    };

    const { data: signed } = await admin.storage
      .from(TEMP_BUCKET)
      .createSignedUrl(tempPath, SIGNED_URL_TTL_S);
    const publicImageUrl = signed?.signedUrl ?? null;
    if (!publicImageUrl) {
      await cleanup();
      return json({ error: 'no_public_image_url' }, 500);
    }

    const plantCommon = confirmedIdent?.common_name ?? null;
    const plantSci =
      confirmedIdent?.scientific_name_without_author ?? confirmedIdent?.scientific_name ?? null;
    const query = buildQuery(mode, lang, plantCommon, plantSci, confirmedDiag?.name ?? null);

    const { data: runRow } = await admin
      .from('visual_second_opinion_runs')
      .insert({ user_id: userId, case_id: caseId, provider: PROVIDER, mode, status: 'started' })
      .select('id')
      .single();

    const failRun = async (code: string) => {
      if (runRow?.id) {
        await admin
          .from('visual_second_opinion_runs')
          .update({ status: 'failed', error_code: code })
          .eq('id', runRow.id);
      }
    };

    const url = new URL(SERPAPI_URL);
    url.searchParams.set('engine', 'google_ai_mode');
    url.searchParams.set('q', query);
    url.searchParams.set('hl', lang);
    url.searchParams.set('gl', country);
    url.searchParams.set('image_url', publicImageUrl);
    url.searchParams.set('api_key', serpKey);

    let payload: Record<string, any> | null = null;
    try {
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(120_000) });
      const text = await resp.text();
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      if (!resp.ok || !payload) {
        await cleanup();
        await failRun(`serpapi_http_${resp.status}`);
        console.error('[visual-opinion] serpapi error', resp.status, text.slice(0, 400));
        return json({ error: 'provider_error', upstreamStatus: resp.status }, 502);
      }
    } catch (e) {
      await cleanup();
      await failRun('network_error');
      return json({ error: 'provider_unreachable', retryable: true }, 504);
    }
    await cleanup();

    if (payload.error) {
      await failRun('serpapi_error');
      return json({ error: 'provider_error', message: String(payload.error).slice(0, 300) }, 502);
    }
    const status = String(payload?.search_metadata?.status || '');
    if (status && status.toLowerCase() !== 'success') {
      await failRun('provider_status');
      return json({ error: 'provider_status_not_success', status }, 502);
    }

    const { structured, summary } = normalizeSerpAiModeResult(payload, mode, lang);
    const hasContent = !!(structured.markdown || structured.textBlocks.length > 0);
    if (!hasContent) {
      await failRun('empty_answer');
      return json({ error: 'empty_answer' }, 502);
    }

    const row = {
      user_id: userId,
      case_id: caseId,
      provider: PROVIDER,
      mode,
      image_ids: [picked.id],
      query,
      language: lang,
      country,
      status: 'success',
      opinion_summary: summary || null,
      structured_result: structured,
      // raw_html_file / prettify_html_file are intentionally not stored.
      raw_payload: {
        search_metadata: structured.searchMetadata,
        search_parameters: structured.searchParameters,
        text_blocks: structured.textBlocks,
        reconstructed_markdown: structured.markdown,
      },
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveErr } = await admin
      .from('plant_case_visual_opinions')
      .upsert(row, { onConflict: 'case_id,provider,mode' })
      .select('*')
      .single();
    if (saveErr) {
      await failRun('save_failed');
      console.error('[visual-opinion] save failed', saveErr.message);
      return json({ error: 'save_failed' }, 500);
    }

    if (runRow?.id) {
      await admin
        .from('visual_second_opinion_runs')
        .update({ status: 'completed' })
        .eq('id', runRow.id);
    }

    return json({ ok: true, cached: false, opinion: saved, usage: { used: (usedCount ?? 0) + 1, limit } });
  } catch (e) {
    console.error('[visual-opinion] internal error', (e as Error).message);
    return json({ error: 'internal_error' }, 500);
  }
});
