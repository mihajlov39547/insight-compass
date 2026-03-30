
-- ============================================================
-- DURABLE WORKFLOW ENGINE: STRUCTURAL REVISION MIGRATION
-- Addresses 11 gaps in the original schema.
-- ============================================================

-- -------------------------------------------------------
-- 1. Enforce version consistency in workflow_edges
--    Add composite unique on workflow_activities so edges
--    can reference (version_id, activity_id) pairs.
-- -------------------------------------------------------

-- Composite unique on activities: (version_id, id)
ALTER TABLE public.workflow_activities
  ADD CONSTRAINT uq_workflow_activities_version_id
  UNIQUE (version_id, id);

-- Drop old simple FKs on edges
ALTER TABLE public.workflow_edges
  DROP CONSTRAINT IF EXISTS workflow_edges_from_activity_id_fkey,
  DROP CONSTRAINT IF EXISTS workflow_edges_to_activity_id_fkey;

-- Add composite FKs so from/to activities must belong to edge's version
ALTER TABLE public.workflow_edges
  ADD CONSTRAINT workflow_edges_from_version_activity_fkey
  FOREIGN KEY (version_id, from_activity_id)
  REFERENCES public.workflow_activities (version_id, id),

  ADD CONSTRAINT workflow_edges_to_version_activity_fkey
  FOREIGN KEY (version_id, to_activity_id)
  REFERENCES public.workflow_activities (version_id, id);

-- -------------------------------------------------------
-- 2. Enforce definition/version consistency in workflow_runs
-- -------------------------------------------------------

-- Composite unique on versions: (workflow_definition_id, id)
ALTER TABLE public.workflow_definition_versions
  ADD CONSTRAINT uq_wdv_definition_id
  UNIQUE (workflow_definition_id, id);

-- Drop old simple FK
ALTER TABLE public.workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_version_id_fkey;

-- Add composite FK
ALTER TABLE public.workflow_runs
  ADD CONSTRAINT workflow_runs_def_version_fkey
  FOREIGN KEY (workflow_definition_id, version_id)
  REFERENCES public.workflow_definition_versions (workflow_definition_id, id);

-- -------------------------------------------------------
-- 3. Enforce run version / activity version in activity_runs
-- -------------------------------------------------------

-- Add version_id column to activity_runs
ALTER TABLE public.activity_runs
  ADD COLUMN IF NOT EXISTS version_id uuid;

-- Backfill version_id from parent workflow_run
UPDATE public.activity_runs ar
SET version_id = wr.version_id
FROM public.workflow_runs wr
WHERE ar.workflow_run_id = wr.id
  AND ar.version_id IS NULL;

-- Make it NOT NULL after backfill
ALTER TABLE public.activity_runs
  ALTER COLUMN version_id SET NOT NULL;

-- Drop old simple FK to activities
ALTER TABLE public.activity_runs
  DROP CONSTRAINT IF EXISTS activity_runs_activity_id_fkey;

-- Add composite FK: activity must belong to same version
ALTER TABLE public.activity_runs
  ADD CONSTRAINT activity_runs_version_activity_fkey
  FOREIGN KEY (version_id, activity_id)
  REFERENCES public.workflow_activities (version_id, id);

-- -------------------------------------------------------
-- 4. Fix join policy: MVP = only 'all' supported
--    Remove 'any' from enum; set default explicitly.
-- -------------------------------------------------------

-- We cannot easily remove an enum value in PG, so instead
-- add a CHECK constraint and update the helper function.
-- Any existing 'any' values get corrected.
UPDATE public.workflow_edges SET join_policy = 'all' WHERE join_policy = 'any';

ALTER TABLE public.workflow_edges
  ADD CONSTRAINT chk_edges_join_policy_mvp
  CHECK (join_policy = 'all');

COMMENT ON CONSTRAINT chk_edges_join_policy_mvp ON public.workflow_edges IS
  'MVP: only all-predecessors-complete semantics supported. Remove this constraint when implementing any-predecessor logic.';

