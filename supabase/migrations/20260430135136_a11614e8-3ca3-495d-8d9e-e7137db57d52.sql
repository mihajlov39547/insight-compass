-- Phase 1.1: Register youtube_processing_v1 workflow definition with stub activities
-- Handlers exist as stubs in workflow-worker/handlers/youtube.ts (return ok:true).
-- No behavior change: legacy youtube-transcript-worker remains the default path.

DO $$
DECLARE
  v_def_id uuid;
  v_ver_id uuid;
  v_classify uuid;
  v_fetch uuid;
  v_persist uuid;
  v_chunk_emb uuid;
  v_chunk_q uuid;
  v_q_emb uuid;
  v_finalize uuid;
BEGIN
  -- Skip if already registered (idempotent)
  IF EXISTS (SELECT 1 FROM public.workflow_definitions WHERE key = 'youtube_processing_v1') THEN
    RAISE NOTICE 'youtube_processing_v1 already exists — skipping';
    RETURN;
  END IF;

  INSERT INTO public.workflow_definitions (key, name, description, status, metadata)
  VALUES (
    'youtube_processing_v1',
    'YouTube Processing v1',
    'Workflow-engine pipeline for YouTube transcript ingestion. Phase 1: stub handlers.',
    'active',
    jsonb_build_object('phase', 'stub', 'replaces', 'youtube-transcript-worker')
  )
  RETURNING id INTO v_def_id;

  INSERT INTO public.workflow_definition_versions (workflow_definition_id, version, is_current, description)
  VALUES (v_def_id, 1, true, 'Initial stub version — see TODO_YOUTUBE_WORKFLOW_MIGRATION.md')
  RETURNING id INTO v_ver_id;

  INSERT INTO public.workflow_activities (version_id, key, name, handler_key, description, is_entry, is_terminal, retry_max_attempts, retry_backoff_seconds, execution_priority)
  VALUES (v_ver_id, 'classify_resource', 'Classify Resource', 'youtube.classify_resource', 'Validate provider and canonicalize video id', true, false, 2, 5, 0)
  RETURNING id INTO v_classify;

  INSERT INTO public.workflow_activities (version_id, key, name, handler_key, description, is_entry, is_terminal, retry_max_attempts, retry_backoff_seconds, execution_priority)
  VALUES (v_ver_id, 'fetch_transcript', 'Fetch Transcript', 'youtube.fetch_transcript', 'Fetch transcript text from provider (SerpApi primary)', false, false, 3, 15, 0)
  RETURNING id INTO v_fetch;

  INSERT INTO public.workflow_activities (version_id, key, name, handler_key, description, is_entry, is_terminal, retry_max_attempts, retry_backoff_seconds, execution_priority)
  VALUES (v_ver_id, 'persist_transcript_chunks', 'Persist Transcript Chunks', 'youtube.persist_transcript_chunks', 'Chunk transcript and write link_transcript_chunks', false, false, 2, 10, 0)
  RETURNING id INTO v_persist;

  INSERT INTO public.workflow_activities (version_id, key, name, handler_key, description, is_entry, is_terminal, retry_max_attempts, retry_backoff_seconds, execution_priority)
  VALUES (v_ver_id, 'generate_transcript_chunk_embeddings', 'Generate Chunk Embeddings', 'youtube.generate_transcript_chunk_embeddings', 'Embed transcript chunks', false, false, 3, 15, 0)
  RETURNING id INTO v_chunk_emb;

  INSERT INTO public.workflow_activities (version_id, key, name, handler_key, description, is_entry, is_terminal, is_optional, retry_max_attempts, retry_backoff_seconds, execution_priority)
  VALUES (v_ver_id, 'generate_transcript_chunk_questions', 'Generate Chunk Questions', 'youtube.generate_transcript_chunk_questions', 'Generate questions per transcript chunk', false, false, true, 2, 15, 0)
  RETURNING id INTO v_chunk_q;

  INSERT INTO public.workflow_activities (version_id, key, name, handler_key, description, is_entry, is_terminal, is_optional, retry_max_attempts, retry_backoff_seconds, execution_priority)
  VALUES (v_ver_id, 'generate_transcript_question_embeddings', 'Generate Question Embeddings', 'youtube.generate_transcript_question_embeddings', 'Embed generated transcript questions', false, false, true, 3, 15, 0)
  RETURNING id INTO v_q_emb;

  INSERT INTO public.workflow_activities (version_id, key, name, handler_key, description, is_entry, is_terminal, retry_max_attempts, retry_backoff_seconds, execution_priority)
  VALUES (v_ver_id, 'finalize_resource_status', 'Finalize Resource Status', 'youtube.finalize_resource_status', 'Set final transcript_status and processing_status', false, true, 2, 5, 0)
  RETURNING id INTO v_finalize;

  -- Linear pipeline: classify -> fetch -> persist -> chunk_emb -> chunk_q -> q_emb -> finalize
  INSERT INTO public.workflow_edges (version_id, from_activity_id, to_activity_id) VALUES
    (v_ver_id, v_classify, v_fetch),
    (v_ver_id, v_fetch, v_persist),
    (v_ver_id, v_persist, v_chunk_emb),
    (v_ver_id, v_chunk_emb, v_chunk_q),
    (v_ver_id, v_chunk_q, v_q_emb),
    (v_ver_id, v_q_emb, v_finalize);
END $$;