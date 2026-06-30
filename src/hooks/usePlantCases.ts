import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export const PLANT_CASE_STATUSES = [
  'draft',
  'ready_for_identification',
  'identified',
  'diagnosed',
  'treated',
  'archived',
] as const;
export type PlantCaseStatus = (typeof PLANT_CASE_STATUSES)[number];

export const PLANT_CASE_GOALS = [
  'identify',
  'diagnose',
  'improve_growth',
  'increase_income',
] as const;
export type PlantCaseGoal = (typeof PLANT_CASE_GOALS)[number];

export interface PlantCase {
  id: string;
  user_id: string;
  project_id: string | null;
  notebook_id: string | null;
  title: string;
  status: PlantCaseStatus;
  user_goal: PlantCaseGoal | null;
  location_text: string | null;
  crop_context: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type NewPlantCase = {
  title: string;
  user_goal?: PlantCaseGoal | null;
  location_text?: string | null;
  crop_context?: string | null;
  notes?: string | null;
  status?: PlantCaseStatus;
  project_id?: string | null;
  notebook_id?: string | null;
};

const TABLE = 'plant_cases';

export function usePlantCases() {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user,
    queryKey: ['plant_cases', user?.id],
    queryFn: async (): Promise<PlantCase[]> => {
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PlantCase[];
    },
  });
}

export function usePlantCase(id: string | null | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['plant_case', id],
    queryFn: async (): Promise<PlantCase | null> => {
      if (!id) return null;
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as PlantCase) ?? null;
    },
  });
}

export function useCreatePlantCase() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: NewPlantCase): Promise<PlantCase> => {
      if (!user) throw new Error('Not authenticated');
      const payload = {
        user_id: user.id,
        title: input.title,
        status: input.status ?? 'draft',
        user_goal: input.user_goal ?? null,
        location_text: input.location_text ?? null,
        crop_context: input.crop_context ?? null,
        notes: input.notes ?? null,
        project_id: input.project_id ?? null,
        notebook_id: input.notebook_id ?? null,
      };
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .insert(payload)
        .select('*')
        .single();
      if (error) throw error;
      return data as PlantCase;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
      qc.invalidateQueries({ queryKey: ['plant_cases_count'] });
    },
  });
}

export function useUpdatePlantCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NewPlantCase> }): Promise<PlantCase> => {
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as PlantCase;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
      if (data?.id) qc.invalidateQueries({ queryKey: ['plant_case', data.id] });
    },
  });
}

export function useDeletePlantCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Collect storage paths AND Drive file IDs first, then delete the case row
      // (CASCADE removes image rows), then best-effort cleanup external storage.
      // TODO(orphan-cleanup): add a scheduled sweep for Supabase/Drive remnants.
      const { data: images } = await (supabase as any)
        .from('plant_case_images')
        .select('storage_path, staging_storage_path, drive_file_id')
        .eq('case_id', id);
      const rows = (images as Array<{
        storage_path: string | null;
        staging_storage_path: string | null;
        drive_file_id: string | null;
      }>) ?? [];

      const paths = Array.from(
        new Set(
          rows.flatMap((r) => [r.storage_path, r.staging_storage_path]).filter((p): p is string => !!p),
        ),
      );
      const driveIds = rows.map((r) => r.drive_file_id).filter((d): d is string => !!d);

      const { error } = await (supabase as any).from(TABLE).delete().eq('id', id);
      if (error) throw error;

      if (paths.length > 0) {
        await supabase.storage.from('plant-case-images').remove(paths).catch(() => {});
      }
      if (driveIds.length > 0) {
        await supabase.functions
          .invoke('plant-image-drive-delete', { body: { driveFileIds: driveIds } })
          .catch((e) => console.warn('[plant-case] Drive cleanup failed', e));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
      qc.invalidateQueries({ queryKey: ['plant_cases_count'] });
      qc.invalidateQueries({ queryKey: ['plant_images_count'] });
    },
  });
}
