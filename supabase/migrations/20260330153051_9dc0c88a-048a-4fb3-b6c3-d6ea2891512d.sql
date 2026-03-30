
-- ============================================================
-- DURABLE WORKFLOW ENGINE — DATABASE SCHEMA
-- ============================================================

-- 1. ENUMS
-- ============================================================

CREATE TYPE public.workflow_definition_status AS ENUM ('draft', 'active', 'inactive', 'archived');
CREATE TYPE public.workflow_run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled', 'timed_out');
CREATE TYPE public.activity_run_status AS ENUM ('pending', 'queued', 'claimed', 'running', 'completed', 'failed', 'skipped', 'cancelled', 'waiting_retry');
CREATE TYPE public.workflow_event_type AS ENUM (
  'workflow_created', 'workflow_started', 'workflow_completed', 'workflow_failed',
  'workflow_cancelled', 'workflow_timed_out', 'workflow_context_updated',
  'activity_scheduled', 'activity_queued', 'activity_claimed', 'activity_started',
  'activity_completed', 'activity_failed', 'activity_retrying', 'activity_skipped',
  'activity_cancelled', 'activity_output_written', 'activity_heartbeat'
);
CREATE TYPE public.edge_join_policy AS ENUM ('all', 'any');

-- 2. WORKFLOW DEFINITIONS
-- ============================================================

CREATE TABLE public.workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status public.workflow_definition_status NOT NULL DEFAULT 'draft',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_def_status ON public.workflow_definitions (status);
CREATE INDEX idx_wf_def_key ON public.workflow_definitions (key);

-- 3. WORKFLOW DEFINITION VERSIONS
-- ============================================================

CREATE TABLE public.workflow_definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  description text NOT NULL DEFAULT '',
  default_context jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_definition_id, version)
);

CREATE INDEX idx_wf_ver_def ON public.workflow_definition_versions (workflow_definition_id);
CREATE INDEX idx_wf_ver_current ON public.workflow_definition_versions (workflow_definition_id) WHERE is_current = true;

-- 4. WORKFLOW ACTIVITIES (definition-level)
-- ============================================================

CREATE TABLE public.workflow_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.workflow_definition_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  handler_key text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_terminal boolean NOT NULL DEFAULT false,
  is_entry boolean NOT NULL DEFAULT false,
  is_optional boolean NOT NULL DEFAULT false,
  writes_output boolean NOT NULL DEFAULT true,
  retry_max_attempts integer NOT NULL DEFAULT 3,
  retry_backoff_seconds integer NOT NULL DEFAULT 10,
  retry_backoff_multiplier numeric NOT NULL DEFAULT 2.0,
  timeout_seconds integer NULL,
  concurrency_key text NULL,
  execution_priority integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, key)
);

CREATE INDEX idx_wf_act_ver ON public.workflow_activities (version_id);
CREATE INDEX idx_wf_act_handler ON public.workflow_activities (handler_key);

-- 5. WORKFLOW EDGES (DAG connections)
-- ============================================================

CREATE TABLE public.workflow_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.workflow_definition_versions(id) ON DELETE CASCADE,
  from_activity_id uuid NOT NULL REFERENCES public.workflow_activities(id) ON DELETE CASCADE,
  to_activity_id uuid NOT NULL REFERENCES public.workflow_activities(id) ON DELETE CASCADE,
  join_policy public.edge_join_policy NOT NULL DEFAULT 'all',
  condition_expr jsonb NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_activity_id, to_activity_id),
  CHECK (from_activity_id <> to_activity_id)
);

CREATE INDEX idx_wf_edge_ver ON public.workflow_edges (version_id);
CREATE INDEX idx_wf_edge_from ON public.workflow_edges (from_activity_id);
CREATE INDEX idx_wf_edge_to ON public.workflow_edges (to_activity_id);

-- 6. WORKFLOW RUNS (runtime instances)
-- ============================================================

