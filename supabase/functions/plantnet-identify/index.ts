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
const TEMP_BUCKET = 'plant-identification-temp';
const MAX_IMAGES = 5;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // Pl@ntNet payload cap
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

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const PLANTNET_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

type PlanId = 'free' | 'basic' | 'premium' | 'enterprise';

// Monthly limit shared by plant identification AND disease diagnosis
// ("Plant AI scans"). Both increment the same counter in
// `plant_identification_usage` via `increment_plant_identification_usage`.
function monthlyLimitForPlan(plan: PlanId): number {
  if (plan === 'basic') return 50;
  if (plan === 'premium' || plan === 'enterprise') return 100;
  return 10;
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
    const ALLOWED_PROJECTS = new Set(['k-southeastern-europe', 'k-world-flora', 'all']);
    const ALLOWED_LANGS = new Set(['en', 'hr']);
    const rawProject = String(body?.project || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const project = ALLOWED_PROJECTS.has(rawProject) ? rawProject : 'k-southeastern-europe';
    const rawLang = String(body?.lang || '').replace(/[^a-zA-Z-]/g, '').slice(0, 8).toLowerCase();
    const lang = ALLOWED_LANGS.has(rawLang) ? rawLang : 'en';
    if (!plantCaseId) return jsonResponse({ error: 'invalid_input' }, 400);

    // Client-provided temp JPEGs for WebP images. Each entry MUST live under
    // plant-identification-temp/<userId>/<caseId>/ and reference an image
    // that belongs to this case (validated below).
    const tempPrefix = `${userId}/${plantCaseId}/`;
    const tempImagesInput: Array<{ sourceImageId: string; storagePath: string; originalRole?: string }> =
      Array.isArray(body?.tempImages)
        ? body.tempImages
            .map((t: any) => ({
              sourceImageId: typeof t?.sourceImageId === 'string' ? t.sourceImageId : '',
              storagePath: typeof t?.storagePath === 'string' ? t.storagePath : '',
              originalRole: typeof t?.originalRole === 'string' ? t.originalRole : undefined,
            }))
            .filter((t: any) =>
              t.sourceImageId &&
              t.storagePath &&
              t.storagePath.startsWith(tempPrefix) &&
              // Reject traversal and stray path components.
              !t.storagePath.includes('..'),
            )
        : [];

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

    // Map temp JPEGs by source image id, but only for temps whose sourceImageId
    // is actually part of THIS case. Anything else is dropped silently.
    const caseImageIdSet = new Set(allImages.map((i) => i.id));
    const tempById = new Map<string, { storagePath: string }>();
    for (const t of tempImagesInput) {
      if (caseImageIdSet.has(t.sourceImageId)) {
        tempById.set(t.sourceImageId, { storagePath: t.storagePath });
      }
    }

    // Plan-aware monthly limit. The atomic reservation happens later, right
    // before the provider call, to prevent parallel requests from both slipping
    // through a pre-check.
    const monthKey = currentMonthKey();
    const { data: profileRow } = await admin
      .from('profiles')
      .select('plan')
      .eq('user_id', userId)
      .maybeSingle();
    const plan = normalizePlan((profileRow as any)?.plan);
    const monthlyLimit = monthlyLimitForPlan(plan);


    // Rank by role preference; WebP without a temp JPEG is not sendable, so drop it.
    const sendable = allImages.filter((i) => {
      const mime = (i.mime_type || '').toLowerCase();
      if (PLANTNET_MIMES.has(mime)) return true;
      if (mime === 'image/webp') return tempById.has(i.id);
      return false;
    });
    if (sendable.length === 0) {
      return jsonResponse({ error: 'no_compatible_images' }, 400);
    }
    const ranked = [...sendable].sort((a, b) => {
      const ai = ROLE_PREFERENCE.indexOf((a.image_role as any) || 'auto');
      const bi = ROLE_PREFERENCE.indexOf((b.image_role as any) || 'auto');
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    const picked = ranked.slice(0, MAX_IMAGES);

    // Download bytes for each picked image.
    // - WebP → use client-uploaded temp JPEG from TEMP_BUCKET.
    // - JPEG/PNG → Drive-preferred, Supabase fallback (unchanged).
    const { env: driveEnv } = readDriveEnv();
    const parts: Array<{ organ: string; bytes: Uint8Array; mime: string; filename: string }> = [];
    const tempPathsToCleanup: string[] = [];
    let totalBytes = 0;

    for (const img of picked) {
      const rawMime = (img.mime_type || 'image/jpeg').toLowerCase();
      const temp = tempById.get(img.id);
      let bytes: Uint8Array | null = null;
      let outMime = rawMime;

      if (temp) {
        // Client-converted JPEG lives in the temp bucket.
        const { data: blob } = await admin.storage.from(TEMP_BUCKET).download(temp.storagePath);
        if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
        outMime = 'image/jpeg';
        tempPathsToCleanup.push(temp.storagePath);
      } else {
        // Only JPEG/PNG originals reach this branch (WebP without temp filtered above).
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
      }
      if (!bytes) continue;
      if (!PLANTNET_MIMES.has(outMime)) continue; // safety: never send WebP upstream
      if (totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) {
        console.warn('[plantnet-identify] payload cap reached, dropping remaining images');
        break;
      }
      totalBytes += bytes.byteLength;
      parts.push({
        organ: mapRoleToOrgan(img.image_role),
        bytes,
        mime: outMime,
        filename: img.original_filename || `${img.id}.${outMime === 'image/png' ? 'png' : 'jpg'}`,
      });
    }

    const cleanupTemp = async () => {
      if (tempPathsToCleanup.length === 0) return;
      try {
        await admin.storage.from(TEMP_BUCKET).remove(tempPathsToCleanup);
      } catch (e) {
        console.warn('[plantnet-identify] temp cleanup failed', (e as Error).message);
      }
    };

    if (parts.length === 0) {
      await cleanupTemp();
      return jsonResponse({ error: 'image_download_failed' }, 502);
    }

    try {
    // Build multipart/form-data. Preserve organ/image order.
    const form = new FormData();
    for (const p of parts) {
      form.append('organs', p.organ);
      form.append('images', new Blob([p.bytes], { type: p.mime }), p.filename);
    }

    const url = new URL(`${PLANTNET_BASE}/${encodeURIComponent(project)}`);
    url.searchParams.set('api-key', plantnetKey);
    url.searchParams.set('nb-results', '10');
    url.searchParams.set('include-related-images', 'true');
    url.searchParams.set('detailed', 'true');
    url.searchParams.set('lang', lang);

    // Atomically reserve one Plant AI scan against the shared monthly quota
    // BEFORE calling Pl@ntNet. Prevents parallel requests from exceeding it.
    let usage = { used: 0, limit: monthlyLimit, remaining: monthlyLimit, monthKey };
    try {
      const { data: resv, error: resvErr } = await admin.rpc('reserve_plant_ai_scan_usage', {
        p_user_id: userId,
        p_provider: 'plantnet',
        p_month_key: monthKey,
        p_limit: monthlyLimit,
      });
      if (resvErr) {
        console.error('[plantnet-identify] reservation rpc failed', resvErr.message);
        await cleanupTemp();
        return jsonResponse({ error: 'internal_error' }, 500);
      }
      const r = (resv || {}) as { allowed?: boolean; used?: number; limit?: number; remaining?: number };
      usage = {
        used: r.used ?? 0,
        limit: r.limit ?? monthlyLimit,
        remaining: r.remaining ?? 0,
        monthKey,
      };
      if (r.allowed === false) {
        await cleanupTemp();
        return jsonResponse({ error: 'plant_ai_scan_limit_reached', usage }, 429);
      }
    } catch (e) {
      console.error('[plantnet-identify] reservation threw', (e as Error).message);
      await cleanupTemp();
      return jsonResponse({ error: 'internal_error' }, 500);
    }

    let pnResp: Response;
    try {
      pnResp = await fetch(url.toString(), { method: 'POST', body: form });
    } catch (e) {
      console.error('[plantnet-identify] network error', (e as Error).message);
      return jsonResponse({ error: 'provider_unreachable', usage }, 502);
    }


    if (!pnResp.ok) {
      const status = pnResp.status;
      // Don't leak upstream body verbatim; capture short reason for logs only.
      const shortText = (await pnResp.text().catch(() => '')).slice(0, 200);
      console.warn('[plantnet-identify] upstream error', status, shortText);
      if (status === 400) return jsonResponse({ error: 'bad_request', usage }, 400);
      if (status === 401 || status === 403) return jsonResponse({ error: 'auth_failed', usage }, 502);
      if (status === 404) return jsonResponse({ error: 'not_found_upstream', usage }, 502);
      if (status === 413) return jsonResponse({ error: 'payload_too_large', usage }, 413);
      if (status === 429) return jsonResponse({ error: 'quota_exhausted', usage }, 429);
      return jsonResponse({ error: 'provider_error', usage }, 502);
    }

    const raw = await pnResp.json().catch(() => null);
    const results = Array.isArray(raw?.results) ? raw.results : [];
    if (results.length === 0) {
      return jsonResponse({ error: 'empty_results', raw, usage }, 200);
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

    // Build ephemeral review payload with related images. Never persisted.
    const pickImages = (arr: any): Array<Record<string, unknown>> => {
      if (!Array.isArray(arr)) return [];
      return arr.slice(0, 4).map((im: any) => {
        const u = im?.url || {};
        return {
          urlSmall: u?.s ?? null,
          urlMedium: u?.m ?? null,
          urlOriginal: u?.o ?? null,
          organ: im?.organ ?? null,
          author: im?.author ?? null,
          license: im?.license ?? null,
          citation: im?.citation ?? null,
          date: im?.date?.string ?? im?.date ?? null,
          project: im?.project ?? null,
        };
      });
    };
    const reviewSpecies = results.slice(0, 10).map((r: any, idx: number) => {
      const sp = r?.species || {};
      const commonNames: string[] = Array.isArray(sp.commonNames) ? sp.commonNames : [];
      return {
        rank: idx + 1,
        score: typeof r?.score === 'number' ? r.score : null,
        scientificName: sp?.scientificName ?? null,
        scientificNameWithoutAuthor: sp?.scientificNameWithoutAuthor ?? null,
        commonName: commonNames[0] ?? null,
        commonNames,
        family: sp?.family?.scientificNameWithoutAuthor ?? null,
        genus: sp?.genus?.scientificNameWithoutAuthor ?? null,
        gbifId: r?.gbif?.id != null ? String(r.gbif.id) : null,
        powoId: r?.powo?.id != null ? String(r.powo.id) : null,
        iucnCategory: r?.iucn?.category ?? null,
        relatedImages: pickImages(r?.images),
      };
    });
    const other = raw?.otherResults || raw?.results?.otherResults || {};
    const rawGenus = Array.isArray(raw?.genus) ? raw.genus : Array.isArray(other?.genus) ? other.genus : [];
    const rawFamily = Array.isArray(raw?.family) ? raw.family : Array.isArray(other?.family) ? other.family : [];
    const reviewGenus = rawGenus.slice(0, 5).map((g: any, idx: number) => ({
      rank: idx + 1,
      score: typeof g?.score === 'number' ? g.score : null,
      scientificName: g?.genus?.scientificNameWithoutAuthor ?? g?.scientificNameWithoutAuthor ?? null,
      family: g?.genus?.family?.scientificNameWithoutAuthor ?? g?.family ?? null,
      commonNames: Array.isArray(g?.genus?.commonNames) ? g.genus.commonNames : Array.isArray(g?.commonNames) ? g.commonNames : [],
      relatedImages: pickImages(g?.images),
    }));
    const reviewFamily = rawFamily.slice(0, 5).map((f: any, idx: number) => ({
      rank: idx + 1,
      score: typeof f?.score === 'number' ? f.score : null,
      scientificName: f?.family?.scientificNameWithoutAuthor ?? f?.scientificNameWithoutAuthor ?? null,
      commonNames: Array.isArray(f?.family?.commonNames) ? f.family.commonNames : Array.isArray(f?.commonNames) ? f.commonNames : [],
      relatedImages: pickImages(f?.images),
    }));
    const review = {
      species: reviewSpecies,
      genus: reviewGenus,
      family: reviewFamily,
      predictedOrgans: Array.isArray(raw?.predictedOrgans)
        ? raw.predictedOrgans.map((p: any) => ({
            image: p?.image ?? null,
            filename: p?.filename ?? null,
            organ: p?.organ ?? null,
            score: typeof p?.score === 'number' ? p.score : null,
          }))
        : [],
      language: lang,
      project,
      engineVersion,
      preferredReferential: typeof raw?.preferedReferential === 'string' ? raw.preferedReferential : null,
    };

    return jsonResponse({
      ok: true,
      results: inserted,
      review,
      remainingIdentificationRequests: remaining,
      usedImageCount: parts.length,
      totalImageCount: allImages.length,
      usage,
    });
    } finally {
      // Best-effort cleanup: never fails identification.
      await cleanupTemp();
    }
  } catch (e) {
    console.error('[plantnet-identify] fatal', (e as Error).message);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
