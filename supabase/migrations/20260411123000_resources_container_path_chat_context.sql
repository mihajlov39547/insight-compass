DROP FUNCTION IF EXISTS public.get_user_resources();
DROP FUNCTION IF EXISTS public.get_user_resources_v6_base();

CREATE FUNCTION public.get_user_resources_v6_base()
RETURNS TABLE(
  id uuid,
  resource_kind text,
  resource_type text,
  source_type text,
  provider text,
  title text,
  mime_type text,
  extension text,
  size_bytes bigint,
  storage_path text,
  owner_user_id uuid,
  owner_display_name text,
  container_type text,
  container_id uuid,
  container_name text,
  container_path text,
  project_id uuid,
  project_name text,
  chat_id uuid,
  chat_name text,
  notebook_id uuid,
  notebook_name text,
  is_owned_by_me boolean,
  is_shared_with_me boolean,
  is_shared boolean,
  can_open boolean,
  can_view_details boolean,
  can_download boolean,
  can_rename boolean,
  can_delete boolean,
  can_retry boolean,
  uploaded_at timestamptz,
  updated_at timestamptz,
  processing_status text,
  processing_error text,
  summary text,
  page_count integer,
  word_count integer,
  detected_language text,
  link_url text,
  normalized_url text,
  preview_title text,
  preview_domain text,
  preview_favicon_url text,
  media_video_id text,
  media_channel_name text,
  media_thumbnail_url text,
  media_duration_seconds integer,
  transcript_status text,
  transcript_error text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  WITH doc_resources AS (
    SELECT
      d.id,
      'document'::text AS resource_kind,
      CASE
        WHEN d.file_type IN ('pdf', 'doc', 'docx', 'rtf') THEN 'document'
        WHEN d.file_type IN ('jpg', 'jpeg', 'png') THEN 'image'
        WHEN d.file_type IN ('xls', 'xlsx', 'csv') THEN 'spreadsheet'
        WHEN d.file_type IN ('pptx') THEN 'presentation'
        WHEN d.file_type IN ('eml', 'msg') THEN 'email'
        WHEN d.file_type IN ('txt', 'txtx', 'md', 'log') THEN 'text'
        WHEN d.file_type IN ('xml', 'json') THEN 'dataset'
        ELSE 'other'
      END AS resource_type,
      'uploaded'::text AS source_type,
      'local_upload'::text AS provider,
      d.file_name AS title,
      d.mime_type,
      d.file_type AS extension,
      d.file_size AS size_bytes,
      d.storage_path,
      d.user_id AS owner_user_id,
      COALESCE(p.full_name, p.username, p.email, 'Unknown') AS owner_display_name,
      CASE
        WHEN d.notebook_id IS NOT NULL THEN 'notebook'
        WHEN d.project_id IS NOT NULL THEN 'project'
        ELSE 'personal'
      END AS container_type,
      COALESCE(d.notebook_id, d.project_id) AS container_id,
      COALESCE(nb.name, pr.name) AS container_name,
      CASE
        WHEN d.notebook_id IS NOT NULL THEN 'Notebook: ' || COALESCE(nb.name, 'Unknown')
        WHEN d.chat_id IS NOT NULL THEN 'Project: ' || COALESCE(pr.name, 'Unknown') || ' -> Chat: ' || COALESCE(ch.name, 'Unknown')
        WHEN d.project_id IS NOT NULL THEN 'Project: ' || COALESCE(pr.name, 'Unknown')
        ELSE 'Personal'
      END AS container_path,
      d.project_id,
      pr.name AS project_name,
      d.chat_id,
      ch.name AS chat_name,
      d.notebook_id,
      nb.name AS notebook_name,
      (d.user_id = auth.uid()) AS is_owned_by_me,
      (d.user_id <> auth.uid()) AS is_shared_with_me,
      (d.user_id <> auth.uid()) AS is_shared,
      true AS can_open,
      true AS can_view_details,
      (d.storage_path IS NOT NULL AND d.storage_path <> '') AS can_download,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.chat_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.chat_id, 'chat', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_rename,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.chat_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.chat_id, 'chat', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_delete,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.chat_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.chat_id, 'chat', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_retry,
      d.created_at AS uploaded_at,
      COALESCE(d.updated_at, d.created_at) AS updated_at,
      d.processing_status,
      d.processing_error,
      d.summary,
      d.page_count,
      d.word_count,
      d.detected_language,
      NULL::text AS link_url,
      NULL::text AS normalized_url,
      NULL::text AS preview_title,
      NULL::text AS preview_domain,
      NULL::text AS preview_favicon_url,
      NULL::text AS media_video_id,
      NULL::text AS media_channel_name,
      NULL::text AS media_thumbnail_url,
      NULL::integer AS media_duration_seconds,
      NULL::text AS transcript_status,
      NULL::text AS transcript_error
    FROM public.documents d
    LEFT JOIN public.profiles p ON p.user_id = d.user_id
    LEFT JOIN public.projects pr ON pr.id = d.project_id
    LEFT JOIN public.chats ch ON ch.id = d.chat_id
    LEFT JOIN public.notebooks nb ON nb.id = d.notebook_id
    WHERE
      auth.uid() IS NOT NULL
      AND (
        d.user_id = auth.uid()
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
        OR (d.chat_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.chat_id, 'chat', 'viewer'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
      )
  ),
  link_resources AS (
    SELECT
      rl.id,
      'resource'::text AS resource_kind,
      COALESCE(NULLIF(rl.resource_type, ''), 'link') AS resource_type,
      COALESCE(NULLIF(rl.source_type, ''), 'linked') AS source_type,
      COALESCE(NULLIF(rl.provider, ''), public.detect_source_provider_from_url(COALESCE(rl.normalized_url, rl.url))) AS provider,
      COALESCE(NULLIF(rl.preview_title, ''), rl.title) AS title,
      'text/uri-list'::text AS mime_type,
      'url'::text AS extension,
      0::bigint AS size_bytes,
      ''::text AS storage_path,
      rl.user_id AS owner_user_id,
      COALESCE(p.full_name, p.username, p.email, 'Unknown') AS owner_display_name,
      CASE
        WHEN rl.notebook_id IS NOT NULL THEN 'notebook'
        WHEN rl.project_id IS NOT NULL THEN 'project'
        ELSE 'personal'
      END AS container_type,
      COALESCE(rl.notebook_id, rl.project_id) AS container_id,
      COALESCE(nb.name, pr.name) AS container_name,
      CASE
        WHEN rl.notebook_id IS NOT NULL THEN 'Notebook: ' || COALESCE(nb.name, 'Unknown')
        WHEN rl.project_id IS NOT NULL THEN 'Project: ' || COALESCE(pr.name, 'Unknown')
        ELSE 'Personal'
      END AS container_path,
      rl.project_id,
      pr.name AS project_name,
      NULL::uuid AS chat_id,
      NULL::text AS chat_name,
      rl.notebook_id,
      nb.name AS notebook_name,
      (rl.user_id = auth.uid()) AS is_owned_by_me,
      (rl.user_id <> auth.uid()) AS is_shared_with_me,
      (rl.user_id <> auth.uid()) AS is_shared,
      (COALESCE(rl.notebook_id, rl.project_id) IS NOT NULL) AS can_open,
      true AS can_view_details,
      false AS can_download,
      (
        auth.uid() = rl.user_id
        OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'editor'))
        OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'editor'))
      ) AS can_rename,
      (
        auth.uid() = rl.user_id
        OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'editor'))
        OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'editor'))
      ) AS can_delete,
      false AS can_retry,
      rl.created_at AS uploaded_at,
      rl.updated_at,
      CASE
        WHEN rl.transcript_status IN ('queued', 'running') THEN rl.transcript_status
        WHEN rl.transcript_status = 'ready' THEN 'transcript_ready'
        WHEN rl.transcript_status = 'failed' THEN 'failed'
        ELSE COALESCE(NULLIF(rl.status, ''), 'linked')
      END AS processing_status,
      CASE
        WHEN rl.transcript_status = 'failed' THEN rl.transcript_error
        ELSE NULL
      END AS processing_error,
      COALESCE(rl.normalized_url, rl.url) AS summary,
      NULL::integer AS page_count,
      NULL::integer AS word_count,
      NULL::text AS detected_language,
      rl.url AS link_url,
      COALESCE(rl.normalized_url, public.normalize_resource_url(rl.url)) AS normalized_url,
      COALESCE(NULLIF(rl.preview_title, ''), rl.title) AS preview_title,
      COALESCE(NULLIF(rl.preview_domain, ''), public.extract_url_domain(COALESCE(rl.normalized_url, rl.url))) AS preview_domain,
      COALESCE(
        NULLIF(rl.preview_favicon_url, ''),
        CASE
          WHEN public.extract_url_domain(COALESCE(rl.normalized_url, rl.url)) IS NULL THEN NULL
          ELSE 'https://' || public.extract_url_domain(COALESCE(rl.normalized_url, rl.url)) || '/favicon.ico'
        END
      ) AS preview_favicon_url,
      rl.media_video_id,
      rl.media_channel_name,
      rl.media_thumbnail_url,
      rl.media_duration_seconds,
      rl.transcript_status,
      rl.transcript_error
    FROM public.resource_links rl
    LEFT JOIN public.profiles p ON p.user_id = rl.user_id
    LEFT JOIN public.projects pr ON pr.id = rl.project_id
    LEFT JOIN public.notebooks nb ON nb.id = rl.notebook_id
    WHERE
      auth.uid() IS NOT NULL
      AND (
        rl.user_id = auth.uid()
        OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'viewer'))
        OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'viewer'))
      )
  )
  SELECT *
  FROM (
    SELECT * FROM doc_resources
    UNION ALL
    SELECT * FROM link_resources
  ) combined
  ORDER BY updated_at DESC;
