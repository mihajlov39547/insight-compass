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
  plant_relevance: 'high' | 'medium' | 'low' | 'unknown' | null;
  plant_relevance_reason: string | null;
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
  providerCode: string | null;
  description: string | null;
  affectedOrgans: string[];
  problemType: 'pest' | 'disease' | 'unknown';
  confidenceBucket: 'high' | 'medium' | 'low';
  relatedImages: PlantDiseaseRelatedImage[];
  plantRelevance: 'high' | 'medium' | 'low' | 'unknown';
  plantRelevanceReason: string | null;
}

export interface PlantDiseaseReviewConfirmedPlant {
  scientificName: string | null;
  scientificNameWithoutAuthor: string | null;
  commonName: string | null;
  genus: string | null;
  family: string | null;
}

export interface PlantDiseaseReview {
  diseases: PlantDiseaseReviewItem[];
  hasAnyRelatedImages: boolean;
  language: string;
  confirmedPlant?: PlantDiseaseReviewConfirmedPlant;
}

export interface PlantDiagnosisInterpretationBestCandidate {
  providerRank: number;
  name: string;
  problemType: 'disease' | 'pest' | 'unknown';
  relevance: 'high' | 'medium' | 'low' | 'unknown';
  reason: string;
  whatToCheckVisually: string[];
}

export interface PlantDiagnosisInterpretationUnlikelyCandidate {
  providerRank: number;
  name: string;
  reason: string;
}

export interface PlantDiagnosisInterpretationProfileContext {
  used: boolean;
  notes: string[];
  warnings: string[];
}

export interface PlantDiagnosisInterpretationData {
  summary: string;
  overallConfidence: 'high' | 'medium' | 'low';
  bestCandidates: PlantDiagnosisInterpretationBestCandidate[];
  unlikelyCandidates: PlantDiagnosisInterpretationUnlikelyCandidate[];
  needsMoreEvidence: string[];
  safetyNote: string;
  plantProfileContext?: PlantDiagnosisInterpretationProfileContext;
}

export interface PlantDiagnosisInterpretation {
  id: string;
  case_id: string;
  user_id: string;
  provider: string;
  model: string | null;
  fallback_model: string | null;
  used_fallback: boolean;
  fallback_reason: string | null;
  diagnosis_run_at: string;
  language: string | null;
  summary: string | null;
  overall_confidence: 'high' | 'medium' | 'low' | null;
  interpretation: PlantDiagnosisInterpretationData | null;
  created_at: string;
}

export interface DiagnoseDiseaseResponse {
  ok?: boolean;
  results?: PlantDiagnosis[];
  review?: PlantDiseaseReview;
  interpretation?: PlantDiagnosisInterpretation | null;
  aiInterpretationFailed?: boolean;
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
      qc.invalidateQueries({ queryKey: ['plant_diagnosis_interpretations', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_case', vars.plantCaseId] });
      qc.invalidateQueries({ queryKey: ['plant_cases'] });
      qc.invalidateQueries({ queryKey: ['plant_ai_scan_usage'] });
      qc.invalidateQueries({ queryKey: ['plant_identification_usage'] });
    },
  });
}

export function usePlantDiagnosisInterpretations(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_diagnosis_interpretations', caseId],
    queryFn: async (): Promise<PlantDiagnosisInterpretation | null> => {
      if (!caseId) return null;
      const { data, error } = await (supabase as any)
        .from('plant_diagnosis_interpretations')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PlantDiagnosisInterpretation | null;
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
