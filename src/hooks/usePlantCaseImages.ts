import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { normalizePlan } from '@/types/app';
import {
  canUploadPlantImage,
  formatPlantLimitReason,
  PLANT_ADVISOR_ACCEPTED_MIMES,
  type PlantAdvisorPlan,
} from '@/config/plantAdvisorLimits';

export const PLANT_IMAGE_ROLES = [
  'auto',
  'whole_plant',
  'leaf',
  'flower',
  'fruit',
  'bark',
  'stem',
  'root',
  'other',
] as const;
export type PlantImageRole = (typeof PLANT_IMAGE_ROLES)[number];

export type PlantImageStorageMode = 'supabase' | 'google_drive' | 'hybrid';
export type PlantImageUploadStatus =
  | 'staged'
  | 'uploading'
  | 'ready'
  | 'drive_failed'
  | 'deleting'
  | 'deleted';

export interface PlantCaseImage {
  id: string;
  case_id: string;
  user_id: string;
  storage_path: string;
  image_role: PlantImageRole;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  storage_mode: PlantImageStorageMode;
  upload_status: PlantImageUploadStatus;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  drive_folder_id: string | null;
  drive_mime_type: string | null;
  drive_uploaded_at: string | null;
  drive_thumbnail_link: string | null;
  drive_thumbnail_version: string | null;
  drive_has_thumbnail: boolean | null;
  drive_image_width: number | null;
  drive_image_height: number | null;
  drive_web_content_link: string | null;
  staging_storage_path: string | null;
  upload_error_code: string | null;
  upload_error_message: string | null;
}


const BUCKET = 'plant-case-images';
const TABLE = 'plant_case_images';

// Backwards-compat exports (still referenced elsewhere as a hard cap).
export const MAX_PLANT_IMAGE_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_PLANT_IMAGE_MIMES = PLANT_ADVISOR_ACCEPTED_MIMES;

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

export function usePlantCaseImages(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_case_images', caseId],
    queryFn: async (): Promise<PlantCaseImage[]> => {
      if (!caseId) return [];
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .select('*')
        .eq('case_id', caseId)
        .neq('upload_status', 'deleted')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlantCaseImage[];
    },
  });
}

export async function getPlantImageSignedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Fetch a plant image preview from the backend proxy (Drive or Supabase fallback)
 * and return an object URL suitable for an <img src>. Caller must revokeObjectURL.
 */
export async function fetchPlantImagePreviewObjectUrl(
  imageId: string,
): Promise<string | null> {
  try {
    const { fetchEdgeFunction } = await import('@/lib/edge/invokeWithAuth');
    const resp = await fetchEdgeFunction(
      `/functions/v1/plant-image-drive-preview?plantCaseImageId=${encodeURIComponent(imageId)}`,
      { method: 'GET' },
    );
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}


export function useUploadPlantImage() {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const plan = normalizePlan(profile?.plan) as PlantAdvisorPlan;

  return useMutation({
    mutationFn: async ({
      caseId,
      file,
      role,
      currentImagesInCase = 0,
      currentTotalImages = 0,
    }: {
      caseId: string;
      file: File;
      role?: PlantImageRole;
      currentImagesInCase?: number;
      currentTotalImages?: number;
    }): Promise<PlantCaseImage> => {
      if (!user) throw new Error('Not authenticated');

      // Client-side plan check (backend RLS still enforces ownership; explicit
      // backend quota enforcement is TODO before public launch).
      const check = canUploadPlantImage(
        plan,
        currentImagesInCase,
        currentTotalImages,
        file.size,
        file.type,
      );
      if (!check.ok) {
        const err = new Error(formatPlantLimitReason(check.reason));
        (err as any).limitReason = check.reason;
        throw err;
      }

      const imageId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      const storagePath = `plant-cases/${user.id}/${caseId}/${imageId}-${safeName(file.name)}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { data, error } = await (supabase as any)
        .from(TABLE)
        .insert({
          id: imageId,
          case_id: caseId,
          user_id: user.id,
          storage_path: storagePath,
          staging_storage_path: storagePath,
          image_role: role ?? 'auto',
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          storage_mode: 'supabase',
          upload_status: 'staged',
        })
        .select('*')
        .single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw error;
      }

      // Fire-and-forget Drive promotion. UI re-fetches via invalidation when done.
      supabase.functions
        .invoke('plant-image-drive-upload', { body: { plantCaseImageId: imageId } })
        .then(() => {
          qc.invalidateQueries({ queryKey: ['plant_case_images', caseId] });
          qc.invalidateQueries({ queryKey: ['plant_images_count'] });
        })
        .catch((e) => console.warn('[plant-image] Drive promote failed', e));

      return data as PlantCaseImage;
    },
    onSuccess: (img) => {
      qc.invalidateQueries({ queryKey: ['plant_case_images', img.case_id] });
      qc.invalidateQueries({ queryKey: ['plant_images_count'] });
    },
  });
}

export function useRetryPlantImageDriveUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (img: PlantCaseImage) => {
      const { data, error } = await supabase.functions.invoke('plant-image-drive-retry', {
        body: { plantCaseImageId: img.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, img) => {
      qc.invalidateQueries({ queryKey: ['plant_case_images', img.case_id] });
    },
  });
}

export function useUpdatePlantImageRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: PlantImageRole }): Promise<PlantCaseImage> => {
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .update({ image_role: role })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as PlantCaseImage;
    },
    onSuccess: (img) => {
      qc.invalidateQueries({ queryKey: ['plant_case_images', img.case_id] });
    },
  });
}

export function useDeletePlantImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (img: PlantCaseImage) => {
      // 1) DB row first (avoid orphan refs pointing at missing objects).
      const { error } = await (supabase as any).from(TABLE).delete().eq('id', img.id);
      if (error) throw error;

      // 2) Best-effort Supabase staging object cleanup.
      const supabasePaths = [img.storage_path, img.staging_storage_path].filter(
        (p): p is string => !!p,
      );
      if (supabasePaths.length > 0) {
        await supabase.storage.from(BUCKET).remove(supabasePaths).catch(() => {});
      }

      // 3) Best-effort Drive cleanup via backend.
      if (img.drive_file_id) {
        await supabase.functions
          .invoke('plant-image-drive-delete', { body: { driveFileIds: [img.drive_file_id] } })
          .catch((e) => console.warn('[plant-image] Drive delete failed', e));
      }
      return img;
    },
    onSuccess: (img) => {
      qc.invalidateQueries({ queryKey: ['plant_case_images', img.case_id] });
      qc.invalidateQueries({ queryKey: ['plant_images_count'] });
    },
  });
}
