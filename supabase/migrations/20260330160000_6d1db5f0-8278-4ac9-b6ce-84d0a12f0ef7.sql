-- ============================================================
-- Phase 5 Validation: Fan-out and Fan-in Orchestration Tests
-- Seed workflow definitions for deterministic validation
-- ============================================================

-- These are stable test definitions that do NOT change.
-- Seeds are idempotent; running multiple times is safe.

-- ============================================================
-- Scenario A: A -> B -> (C, D, E) -> F
-- F depends on C and D; E is parallel but not required for F
-- ============================================================

INSERT INTO public.workflow_definitions (
  key,
  name,
  status,
  created_at,
  updated_at
) SELECT
  'validation.fanout.basic',
  'Validation: Fan-out Basic',
  'active',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflow_definitions WHERE key = 'validation.fanout.basic'
);

-- Get the definition ID for the next inserts
WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.fanout.basic'
)
INSERT INTO public.workflow_definition_versions (
  workflow_definition_id,
  version,
  is_current,
  default_context,
  created_at
) SELECT
  def.id,
  1,
  true,
  '{}',
  now()
FROM def
ON CONFLICT (workflow_definition_id, version) DO NOTHING;

-- Get the version ID for activities
WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.fanout.basic'
),
ver AS (
  SELECT id FROM public.workflow_definition_versions 
  WHERE workflow_definition_id = (SELECT id FROM def) AND version = 1
)
INSERT INTO public.workflow_activities (
  version_id,
  key,
  name,
  handler_key,
  is_entry,
  is_terminal,
  is_optional,
  retry_max_attempts,
  retry_backoff_seconds,
  retry_backoff_multiplier,
  execution_priority,
  created_at
) SELECT
  v.id,
  a.key,
  a.name,
  a.handler_key,
  a.is_entry,
  a.is_terminal,
  a.is_optional,
  3,
  1,
  1.5,
  0,
  now()
FROM (
  VALUES
    ('A', 'Activity A', 'debug.noop', true, false, false),
    ('B', 'Activity B', 'debug.noop', false, false, false),
    ('C', 'Activity C', 'debug.noop', false, false, false),
    ('D', 'Activity D', 'debug.noop', false, false, false),
    ('E', 'Activity E', 'debug.noop', false, true, false),
    ('F', 'Activity F', 'debug.noop', false, true, false)
) a(key, name, handler_key, is_entry, is_terminal, is_optional),
ver v
ON CONFLICT (version_id, key) DO NOTHING;

-- Add edges: A -> B -> (C, D, E); C,D -> F (E not required for F)
WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.fanout.basic'
),
ver AS (
  SELECT id FROM public.workflow_definition_versions 
  WHERE workflow_definition_id = (SELECT id FROM def) AND version = 1
),
activities AS (
  SELECT id, key FROM public.workflow_activities WHERE version_id = (SELECT id FROM ver)
)
INSERT INTO public.workflow_edges (
  version_id,
  from_activity_id,
  to_activity_id,
  join_policy,
  created_at
) SELECT
  v.id,
  from_act.id,
  to_act.id,
  'all',
  now()
FROM (
  VALUES
    ('A', 'B'),
    ('B', 'C'),
    ('B', 'D'),
    ('B', 'E'),
    ('C', 'F'),
    ('D', 'F')
) edges(from_key, to_key),
ver v,
activities from_act,
activities to_act
WHERE from_act.key = edges.from_key
  AND to_act.key = edges.to_key
ON CONFLICT (from_activity_id, to_activity_id) DO NOTHING;

-- ============================================================
-- Scenario B: A -> (B, C) -> D
-- Simple fan-out to fan-in
-- ============================================================

INSERT INTO public.workflow_definitions (
  key,
  name,
  status,
  created_at,
  updated_at
) SELECT
  'validation.fanin.basic',
  'Validation: Fan-in Basic',
  'active',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflow_definitions WHERE key = 'validation.fanin.basic'
);

WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.fanin.basic'
)
INSERT INTO public.workflow_definition_versions (
  workflow_definition_id,
  version,
  is_current,
  default_context,
  created_at
) SELECT
  def.id,
  1,
  true,
  '{}',
  now()
FROM def
ON CONFLICT (workflow_definition_id, version) DO NOTHING;

WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.fanin.basic'
),
ver AS (
  SELECT id FROM public.workflow_definition_versions 
  WHERE workflow_definition_id = (SELECT id FROM def) AND version = 1
)
INSERT INTO public.workflow_activities (
  version_id,
  key,
  name,
  handler_key,
  is_entry,
  is_terminal,
  is_optional,
  retry_max_attempts,
  retry_backoff_seconds,
  retry_backoff_multiplier,
  execution_priority,
  created_at
) SELECT
  v.id,
  a.key,
  a.name,
  a.handler_key,
  a.is_entry,
  a.is_terminal,
  a.is_optional,
  3,
  1,
  1.5,
  0,
  now()
