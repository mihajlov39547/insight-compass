CREATE TABLE IF NOT EXISTS public.youtube_transcript_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_link_id uuid NOT NULL REFERENCES public.resource_links(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'raw',
  text text NOT NULL,
  lang text,
  char_count integer GENERATED ALWAYS AS (char_length(text)) STORED,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_link_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_yt_transcript_stages_resource
  ON public.youtube_transcript_stages(resource_link_id);

ALTER TABLE public.youtube_transcript_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view accessible transcript stages"
ON public.youtube_transcript_stages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.resource_links rl
    WHERE rl.id = youtube_transcript_stages.resource_link_id
      AND (
        rl.user_id = auth.uid()
        OR (rl.project_id IS NOT NULL AND check_item_permission(auth.uid(), rl.project_id, 'project'::text, 'viewer'::text))
        OR (rl.notebook_id IS NOT NULL AND check_item_permission(auth.uid(), rl.notebook_id, 'notebook'::text, 'viewer'::text))
      )
  )
);

CREATE POLICY "Service role manages transcript stages"
ON public.youtube_transcript_stages
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_yt_transcript_stages_updated_at
BEFORE UPDATE ON public.youtube_transcript_stages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend existing reset_resource_for_retry(p_entity_type, p_entity_id) to also wipe transcript stages
DROP FUNCTION IF EXISTS public.reset_resource_for_retry(text, uuid);

CREATE OR REPLACE FUNCTION public.reset_resource_for_retry(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  v_cancelled_runs integer := 0;
  v_cancelled_activities integer := 0;
  v_deleted_chunks integer := 0;
  v_deleted_questions integer := 0;
  v_deleted_stages integer := 0;
BEGIN
  IF p_entity_type = 'document' THEN
    DELETE FROM public.document_chunk_questions WHERE document_id = p_entity_id;
    GET DIAGNOSTICS v_deleted_questions = ROW_COUNT;

    DELETE FROM public.document_chunks WHERE document_id = p_entity_id;
    GET DIAGNOSTICS v_deleted_chunks = ROW_COUNT;

    DELETE FROM public.document_analysis WHERE document_id = p_entity_id;

    UPDATE public.documents
       SET processing_status = 'uploaded',
           processing_error = NULL,
           summary = NULL,
           detected_language = NULL,
           char_count = NULL,
           word_count = NULL,
           page_count = NULL,
           retry_count = COALESCE(retry_count, 0) + 1,
           last_retry_at = now(),
           updated_at = now()
     WHERE id = p_entity_id;

  ELSIF p_entity_type = 'resource_link' THEN
    DELETE FROM public.link_transcript_chunk_questions WHERE resource_link_id = p_entity_id;
    GET DIAGNOSTICS v_deleted_questions = ROW_COUNT;

    DELETE FROM public.link_transcript_chunks WHERE resource_link_id = p_entity_id;
    GET DIAGNOSTICS v_deleted_chunks = ROW_COUNT;

    DELETE FROM public.youtube_transcript_stages WHERE resource_link_id = p_entity_id;
    GET DIAGNOSTICS v_deleted_stages = ROW_COUNT;

    UPDATE public.resource_links
       SET transcript_status = 'pending',
           transcript_error = NULL,
           transcript_updated_at = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('transcript', COALESCE(
                  (metadata->'transcript') - '_text_stash' - 'error' - 'debug' - 'summary',
                  '{}'::jsonb)),
           updated_at = now()
     WHERE id = p_entity_id;
  ELSE
    RAISE EXCEPTION 'Unsupported entity_type: %', p_entity_type;
  END IF;

  WITH cancelled AS (
    UPDATE public.workflow_runs
       SET status = 'cancelled',
           failure_reason = 'superseded_by_retry',
           finished_at = COALESCE(finished_at, now()),
           updated_at = now()
     WHERE trigger_entity_type = p_entity_type
       AND trigger_entity_id = p_entity_id
       AND status NOT IN ('completed', 'failed', 'cancelled')
    RETURNING id
  )
  SELECT count(*)::int INTO v_cancelled_runs FROM cancelled;

  UPDATE public.activity_runs ar
     SET status = 'cancelled',
         finished_at = COALESCE(finished_at, now()),
         updated_at = now()
   FROM public.workflow_runs wr
   WHERE ar.workflow_run_id = wr.id
     AND wr.trigger_entity_type = p_entity_type
     AND wr.trigger_entity_id = p_entity_id
     AND wr.status = 'cancelled'
     AND ar.status NOT IN ('completed', 'failed', 'cancelled');
  GET DIAGNOSTICS v_cancelled_activities = ROW_COUNT;

  result := jsonb_build_object(
    'ok', true,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'cancelled_workflow_runs', v_cancelled_runs,
    'cancelled_activity_runs', v_cancelled_activities,
    'deleted_chunks', v_deleted_chunks,
    'deleted_questions', v_deleted_questions,
    'deleted_transcript_stages', v_deleted_stages
  );

  RETURN result;
END;
$$;