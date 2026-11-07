-- lovable-cron-fallback-reviewed: existing workflow jobs re-registered with unchanged cadence, only auth header changes
CREATE OR REPLACE FUNCTION public.can_see_user_email(_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    auth.uid() = _target
    OR EXISTS (
      SELECT 1 FROM public.shares s
      WHERE (s.shared_by_user_id = auth.uid() AND s.shared_with_user_id = _target)
         OR (s.shared_by_user_id = _target AND s.shared_with_user_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.shares a JOIN public.shares b
        ON a.item_id = b.item_id AND a.item_type = b.item_type
      WHERE a.shared_with_user_id = auth.uid() AND b.shared_with_user_id = _target
    )
  )
$$;
REVOKE ALL ON FUNCTION public.can_see_user_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_user_email(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_profile(_user_id uuid)
RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.user_id, p.full_name, p.username, p.avatar_url,
         CASE WHEN public.can_see_user_email(p.user_id) THEN p.email ELSE NULL END
  FROM public.profiles p WHERE p.user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.user_id, p.full_name, p.username, p.avatar_url,
         CASE WHEN public.can_see_user_email(p.user_id) THEN p.email ELSE NULL END
  FROM public.profiles p WHERE p.user_id = ANY(_user_ids);
$$;
REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.get_email_by_username(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.internal_job_tokens (
  name text PRIMARY KEY,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.internal_job_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_job_tokens TO service_role;
ALTER TABLE public.internal_job_tokens ENABLE ROW LEVEL SECURITY;

INSERT INTO public.internal_job_tokens(name, token)
VALUES ('workflow_cron', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

SELECT cron.unschedule('workflow-worker-poll');
SELECT cron.unschedule('workflow-maintenance-shadow');
SELECT cron.schedule('workflow-worker-poll', '45 seconds', $c$
  SELECT net.http_post(
    url := 'https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/workflow-worker',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-internal-job-token', (SELECT token FROM public.internal_job_tokens WHERE name = 'workflow_cron')),
    body := '{"max_activities_to_process": 10, "lease_seconds": 300, "debug": false}'::jsonb
  );
$c$);
SELECT cron.schedule('workflow-maintenance-shadow', '*/5 * * * *', $c$
  SELECT net.http_post(
    url := 'https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/workflow-maintenance',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-internal-job-token', (SELECT token FROM public.internal_job_tokens WHERE name = 'workflow_cron')),
    body := '{"max_records": 20, "stale_before_seconds": 0, "dry_run": false, "actor": "cron-maintenance"}'::jsonb
  );
$c$);