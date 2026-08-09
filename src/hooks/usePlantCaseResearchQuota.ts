import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { fetchEdgeFunction } from '@/lib/edge/invokeWithAuth';

/** One Plant Case Research run per user per calendar day, across all cases. */
export const PLANT_RESEARCH_DAILY_LIMIT = 1;

/**
 * Local calendar day (YYYY-MM-DD).
 *
 * INTENTIONAL: the quota means "one run per user per *local* day", so the day
 * boundary follows the user's own clock rather than UTC. The server validates
 * the value it receives to +/- 1 day of its UTC date, so a skewed or spoofed
 * clock cannot mint extra runs.
 */
export function localRunDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type PlantResearchRunStatus = 'started' | 'completed' | 'failed';

export interface PlantResearchQuota {
  runDate: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  /** True when today's only run failed — a retry is allowed the same day. */
  retryAvailable: boolean;
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
      // Only non-failed runs consume the quota (mirrors the DB unique index).
      const { data, error } = await supabase
        .from('plant_case_research_runs')
        .select('id, status')
        .eq('user_id', user!.id)
        .eq('run_date', runDate);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ status: PlantResearchRunStatus }>;
      const used = rows.filter((r) => r.status !== 'failed').length;
      const hadFailure = rows.some((r) => r.status === 'failed');
      return {
        runDate,
        used,
        limit: PLANT_RESEARCH_DAILY_LIMIT,
        remaining: Math.max(0, PLANT_RESEARCH_DAILY_LIMIT - used),
        exhausted: used >= PLANT_RESEARCH_DAILY_LIMIT,
        retryAvailable: used < PLANT_RESEARCH_DAILY_LIMIT && hadFailure,
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
        retryAvailable: false,
      } satisfies PlantResearchQuota),
  };
}

async function callResearchGate<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetchEdgeFunction('/functions/v1/plant-case-research', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : `request_failed_${res.status}`);
  }
  return json as T;
}

/**
 * Which Plant Advisor research flow a run belongs to. Both share the same
 * daily quota; the type decides which pinned artifact is written.
 */
export type PlantResearchType = 'plant_research' | 'income_research';

/**
 * Reserve today's research slot server-side. The edge function owns the quota
 * (clients cannot write `plant_case_research_runs`), so this is the only gate.
 */
export function useReservePlantResearchRun() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      caseId,
      researchType = 'plant_research',
    }: {
      caseId: string;
      researchType?: PlantResearchType;
    }) => {
      const data = await callResearchGate<{ runId: string; runDate: string }>({
        action: 'reserve',
        caseId,
        researchType,
        runDate: localRunDate(),
      });
      return data.runId;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['plant-case-research-quota'] });
    },
  });
}

/** Persist (or replace) the pinned research answer and mark the run completed. */
export function useCompletePlantResearchRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      runId: string;
      caseId: string;
      content: string;
      metadata: Record<string, unknown>;
      researchType?: PlantResearchType;
    }) => callResearchGate<{ message: unknown }>({ action: 'complete', ...args }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['plant-case-research-quota'] });
    },
  });
}


/** Mark a run failed so the user keeps today's research attempt. */
export function useFailPlantResearchRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { runId: string; reason?: string }) =>
      callResearchGate<{ ok: boolean }>({ action: 'fail', ...args }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['plant-case-research-quota'] });
    },
  });
}