-- -------------------------------------------------------
-- 5. Orchestration helper: schedule downstream activities
--    after an activity completes.
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.schedule_downstream_activities(
  p_workflow_run_id uuid,
  p_completed_activity_id uuid,
  p_actor text DEFAULT 'orchestrator'
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_downstream_activity_id uuid;
  v_activity_run_id uuid;
  v_is_runnable boolean;
BEGIN
  -- Find all downstream activities connected via edges
  FOR v_downstream_activity_id IN
    SELECT DISTINCT e.to_activity_id
    FROM public.workflow_edges e
    JOIN public.activity_runs ar_from
      ON ar_from.activity_id = e.from_activity_id
      AND ar_from.workflow_run_id = p_workflow_run_id
    WHERE e.from_activity_id = p_completed_activity_id
  LOOP
    -- Check if all predecessors are satisfied
    SELECT public.is_activity_runnable(p_workflow_run_id, v_downstream_activity_id)
    INTO v_is_runnable;

    IF v_is_runnable THEN
      -- Find the pending activity_run for this downstream activity
      SELECT ar.id INTO v_activity_run_id
      FROM public.activity_runs ar
      WHERE ar.workflow_run_id = p_workflow_run_id
        AND ar.activity_id = v_downstream_activity_id
        AND ar.status = 'pending'
      LIMIT 1;

      IF v_activity_run_id IS NOT NULL THEN
        -- Promote to queued
        UPDATE public.activity_runs
        SET status = 'queued',
            scheduled_at = now(),
            updated_at = now()
        WHERE id = v_activity_run_id;

        -- Log event
        INSERT INTO public.workflow_events (workflow_run_id, activity_run_id, event_type, actor, details)
        VALUES (
          p_workflow_run_id,
          v_activity_run_id,
          'activity_queued',
          p_actor,
          jsonb_build_object(
            'triggered_by_activity_id', p_completed_activity_id,
            'downstream_activity_id', v_downstream_activity_id
          )
        );

        RETURN NEXT v_activity_run_id;
      END IF;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

-- -------------------------------------------------------
-- 6. Activity attempt history (append-only)
-- -------------------------------------------------------

CREATE TABLE public.activity_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_run_id uuid NOT NULL,
  workflow_run_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  lease_expires_at timestamptz,
  input_payload jsonb,
  output_payload jsonb,
  error_message text,
  error_details jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_attempts_activity_run
    FOREIGN KEY (activity_run_id) REFERENCES public.activity_runs (id) ON DELETE CASCADE,
  CONSTRAINT fk_attempts_workflow_run
    FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs (id) ON DELETE CASCADE,
  CONSTRAINT uq_attempt_per_run
    UNIQUE (activity_run_id, attempt_number),
  CONSTRAINT chk_attempt_number_positive
    CHECK (attempt_number >= 1)
);

CREATE INDEX idx_activity_attempts_run ON public.activity_attempts (activity_run_id);
CREATE INDEX idx_activity_attempts_workflow ON public.activity_attempts (workflow_run_id);

ALTER TABLE public.activity_attempts ENABLE ROW LEVEL SECURITY;

-- Attempts are read-only for authenticated users (via their workflow run)
CREATE POLICY "Users can view their own activity attempts"
  ON public.activity_attempts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workflow_runs wr
    WHERE wr.id = activity_attempts.workflow_run_id AND wr.user_id = auth.uid()
  ));

COMMENT ON TABLE public.activity_attempts IS
  'Append-only per-attempt execution history. One row per claim/execution attempt of an activity_run.';

-- -------------------------------------------------------
-- 7. Harden RLS: remove user INSERT/UPDATE on orchestration tables
--    Only service_role / Edge Functions should mutate these.
-- -------------------------------------------------------

-- activity_runs: drop user insert/update policies
DROP POLICY IF EXISTS "Users can insert their own activity runs" ON public.activity_runs;
DROP POLICY IF EXISTS "Users can update their own activity runs" ON public.activity_runs;

-- workflow_events: drop user insert policy
DROP POLICY IF EXISTS "Users can insert their own workflow events" ON public.workflow_events;

-- workflow_context_snapshots: drop user insert policy
DROP POLICY IF EXISTS "Users can insert their own context snapshots" ON public.workflow_context_snapshots;

