import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

/** One Plant Case Research run per user per calendar day, across all cases. */
export const PLANT_RESEARCH_DAILY_LIMIT = 1;

/** Local calendar day (YYYY-MM-DD) — falls back to UTC formatting rules. */
export function localRunDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface PlantResearchQuota {
  runDate: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

function quotaKey(userId: string | undefined, runDate: string) {
  return ['plant-case-research-quota', userId ?? null, runDate];
}

export function usePlantCaseResearchQuota() {
  const { user } = useAuth();
  const runDate = localRunDate();

  const query = useQuery({
    queryKey: quotaKey(user?.id, runDate),
    enabled: !!user,
    queryFn: async (): Promise<PlantResearchQuota> => {
      const { count, error } = await supabase
        .from('plant_case_research_runs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('run_date', runDate);
      if (error) throw error;
      const used = count ?? 0;
      return {
        runDate,
        used,
        limit: PLANT_RESEARCH_DAILY_LIMIT,
        remaining: Math.max(0, PLANT_RESEARCH_DAILY_LIMIT - used),
        exhausted: used >= PLANT_RESEARCH_DAILY_LIMIT,
      };
    },
  });

  return {
    ...query,
    runDate,
    quota:
      query.data ??
      ({
        runDate,
        used: 0,
        limit: PLANT_RESEARCH_DAILY_LIMIT,
        remaining: PLANT_RESEARCH_DAILY_LIMIT,
        exhausted: false,
      } satisfies PlantResearchQuota),
  };
}

/**
 * Reserve today's research slot. The unique(user_id, run_date) constraint makes
 * this the atomic gate — a duplicate insert means the quota is already spent.
 */
export function useReservePlantResearchRun() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ caseId }: { caseId: string }) => {
      if (!user) throw new Error('not_authenticated');
      const runDate = localRunDate();
      const { data, error } = await supabase
        .from('plant_case_research_runs')
        .insert({ user_id: user.id, case_id: caseId, run_date: runDate })
        .select('id')
        .single();
      if (error) {
        // 23505 = unique_violation on unique(user_id, run_date)
        if (error.code === '23505') throw new Error('quota_exhausted');
        if (error.code === '23503' || error.code === '42501') throw new Error('invalid_case');
        throw error;
      }
      return data.id as string;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['plant-case-research-quota'] });
    },
  });
}
