-- Phase 1.3: Feature flag plumbing for opting into workflow-engine YouTube path
CREATE TABLE IF NOT EXISTS public.app_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;

-- Lock direct client access; flags are read via RPC, written via migrations / service role.
DROP POLICY IF EXISTS "Service role manages feature flags" ON public.app_feature_flags;
CREATE POLICY "Service role manages feature flags"
  ON public.app_feature_flags FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Deny all client access to feature flags" ON public.app_feature_flags;
CREATE POLICY "Deny all client access to feature flags"
  ON public.app_feature_flags FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

INSERT INTO public.app_feature_flags (key, enabled, description)
VALUES ('youtube_use_workflow', false, 'Route new YouTube links through youtube_processing_v1 workflow instead of legacy youtube-transcript-worker')
ON CONFLICT (key) DO NOTHING;

-- Public RPC for clients to read flag state without touching the table directly.
CREATE OR REPLACE FUNCTION public.is_feature_enabled(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT enabled FROM public.app_feature_flags WHERE key = p_key), false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_feature_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_feature_enabled(text) TO authenticated, service_role;