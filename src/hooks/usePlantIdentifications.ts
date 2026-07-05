import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  convertImageBlobToJpeg,
  isWebpMime,
} from '@/lib/plantImageConversion';
import { fetchPlantImagePreviewObjectUrl } from '@/hooks/usePlantCaseImages';
import type { PlantCaseImage } from '@/hooks/usePlantCaseImages';

const TEMP_BUCKET = 'plant-identification-temp';

export interface PlantIdentifyTempImage {
  sourceImageId: string;
  storagePath: string;
  mimeType: 'image/jpeg';
  originalRole?: string;
}

/**
 * For each WebP image in the input list, fetch its bytes, convert to JPEG
 * client-side, and upload to the temporary identification bucket. Returns
 * the list of temp descriptors to pass to the plantnet-identify function.
 * Non-WebP images are ignored (handled by the backend directly).
 */
export async function prepareWebpTempImages(args: {
  userId: string;
  caseId: string;
  images: PlantCaseImage[];
}): Promise<PlantIdentifyTempImage[]> {
  const { userId, caseId, images } = args;
  const webps = images.filter((i) => isWebpMime(i.mime_type));
  if (webps.length === 0) return [];

  const results: PlantIdentifyTempImage[] = [];
  for (const img of webps) {
    // 1) Get original bytes via the preview proxy (works for Drive + Supabase modes).
    const objectUrl = await fetchPlantImagePreviewObjectUrl(img.id);
    if (!objectUrl) throw new Error('webp_fetch_failed');
    let blob: Blob;
    try {
      const resp = await fetch(objectUrl);
      blob = await resp.blob();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    // 2) Convert to JPEG via canvas.
    const jpeg = await convertImageBlobToJpeg(blob);

    // 3) Upload to the private temp bucket. Path prefix must be userId (RLS).
    const storagePath = `${userId}/${caseId}/${img.id}.jpg`;
    const { error: upErr } = await supabase.storage
      .from(TEMP_BUCKET)
      .upload(storagePath, jpeg, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (upErr) throw upErr;

    results.push({
      sourceImageId: img.id,
      storagePath,
      mimeType: 'image/jpeg',
      originalRole: img.image_role ?? undefined,
    });
  }
  return results;
}

export interface PlantIdentification {
  id: string;
  case_id: string;
  user_id: string;
  provider: string;
  project: string;
  rank: number;
  score: number | null;
  scientific_name: string | null;
  scientific_name_without_author: string | null;
  scientific_name_authorship: string | null;
  common_name: string | null;
  family: string | null;
  genus: string | null;
  gbif_id: string | null;
  powo_id: string | null;
  raw_result: unknown;
  remaining_identification_requests: number | null;
  engine_version: string | null;
  created_at: string;
  is_confirmed?: boolean;
  confirmed_at?: string | null;
}

export function usePlantIdentifications(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_identifications', caseId],
    queryFn: async (): Promise<PlantIdentification[]> => {
      if (!caseId) return [];
      const { data, error } = await (supabase as any)
        .from('plant_identifications')
        .select('*')
        .eq('case_id', caseId)
        .order('rank', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlantIdentification[];
    },
  });
}

export interface IdentifyPlantResponse {
  ok?: boolean;
  results?: PlantIdentification[];
  remainingIdentificationRequests?: number | null;
  usedImageCount?: number;
  totalImageCount?: number;
  error?: string;
  usage?: {
    used: number;
    limit: number;
    remaining: number;
    monthKey: string;
  };
}

export function useIdentifyPlant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      plantCaseId: string;
      imageIds?: string[];
      tempImages?: PlantIdentifyTempImage[];
    }): Promise<IdentifyPlantResponse> => {
      const { data, error } = await supabase.functions.invoke('plantnet-identify', {
        body: {
          plantCaseId: args.plantCaseId,
          imageIds: args.imageIds,
          tempImages: args.tempImages,
          project: 'all',
          lang: 'en',
        },
      });
      if (error) {
        // supabase.functions.invoke wraps the response body when non-2xx.
        const ctx: any = (error as any).context;
        let code: string | undefined;
        try {
          const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          code = body?.error;
        } catch {
          code = undefined;
        }
        const err = new Error(code || error.message || 'identification_failed');
        (err as any).code = code;
        throw err;
      }
      return (data ?? {}) as IdentifyPlantResponse;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_identifications', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_case', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
      qc.invalidateQueries({ queryKey: ['plant_identification_usage'] });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['plant_identification_usage'] });
    },
  });
}

export function useConfirmPlantIdentification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { plantCaseId: string; identificationId: string }) => {
      const { data, error } = await supabase.functions.invoke('plant-identification-confirm', {
        body: args,
      });
      if (error) {
        const ctx: any = (error as any).context;
        let code: string | undefined;
        try {
          const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          code = body?.error;
        } catch {
          code = undefined;
        }
        const err = new Error(code || error.message || 'confirmation_failed');
        (err as any).code = code;
        throw err;
      }
      return data as { ok: boolean; identification: PlantIdentification };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_identifications', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_case', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
    },
  });
}

export function confidenceBucket(score: number | null | undefined): 'high' | 'medium' | 'low' | null {
  if (score == null) return null;
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}
