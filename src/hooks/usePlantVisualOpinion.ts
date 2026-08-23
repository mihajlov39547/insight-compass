import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type VisualOpinionMode = 'identify' | 'diagnose';

export interface VisualOpinionStructured {
  markdown?: string;
  firstParagraph?: string;
  bullets?: string[];
  saysNotPlant?: boolean;
  saysWrongImage?: boolean;
  possiblePlantNames?: string[];
  possibleProblemNames?: string[];
  missingPhotoSuggestions?: string[];
  visibleSymptoms?: string[];
  confidenceSignal?: 'high' | 'medium' | 'low' | 'unknown';
  safetyFlags?: {
    containsTreatmentAdvice?: boolean;
    containsChemicalSpecifics?: boolean;
    containsPersonIdentification?: boolean;
    notAPlantImage?: boolean;
  };
}

export interface VisualOpinionRow {
  id: string;
  user_id: string;
  case_id: string;
  provider: string;
  mode: VisualOpinionMode;
  image_ids: string[];
  query: string;
  language: string | null;
  country: string | null;
  status: string;
  opinion_summary: string | null;
  structured_result: VisualOpinionStructured;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

export function usePlantVisualOpinion(
  caseId: string | null | undefined,
  mode: VisualOpinionMode,
) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_visual_opinion', caseId, mode],
    queryFn: async (): Promise<VisualOpinionRow | null> => {
      if (!caseId) return null;
      const { data, error } = await (supabase as any)
        .from('plant_case_visual_opinions')
        .select('*')
        .eq('case_id', caseId)
        .eq('provider', 'serpapi_google_ai_mode')
        .eq('mode', mode)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as VisualOpinionRow | null;
    },
  });
}

export function useRunPlantVisualOpinion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      caseId: string;
      mode: VisualOpinionMode;
      imageId?: string | null;
      force?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('plant-serpapi-visual-opinion', {
        body: {
          caseId: args.caseId,
          mode: args.mode,
          imageId: args.imageId ?? undefined,
          force: args.force === true,
        },
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
        const err = new Error(code || error.message || 'visual_opinion_failed');
        (err as any).code = code;
        throw err;
      }
      return data as { ok: boolean; cached?: boolean; opinion: VisualOpinionRow };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_visual_opinion', vars.caseId, vars.mode] });
    },
  });
}

/** True when the second opinion clearly does not support the confirmed record. */
export function visualOpinionConflicts(
  row: VisualOpinionRow | null | undefined,
  confirmedName: string | null | undefined,
): boolean {
  if (!row) return false;
  const s = row.structured_result ?? {};
  if (s.safetyFlags?.notAPlantImage || s.saysNotPlant) return true;
  if (!confirmedName) return false;
  const text = `${row.opinion_summary ?? ''} ${s.markdown ?? ''}`.toLowerCase();
  const tokens = confirmedName
    .toLowerCase()
    .split(/[\s(),]+/)
    .filter((w) => w.length > 3);
  if (tokens.length === 0) return false;
  const supported = tokens.some((w) => text.includes(w));
  return !supported;
}
