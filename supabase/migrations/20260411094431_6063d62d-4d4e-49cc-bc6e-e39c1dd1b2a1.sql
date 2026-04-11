
-- Step 1: Clean up orphan documents
DELETE FROM public.documents d
WHERE (d.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = d.project_id))
   OR (d.chat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chats c WHERE c.id = d.chat_id));

-- Step 2: Clean up orphan notebook_messages
DELETE FROM public.notebook_messages nm
WHERE NOT EXISTS (SELECT 1 FROM public.notebooks n WHERE n.id = nm.notebook_id);

-- Step 3: Clean up orphan notebook_notes
DELETE FROM public.notebook_notes nn
WHERE NOT EXISTS (SELECT 1 FROM public.notebooks n WHERE n.id = nn.notebook_id);

-- Step 4: Add FK: documents → projects/chats/notebooks ON DELETE CASCADE
ALTER TABLE public.documents
  ADD CONSTRAINT documents_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_chat_id_fkey
  FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_notebook_id_fkey
  FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id) ON DELETE CASCADE;

-- Step 5: Add FK: notebook_messages/notes → notebooks ON DELETE CASCADE
ALTER TABLE public.notebook_messages
  ADD CONSTRAINT notebook_messages_notebook_id_fkey
  FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id) ON DELETE CASCADE;

ALTER TABLE public.notebook_notes
  ADD CONSTRAINT notebook_notes_notebook_id_fkey
  FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id) ON DELETE CASCADE;

-- Step 6: Change resource_links FKs to CASCADE
ALTER TABLE public.resource_links DROP CONSTRAINT resource_links_project_id_fkey;
ALTER TABLE public.resource_links
  ADD CONSTRAINT resource_links_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.resource_links DROP CONSTRAINT resource_links_notebook_id_fkey;
ALTER TABLE public.resource_links
  ADD CONSTRAINT resource_links_notebook_id_fkey
  FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id) ON DELETE CASCADE;

-- Step 7: Change link_transcript_chunks FKs to CASCADE
ALTER TABLE public.link_transcript_chunks DROP CONSTRAINT link_transcript_chunks_project_id_fkey;
ALTER TABLE public.link_transcript_chunks
  ADD CONSTRAINT link_transcript_chunks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.link_transcript_chunks DROP CONSTRAINT link_transcript_chunks_notebook_id_fkey;
ALTER TABLE public.link_transcript_chunks
  ADD CONSTRAINT link_transcript_chunks_notebook_id_fkey
  FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id) ON DELETE CASCADE;

-- Step 8: Change document_chunks FKs to CASCADE
ALTER TABLE public.document_chunks DROP CONSTRAINT document_chunks_project_id_fkey;
ALTER TABLE public.document_chunks
  ADD CONSTRAINT document_chunks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.document_chunks DROP CONSTRAINT document_chunks_chat_id_fkey;
ALTER TABLE public.document_chunks
  ADD CONSTRAINT document_chunks_chat_id_fkey
  FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;

ALTER TABLE public.document_chunks DROP CONSTRAINT document_chunks_notebook_id_fkey;
ALTER TABLE public.document_chunks
  ADD CONSTRAINT document_chunks_notebook_id_fkey
  FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id) ON DELETE CASCADE;

-- Step 9: Shares cleanup trigger
CREATE OR REPLACE FUNCTION public.cleanup_shares_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.shares
  WHERE item_id = OLD.id
    AND item_type = TG_ARGV[0];
  RETURN OLD;
END;
$$;

CREATE TRIGGER cleanup_shares_on_project_delete
  AFTER DELETE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_shares_on_delete('project');

CREATE TRIGGER cleanup_shares_on_notebook_delete
  AFTER DELETE ON public.notebooks
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_shares_on_delete('notebook');
