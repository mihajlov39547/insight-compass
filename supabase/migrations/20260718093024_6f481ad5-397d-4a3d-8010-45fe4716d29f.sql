CREATE TABLE public.plant_ai_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.plant_cases(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'plantnet',
  scan_type text NOT NULL CHECK (scan_type IN ('identify', 'diagnose')),
  month_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'provider_success', 'provider_error', 'empty_results')),
  usage_used integer,
  usage_limit integer,
  usage_remaining integer,
  provider_status integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plant_ai_scan_events TO authenticated;
GRANT ALL ON public.plant_ai_scan_events TO service_role;

ALTER TABLE public.plant_ai_scan_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scan events"
  ON public.plant_ai_scan_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_plant_ai_scan_events_user_month
  ON public.plant_ai_scan_events (user_id, month_key, created_at DESC);

CREATE INDEX idx_plant_ai_scan_events_case
  ON public.plant_ai_scan_events (case_id, created_at DESC);

CREATE INDEX idx_plant_ai_scan_events_scan_type
  ON public.plant_ai_scan_events (scan_type, created_at DESC);
