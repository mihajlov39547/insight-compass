import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

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
}

const BUCKET = 'plant-case-images';
const TABLE = 'plant_case_images';

export const MAX_PLANT_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_PLANT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

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

export function useUploadPlantImage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      caseId,
      file,
      role,
    }: {
      caseId: string;
      file: File;
      role?: PlantImageRole;
    }): Promise<PlantCaseImage> => {
      if (!user) throw new Error('Not authenticated');
      if (file.size > MAX_PLANT_IMAGE_BYTES) throw new Error('File too large (max 10 MB)');
      if (!ACCEPTED_PLANT_IMAGE_MIMES.includes(file.type)) {
        throw new Error('Unsupported image type. Use JPEG, PNG, or WebP.');
      }
      const imageId = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
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
          image_role: role ?? 'auto',
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        })
        .select('*')
        .single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw error;
      }
      return data as PlantCaseImage;
    },
    onSuccess: (img) => {
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
      await supabase.storage.from('plant-case-images').remove([img.storage_path]);
      const { error } = await (supabase as any).from(TABLE).delete().eq('id', img.id);
      if (error) throw error;
      return img;
    },
    onSuccess: (img) => {
      qc.invalidateQueries({ queryKey: ['plant_case_images', img.case_id] });
    },
  });
}
