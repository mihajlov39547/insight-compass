// Pl@ntNet species identification for a plant case.
// Never expose the API key to the browser. Never log the key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { fetchDriveFileMedia, readDriveEnv } from '../_shared/plant-drive.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const BUCKET = 'plant-case-images';
const MAX_IMAGES = 5;
const PLANTNET_BASE = 'https://my-api.plantnet.org/v2/identify';

// Order of preference when auto-selecting images from a case.
const ROLE_PREFERENCE = [
  'flower',
  'fruit',
  'leaf',
  'bark',
  'auto',
  'whole_plant',
  'stem',
  'root',
  'other',
] as const;

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

type PlanId = 'free' | 'basic' | 'premium' | 'enterprise';

function monthlyLimitForPlan(plan: PlanId): number {
  if (plan === 'basic') return 50;
  if (plan === 'premium' || plan === 'enterprise') return 100;
  return 5;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizePlan(v: unknown): PlanId {
  if (v === 'basic' || v === 'premium' || v === 'enterprise' || v === 'free') return v;
  return 'free';
}

function mapRoleToOrgan(role: string | null | undefined): string {
  const r = (role || 'auto').toLowerCase();
  if (r === 'leaf' || r === 'flower' || r === 'fruit' || r === 'bark' || r === 'auto') return r;
  // whole_plant, stem, root, other -> auto
  return 'auto';
}

interface ImgRow {
  id: string;
  storage_mode: string;
  drive_file_id: string | null;
  staging_storage_path: string | null;
  storage_path: string | null;
  mime_type: string | null;
  image_role: string | null;
  original_filename: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const plantnetKey = Deno.env.get('PLANTNET_API_KEY');
    if (!plantnetKey) return jsonResponse({ error: 'api_key_missing' }, 503);

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const plantCaseId = String(body?.plantCaseId || '');
    const imageIds: string[] = Array.isArray(body?.imageIds)
      ? body.imageIds.filter((x: unknown) => typeof x === 'string')
      : [];
    const project = String(body?.project || 'all').replace(/[^a-zA-Z0-9_-]/g, '') || 'all';
    const lang = String(body?.lang || 'en').replace(/[^a-zA-Z-]/g, '').slice(0, 8) || 'en';
    if (!plantCaseId) return jsonResponse({ error: 'invalid_input' }, 400);

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

    // Verify case ownership.
    const { data: pcase } = await admin
      .from('plant_cases')
      .select('id,user_id')
      .eq('id', plantCaseId)
      .maybeSingle();
    if (!pcase) return jsonResponse({ error: 'not_found' }, 404);
    if ((pcase as any).user_id !== userId) return jsonResponse({ error: 'forbidden' }, 403);

    // Load images.
    let q = admin
      .from('plant_case_images')
      .select(
        'id,storage_mode,drive_file_id,staging_storage_path,storage_path,mime_type,image_role,original_filename',
      )
      .eq('case_id', plantCaseId)
      .neq('upload_status', 'deleted');
    if (imageIds.length > 0) q = q.in('id', imageIds);
    const { data: imagesRaw, error: imgErr } = await q;
    if (imgErr) return jsonResponse({ error: 'db_error' }, 500);
    const allImages = ((imagesRaw as ImgRow[]) ?? []).filter((i) =>
      ALLOWED_MIMES.has((i.mime_type || '').toLowerCase()),
    );
    if (allImages.length === 0) {
      return jsonResponse({ error: 'no_compatible_images' }, 400);
    }

    // Rank by role preference; take up to 5.
    const ranked = [...allImages].sort((a, b) => {
      const ai = ROLE_PREFERENCE.indexOf((a.image_role as any) || 'auto');
      const bi = ROLE_PREFERENCE.indexOf((b.image_role as any) || 'auto');
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    const picked = ranked.slice(0, MAX_IMAGES);

    // Download bytes for each picked image (Drive preferred, Supabase fallback).
    const { env: driveEnv } = readDriveEnv();
    const parts: Array<{ organ: string; bytes: Uint8Array; mime: string; filename: string }> = [];

    for (const img of picked) {
      const mime = (img.mime_type || 'image/jpeg').toLowerCase();
      let bytes: Uint8Array | null = null;
      if (img.storage_mode === 'google_drive' && img.drive_file_id && driveEnv) {
        try {
          const resp = await fetchDriveFileMedia(driveEnv, img.drive_file_id);
          if (resp.ok) bytes = new Uint8Array(await resp.arrayBuffer());
        } catch {
          bytes = null;
        }
      }
      if (!bytes) {
        const path = img.staging_storage_path || img.storage_path;
        if (path) {
          const { data: blob } = await admin.storage.from(BUCKET).download(path);
          if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
        }
      }
      if (!bytes) continue;
      parts.push({
        organ: mapRoleToOrgan(img.image_role),
        bytes,
        mime,
        filename: img.original_filename || `${img.id}.${mime === 'image/png' ? 'png' : 'jpg'}`,
      });
    }

    if (parts.length === 0) {
      return jsonResponse({ error: 'image_download_failed' }, 502);
    }

    // Build multipart/form-data. Preserve organ/image order.
    const form = new FormData();
    for (const p of parts) {
      form.append('organs', p.organ);
      form.append('images', new Blob([p.bytes], { type: p.mime }), p.filename);
    }

    const url = new URL(`${PLANTNET_BASE}/${encodeURIComponent(project)}`);
    url.searchParams.set('api-key', plantnetKey);
    url.searchParams.set('nb-results', '5');
    url.searchParams.set('include-related-images', 'false');
    url.searchParams.set('lang', lang);

    let pnResp: Response;
    try {
      pnResp = await fetch(url.toString(), { method: 'POST', body: form });
    } catch (e) {
      console.error('[plantnet-identify] network error', (e as Error).message);
      return jsonResponse({ error: 'provider_unreachable' }, 502);
    }

    if (!pnResp.ok) {
      const status = pnResp.status;
      // Don't leak upstream body verbatim; capture short reason for logs only.
      const shortText = (await pnResp.text().catch(() => '')).slice(0, 200);
      console.warn('[plantnet-identify] upstream error', status, shortText);
      if (status === 400) return jsonResponse({ error: 'bad_request' }, 400);
      if (status === 401 || status === 403) return jsonResponse({ error: 'auth_failed' }, 502);
      if (status === 404) return jsonResponse({ error: 'not_found_upstream' }, 502);
      if (status === 413) return jsonResponse({ error: 'payload_too_large' }, 413);
      if (status === 429) return jsonResponse({ error: 'quota_exhausted' }, 429);
      return jsonResponse({ error: 'provider_error' }, 502);
    }

    const raw = await pnResp.json().catch(() => null);
    const results = Array.isArray(raw?.results) ? raw.results : [];
    if (results.length === 0) {
      return jsonResponse({ error: 'empty_results', raw }, 200);
    }

    const remaining =
      typeof raw?.remainingIdentificationRequests === 'number'
        ? raw.remainingIdentificationRequests
        : null;
    const engineVersion = typeof raw?.version === 'string' ? raw.version : null;

    // Wipe prior identifications for a fresh view, but preserve any confirmed row.
    await admin
      .from('plant_identifications')
      .delete()
      .eq('case_id', plantCaseId)
      .eq('is_confirmed', false);

    const normalized = results.slice(0, 5).map((r: any, idx: number) => {
      const species = r?.species || {};
      const commonNames: string[] = Array.isArray(species.commonNames) ? species.commonNames : [];
      return {
        case_id: plantCaseId,
        user_id: userId,
        provider: 'plantnet',
        project,
        rank: idx + 1,
        score: typeof r?.score === 'number' ? r.score : null,
        scientific_name: species.scientificName ?? null,
        scientific_name_without_author: species.scientificNameWithoutAuthor ?? null,
        scientific_name_authorship: species.scientificNameAuthorship ?? null,
        common_name: commonNames[0] ?? null,
        family: species?.family?.scientificNameWithoutAuthor ?? null,
        genus: species?.genus?.scientificNameWithoutAuthor ?? null,
        gbif_id: r?.gbif?.id != null ? String(r.gbif.id) : null,
        powo_id: r?.powo?.id != null ? String(r.powo.id) : null,
        raw_result: r,
        raw_response: idx === 0 ? raw : null,
        remaining_identification_requests: remaining,
        engine_version: engineVersion,
      };
    });

    const { data: inserted, error: insErr } = await admin
      .from('plant_identifications')
      .insert(normalized)
      .select('*');
    if (insErr) {
      console.error('[plantnet-identify] insert failed', insErr.message);
      return jsonResponse({ error: 'db_error' }, 500);
    }

    const top = normalized[0];
    const caseUpdate: Record<string, unknown> = {
      identified_scientific_name: top.scientific_name_without_author || top.scientific_name,
      identified_common_name: top.common_name,
      identification_confidence: top.score,
      identified_at: new Date().toISOString(),
      identification_provider: 'plantnet',
    };
    if (typeof top.score === 'number') {
      caseUpdate.status = 'identified';
    }
    await admin.from('plant_cases').update(caseUpdate).eq('id', plantCaseId);

    return jsonResponse({
      ok: true,
      results: inserted,
      remainingIdentificationRequests: remaining,
      usedImageCount: parts.length,
      totalImageCount: allImages.length,
    });
  } catch (e) {
    console.error('[plantnet-identify] fatal', (e as Error).message);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
