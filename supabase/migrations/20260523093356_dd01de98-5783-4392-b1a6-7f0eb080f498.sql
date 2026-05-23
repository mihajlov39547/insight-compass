-- Phase 2 backstop: DB trigger that propagates workflow_runs.status = 'failed'
-- to the linked document/resource_link if the app-level sync misses it.

CREATE OR REPLACE FUNCTION public.sync_entity_on_workflow_failed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_error text;
  v_reason text;
BEGIN
  -- Only act on transitions INTO 'failed'
  IF NEW.status <> 'failed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'failed' THEN
    RETURN NEW;
  END IF;
  IF NEW.trigger_entity_type IS NULL OR NEW.trigger_entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pick the most recent required failed activity error as the user-facing reason
  SELECT ar.error_message
    INTO v_last_error
  FROM public.activity_runs ar
  WHERE ar.workflow_run_id = NEW.id
    AND ar.status = 'failed'
    AND ar.is_optional = false
    AND ar.error_message IS NOT NULL
  ORDER BY ar.finished_at DESC NULLS LAST, ar.updated_at DESC
  LIMIT 1;

  v_reason := COALESCE(
    NULLIF(v_last_error, ''),
    NULLIF(NEW.failure_reason, ''),
    'workflow_failed'
  );
  v_reason := left(v_reason, 2000);

  IF NEW.trigger_entity_type = 'document' THEN
    UPDATE public.documents
       SET processing_status = 'failed',
           processing_error = 'Workflow failed: ' || v_reason,
           updated_at = now()
     WHERE id = NEW.trigger_entity_id
       AND processing_status NOT IN ('completed', 'failed');
  ELSIF NEW.trigger_entity_type = 'resource_link' THEN
    UPDATE public.resource_links
       SET transcript_status = 'failed',
           transcript_error = v_reason,
           transcript_updated_at = now(),
           updated_at = now()
     WHERE id = NEW.trigger_entity_id
       AND transcript_status NOT IN ('completed', 'ready', 'failed');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the workflow_runs update because of the backstop
  RAISE WARNING 'sync_entity_on_workflow_failed error: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_entity_on_workflow_failed ON public.workflow_runs;
CREATE TRIGGER trg_sync_entity_on_workflow_failed
AFTER UPDATE OF status ON public.workflow_runs
FOR EACH ROW
WHEN (NEW.status = 'failed')
EXECUTE FUNCTION public.sync_entity_on_workflow_failed();