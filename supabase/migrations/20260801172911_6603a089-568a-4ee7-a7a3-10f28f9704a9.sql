REVOKE ALL ON FUNCTION public.downgrade_expired_subscriptions() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_dispatch() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_wake() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_plant_ai_scan_usage(uuid, text, text, integer) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.get_user_resources() FROM anon;
REVOKE ALL ON FUNCTION public.get_workflow_dag(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.increment_plant_identification_usage(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.is_feature_enabled(text) FROM anon;
REVOKE ALL ON FUNCTION public.reset_resource_for_retry(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resume_failed_activities(uuid) FROM anon;
