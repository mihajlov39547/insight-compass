
DROP POLICY IF EXISTS "Users can insert messages with permission" ON public.messages;
CREATE POLICY "Users can insert messages with permission" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = messages.chat_id
        AND public.check_item_permission(auth.uid(), c.project_id, 'project', 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can insert notebook messages with permission" ON public.notebook_messages;
CREATE POLICY "Users can insert notebook messages with permission" ON public.notebook_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor')
  );

DROP POLICY IF EXISTS "Users can create their own pins" ON public.chat_message_pins;
CREATE POLICY "Users can create their own pins" ON public.chat_message_pins
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (project_id IS NULL OR public.check_item_permission(auth.uid(), project_id, 'project', 'editor'))
    AND (notebook_id IS NULL OR public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'editor'))
  );
