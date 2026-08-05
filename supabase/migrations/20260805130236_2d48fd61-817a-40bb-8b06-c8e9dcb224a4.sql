GRANT UPDATE ON public.plant_case_chat_messages TO authenticated;

CREATE POLICY "Users can update their own plant case chat messages"
ON public.plant_case_chat_messages
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
);
