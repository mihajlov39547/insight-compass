
-- Notebook notes table
CREATE TABLE public.notebook_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notebook_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notebook_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notebook notes" ON public.notebook_notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own notebook notes" ON public.notebook_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own notebook notes" ON public.notebook_notes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own notebook notes" ON public.notebook_notes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Notebook messages table
CREATE TABLE public.notebook_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notebook_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_id TEXT,
  sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notebook_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notebook messages" ON public.notebook_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own notebook messages" ON public.notebook_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own notebook messages" ON public.notebook_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Source enabled/disabled toggle for notebook documents
ALTER TABLE public.documents ADD COLUMN notebook_enabled BOOLEAN NOT NULL DEFAULT true;

-- Updated_at trigger for notebook_notes
CREATE TRIGGER update_notebook_notes_updated_at BEFORE UPDATE ON public.notebook_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for notebook_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.notebook_messages;
