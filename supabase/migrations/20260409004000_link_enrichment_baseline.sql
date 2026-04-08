CREATE OR REPLACE FUNCTION public.normalize_resource_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public
AS $$
DECLARE
  v_url text;
BEGIN
  v_url := btrim(COALESCE(p_url, ''));
  IF v_url = '' THEN
    RETURN '';
  END IF;

  IF v_url !~* '^[a-z][a-z0-9+.-]*://' THEN
    v_url := 'https://' || v_url;
  END IF;

  v_url := regexp_replace(v_url, '#.*$', '');
  v_url := regexp_replace(v_url, '\\s+', '', 'g');

  RETURN v_url;
END;
$$;

CREATE OR REPLACE FUNCTION public.extract_url_domain(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $$
  SELECT NULLIF(
    split_part(
      regexp_replace(
        lower(split_part(split_part(public.normalize_resource_url(p_url), '://', 2), '/', 1)),
        '^www\\.',
        ''
      ),
      ':',
      1
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.detect_source_provider_from_url(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $$
  SELECT CASE
    WHEN public.extract_url_domain(p_url) = 'youtu.be'
      OR public.extract_url_domain(p_url) LIKE '%youtube.com' THEN 'youtube'
    WHEN public.extract_url_domain(p_url) LIKE '%drive.google.com'
      OR public.extract_url_domain(p_url) LIKE '%docs.google.com' THEN 'google_drive'
    WHEN public.extract_url_domain(p_url) LIKE '%dropbox.com' THEN 'dropbox'
    WHEN public.extract_url_domain(p_url) LIKE '%notion.so'
      OR public.extract_url_domain(p_url) LIKE '%notion.site' THEN 'notion'
    ELSE 'unknown'
  END;
$$;

ALTER TABLE public.resource_links
  ADD COLUMN IF NOT EXISTS normalized_url text,
  ADD COLUMN IF NOT EXISTS preview_title text,
  ADD COLUMN IF NOT EXISTS preview_domain text,
  ADD COLUMN IF NOT EXISTS preview_favicon_url text;

UPDATE public.resource_links rl
SET
  normalized_url = public.normalize_resource_url(rl.url),
  preview_domain = public.extract_url_domain(rl.url),
  preview_favicon_url = CASE
    WHEN public.extract_url_domain(rl.url) IS NULL THEN NULL
    ELSE 'https://' || public.extract_url_domain(rl.url) || '/favicon.ico'
  END,
  preview_title = COALESCE(NULLIF(btrim(rl.title), ''), public.extract_url_domain(rl.url), public.normalize_resource_url(rl.url)),
  provider = CASE
    WHEN rl.provider IS NULL OR btrim(rl.provider) = '' OR rl.provider = 'unknown'
      THEN public.detect_source_provider_from_url(rl.url)
    ELSE rl.provider
  END,
  metadata = COALESCE(rl.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'normalized_url', public.normalize_resource_url(rl.url),
      'preview_domain', public.extract_url_domain(rl.url),
      'preview_favicon_url', CASE
        WHEN public.extract_url_domain(rl.url) IS NULL THEN NULL
        ELSE 'https://' || public.extract_url_domain(rl.url) || '/favicon.ico'
      END
    );

CREATE OR REPLACE FUNCTION public.create_link_resource_stub(
  p_url text,
  p_title text DEFAULT NULL,
  p_provider text DEFAULT 'unknown',
  p_container_type text DEFAULT 'personal',
  p_container_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text,
  url text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_url text;
  v_title text;
  v_provider text;
  v_container_type text;
  v_project_id uuid := NULL;
  v_notebook_id uuid := NULL;
  v_normalized_url text;
  v_preview_domain text;
  v_preview_favicon_url text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_url := btrim(p_url);
  v_title := btrim(COALESCE(p_title, ''));
  v_provider := COALESCE(NULLIF(btrim(p_provider), ''), 'unknown');
  v_container_type := COALESCE(NULLIF(btrim(p_container_type), ''), 'personal');

  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'URL is required';
  END IF;

  IF v_container_type NOT IN ('personal', 'project', 'notebook') THEN
    RAISE EXCEPTION 'Invalid container_type: %', v_container_type;
  END IF;

  IF v_container_type = 'project' THEN
    IF p_container_id IS NULL THEN
      RAISE EXCEPTION 'project container_id is required';
    END IF;

    IF NOT public.check_item_permission(auth.uid(), p_container_id, 'project', 'editor') THEN
      RAISE EXCEPTION 'Permission denied for target project';
    END IF;

    v_project_id := p_container_id;
  ELSIF v_container_type = 'notebook' THEN
    IF p_container_id IS NULL THEN
      RAISE EXCEPTION 'notebook container_id is required';
    END IF;

    IF NOT public.check_item_permission(auth.uid(), p_container_id, 'notebook', 'editor') THEN
      RAISE EXCEPTION 'Permission denied for target notebook';
    END IF;

    v_notebook_id := p_container_id;
  END IF;

  v_normalized_url := public.normalize_resource_url(v_url);
  v_preview_domain := public.extract_url_domain(v_normalized_url);
  v_preview_favicon_url := CASE
    WHEN v_preview_domain IS NULL THEN NULL
    ELSE 'https://' || v_preview_domain || '/favicon.ico'
  END;

  IF v_provider = 'unknown' THEN
    v_provider := public.detect_source_provider_from_url(v_normalized_url);
  END IF;

  IF v_title IS NULL OR v_title = '' THEN
    v_title := COALESCE(v_preview_domain, v_normalized_url);
  END IF;

  RETURN QUERY
  INSERT INTO public.resource_links (
    user_id,
    project_id,
    notebook_id,
    title,
    url,
    normalized_url,
    provider,
    source_type,
    resource_type,
    status,
    preview_title,
    preview_domain,
    preview_favicon_url,
    metadata
  )
  VALUES (
    auth.uid(),
    v_project_id,
    v_notebook_id,
    v_title,
    v_url,
    v_normalized_url,
    v_provider,
    'linked',
    'link',
    'ready',
    v_title,
    v_preview_domain,
    v_preview_favicon_url,
    jsonb_build_object(
      'stub', true,
      'url', v_url,
      'normalized_url', v_normalized_url,
      'preview_domain', v_preview_domain,
      'preview_favicon_url', v_preview_favicon_url
    )
  )
  RETURNING resource_links.id, resource_links.title, resource_links.url, resource_links.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_link_resource_stub(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_link_resource_stub(text, text, text, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_user_resources();

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
  preview_favicon_url text
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
      (d.user_id = auth.uid()) AS is_owned_by_me,
      (d.user_id <> auth.uid()) AS is_shared_with_me,
      (d.user_id <> auth.uid()) AS is_shared,
      true AS can_open,
      true AS can_view_details,
      (d.storage_path IS NOT NULL AND d.storage_path <> '') AS can_download,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_rename,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_delete,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
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
      NULL::text AS preview_favicon_url
    FROM public.documents d
    LEFT JOIN public.profiles p ON p.user_id = d.user_id
    LEFT JOIN public.projects pr ON pr.id = d.project_id
    LEFT JOIN public.notebooks nb ON nb.id = d.notebook_id
    WHERE
      auth.uid() IS NOT NULL
      AND (
        d.user_id = auth.uid()
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
      )
  ),
  link_resources AS (
    SELECT
      rl.id,
      'resource'::text AS resource_kind,
      'link'::text AS resource_type,
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
      'completed'::text AS processing_status,
      NULL::text AS processing_error,
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
      ) AS preview_favicon_url
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

REVOKE ALL ON FUNCTION public.get_user_resources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_resources() TO authenticated;
