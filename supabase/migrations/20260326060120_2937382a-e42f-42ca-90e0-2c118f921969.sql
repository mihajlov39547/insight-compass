
-- Add retrieval weight columns to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS retrieval_chunk_weight numeric NOT NULL DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS retrieval_question_weight numeric NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS retrieval_keyword_weight numeric NOT NULL DEFAULT 0.20;

COMMENT ON COLUMN public.user_settings.retrieval_chunk_weight IS 'Weight for chunk semantic similarity in hybrid retrieval (0-1, all 3 must sum to 1)';
COMMENT ON COLUMN public.user_settings.retrieval_question_weight IS 'Weight for question semantic similarity in hybrid retrieval (0-1, all 3 must sum to 1)';
COMMENT ON COLUMN public.user_settings.retrieval_keyword_weight IS 'Weight for keyword score in hybrid retrieval (0-1, all 3 must sum to 1)';
