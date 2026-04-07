
-- ============================================================
-- RBAC Permission System for Projects and Notebooks
-- ============================================================

-- 1. Role-checking helper functions

CREATE OR REPLACE FUNCTION public.get_user_item_role(p_user_id uuid, p_item_id uuid, p_item_type text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean := false;
  v_share_role text;
BEGIN
  IF p_item_type = 'project' THEN
    SELECT TRUE INTO v_is_owner FROM projects WHERE id = p_item_id AND user_id = p_user_id;
  ELSIF p_item_type = 'notebook' THEN
    SELECT TRUE INTO v_is_owner FROM notebooks WHERE id = p_item_id AND user_id = p_user_id;
  END IF;
  IF v_is_owner THEN RETURN 'owner'; END IF;
  SELECT permission INTO v_share_role FROM shares
  WHERE item_id = p_item_id AND item_type = p_item_type AND shared_with_user_id = p_user_id LIMIT 1;
  RETURN v_share_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_item_permission(p_user_id uuid, p_item_id uuid, p_item_type text, p_min_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_role_level int;
  v_min_level int;
BEGIN
  v_role := public.get_user_item_role(p_user_id, p_item_id, p_item_type);
  IF v_role IS NULL THEN RETURN false; END IF;
  v_role_level := CASE v_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END;
  v_min_level := CASE p_min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END;
  RETURN v_role_level >= v_min_level;
END;
$$;

-- 2. Trigger to prevent non-owner archive

CREATE OR REPLACE FUNCTION public.prevent_non_owner_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_archived IS DISTINCT FROM OLD.is_archived AND NEW.is_archived = true THEN
    IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Only the owner can archive this resource';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_non_owner_project_archive
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.prevent_non_owner_archive();

CREATE TRIGGER prevent_non_owner_notebook_archive
BEFORE UPDATE ON public.notebooks
FOR EACH ROW EXECUTE FUNCTION public.prevent_non_owner_archive();

-- 3. PROJECTS: admin+ can update (trigger prevents non-owner archive)

CREATE POLICY "Shared admins can update shared projects"
ON public.projects FOR UPDATE TO authenticated
USING (public.check_item_permission(auth.uid(), id, 'project', 'admin'));

-- 4. NOTEBOOKS: admin+ can update

CREATE POLICY "Shared admins can update shared notebooks"
ON public.notebooks FOR UPDATE TO authenticated
USING (public.check_item_permission(auth.uid(), id, 'notebook', 'admin'));

-- 5. CHATS: editor+ can create, admin+ can update/delete

DROP POLICY IF EXISTS "Users can insert their own chats" ON public.chats;
CREATE POLICY "Users can insert chats with permission"
ON public.chats FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor')
);

CREATE POLICY "Shared admins can update chats"
ON public.chats FOR UPDATE TO authenticated
USING (public.check_item_permission(auth.uid(), project_id, 'project', 'admin'));

CREATE POLICY "Shared admins can delete chats"
ON public.chats FOR DELETE TO authenticated
USING (public.check_item_permission(auth.uid(), project_id, 'project', 'admin'));

-- 6. MESSAGES: viewer+ can send in shared chats

DROP POLICY IF EXISTS "Users can insert their own messages" ON public.messages;
CREATE POLICY "Users can insert messages with permission"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = messages.chat_id
    AND public.check_item_permission(auth.uid(), c.project_id, 'project', 'viewer')
  )
);

-- 7. DOCUMENTS: shared access

CREATE POLICY "Shared users can view shared documents"
ON public.documents FOR SELECT TO authenticated
USING (
  (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'viewer'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'))
);

DROP POLICY IF EXISTS "Users can insert their own documents" ON public.documents;
CREATE POLICY "Users can insert documents with permission"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
    OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
    OR (project_id IS NULL AND notebook_id IS NULL)
  )
);

DROP POLICY IF EXISTS "Users can update their own documents" ON public.documents;
CREATE POLICY "Users can update documents with permission"
ON public.documents FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
);

DROP POLICY IF EXISTS "Users can delete their own documents" ON public.documents;
CREATE POLICY "Users can delete documents with permission"
ON public.documents FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
);

-- 8. DOCUMENT_ANALYSIS: shared viewers can read

CREATE POLICY "Shared users can view shared document analysis"
ON public.document_analysis FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM documents d WHERE d.id = document_analysis.document_id
    AND (
      (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
      OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
    )
  )
);

-- 9. DOCUMENT_CHUNKS: shared viewers can read

CREATE POLICY "Shared users can view shared document chunks"
ON public.document_chunks FOR SELECT TO authenticated
USING (
  (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'viewer'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'))
);

-- 10. DOCUMENT_CHUNK_QUESTIONS: shared viewers can read

CREATE POLICY "Shared users can view shared chunk questions"
ON public.document_chunk_questions FOR SELECT TO authenticated
USING (
  (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'viewer'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'))
);

-- 11. SHARES: admin+ required to manage

DROP POLICY IF EXISTS "Users can create shares" ON public.shares;
CREATE POLICY "Users can create shares with permission"
ON public.shares FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = shared_by_user_id
  AND public.check_item_permission(auth.uid(), item_id, item_type, 'admin')
);

DROP POLICY IF EXISTS "Users can update shares they created" ON public.shares;
CREATE POLICY "Users can update shares with permission"
ON public.shares FOR UPDATE TO authenticated
USING (public.check_item_permission(auth.uid(), item_id, item_type, 'admin'));

DROP POLICY IF EXISTS "Users can delete shares they created" ON public.shares;
CREATE POLICY "Users can delete shares with permission"
ON public.shares FOR DELETE TO authenticated
USING (public.check_item_permission(auth.uid(), item_id, item_type, 'admin'));

-- 12. NOTEBOOK_MESSAGES: shared access

CREATE POLICY "Shared users can view shared notebook messages"
ON public.notebook_messages FOR SELECT TO authenticated
USING (public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'));

DROP POLICY IF EXISTS "Users can insert their own notebook messages" ON public.notebook_messages;
CREATE POLICY "Users can insert notebook messages with permission"
ON public.notebook_messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer')
);

-- 13. NOTEBOOK_NOTES: shared access

CREATE POLICY "Shared users can view shared notebook notes"
ON public.notebook_notes FOR SELECT TO authenticated
USING (public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'));

DROP POLICY IF EXISTS "Users can insert their own notebook notes" ON public.notebook_notes;
CREATE POLICY "Users can insert notebook notes with permission"
ON public.notebook_notes FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor')
);

DROP POLICY IF EXISTS "Users can update their own notebook notes" ON public.notebook_notes;
CREATE POLICY "Users can update notebook notes with permission"
ON public.notebook_notes FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  OR public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor')
);

