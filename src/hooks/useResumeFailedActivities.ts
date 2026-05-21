import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { getFunctionUrl } from '@/lib/edge/invokeWithAuth';

/**
 * Resumes a failed workflow run by re-arming only its failed activities
 * (no full wipe). Successful upstream activities and their context patches
 * are preserved on the SAME workflow_run_id.
 */
export function useResumeFailedActivities() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (workflowRunId: string) => {
      const { data, error } = await supabase.rpc('resume_failed_activities', {
        p_workflow_run_id: workflowRunId,
      });
      if (error) throw error;

      // Best-effort worker kicks so the resumed activities pick up quickly.
      const kick = () => {
        fetch(getFunctionUrl('/functions/v1/workflow-worker'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            max_activities_to_process: 10,
            lease_seconds: 180,
          }),
        }).catch(() => {});
      };
      kick();
      setTimeout(kick, 3000);
      setTimeout(kick, 8000);

      return data as { workflow_run_id: string; reset_count: number; resume_count: number };
    },
    onSuccess: (data) => {
      toast({
        title: 'Resuming workflow',
        description: `Re-queued ${data.reset_count} failed step${data.reset_count === 1 ? '' : 's'} (resume #${data.resume_count}).`,
      });
      qc.invalidateQueries({ queryKey: ['workflow-dag'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Could not resume workflow',
        description: message,
        variant: 'destructive',
      });
    },
  });
}
