CREATE OR REPLACE FUNCTION public.enqueue_youtube_transcript_job(p_resource_id uuid, p_force_retry boolean DEFAULT false)
RETURNS TABLE(job_id uuid, transcript_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Legacy queue removed; YouTube transcripts are processed by workflow_worker
  -- (youtube_processing_v1) started from the client. This function is kept as
  -- a no-op so existing callers (e.g. create_link_resource_stub) keep working.
  UPDATE public.resource_links rl
  SET transcript_status = 'queued',
      transcript_error = NULL
  WHERE rl.id = p_resource_id
    AND rl.transcript_status IS DISTINCT FROM 'ready';

  RETURN QUERY SELECT NULL::uuid, 'queued'::text;
END;
$$;