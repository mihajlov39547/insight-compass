import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PermapeopleNormalizedData {
  attributes?: Record<string, string | null>;
  family?: string | null;
  waterRequirement?: string | null;
  lightRequirement?: string | null;
  soilType?: string | null;
  hardinessZone?: string | null;
  growth?: string | null;
  layer?: string | null;
  edible?: string | null;
  edibleParts?: string | null;
}

export interface ExternalPlantProfileRow {
  id: string;
  user_id: string;
  case_id: string;
  provider: string;
  provider_plant_id: string | null;
  scientific_name: string | null;
  common_name: string | null;
  family: string | null;
  genus: string | null;
  type: string | null;
  match_confidence: 'high' | 'medium' | 'low' | null;
  source_url: string | null;
  image_thumb_url: string | null;
  image_title_url: string | null;
  profile_payload: Record<string, any>;
  normalized_data: PermapeopleNormalizedData;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

export function usePermapeopleProfile(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_external_profile', 'permapeople', caseId],
    queryFn: async (): Promise<ExternalPlantProfileRow | null> => {
      if (!caseId) return null;
      const { data, error } = await (supabase as any)
        .from('plant_case_external_profiles')
        .select('*')
        .eq('case_id', caseId)
        .eq('provider', 'permapeople')
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ExternalPlantProfileRow | null;
    },
  });
}

export function useFetchPermapeopleProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      caseId: string;
      scientificName?: string | null;
      commonName?: string | null;
      force?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('plant-permapeople-profile', {
        body: {
          caseId: args.caseId,
          scientificName: args.scientificName ?? undefined,
          commonName: args.commonName ?? undefined,
          force: args.force,
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
        const err = new Error(code || error.message || 'permapeople_failed');
        (err as any).code = code;
        throw err;
      }
      return data as {
        ok: boolean;
        profile: ExternalPlantProfileRow | null;
        cached?: boolean;
      };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_external_profile', 'permapeople', vars.caseId] });
    },
  });
}
