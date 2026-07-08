import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PlantIdentifyTempImage } from '@/hooks/usePlantIdentifications';

export interface PlantDiagnosis {
  id: string;
  case_id: string;
  user_id: string;
  provider: string;
  rank: number;
  score: number | null;
  problem_type: string;
  name: string | null;
  description: string | null;
  affected_organs: string[] | null;
  language: string | null;
  plant_scientific_name: string | null;
  plant_common_name: string | null;
  plant_context_source: string | null;
  is_confirmed: boolean;
  confirmed_at: string | null;
  created_at: string;
}

export interface PlantDiseaseRelatedImage {
  urlSmall: string | null;
  urlMedium: string | null;
  urlOriginal: string | null;
  organ: string | null;
  author: string | null;
  license: string | null;
  citation: string | null;
  date: string | null;
}

export interface PlantDiseaseReviewItem {
  rank: number;
  score: number | null;
  name: string | null;
  description: string | null;
  affectedOrgans: string[];
  relatedImages: PlantDiseaseRelatedImage[];
}

export interface PlantDiseaseReview {
  diseases: PlantDiseaseReviewItem[];
  language: string;
}

export interface DiagnoseDiseaseResponse {
  ok?: boolean;
  results?: PlantDiagnosis[];
  review?: PlantDiseaseReview;
  usedImageCount?: number;
  totalImageCount?: number;
  error?: string;
}

export function usePlantDiagnoses(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_diagnoses', caseId],
    queryFn: async (): Promise<PlantDiagnosis[]> => {
      if (!caseId) return [];
      const { data, error } = await (supabase as any)
        .from('plant_diagnoses')
        .select('*')
        .eq('case_id', caseId)
        .order('rank', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlantDiagnosis[];
    },
  });
}

export function useDiagnoseDisease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      plantCaseId: string;
      imageIds?: string[];
      tempImages?: PlantIdentifyTempImage[];
      lang?: string;
    }): Promise<DiagnoseDiseaseResponse> => {
      const { data, error } = await supabase.functions.invoke('plant-disease-identify', {
        body: {
          plantCaseId: args.plantCaseId,
          imageIds: args.imageIds,
          tempImages: args.tempImages,
          lang: args.lang ?? 'en',
        },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let code: string | undefined;
        try {
          const b = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          code = b?.error;
        } catch {
          code = undefined;
        }
        const err = new Error(code || error.message || 'diagnosis_failed');
        (err as any).code = code;
        throw err;
      }
      return (data ?? {}) as DiagnoseDiseaseResponse;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_diagnoses', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_case', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
    },
  });
}

export function useConfirmPlantDiagnosis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { plantCaseId: string; diagnosisId: string }) => {
      const { data, error } = await supabase.functions.invoke('plant-diagnosis-confirm', {
        body: args,
      });
      if (error) {
        const ctx: any = (error as any).context;
        let code: string | undefined;
        try {
          const b = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          code = b?.error;
        } catch {
          code = undefined;
        }
        const err = new Error(code || error.message || 'confirmation_failed');
        (err as any).code = code;
        throw err;
      }
      return data as { ok: boolean; diagnosis: PlantDiagnosis };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_diagnoses', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_case', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
    },
  });
}
