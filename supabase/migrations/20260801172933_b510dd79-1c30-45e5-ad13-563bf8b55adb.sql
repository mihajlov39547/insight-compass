REVOKE ALL ON FUNCTION public.reset_resource_for_retry(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resume_failed_activities(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workflow_dag(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.downgrade_expired_subscriptions() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reset_resource_for_retry(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resume_failed_activities(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workflow_dag(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.downgrade_expired_subscriptions() TO service_role;
