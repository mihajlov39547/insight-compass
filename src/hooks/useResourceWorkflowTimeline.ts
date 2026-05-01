import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WorkflowActivityRun {
  activity_key: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  attempt_count: number;
  is_optional: boolean;
}

export interface ResourceWorkflowTimeline {
  workflowRunId: string;
  workflowStatus: string;
  activities: WorkflowActivityRun[];
}

/**
 * Fetches the latest workflow activity_runs timeline for a YouTube resource.
 * Falls back to null when no workflow run exists (legacy-only processing).
 */
export function useResourceWorkflowTimeline(resourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['resource-workflow-timeline', resourceId],
    enabled: enabled && !!resourceId,
    queryFn: async (): Promise<ResourceWorkflowTimeline | null> => {
      if (!resourceId) return null;

      // Get the latest workflow run for this resource
      const { data: runs, error: runErr } = await supabase
        .from('workflow_runs')
        .select('id, status')
        .eq('trigger_entity_id', resourceId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (runErr || !runs || runs.length === 0) return null;

      const run = runs[0];

      // Get all activity runs for this workflow run
      const { data: activities, error: actErr } = await supabase
        .from('activity_runs')
        .select('activity_key, status, started_at, finished_at, error_message, attempt_count, is_optional')
        .eq('workflow_run_id', run.id)
        .order('created_at', { ascending: true });

      if (actErr || !activities) return null;

      return {
        workflowRunId: run.id,
        workflowStatus: run.status,
        activities: activities as WorkflowActivityRun[],
      };
    },
    staleTime: 5_000,
    refetchInterval: enabled && !!resourceId ? 5_000 : false,
  });
}
