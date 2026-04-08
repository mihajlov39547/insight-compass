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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resource not found or permission denied';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_user_resource(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_user_resource(uuid, text) TO authenticated;