DROP POLICY IF EXISTS "Users can delete their own notebook notes" ON public.notebook_notes;
CREATE POLICY "Users can delete notebook notes with permission"
ON public.notebook_notes FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor')
);

-- 14. Update search_document_chunks for shared access

CREATE OR REPLACE FUNCTION public.search_document_chunks(
  query_embedding extensions.vector,
  match_count integer DEFAULT 10,
  similarity_threshold double precision DEFAULT 0.0,
  filter_project_id uuid DEFAULT NULL::uuid,
  filter_notebook_id uuid DEFAULT NULL::uuid,
  filter_chat_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  chunk_id uuid, document_id uuid, project_id uuid, chat_id uuid, notebook_id uuid,
  chunk_index integer, chunk_text text, similarity double precision,
  page integer, section text, language text, token_count integer,
  file_name text, metadata_json jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    dc.id AS chunk_id, dc.document_id, dc.project_id, dc.chat_id, dc.notebook_id,
    dc.chunk_index, dc.chunk_text,
    (1 - (dc.embedding <=> query_embedding))::float AS similarity,
    dc.page, dc.section, dc.language, dc.token_count, d.file_name, dc.metadata_json
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id
  WHERE
    (
      dc.user_id = auth.uid()
      OR (dc.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), dc.project_id, 'project', 'viewer'))
      OR (dc.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), dc.notebook_id, 'notebook', 'viewer'))
    )
    AND dc.embedding IS NOT NULL
    AND (filter_project_id IS NULL OR dc.project_id = filter_project_id)
    AND (filter_notebook_id IS NULL OR (dc.notebook_id = filter_notebook_id AND d.notebook_enabled = true))
    AND (filter_chat_id IS NULL OR dc.chat_id = filter_chat_id)
    AND (1 - (dc.embedding <=> query_embedding))::float >= similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 15. Update get_document_chunk_stats for shared access

CREATE OR REPLACE FUNCTION public.get_document_chunk_stats(doc_ids uuid[])
RETURNS TABLE(document_id uuid, chunk_count bigint, embedded_count bigint, avg_token_count numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    dc.document_id,
    COUNT(*)::bigint AS chunk_count,
    COUNT(dc.embedding)::bigint AS embedded_count,
    AVG(dc.token_count)::numeric AS avg_token_count
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id
  WHERE dc.document_id = ANY(doc_ids)
    AND (
      dc.user_id = auth.uid()
      OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
      OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
    )
  GROUP BY dc.document_id;
$$;

-- 16. Update get_document_question_stats for shared access

CREATE OR REPLACE FUNCTION public.get_document_question_stats(doc_ids uuid[])
RETURNS TABLE(document_id uuid, question_count bigint, embedded_question_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    dcq.document_id,
    COUNT(*)::bigint AS question_count,
    COUNT(dcq.embedding)::bigint AS embedded_question_count
  FROM public.document_chunk_questions dcq
  JOIN public.documents d ON d.id = dcq.document_id
  WHERE dcq.document_id = ANY(doc_ids)
    AND (
      dcq.user_id = auth.uid()
      OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
      OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
    )
  GROUP BY dcq.document_id;
$$;

-- 17. Update search_documents for shared access

CREATE OR REPLACE FUNCTION public.search_documents(search_query text)
RETURNS TABLE(document_id uuid, file_name text, project_id uuid, chat_id uuid, summary text, processing_status text, snippet text, rank real)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    d.id AS document_id, d.file_name, d.project_id, d.chat_id, d.summary, d.processing_status,
    CASE
      WHEN da.normalized_search_text IS NOT NULL THEN
        left(ts_headline('simple', da.normalized_search_text, plainto_tsquery('simple', search_query), 'MaxWords=25,MinWords=10,MaxFragments=1'), 150)
      ELSE d.summary
    END AS snippet,
    CASE
      WHEN da.search_vector IS NOT NULL THEN
        ts_rank(da.search_vector, plainto_tsquery('simple', search_query))
      ELSE 0
    END AS rank
  FROM public.documents d
  LEFT JOIN public.document_analysis da ON da.document_id = d.id
  WHERE
    (
      d.user_id = auth.uid()
      OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
      OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
    )
    AND (
      d.file_name ILIKE '%' || search_query || '%'
      OR d.summary ILIKE '%' || search_query || '%'
      OR (da.search_vector IS NOT NULL AND da.search_vector @@ plainto_tsquery('simple', search_query))
    )
  ORDER BY rank DESC, d.created_at DESC
  LIMIT 20;
$$;
