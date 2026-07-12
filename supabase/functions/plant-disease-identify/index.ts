// Pl@ntNet disease diagnosis for a plant case.
// Reuses the WebP→JPEG temp flow from plantnet-identify.
// Does NOT send project/flora — disease endpoint is language-only.
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
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const PLANTNET_DISEASE_URL = 'https://my-api.plantnet.org/v2/diseases/identify';

// Preferred organs for disease diagnosis.
const ROLE_PREFERENCE = ['leaf', 'fruit', 'flower', 'stem', 'whole_plant', 'bark', 'root', 'other', 'auto'] as const;

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const PLANTNET_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

// Map app image roles to Pl@ntNet disease organ vocabulary.
function mapRoleToDiseaseOrgan(role: string | null | undefined): string {
  const r = (role || 'auto').toLowerCase();
  if (r === 'leaf') return 'leaf';
  if (r === 'flower') return 'flower';
  if (r === 'fruit') return 'fruit';
  if (r === 'bark') return 'bark';
  if (r === 'stem') return 'branch';
  if (r === 'whole_plant') return 'habit';
  if (r === 'root') return 'other';
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
    const ALLOWED_LANGS = new Set(['en', 'hr']);
    const rawLang = String(body?.lang || '').replace(/[^a-zA-Z-]/g, '').slice(0, 8).toLowerCase();
    const lang = ALLOWED_LANGS.has(rawLang) ? rawLang : 'en';
    if (!plantCaseId) return jsonResponse({ error: 'invalid_input' }, 400);

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
              !t.storagePath.includes('..'),
            )
        : [];

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

    const { data: pcase } = await admin
      .from('plant_cases')
      .select('id,user_id,user_goal,confirmed_scientific_name,confirmed_common_name,confirmed_identification_id,title,notes,location_text,crop_context')
      .eq('id', plantCaseId)
      .maybeSingle();
    if (!pcase) return jsonResponse({ error: 'not_found' }, 404);
    if ((pcase as any).user_id !== userId) return jsonResponse({ error: 'forbidden' }, 403);
    if ((pcase as any).user_goal !== 'diagnose') {
      return jsonResponse({ error: 'invalid_case_goal' }, 400);
    }
    if (!(pcase as any).confirmed_identification_id) {
      return jsonResponse({ error: 'plant_not_confirmed' }, 400);
    }

    // Load confirmed identification for relevance annotation.
    const { data: confIdent } = await admin
      .from('plant_identifications')
      .select('scientific_name,scientific_name_without_author,common_name,genus,family')
      .eq('id', (pcase as any).confirmed_identification_id)
      .maybeSingle();

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
    if (allImages.length === 0) return jsonResponse({ error: 'no_compatible_images' }, 400);

    const caseImageIdSet = new Set(allImages.map((i) => i.id));
    const tempById = new Map<string, { storagePath: string }>();
    for (const t of tempImagesInput) {
      if (caseImageIdSet.has(t.sourceImageId)) {
        tempById.set(t.sourceImageId, { storagePath: t.storagePath });
      }
    }

    const sendable = allImages.filter((i) => {
      const mime = (i.mime_type || '').toLowerCase();
      if (PLANTNET_MIMES.has(mime)) return true;
      if (mime === 'image/webp') return tempById.has(i.id);
      return false;
    });
    if (sendable.length === 0) return jsonResponse({ error: 'no_compatible_images' }, 400);

    const ranked = [...sendable].sort((a, b) => {
      const ai = ROLE_PREFERENCE.indexOf((a.image_role as any) || 'auto');
      const bi = ROLE_PREFERENCE.indexOf((b.image_role as any) || 'auto');
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    const picked = ranked.slice(0, MAX_IMAGES);

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
        const { data: blob } = await admin.storage.from(TEMP_BUCKET).download(temp.storagePath);
        if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
        outMime = 'image/jpeg';
        tempPathsToCleanup.push(temp.storagePath);
      } else {
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
      if (!PLANTNET_MIMES.has(outMime)) continue;
      if (totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) {
        console.warn('[plant-disease-identify] payload cap reached, dropping remaining images');
        break;
      }
      totalBytes += bytes.byteLength;
      parts.push({
        organ: mapRoleToDiseaseOrgan(img.image_role),
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
        console.warn('[plant-disease-identify] temp cleanup failed', (e as Error).message);
      }
    };

    if (parts.length === 0) {
      await cleanupTemp();
      return jsonResponse({ error: 'image_download_failed' }, 502);
    }

    try {
      const form = new FormData();
      for (const p of parts) {
        form.append('organs', p.organ);
        form.append('images', new Blob([p.bytes], { type: p.mime }), p.filename);
      }

      const url = new URL(PLANTNET_DISEASE_URL);
      url.searchParams.set('api-key', plantnetKey);
      url.searchParams.set('nb-results', '10');
      url.searchParams.set('include-related-images', 'true');
      url.searchParams.set('lang', lang);

      let pnResp: Response;
      try {
        pnResp = await fetch(url.toString(), { method: 'POST', body: form });
      } catch (e) {
        console.error('[plant-disease-identify] network error', (e as Error).message);
        return jsonResponse({ error: 'provider_unreachable' }, 502);
      }

      if (!pnResp.ok) {
        const status = pnResp.status;
        const shortText = (await pnResp.text().catch(() => '')).slice(0, 200);
        console.warn('[plant-disease-identify] upstream error', status, shortText);
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
          };
        });
      };

      const pc: any = pcase as any;
      const plantContextSource = pc?.confirmed_identification_id ? 'confirmed_identification' : 'unknown';

      // --- Heuristics: readable name, problem type, confidence bucket ---
      const PEST_PATTERNS = [
        'aphid', 'beetle', 'mite', 'caterpillar', 'larva', 'insect', 'fly', 'bug',
        'scale', 'weevil', 'moth', 'thrips', 'nematode', 'wasp', 'ant', 'grasshopper',
        'whitefly', 'mealybug', 'leafhopper', 'borer', 'sawfly',
        // hr / sr
        'lisna uš', 'lisne uši', 'buba', 'grinj', 'gusenic', 'ličink', 'insekt',
        'muha', 'muva', 'štitast', 'pipa', 'leptir', 'trip', 'nematod', 'osa',
        'mrav', 'skakavac', 'bela mušica', 'crv',
      ];
      const DISEASE_PATTERNS = [
        'rust', 'mildew', 'blight', 'rot', 'spot', 'fungus', 'fungal', 'bacteria',
        'bacterial', 'phytoplasma', 'virus', 'mosaic', 'canker', 'wilt', 'scab',
        'anthracnose', 'smut',
        // hr / sr
        'rđa', 'plamenjača', 'pepelnic', 'trulež', 'pjeg', 'pega', 'gljiv',
        'bakterij', 'fitoplazm', 'mozaik', 'rak ', 'venjenje', 'krastav',
      ];

      function classifyProblem(text: string): 'pest' | 'disease' | 'unknown' {
        const t = text.toLowerCase();
        for (const p of PEST_PATTERNS) if (p && t.includes(p)) return 'pest';
        for (const p of DISEASE_PATTERNS) if (p && t.includes(p)) return 'disease';
        return 'unknown';
      }

      function confidenceBucket(s: number | null): 'high' | 'medium' | 'low' {
        if (typeof s !== 'number') return 'low';
        if (s >= 0.7) return 'high';
        if (s >= 0.4) return 'medium';
        return 'low';
      }

      // --- Plant relevance heuristic ---
      const ci: any = confIdent ?? {};
      const confirmedTokens: string[] = [];
      const pushTok = (v: unknown) => {
        if (typeof v !== 'string') return;
        const t = v.trim().toLowerCase();
        if (t.length >= 3) confirmedTokens.push(t);
      };
      pushTok(ci.scientific_name);
      pushTok(ci.scientific_name_without_author);
      pushTok(ci.common_name);
      pushTok(ci.genus);
      pushTok(ci.family);
      pushTok(pc?.confirmed_scientific_name);
      pushTok(pc?.confirmed_common_name);
      // Add common alt names for widely used genera (best-effort).
      const genusLower = (ci.genus || '').toLowerCase();
      const ALIASES: Record<string, string[]> = {
        rubus: ['blackberry', 'raspberry', 'bramble', 'kupina', 'malina'],
        malus: ['apple', 'jabuka'],
        vitis: ['grape', 'grapevine', 'vinova loza', 'grožđe'],
        prunus: ['cherry', 'plum', 'peach', 'apricot', 'trešnja', 'šljiva', 'breskva', 'kajsija'],
        solanum: ['tomato', 'potato', 'paradajz', 'krompir', 'krumpir'],
        zea: ['maize', 'corn', 'kukuruz'],
        triticum: ['wheat', 'pšenica'],
        glycine: ['soybean', 'soja'],
        citrus: ['orange', 'lemon', 'limun', 'narandža'],
      };
      if (ALIASES[genusLower]) for (const a of ALIASES[genusLower]) confirmedTokens.push(a);

      const OTHER_HOST_TOKENS = [
        'spruce', 'pine', 'fir', 'grasses', 'grass', 'soybean', 'apple', 'tomato',
        'wheat', 'corn', 'maize', 'grape', 'grapevine', 'potato', 'citrus', 'orange',
        'lemon', 'rice', 'cotton', 'barley', 'oat', 'onion', 'cabbage', 'strawberry',
        'peach', 'plum', 'cherry', 'pear', 'walnut', 'hazelnut', 'oak', 'maple',
        'smrek', 'bor', 'jela', 'trav', 'soja', 'jabuka', 'paradajz', 'pšenica',
        'kukuruz', 'grožđ', 'vinova', 'krompir', 'krumpir', 'limun', 'narandža',
        'jagoda', 'breskva', 'šljiva', 'trešnja', 'kruška', 'orah', 'hrast',
      ];
      const BROAD_PEST_TOKENS = [
        'aphid', 'mite', 'caterpillar', 'thrips', 'whitefly', 'mealybug', 'scale',
        'japanese beetle', 'popillia', 'leafhopper', 'nematode',
        'lisna uš', 'grinj', 'gusenic', 'trip', 'štitast', 'bela mušica', 'nematod',
      ];

      function classifyRelevance(text: string, problemType: 'pest' | 'disease' | 'unknown'):
        { relevance: 'high' | 'medium' | 'low' | 'unknown'; reason: string | null } {
        const t = text.toLowerCase();
        if (!t.trim()) return { relevance: 'unknown', reason: null };
        // High: mentions any confirmed-plant token.
        for (const tok of confirmedTokens) {
          if (tok && t.includes(tok)) return { relevance: 'high', reason: 'mentions_confirmed' };
        }
        // Low: mentions an unrelated host.
        const otherHost = OTHER_HOST_TOKENS.find((h) => t.includes(h));
        if (otherHost) {
          // Skip if that host is in the confirmed-plant tokens.
          const isConfirmed = confirmedTokens.some((c) => c.includes(otherHost) || otherHost.includes(c));
          if (!isConfirmed) return { relevance: 'low', reason: 'mentions_other_host' };
        }
        // Medium: broad pest.
        if (problemType === 'pest' && BROAD_PEST_TOKENS.some((p) => t.includes(p))) {
          return { relevance: 'medium', reason: 'broad_pest' };
        }
        return { relevance: 'unknown', reason: null };
      }

      const enriched = results.slice(0, 10).map((r: any, idx: number) => {
        const disease = r?.disease || r?.species || {};
        const providerCode: string | null =
          (typeof r?.name === 'string' && r.name.trim()) ? r.name.trim() :
          (typeof disease?.code === 'string' && disease.code.trim()) ? disease.code.trim() :
          null;
        const rawDescription: string | null =
          (typeof disease?.description === 'string' && disease.description) ||
          (typeof disease?.description?.content === 'string' && disease.description.content) ||
          (typeof r?.description === 'string' && r.description) ||
          null;
        const diseaseName: string | null =
          (typeof disease?.name === 'string' && disease.name.trim()) ? disease.name.trim() :
          (typeof disease?.scientificName === 'string' && disease.scientificName.trim()) ? disease.scientificName.trim() :
          null;
        // Prefer readable description over opaque provider code.
        const readableName: string | null =
          diseaseName ||
          (rawDescription && rawDescription.trim().length > 0 && rawDescription.trim() !== providerCode
            ? rawDescription.trim()
            : providerCode);
        const affectedOrgans: string[] = Array.isArray(disease?.organs)
          ? disease.organs.filter((s: any) => typeof s === 'string')
          : Array.isArray(r?.organs)
          ? r.organs.filter((s: any) => typeof s === 'string')
          : [];
        const classificationText = [readableName ?? '', rawDescription ?? '', providerCode ?? ''].join(' ');
        const problemType = classifyProblem(classificationText);
        const score = typeof r?.score === 'number' ? r.score : null;
        const images = pickImages(r?.images);
        const { relevance: plantRelevance, reason: plantRelevanceReason } =
          classifyRelevance(classificationText, problemType);
        return {
          rank: idx + 1,
          score,
          providerCode,
          name: readableName,
          description: rawDescription,
          affectedOrgans,
          problemType,
          confidenceBucket: confidenceBucket(score),
          relatedImages: images,
          plantRelevance,
          plantRelevanceReason,
          raw: r,
        };
      });

      // Delete previous unconfirmed diagnoses; keep confirmed row intact.
      await admin
        .from('plant_diagnoses')
        .delete()
        .eq('case_id', plantCaseId)
        .eq('is_confirmed', false);

      const normalizedForInsert = enriched.map((e, idx) => ({
        case_id: plantCaseId,
        user_id: userId,
        provider: 'plantnet_disease',
        rank: e.rank,
        score: e.score,
        problem_type: e.problemType,
        name: e.name,
        description: e.description,
        affected_organs: e.affectedOrgans.length > 0 ? e.affectedOrgans : null,
        raw_result: { ...e.raw, _providerCode: e.providerCode, _confidenceBucket: e.confidenceBucket },
        raw_response: idx === 0 ? raw : null,
        language: lang,
        plant_context_source: plantContextSource,
        plant_scientific_name: pc?.confirmed_scientific_name ?? null,
        plant_common_name: pc?.confirmed_common_name ?? null,
        plant_relevance: e.plantRelevance,
        plant_relevance_reason: e.plantRelevanceReason,
      }));

      const { data: inserted, error: insErr } = await admin
        .from('plant_diagnoses')
        .insert(normalizedForInsert)
        .select('*');
      if (insErr) {
        console.error('[plant-disease-identify] insert failed', insErr.message);
        return jsonResponse({ error: 'db_error' }, 500);
      }

      const hasAnyRelatedImages = enriched.some((e) => e.relatedImages.length > 0);

      const confirmedPlant = {
        scientificName: (confIdent as any)?.scientific_name ?? pc?.confirmed_scientific_name ?? null,
        scientificNameWithoutAuthor: (confIdent as any)?.scientific_name_without_author ?? null,
        commonName: (confIdent as any)?.common_name ?? pc?.confirmed_common_name ?? null,
        genus: (confIdent as any)?.genus ?? null,
        family: (confIdent as any)?.family ?? null,
      };

      // --- AI interpretation (Phase 4B-2) ---
      // Non-blocking: any failure returns provider results normally.
      const aiLang = lang === 'hr' ? 'sr' : 'en';
      const aiApiKey = Deno.env.get('LOVABLE_API_KEY') ?? '';
      let interpretation: AiInterpretationResult;
      if (!aiApiKey) {
        console.warn('[plant-disease-identify] missing_ai_key');
        interpretation = { ok: false, usedFallback: false, fallbackAttempted: false, reason: 'missing_ai_key' };
      } else {
        interpretation = await runAiInterpretation({
          apiKey: aiApiKey,
          primaryModel: normalizeModelId(Deno.env.get('PLANT_DISEASE_AI_PRIMARY_MODEL') ?? 'gemini-3.5-flash'),
          fallbackModel: normalizeModelId(Deno.env.get('PLANT_DISEASE_AI_FALLBACK_MODEL') ?? 'google/gemini-2.5-pro'),
          language: aiLang,
          confirmedPlant,
          caseContext: {
            title: (pcase as any)?.title ?? null,
            notes: (pcase as any)?.notes ?? null,
            location: (pcase as any)?.location_text ?? null,
            crop: (pcase as any)?.crop_context ?? null,
            imageRoles: Array.from(new Set(picked.map((p) => p.image_role || 'auto'))),
          },
          candidates: enriched,
        });
      }

      let interpretationRow: any = null;
      if (interpretation.ok && interpretation.data) {
        const { data: iRow } = await admin
          .from('plant_diagnosis_interpretations')
          .insert({
            case_id: plantCaseId,
            user_id: userId,
            provider: 'gemini',
            model: interpretation.modelUsed,
            fallback_model: interpretation.fallbackAttempted ? (interpretation.fallbackModel ?? null) : null,
            used_fallback: interpretation.usedFallback,
            fallback_reason: interpretation.usedFallback ? (interpretation.fallbackReason ?? null) : null,
            language: aiLang,
            summary: interpretation.data.summary ?? null,
            overall_confidence: interpretation.data.overallConfidence ?? null,
            interpretation: interpretation.data,
          })
          .select('*')
          .maybeSingle();
        interpretationRow = iRow;
      } else {
        console.warn('[plant-disease-identify] ai interpretation failed', interpretation.reason);
      }

      const review = {
        diseases: enriched.map((e) => ({
            rank: e.rank,
            score: e.score,
            name: e.name,
            providerCode: e.providerCode,
            description: e.description,
            affectedOrgans: e.affectedOrgans,
            problemType: e.problemType,
            confidenceBucket: e.confidenceBucket,
            relatedImages: e.relatedImages,
            plantRelevance: e.plantRelevance,
            plantRelevanceReason: e.plantRelevanceReason,
        })),
        hasAnyRelatedImages,
        language: lang,
        confirmedPlant,
      };

      return jsonResponse({
        ok: true,
        results: inserted,
        review,
        interpretation: interpretationRow,
        aiInterpretationFailed: !interpretation.ok,
        usedImageCount: parts.length,
        totalImageCount: allImages.length,
      });
    } finally {
      await cleanupTemp();
    }
  } catch (e) {
    console.error('[plant-disease-identify] fatal', (e as Error).message);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// AI interpretation helpers (Phase 4B-2)
// ---------------------------------------------------------------------------

function normalizeModelId(id: string): string {
  const raw = (id || '').trim();
  if (!raw) return 'google/gemini-3.5-flash';
  if (raw.includes('/')) return raw;
  if (raw.startsWith('gemini')) return `google/${raw}`;
  if (raw.startsWith('gpt')) return `openai/${raw}`;
  return raw;
}

interface AiCandidate {
  rank: number;
  score: number | null;
  providerCode: string | null;
  name: string | null;
  description: string | null;
  problemType: 'pest' | 'disease' | 'unknown';
  confidenceBucket: 'high' | 'medium' | 'low';
  plantRelevance: 'high' | 'medium' | 'low' | 'unknown';
  plantRelevanceReason: string | null;
}

interface AiInterpretationInput {
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
  language: 'en' | 'sr';
  confirmedPlant: {
    scientificName: string | null;
    scientificNameWithoutAuthor: string | null;
    commonName: string | null;
    genus: string | null;
    family: string | null;
  };
  caseContext: {
    title: string | null;
    notes: string | null;
    location: string | null;
    crop: string | null;
    imageRoles: string[];
  };
  candidates: AiCandidate[];
}

interface AiInterpretationResult {
  ok: boolean;
  modelUsed?: string;
  usedFallback: boolean;
  fallbackAttempted: boolean;
  fallbackModel?: string;
  fallbackReason?: string;
  reason?: string;
  data?: any;
}

async function runAiInterpretation(input: AiInterpretationInput): Promise<AiInterpretationResult> {
  if (!input.apiKey) return { ok: false, usedFallback: false, reason: 'missing_api_key' };
  const langInstruction = input.language === 'sr'
    ? 'Respond in Serbian (Latin script).'
    : 'Respond in English.';
  const systemPrompt = `You are a plant disease triage assistant. You interpret candidate results from Pl@ntNet given a confirmed plant species and case context. ${langInstruction}

Rules:
- Return STRICT JSON matching the schema. No markdown, no prose outside JSON.
- Do NOT invent diagnoses outside the provided provider candidates. If you must mention something not in the list, put it ONLY in needsMoreEvidence and label it "not returned by provider".
- Do NOT provide treatment recommendations.
- Do NOT recommend chemicals, pesticides, fungicides, fertilizers, doses, or application instructions.
- Do NOT claim certainty. Explain when Pl@ntNet confidence is low.
- Prefer candidates relevant to the confirmed plant. Mark obviously unrelated candidates as unlikely.
- If all candidates are weak, state that diagnosis remains uncertain.
- whatToCheckVisually: short visual checks only (e.g. "look for orange pustules under leaves", "inspect leaf undersides", "look for insect feeding holes"). No treatment.
- Keep output concise.

Schema:
{
  "summary": string,
  "overallConfidence": "high" | "medium" | "low",
  "bestCandidates": [{ "providerRank": number, "name": string, "problemType": "disease"|"pest"|"unknown", "relevance": "high"|"medium"|"low"|"unknown", "reason": string, "whatToCheckVisually": string[] }],
  "unlikelyCandidates": [{ "providerRank": number, "name": string, "reason": string }],
  "needsMoreEvidence": string[],
  "safetyNote": string
}`;

  const userPayload = {
    confirmedPlant: input.confirmedPlant,
    caseContext: input.caseContext,
    candidates: input.candidates.map((c) => ({
      providerRank: c.rank,
      score: c.score,
      providerCode: c.providerCode,
      name: c.name,
      description: c.description,
      problemType: c.problemType,
      confidenceBucket: c.confidenceBucket,
      plantRelevance: c.plantRelevance,
      plantRelevanceReason: c.plantRelevanceReason,
    })),
  };

  const callOnce = async (model: string): Promise<{ ok: boolean; data?: any; reason?: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) {
        const t = (await resp.text().catch(() => '')).slice(0, 200);
        return { ok: false, reason: `http_${resp.status}:${t}` };
      }
      const body = await resp.json().catch(() => null);
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        return { ok: false, reason: 'empty_content' };
      }
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Attempt to extract JSON object from surrounding text.
        const m = content.match(/\{[\s\S]*\}/);
        if (!m) return { ok: false, reason: 'json_parse_failed' };
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          return { ok: false, reason: 'json_parse_failed' };
        }
      }
      // Minimal shape validation.
      if (!parsed || typeof parsed !== 'object' || typeof parsed.summary !== 'string') {
        return { ok: false, reason: 'schema_mismatch' };
      }
      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, reason: `error:${(e as Error).message}` };
    } finally {
      clearTimeout(timeout);
    }
  };

  const first = await callOnce(input.primaryModel);
  console.log('[plant-disease-identify][ai] primary', input.primaryModel, first.ok ? 'ok' : first.reason);
  if (first.ok) {
    return { ok: true, modelUsed: input.primaryModel, usedFallback: false, fallbackAttempted: false, data: first.data };
  }
  if (!input.fallbackModel || input.fallbackModel === input.primaryModel) {
    return { ok: false, usedFallback: false, fallbackAttempted: false, reason: first.reason };
  }
  const second = await callOnce(input.fallbackModel);
  console.log('[plant-disease-identify][ai] fallback', input.fallbackModel, second.ok ? 'ok' : second.reason);
  if (second.ok) {
    return {
      ok: true,
      modelUsed: input.fallbackModel,
      usedFallback: true,
      fallbackAttempted: true,
      fallbackModel: input.fallbackModel,
      fallbackReason: first.reason,
      data: second.data,
    };
  }
  return {
    ok: false,
    usedFallback: false,
    fallbackAttempted: true,
    fallbackModel: input.fallbackModel,
    reason: `primary:${first.reason};fallback:${second.reason}`,
  };
}
