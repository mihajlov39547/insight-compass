-- 1) Make storage_path nullable (external_reference docs clear it after processing)
ALTER TABLE public.documents ALTER COLUMN storage_path DROP NOT NULL;

-- 2) Extend get_user_resources() with external_url, storage_mode, external_modified_at
DROP FUNCTION IF EXISTS public.get_user_resources();

CREATE OR REPLACE FUNCTION public.get_user_resources()
RETURNS TABLE(
  id uuid, resource_kind text, resource_type text, source_type text, provider text,
  title text, mime_type text, extension text, size_bytes bigint, storage_path text,
  owner_user_id uuid, owner_display_name text, container_type text, container_id uuid,
  container_name text, container_path text, project_id uuid, project_name text,
  chat_id uuid, chat_name text, notebook_id uuid, notebook_name text,
  is_owned_by_me boolean, is_shared_with_me boolean, is_shared boolean,
  can_open boolean, can_view_details boolean, can_download boolean,
  can_rename boolean, can_delete boolean, can_retry boolean,
  uploaded_at timestamptz, updated_at timestamptz,
  processing_status text, processing_error text, summary text,
  page_count integer, word_count integer, detected_language text,
  link_url text, normalized_url text, preview_title text, preview_domain text,
  preview_favicon_url text, media_video_id text, media_channel_name text,
  media_thumbnail_url text, media_duration_seconds integer,
  transcript_status text, transcript_error text,
  external_url text, storage_mode text, external_modified_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    g.id, g.resource_kind, g.resource_type, g.source_type, g.provider,
    g.title, g.mime_type, g.extension, g.size_bytes, g.storage_path,
    g.owner_user_id, g.owner_display_name, g.container_type, g.container_id,
    g.container_name, g.container_path, g.project_id, g.project_name,
    g.chat_id, g.chat_name, g.notebook_id, g.notebook_name,
    g.is_owned_by_me, g.is_shared_with_me, g.is_shared,
    g.can_open, g.can_view_details, g.can_download,
    g.can_rename, g.can_delete,
    CASE
      WHEN g.provider = 'youtube'
        AND g.source_type = 'linked'
        AND g.transcript_status = 'failed'
      THEN true
      ELSE g.can_retry
    END AS can_retry,
    g.uploaded_at, g.updated_at, g.processing_status, g.processing_error,
    CASE
      WHEN g.provider = 'youtube' AND g.source_type = 'linked' THEN
        COALESCE(NULLIF(rl.metadata #>> '{transcript,summary}', ''), g.summary)
      ELSE g.summary
    END AS summary,
    g.page_count, g.word_count, g.detected_language,
    g.link_url, g.normalized_url, g.preview_title, g.preview_domain,
    g.preview_favicon_url, g.media_video_id, g.media_channel_name,
    g.media_thumbnail_url, g.media_duration_seconds,
    g.transcript_status, g.transcript_error,
    d.external_url,
    COALESCE(d.storage_mode, 'stored_copy') AS storage_mode,
    d.external_modified_at
  FROM public.get_user_resources_v6_base() g
  LEFT JOIN public.resource_links rl
    ON rl.id = g.id AND g.resource_kind = 'resource' AND g.source_type = 'linked'
  LEFT JOIN public.documents d
    ON d.id = g.id AND g.resource_kind = 'document';
$function$;

REVOKE ALL ON FUNCTION public.get_user_resources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_resources() TO authenticated;

-- 3) Cleanup helper for stale external_reference temp files (>24h old, failed)
CREATE OR REPLACE FUNCTION public.cleanup_stale_external_reference_temp_files()
RETURNS TABLE(document_id uuid, storage_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH stale AS (
    SELECT d.id, d.storage_path
    FROM public.documents d
    WHERE d.storage_mode = 'external_reference'
      AND d.storage_path IS NOT NULL
      AND d.storage_path <> ''
      AND (
        d.processing_status = 'failed'
        OR d.updated_at < (now() - interval '24 hours')
      )
  ),
  cleared AS (
    UPDATE public.documents d
    SET storage_path = NULL
    FROM stale
    WHERE d.id = stale.id
    RETURNING d.id, stale.storage_path
  )
  SELECT id AS document_id, storage_path FROM cleared;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_stale_external_reference_temp_files() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_external_reference_temp_files() TO service_role;