CREATE TABLE public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES public.workflow_definitions(id),
  version_id uuid NOT NULL REFERENCES public.workflow_definition_versions(id),
  user_id uuid NULL,
  status public.workflow_run_status NOT NULL DEFAULT 'pending',
  trigger_entity_type text NULL,
  trigger_entity_id uuid NULL,
  idempotency_key text NULL,
  input_payload jsonb NOT NULL DEFAULT '{}',
  context jsonb NOT NULL DEFAULT '{}',
  output_payload jsonb NULL,
  failure_reason text NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  last_heartbeat_at timestamptz NULL,
  timeout_seconds integer NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_wf_run_idempotency ON public.workflow_runs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_wf_run_status ON public.workflow_runs (status);
CREATE INDEX idx_wf_run_user ON public.workflow_runs (user_id);
CREATE INDEX idx_wf_run_def ON public.workflow_runs (workflow_definition_id);
CREATE INDEX idx_wf_run_trigger ON public.workflow_runs (trigger_entity_type, trigger_entity_id);
CREATE INDEX idx_wf_run_created ON public.workflow_runs (created_at DESC);

-- 7. ACTIVITY RUNS (runtime activity instances)
-- ============================================================

CREATE TABLE public.activity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.workflow_activities(id),
  activity_key text NOT NULL,
  activity_name text NOT NULL,
  handler_key text NOT NULL,
  status public.activity_run_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  is_terminal boolean NOT NULL DEFAULT false,
  is_optional boolean NOT NULL DEFAULT false,
  input_payload jsonb NULL,
  output_payload jsonb NULL,
  error_message text NULL,
  error_details jsonb NULL,
  retry_backoff_seconds integer NOT NULL DEFAULT 10,
  retry_backoff_multiplier numeric NOT NULL DEFAULT 2.0,
  next_retry_at timestamptz NULL,
  scheduled_at timestamptz NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  claimed_by text NULL,
  claimed_at timestamptz NULL,
  lease_expires_at timestamptz NULL,
  queue_msg_id bigint NULL,
  execution_priority integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, activity_key)
);

CREATE INDEX idx_act_run_wf ON public.activity_runs (workflow_run_id);
CREATE INDEX idx_act_run_status ON public.activity_runs (status);
CREATE INDEX idx_act_run_claimable ON public.activity_runs (status, scheduled_at)
  WHERE status IN ('pending', 'queued', 'waiting_retry');
CREATE INDEX idx_act_run_lease ON public.activity_runs (lease_expires_at)
  WHERE claimed_by IS NOT NULL AND status = 'claimed';
CREATE INDEX idx_act_run_retry ON public.activity_runs (next_retry_at)
  WHERE status = 'waiting_retry';
CREATE INDEX idx_act_run_handler ON public.activity_runs (handler_key);

-- 8. WORKFLOW EVENTS (append-only audit log)
-- ============================================================

CREATE TABLE public.workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  activity_run_id uuid NULL REFERENCES public.activity_runs(id) ON DELETE SET NULL,
  event_type public.workflow_event_type NOT NULL,
  actor text NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_evt_run ON public.workflow_events (workflow_run_id);
CREATE INDEX idx_wf_evt_activity ON public.workflow_events (activity_run_id) WHERE activity_run_id IS NOT NULL;
CREATE INDEX idx_wf_evt_type ON public.workflow_events (event_type);
CREATE INDEX idx_wf_evt_created ON public.workflow_events (created_at DESC);

-- 9. WORKFLOW CONTEXT SNAPSHOTS (point-in-time recovery)
-- ============================================================

CREATE TABLE public.workflow_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  activity_run_id uuid NULL REFERENCES public.activity_runs(id) ON DELETE SET NULL,
  snapshot_context jsonb NOT NULL,
  reason text NOT NULL DEFAULT 'activity_completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_ctx_run ON public.workflow_context_snapshots (workflow_run_id);
CREATE INDEX idx_wf_ctx_created ON public.workflow_context_snapshots (workflow_run_id, created_at DESC);

-- 10. QUEUE DISPATCHES (pgmq integration tracking)
-- ============================================================

