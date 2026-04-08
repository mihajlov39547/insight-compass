CREATE TABLE IF NOT EXISTS public.resource_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  notebook_id uuid NULL REFERENCES public.notebooks(id) ON DELETE SET NULL,
  title text NOT NULL,
  url text NOT NULL,
  provider text NOT NULL DEFAULT 'unknown',
  source_type text NOT NULL DEFAULT 'linked',
  resource_type text NOT NULL DEFAULT 'link',
  status text NOT NULL DEFAULT 'ready',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resource_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view accessible resource links" ON public.resource_links;
CREATE POLICY "Users can view accessible resource links"
ON public.resource_links FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'viewer'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'))
);

DROP POLICY IF EXISTS "Users can insert resource links with permission" ON public.resource_links;
CREATE POLICY "Users can insert resource links with permission"
ON public.resource_links FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
    OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
    OR (project_id IS NULL AND notebook_id IS NULL)
  )
);

DROP POLICY IF EXISTS "Users can update resource links with permission" ON public.resource_links;
CREATE POLICY "Users can update resource links with permission"
ON public.resource_links FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
);

DROP POLICY IF EXISTS "Users can delete resource links with permission" ON public.resource_links;
CREATE POLICY "Users can delete resource links with permission"
ON public.resource_links FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
);

DROP TRIGGER IF EXISTS update_resource_links_updated_at ON public.resource_links;
CREATE TRIGGER update_resource_links_updated_at
  BEFORE UPDATE ON public.resource_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_resource_links_user_id ON public.resource_links(user_id);
CREATE INDEX IF NOT EXISTS idx_resource_links_project_id ON public.resource_links(project_id);
CREATE INDEX IF NOT EXISTS idx_resource_links_notebook_id ON public.resource_links(notebook_id);
CREATE INDEX IF NOT EXISTS idx_resource_links_updated_at ON public.resource_links(updated_at DESC);

CREATE TABLE IF NOT EXISTS public.source_connection_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  display_name text NULL,
  status text NOT NULL DEFAULT 'requested',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.source_connection_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own source connection requests" ON public.source_connection_requests;
CREATE POLICY "Users can view their own source connection requests"
ON public.source_connection_requests FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their own source connection requests" ON public.source_connection_requests;
CREATE POLICY "Users can create their own source connection requests"
ON public.source_connection_requests FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_source_connection_requests_updated_at ON public.source_connection_requests;
CREATE TRIGGER update_source_connection_requests_updated_at
  BEFORE UPDATE ON public.source_connection_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

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

  IF v_title IS NULL OR v_title = '' THEN
    v_title := v_url;
  END IF;

  RETURN QUERY
  INSERT INTO public.resource_links (
    user_id,
    project_id,
    notebook_id,
    title,
    url,
    provider,
    source_type,
    resource_type,
    status,
    metadata
  )
  VALUES (
    auth.uid(),
    v_project_id,
    v_notebook_id,
    v_title,
    v_url,
    v_provider,
    'linked',
    'link',
    'ready',
    jsonb_build_object('stub', true, 'url', v_url)
  )
  RETURNING resource_links.id, resource_links.title, resource_links.url, resource_links.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_link_resource_stub(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_link_resource_stub(text, text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_source_connection_request_stub(
  p_provider text,
  p_display_name text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  id uuid,
  provider text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_provider text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_provider := NULLIF(btrim(p_provider), '');
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'Provider is required';
  END IF;

  RETURN QUERY
  INSERT INTO public.source_connection_requests (
    user_id,
    provider,
    display_name,
    status,
    metadata
  )
  VALUES (
    auth.uid(),
    v_provider,
    NULLIF(btrim(p_display_name), ''),
    'requested',
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING source_connection_requests.id, source_connection_requests.provider, source_connection_requests.status, source_connection_requests.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_source_connection_request_stub(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_source_connection_request_stub(text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_user_resource(p_resource_id uuid, p_new_title text)
RETURNS TABLE(
  id uuid,
  title text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_new_title text;
BEGIN
  v_new_title := btrim(p_new_title);

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_new_title IS NULL OR v_new_title = '' THEN
    RAISE EXCEPTION 'Resource title cannot be empty';
  END IF;

  RETURN QUERY
  UPDATE public.documents d
  SET file_name = v_new_title
  WHERE
    d.id = p_resource_id
    AND (
      auth.uid() = d.user_id
      OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
      OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
    )
  RETURNING d.id, d.file_name AS title, d.updated_at;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.resource_links rl
  SET title = v_new_title
  WHERE
    rl.id = p_resource_id
    AND (
      auth.uid() = rl.user_id
      OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'editor'))
      OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'editor'))
    )
  RETURNING rl.id, rl.title, rl.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resource not found or permission denied';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_user_resource(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_user_resource(uuid, text) TO authenticated;

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
  detected_language text
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
      d.detected_language
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
      COALESCE(NULLIF(rl.provider, ''), 'unknown') AS provider,
      rl.title,
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
      rl.url AS summary,
      NULL::integer AS page_count,
      NULL::integer AS word_count,
      NULL::text AS detected_language
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