-- queue_dispatches: drop user insert policy
DROP POLICY IF EXISTS "Users can insert their own queue dispatches" ON public.queue_dispatches;

-- Keep SELECT policies so users can observe their own workflow state.
-- Orchestration mutations happen via service_role in Edge Functions.

COMMENT ON POLICY "Users can view their own activity runs" ON public.activity_runs IS
  'Read-only for authenticated users. Mutations via service_role only.';
COMMENT ON POLICY "Users can view their own workflow events" ON public.workflow_events IS
  'Read-only for authenticated users. Mutations via service_role only.';
COMMENT ON POLICY "Users can view their own context snapshots" ON public.workflow_context_snapshots IS
  'Read-only for authenticated users. Mutations via service_role only.';
COMMENT ON POLICY "Users can view their own queue dispatches" ON public.queue_dispatches IS
  'Read-only for authenticated users. Mutations via service_role only.';

-- -------------------------------------------------------
-- 8. Scope idempotency to (user_id, definition, key)
-- -------------------------------------------------------

-- Drop the old global unique index
DROP INDEX IF EXISTS public.idx_workflow_runs_idempotency;

-- Add scoped unique index
CREATE UNIQUE INDEX idx_workflow_runs_idempotency_scoped
  ON public.workflow_runs (user_id, workflow_definition_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- -------------------------------------------------------
-- 9. CHECK constraints for retry/timeout fields
-- -------------------------------------------------------

-- workflow_activities
ALTER TABLE public.workflow_activities
  ADD CONSTRAINT chk_wa_retry_max CHECK (retry_max_attempts >= 1),
  ADD CONSTRAINT chk_wa_backoff_seconds CHECK (retry_backoff_seconds >= 0),
  ADD CONSTRAINT chk_wa_backoff_multiplier CHECK (retry_backoff_multiplier >= 1),
  ADD CONSTRAINT chk_wa_timeout CHECK (timeout_seconds > 0 OR timeout_seconds IS NULL);

-- activity_runs
ALTER TABLE public.activity_runs
  ADD CONSTRAINT chk_ar_attempt_count CHECK (attempt_count >= 0),
  ADD CONSTRAINT chk_ar_max_attempts CHECK (max_attempts >= 1),
  ADD CONSTRAINT chk_ar_backoff_seconds CHECK (retry_backoff_seconds >= 0),
  ADD CONSTRAINT chk_ar_backoff_multiplier CHECK (retry_backoff_multiplier >= 1);

-- workflow_runs
ALTER TABLE public.workflow_runs
  ADD CONSTRAINT chk_wr_timeout CHECK (timeout_seconds > 0 OR timeout_seconds IS NULL);

-- -------------------------------------------------------
-- 10. Context update model: document the hybrid approach
-- -------------------------------------------------------

COMMENT ON COLUMN public.activity_runs.output_payload IS
  'Immutable result of this activity. Set once on completion. Downstream activities and fan-in joins read from here.';

COMMENT ON COLUMN public.workflow_runs.context IS
  'Live workflow context. Updated ONLY by the orchestrator (service_role) during join/merge or final activities. Not mutated by individual activities directly.';

COMMENT ON TABLE public.workflow_context_snapshots IS
  'Point-in-time snapshots of workflow_runs.context for audit, recovery, and replay inspection. Append-only.';

-- -------------------------------------------------------
-- 11. Update is_activity_runnable to be explicit about
--     all-predecessors semantics
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_activity_runnable(p_workflow_run_id uuid, p_activity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Returns true when ALL predecessor activities (connected via
  -- workflow_edges where to_activity_id = p_activity_id) have
  -- status = 'completed' or 'skipped'. This implements the 'all'
  -- join policy (the only policy supported in MVP).
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.workflow_edges e
    JOIN public.activity_runs ar_pred
      ON ar_pred.workflow_run_id = p_workflow_run_id
      AND ar_pred.activity_id = e.from_activity_id
    WHERE e.to_activity_id = p_activity_id
      AND ar_pred.status NOT IN ('completed', 'skipped')
  );
$$;
