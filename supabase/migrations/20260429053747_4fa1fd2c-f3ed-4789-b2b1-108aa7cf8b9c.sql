
DROP POLICY IF EXISTS "Authenticated users can read workflow definitions" ON public.workflow_definitions;
DROP POLICY IF EXISTS "Authenticated users can read workflow versions" ON public.workflow_definition_versions;
DROP POLICY IF EXISTS "Authenticated users can read workflow activities" ON public.workflow_activities;
DROP POLICY IF EXISTS "Authenticated users can read workflow edges" ON public.workflow_edges;

CREATE POLICY "Service role can read workflow definitions"
  ON public.workflow_definitions FOR SELECT TO public
  USING (auth.role() = 'service_role');
CREATE POLICY "Service role can read workflow versions"
  ON public.workflow_definition_versions FOR SELECT TO public
  USING (auth.role() = 'service_role');
CREATE POLICY "Service role can read workflow activities"
  ON public.workflow_activities FOR SELECT TO public
  USING (auth.role() = 'service_role');
CREATE POLICY "Service role can read workflow edges"
  ON public.workflow_edges FOR SELECT TO public
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
CREATE POLICY "Users can update their own files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'insight-navigator' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'insight-navigator' AND (storage.foldername(name))[1] = auth.uid()::text);

ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, extensions, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, extensions, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, extensions, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, extensions, pgmq;

REVOKE EXECUTE ON FUNCTION public.claim_next_activity(text, integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_next_youtube_transcript_job(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_pending_registrations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_shares_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_share_inbox_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_welcome_inbox_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.edge_condition_matches(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_activity_runnable(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_non_owner_archive() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_link_adapter_enrichment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_downstream_activities(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_reachable_activity_ids(uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.check_item_permission(uuid, uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_link_resource_stub(text, text, text, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_source_connection_request_stub(text, text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_youtube_transcript_job(uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_document_chunk_stats(uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_document_processing_status(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_document_question_stats(uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_link_transcript_preview(uuid, integer, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_item_role(uuid, uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_resources() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_resources_v6_base() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rename_user_resource(uuid, text) FROM anon, PUBLIC;
