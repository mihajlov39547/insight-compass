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
  is_shared boolean,
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
SET search_path TO 'public'
AS $$
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
    (d.user_id <> auth.uid()) AS is_shared,
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
    d.created_at AS updated_at,
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
    d.user_id = auth.uid()
    OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
    OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
  ORDER BY d.created_at DESC;
$$;
