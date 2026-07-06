import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export type PlantIdentificationLanguage = 'en' | 'sr';
export type PlantIdentificationProject =
  | 'k-southeastern-europe'
  | 'k-world-flora'
  | 'all';

export interface PlantAdvisorSettings {
  identificationLanguage: PlantIdentificationLanguage;
  identificationProject: PlantIdentificationProject;
}

const DEFAULTS: PlantAdvisorSettings = {
  identificationLanguage: 'en',
  identificationProject: 'k-southeastern-europe',
};

const VALID_LANGS: PlantIdentificationLanguage[] = ['en', 'sr'];
const VALID_PROJECTS: PlantIdentificationProject[] = [
  'k-southeastern-europe',
  'k-world-flora',
  'all',
];

function normLang(v: unknown): PlantIdentificationLanguage {
  return VALID_LANGS.includes(v as PlantIdentificationLanguage)
    ? (v as PlantIdentificationLanguage)
    : DEFAULTS.identificationLanguage;
}
function normProject(v: unknown): PlantIdentificationProject {
  return VALID_PROJECTS.includes(v as PlantIdentificationProject)
    ? (v as PlantIdentificationProject)
    : DEFAULTS.identificationProject;
}

/** Map user-facing language to the Pl@ntNet API `lang` param. */
export function toPlantnetApiLang(l: PlantIdentificationLanguage): 'en' | 'hr' {
  return l === 'sr' ? 'hr' : 'en';
}

export function usePlantAdvisorSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    enabled: !!user,
    queryKey: ['plant-advisor-settings', user?.id],
    queryFn: async (): Promise<PlantAdvisorSettings> => {
      if (!user) return DEFAULTS;
      const { data, error } = await (supabase as any)
        .from('user_settings')
        .select('plant_identification_language, plant_identification_project')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) return DEFAULTS;
      return {
        identificationLanguage: normLang(data.plant_identification_language),
        identificationProject: normProject(data.plant_identification_project),
      };
    },
  });

  const mutation = useMutation({
    mutationFn: async (patch: Partial<PlantAdvisorSettings>) => {
      if (!user) throw new Error('not_authenticated');
      const payload: Record<string, unknown> = { user_id: user.id };
      if (patch.identificationLanguage !== undefined) {
        payload.plant_identification_language = normLang(patch.identificationLanguage);
      }
      if (patch.identificationProject !== undefined) {
        payload.plant_identification_project = normProject(patch.identificationProject);
      }
      const { error } = await (supabase as any)
        .from('user_settings')
        .upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plant-advisor-settings', user?.id] });
    },
  });

  return {
    ...(query.data ?? DEFAULTS),
    isLoading: query.isLoading,
    updateSettings: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
