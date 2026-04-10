CREATE POLICY "Users can delete accessible transcript chunks"
ON public.link_transcript_chunks
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
);