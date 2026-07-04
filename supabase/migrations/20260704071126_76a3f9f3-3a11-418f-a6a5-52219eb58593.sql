
CREATE TABLE public.plant_identification_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'plantnet',
  month_key TEXT NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX plant_identification_usage_user_provider_month_uniq
  ON public.plant_identification_usage (user_id, provider, month_key);

GRANT SELECT ON public.plant_identification_usage TO authenticated;
GRANT ALL ON public.plant_identification_usage TO service_role;

ALTER TABLE public.plant_identification_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own identification usage"
  ON public.plant_identification_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_plant_identification_usage_updated_at
  BEFORE UPDATE ON public.plant_identification_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.increment_plant_identification_usage(
  p_user_id UUID,
  p_provider TEXT,
  p_month_key TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO public.plant_identification_usage (user_id, provider, month_key, request_count)
  VALUES (p_user_id, p_provider, p_month_key, 1)
  ON CONFLICT (user_id, provider, month_key)
  DO UPDATE SET request_count = public.plant_identification_usage.request_count + 1,
                updated_at = now()
  RETURNING request_count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_plant_identification_usage(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_plant_identification_usage(UUID, TEXT, TEXT) TO service_role;
