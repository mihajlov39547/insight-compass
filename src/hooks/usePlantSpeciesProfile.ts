import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PlantSpeciesProfileRow {
  id: string;
  case_id: string;
  user_id: string;
  identification_id: string | null;
  provider: string;
  provider_id: string | null;
  slug: string | null;
  scientific_name: string | null;
  common_name: string | null;
  family: string | null;
  genus: string | null;
  status: string | null;
  rank: string | null;
  profile: Record<string, any>;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

export function usePlantSpeciesProfile(caseId: string | null | undefined) {
  return useQuery({
    enabled: !!caseId,
    queryKey: ['plant_species_profile', caseId],
    queryFn: async (): Promise<PlantSpeciesProfileRow | null> => {
      if (!caseId) return null;
      const { data, error } = await (supabase as any)
        .from('plant_species_profiles')
        .select('*')
        .eq('case_id', caseId)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PlantSpeciesProfileRow | null;
    },
  });
}

export function useEnrichPlantProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { plantCaseId: string; identificationId?: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('trefle-plant-enrich', {
        body: {
          plantCaseId: args.plantCaseId,
          identificationId: args.identificationId,
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
        const err = new Error(code || error.message || 'trefle_failed');
        (err as any).code = code;
        throw err;
      }
      return data as { ok: boolean; profile: PlantSpeciesProfileRow | null; cached?: boolean };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['plant_species_profile', vars.plantCaseId] });
    },
  });
}

/**
 * Auto-enrich once when a plant is confirmed and no profile exists yet.
 */
export function useAutoEnrichPlantProfile(args: {
  caseId: string;
  hasConfirmedIdentification: boolean;
}) {
  const { caseId, hasConfirmedIdentification } = args;
  const profile = usePlantSpeciesProfile(caseId);
  const enrich = useEnrichPlantProfile();

  useEffect(() => {
    if (!hasConfirmedIdentification) return;
    if (profile.isLoading || profile.isFetching) return;
    if (profile.data) return;
    if (enrich.isPending) return;
    enrich.mutate({ plantCaseId: caseId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConfirmedIdentification, profile.isLoading, profile.isFetching, profile.data, caseId]);

  return { profile, enrich };
}
