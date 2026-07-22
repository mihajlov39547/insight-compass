import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type GroundingSourceType =
  | 'university_extension'
  | 'botanical_garden'
  | 'government'
  | 'plant_database'
  | 'horticulture_site'
  | 'other';

export type GroundingAuthorityScore = 'high' | 'medium' | 'low';

export interface GroundingSource {
  provider: 'trefle' | 'perenual' | 'web';
  title: string;
  url: string | null;
  fetchedAt: string;
  summary: string;
  fields?: Record<string, unknown> | null;
  careCategories?: string[];
  sourceType?: GroundingSourceType;
  authorityScore?: GroundingAuthorityScore;
}

export interface CareCategory {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  sources: Array<{ provider: string; title?: string; url?: string }>;
}

export interface GroundingRow {
  id: string;
  case_id: string;
  user_id: string;
  goal: string;
  status: 'success' | 'partial' | 'error';
  primary_scientific_name: string | null;
  primary_common_name: string | null;
  location_text: string | null;
  provider_payload: any;
  normalized_summary: {
    plant?: {
      confirmedCommonName: string | null;
      confirmedScientificName: string | null;
      identificationConfidence: number | null;
      confidenceWarning: boolean;
    };
    location?: { text: string | null; cropContext: string | null };
    normalizedCare?: Record<string, CareCategory | null>;
    limitations?: string[];
  };
  sources: GroundingSource[];
  error_code: string | null;
  error_message: string | null;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

export function usePlantCaseGrounding(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_case_grounding', caseId],
    queryFn: async (): Promise<GroundingRow | null> => {
      if (!caseId) return null;
      const { data, error } = await (supabase as any)
        .from('plant_case_grounding_contexts')
        .select('*')
        .eq('case_id', caseId)
        .eq('goal', 'improve_growth')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as GroundingRow | null;
    },
  });
}

export function useGatherGrowthGuidance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { caseId: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('plant-growth-grounding', {
        body: { caseId: args.caseId, force: !!args.force },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let code: string | undefined;
        try {
          const b = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          code = b?.error;
        } catch { /* ignore */ }
        const err = new Error(code || error.message || 'grounding_failed');
        (err as any).code = code;
        throw err;
      }
      return data as { ok: boolean; cached: boolean; grounding: GroundingRow };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_case_grounding', vars.caseId] });
    },
  });
}