FROM (
  VALUES
    ('A', 'Activity A', 'debug.noop', true, false, false),
    ('B', 'Activity B', 'debug.noop', false, false, false),
    ('C', 'Activity C', 'debug.noop', false, false, false),
    ('D', 'Activity D', 'debug.noop', false, true, false)
) a(key, name, handler_key, is_entry, is_terminal, is_optional),
ver v
ON CONFLICT (version_id, key) DO NOTHING;

WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.fanin.basic'
),
ver AS (
  SELECT id FROM public.workflow_definition_versions 
  WHERE workflow_definition_id = (SELECT id FROM def) AND version = 1
),
activities AS (
  SELECT id, key FROM public.workflow_activities WHERE version_id = (SELECT id FROM ver)
)
INSERT INTO public.workflow_edges (
  version_id,
  from_activity_id,
  to_activity_id,
  join_policy,
  created_at
) SELECT
  v.id,
  from_act.id,
  to_act.id,
  'all',
  now()
FROM (
  VALUES
    ('A', 'B'),
    ('A', 'C'),
    ('B', 'D'),
    ('C', 'D')
) edges(from_key, to_key),
ver v,
activities from_act,
activities to_act
WHERE from_act.key = edges.from_key
  AND to_act.key = edges.to_key
ON CONFLICT (from_activity_id, to_activity_id) DO NOTHING;

-- ============================================================
-- Scenario C: Multiple entry activities
-- A (entry) -> D
-- B (entry) -> E
-- C (entry) -> F
-- ============================================================

INSERT INTO public.workflow_definitions (
  key,
  name,
  status,
  created_at,
  updated_at
) SELECT
  'validation.multi_entry.basic',
  'Validation: Multi Entry Basic',
  'active',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflow_definitions WHERE key = 'validation.multi_entry.basic'
);

WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.multi_entry.basic'
)
INSERT INTO public.workflow_definition_versions (
  workflow_definition_id,
  version,
  is_current,
  default_context,
  created_at
) SELECT
  def.id,
  1,
  true,
  '{}',
  now()
FROM def
ON CONFLICT (workflow_definition_id, version) DO NOTHING;

WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.multi_entry.basic'
),
ver AS (
  SELECT id FROM public.workflow_definition_versions 
  WHERE workflow_definition_id = (SELECT id FROM def) AND version = 1
)
INSERT INTO public.workflow_activities (
  version_id,
  key,
  name,
  handler_key,
  is_entry,
  is_terminal,
  is_optional,
  retry_max_attempts,
  retry_backoff_seconds,
  retry_backoff_multiplier,
  execution_priority,
  created_at
) SELECT
  v.id,
  a.key,
  a.name,
  a.handler_key,
  a.is_entry,
  a.is_terminal,
  a.is_optional,
  3,
  1,
  1.5,
  0,
  now()
FROM (
  VALUES
    ('A', 'Activity A', 'debug.noop', true, false, false),
    ('B', 'Activity B', 'debug.noop', true, false, false),
    ('C', 'Activity C', 'debug.noop', true, false, false),
    ('D', 'Activity D', 'debug.noop', false, true, false),
    ('E', 'Activity E', 'debug.noop', false, true, false),
    ('F', 'Activity F', 'debug.noop', false, true, false)
) a(key, name, handler_key, is_entry, is_terminal, is_optional),
ver v
ON CONFLICT (version_id, key) DO NOTHING;

WITH def AS (
  SELECT id FROM public.workflow_definitions WHERE key = 'validation.multi_entry.basic'
),
ver AS (
  SELECT id FROM public.workflow_definition_versions 
  WHERE workflow_definition_id = (SELECT id FROM def) AND version = 1
),
activities AS (
  SELECT id, key FROM public.workflow_activities WHERE version_id = (SELECT id FROM ver)
)
INSERT INTO public.workflow_edges (
  version_id,
  from_activity_id,
  to_activity_id,
  join_policy,
  created_at
) SELECT
  v.id,
  from_act.id,
  to_act.id,
  'all',
  now()
FROM (
  VALUES
    ('A', 'D'),
    ('B', 'E'),
    ('C', 'F')
) edges(from_key, to_key),
ver v,
activities from_act,
activities to_act
WHERE from_act.key = edges.from_key
  AND to_act.key = edges.to_key
ON CONFLICT (from_activity_id, to_activity_id) DO NOTHING;