CREATE TABLE public.queue_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  activity_run_id uuid NOT NULL REFERENCES public.activity_runs(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  pgmq_msg_id bigint NULL,
  status text NOT NULL DEFAULT 'enqueued',
  idempotency_key text NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  completed_at timestamptz NULL,
  dead_lettered_at timestamptz NULL,
  error_message text NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_q_disp_activity ON public.queue_dispatches (activity_run_id);
CREATE INDEX idx_q_disp_wf ON public.queue_dispatches (workflow_run_id);
CREATE INDEX idx_q_disp_status ON public.queue_dispatches (status);
CREATE UNIQUE INDEX idx_q_disp_idemp ON public.queue_dispatches (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 11. TRIGGERS — updated_at
-- ============================================================

CREATE TRIGGER trg_workflow_definitions_updated
  BEFORE UPDATE ON public.workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_workflow_runs_updated
  BEFORE UPDATE ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_activity_runs_updated
  BEFORE UPDATE ON public.activity_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 12. RLS
-- ============================================================

ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_dispatches ENABLE ROW LEVEL SECURITY;

-- Definition tables: readable by all authenticated (shared templates)
CREATE POLICY "Authenticated users can read workflow definitions"
  ON public.workflow_definitions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read workflow versions"
  ON public.workflow_definition_versions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read workflow activities"
  ON public.workflow_activities FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read workflow edges"
  ON public.workflow_edges FOR SELECT TO authenticated USING (true);

-- Runtime tables: user-scoped
CREATE POLICY "Users can view their own workflow runs"
  ON public.workflow_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own workflow runs"
  ON public.workflow_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workflow runs"
  ON public.workflow_runs FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- activity_runs via workflow_runs ownership
CREATE POLICY "Users can view their own activity runs"
  ON public.activity_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

CREATE POLICY "Users can insert their own activity runs"
  ON public.activity_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

CREATE POLICY "Users can update their own activity runs"
  ON public.activity_runs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

-- Events: read-only via workflow ownership
CREATE POLICY "Users can view their own workflow events"
  ON public.workflow_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

CREATE POLICY "Users can insert their own workflow events"
  ON public.workflow_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

-- Context snapshots
CREATE POLICY "Users can view their own context snapshots"
  ON public.workflow_context_snapshots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

CREATE POLICY "Users can insert their own context snapshots"
  ON public.workflow_context_snapshots FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

-- Queue dispatches
CREATE POLICY "Users can view their own queue dispatches"
  ON public.queue_dispatches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

CREATE POLICY "Users can insert their own queue dispatches"
  ON public.queue_dispatches FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflow_runs wr WHERE wr.id = workflow_run_id AND wr.user_id = auth.uid()));

-- 13. HELPER: Check if activity is runnable (all predecessors completed)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_activity_runnable(
  p_workflow_run_id uuid,
  p_activity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

-- 14. HELPER: Claim next runnable activity (FOR UPDATE SKIP LOCKED pattern)
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_next_activity(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 300,
  p_handler_keys text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity_run_id uuid;
BEGIN
  SELECT ar.id INTO v_activity_run_id
  FROM public.activity_runs ar
  WHERE ar.status IN ('queued', 'waiting_retry')
    AND (ar.status = 'queued' OR (ar.status = 'waiting_retry' AND ar.next_retry_at <= now()))
    AND (ar.lease_expires_at IS NULL OR ar.lease_expires_at < now())
    AND (p_handler_keys IS NULL OR ar.handler_key = ANY(p_handler_keys))
  ORDER BY ar.execution_priority DESC, ar.scheduled_at ASC NULLS LAST
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_activity_run_id IS NOT NULL THEN
    UPDATE public.activity_runs
    SET status = 'claimed',
        claimed_by = p_worker_id,
        claimed_at = now(),
        lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
        attempt_count = attempt_count + 1
    WHERE id = v_activity_run_id;
  END IF;

  RETURN v_activity_run_id;
END;
$$;
