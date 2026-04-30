-- Cleanup job for workflow log tables
-- Keeps only the last 2 days of data; runs every 10 minutes; deletes up to 100 rows per table per run.

CREATE OR REPLACE FUNCTION public.cleanup_workflow_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - interval '2 days';
  batch_size int := 100;
  deleted_events int := 0;
  deleted_attempts int := 0;
  deleted_activity_runs int := 0;
  deleted_queue int := 0;
  deleted_workflow_runs int := 0;
  deleted_snapshots int := 0;
BEGIN
  -- workflow_events (no FK dependents)
  WITH del AS (
    DELETE FROM public.workflow_events
    WHERE id IN (
      SELECT id FROM public.workflow_events
      WHERE created_at < cutoff
      ORDER BY created_at ASC
      LIMIT batch_size
    )
    RETURNING 1
  ) SELECT count(*) INTO deleted_events FROM del;

  -- activity_attempts
  WITH del AS (
    DELETE FROM public.activity_attempts
    WHERE id IN (
      SELECT id FROM public.activity_attempts
      WHERE created_at < cutoff
      ORDER BY created_at ASC
      LIMIT batch_size
    )
    RETURNING 1
  ) SELECT count(*) INTO deleted_attempts FROM del;

  -- queue_dispatches (terminal only)
  WITH del AS (
    DELETE FROM public.queue_dispatches
    WHERE id IN (
      SELECT id FROM public.queue_dispatches
      WHERE enqueued_at < cutoff
        AND status IN ('completed', 'dead_lettered')
      ORDER BY enqueued_at ASC
      LIMIT batch_size
    )
    RETURNING 1
  ) SELECT count(*) INTO deleted_queue FROM del;

  -- workflow_context_snapshots (if exists)
  BEGIN
    WITH del AS (
      DELETE FROM public.workflow_context_snapshots
      WHERE id IN (
        SELECT id FROM public.workflow_context_snapshots
        WHERE created_at < cutoff
        ORDER BY created_at ASC
        LIMIT batch_size
      )
      RETURNING 1
    ) SELECT count(*) INTO deleted_snapshots FROM del;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    deleted_snapshots := 0;
  END;

  -- activity_runs (terminal only, after dependents are gone)
  WITH del AS (
    DELETE FROM public.activity_runs
    WHERE id IN (
      SELECT ar.id FROM public.activity_runs ar
      WHERE ar.updated_at < cutoff
        AND ar.status IN ('succeeded', 'failed', 'cancelled', 'skipped')
        AND NOT EXISTS (SELECT 1 FROM public.activity_attempts aa WHERE aa.activity_run_id = ar.id)
        AND NOT EXISTS (SELECT 1 FROM public.workflow_events we WHERE we.activity_run_id = ar.id)
        AND NOT EXISTS (SELECT 1 FROM public.queue_dispatches qd WHERE qd.activity_run_id = ar.id)
      ORDER BY ar.updated_at ASC
      LIMIT batch_size
    )
    RETURNING 1
  ) SELECT count(*) INTO deleted_activity_runs FROM del;

  -- workflow_runs (terminal only, after dependents are gone)
  WITH del AS (
    DELETE FROM public.workflow_runs
    WHERE id IN (
      SELECT wr.id FROM public.workflow_runs wr
      WHERE wr.updated_at < cutoff
        AND wr.status IN ('completed', 'failed', 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM public.activity_runs ar WHERE ar.workflow_run_id = wr.id)
        AND NOT EXISTS (SELECT 1 FROM public.workflow_events we WHERE we.workflow_run_id = wr.id)
        AND NOT EXISTS (SELECT 1 FROM public.queue_dispatches qd WHERE qd.workflow_run_id = wr.id)
      ORDER BY wr.updated_at ASC
      LIMIT batch_size
    )
    RETURNING 1
  ) SELECT count(*) INTO deleted_workflow_runs FROM del;

  RETURN jsonb_build_object(
    'cutoff', cutoff,
    'deleted_workflow_events', deleted_events,
    'deleted_activity_attempts', deleted_attempts,
    'deleted_activity_runs', deleted_activity_runs,
    'deleted_queue_dispatches', deleted_queue,
    'deleted_workflow_runs', deleted_workflow_runs,
    'deleted_workflow_context_snapshots', deleted_snapshots
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_workflow_logs() FROM PUBLIC, anon, authenticated;

-- Schedule via pg_cron every 10 minutes
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-workflow-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-workflow-logs',
  '*/10 * * * *',
  $$ SELECT public.cleanup_workflow_logs(); $$
);