$$;

CREATE FUNCTION public.get_user_resources()
RETURNS TABLE(
  id uuid,
  resource_kind text,
  resource_type text,
  source_type text,
  provider text,
  title text,
  mime_type text,
  extension text,
  size_bytes bigint,
  storage_path text,
  owner_user_id uuid,
  owner_display_name text,
  container_type text,
  container_id uuid,
  container_name text,
  container_path text,
  project_id uuid,
  project_name text,
  chat_id uuid,
  chat_name text,
  notebook_id uuid,
  notebook_name text,
  is_owned_by_me boolean,
  is_shared_with_me boolean,
  is_shared boolean,
  can_open boolean,
  can_view_details boolean,
  can_download boolean,
  can_rename boolean,
  can_delete boolean,
  can_retry boolean,
  uploaded_at timestamptz,
  updated_at timestamptz,
  processing_status text,
  processing_error text,
  summary text,
  page_count integer,
  word_count integer,
  detected_language text,
  link_url text,
  normalized_url text,
  preview_title text,
  preview_domain text,
  preview_favicon_url text,
  media_video_id text,
  media_channel_name text,
  media_thumbnail_url text,
  media_duration_seconds integer,
  transcript_status text,
  transcript_error text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    g.id,
    g.resource_kind,
    g.resource_type,
    g.source_type,
    g.provider,
    g.title,
    g.mime_type,
    g.extension,
    g.size_bytes,
    g.storage_path,
    g.owner_user_id,
    g.owner_display_name,
    g.container_type,
    g.container_id,
    g.container_name,
    g.container_path,
    g.project_id,
    g.project_name,
    g.chat_id,
    g.chat_name,
    g.notebook_id,
    g.notebook_name,
    g.is_owned_by_me,
    g.is_shared_with_me,
    g.is_shared,
    g.can_open,
    g.can_view_details,
    g.can_download,
    g.can_rename,
    g.can_delete,
    CASE
      WHEN g.provider = 'youtube'
        AND g.source_type = 'linked'
        AND g.transcript_status = 'failed'
      THEN true
      ELSE g.can_retry
    END AS can_retry,
    g.uploaded_at,
    g.updated_at,
    g.processing_status,
    g.processing_error,
    g.summary,
    g.page_count,
    g.word_count,
    g.detected_language,
    g.link_url,
    g.normalized_url,
    g.preview_title,
    g.preview_domain,
    g.preview_favicon_url,
    g.media_video_id,
    g.media_channel_name,
    g.media_thumbnail_url,
    g.media_duration_seconds,
    g.transcript_status,
    g.transcript_error
  FROM public.get_user_resources_v6_base() g;
$$;

REVOKE ALL ON FUNCTION public.get_user_resources_v6_base() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_resources_v6_base() TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_resources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_resources() TO authenticated;
