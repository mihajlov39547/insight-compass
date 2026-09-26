import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import type { FollowupArea, FollowupOutcome } from '@/lib/plantFollowupReview';

export interface PlantCaseFollowup {
  id: string;
  user_id: string;
  case_id: string;
  followup_date: string;
  title: string | null;
  note: string | null;
  outcome_status: FollowupOutcome;
  related_area: FollowupArea;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function usePlantCaseFollowups(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_case_followups', caseId],
    queryFn: async (): Promise<PlantCaseFollowup[]> => {
      const { data, error } = await (supabase as any)
        .from('plant_case_followups')
        .select('*')
        .eq('case_id', caseId)
        .order('followup_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PlantCaseFollowup[];
    },
  });
}

export function useCreatePlantCaseFollowup() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      caseId: string;
      followup_date: string;
      title: string | null;
      note: string | null;
      outcome_status: FollowupOutcome;
      related_area: FollowupArea;
    }): Promise<PlantCaseFollowup> => {
      if (!user) throw new Error('Not authenticated');
      const { caseId, ...rest } = input;
      const { data, error } = await (supabase as any)
        .from('plant_case_followups')
        .insert({ ...rest, case_id: caseId, user_id: user.id })
        .select('*')
        .single();
      if (error) throw error;
      return data as PlantCaseFollowup;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['plant_case_followups', row.case_id] });
    },
  });
}

export function useDeletePlantCaseFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { id: string; case_id: string }) => {
      const { error } = await (supabase as any).from('plant_case_followups').delete().eq('id', row.id);
      if (error) throw error;
      return row;
    },
    onSuccess: (row) => qc.invalidateQueries({ queryKey: ['plant_case_followups', row.case_id] }),
  });
}

/** Link freshly uploaded images to a follow-up entry. */
export async function linkImagesToFollowup(imageIds: string[], followupId: string) {
  if (imageIds.length === 0) return;
  const { error } = await (supabase as any)
    .from('plant_case_images')
    .update({ followup_id: followupId, image_context: 'followup' })
    .in('id', imageIds);
  if (error) throw error;
}
