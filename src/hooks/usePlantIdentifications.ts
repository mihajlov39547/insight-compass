import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
}

export function useIdentifyPlant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      plantCaseId: string;
      imageIds?: string[];
    }): Promise<IdentifyPlantResponse> => {
      const { data, error } = await supabase.functions.invoke('plantnet-identify', {
        body: {
          plantCaseId: args.plantCaseId,
          imageIds: args.imageIds,
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
    },
  });
}

export function confidenceBucket(score: number | null | undefined): 'high' | 'medium' | 'low' | null {
  if (score == null) return null;
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}
