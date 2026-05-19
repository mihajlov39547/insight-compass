import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type WorkflowNodeStatus =
  | 'pending'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dead_letter'
  | 'skipped'
  | 'cancelled'
  | 'waiting_retry';

export interface WorkflowDagNode {
  key: string;
  name: string;
  is_entry: boolean;
  is_terminal: boolean;
  is_optional: boolean;
  handler_key: string;
  status: WorkflowNodeStatus;
  attempt_count: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface WorkflowDagEdge {
  from: string;
  to: string;
}

export interface WorkflowDag {
  workflow_run_id: string;
  workflow_key: string;
  workflow_status: string;
  nodes: WorkflowDagNode[];
  edges: WorkflowDagEdge[];
}

/**
 * Fetches the workflow DAG (nodes + edges + per-activity status) for the latest
 * workflow_run of a given resource. Returns null if no workflow run exists.
 */
export function useWorkflowDagForResource(resourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['workflow-dag', resourceId],
    enabled: enabled && !!resourceId,
    queryFn: async (): Promise<WorkflowDag | null> => {
      if (!resourceId) return null;
      const { data: runs } = await supabase
        .from('workflow_runs')
        .select('id')
        .eq('trigger_entity_id', resourceId)
        .order('created_at', { ascending: false })
        .limit(1);
      const runId = runs?.[0]?.id;
      if (!runId) return null;
      const { data, error } = await supabase.rpc('get_workflow_dag', { p_workflow_run_id: runId });
      if (error || !data) return null;
      return data as unknown as WorkflowDag;
    },
    staleTime: 5_000,
    refetchInterval: enabled && !!resourceId ? 5_000 : false,
  });
}
