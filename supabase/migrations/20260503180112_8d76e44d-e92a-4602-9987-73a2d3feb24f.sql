
-- Plans table
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  price_cents integer,
  currency text NOT NULL DEFAULT 'USD',
  interval text NOT NULL DEFAULT 'month',
  paypal_plan_id text,
  project_limit integer,
  notebook_limit integer,
  chats_per_project_limit integer,
  document_upload_limit integer,
  retrieval_level text NOT NULL DEFAULT 'basic',
  latest_models_enabled boolean NOT NULL DEFAULT false,
  project_sharing_enabled boolean NOT NULL DEFAULT false,
  project_member_limit integer,
  notebook_sharing_enabled boolean NOT NULL DEFAULT false,
  notebook_member_limit integer,
  support_level text NOT NULL DEFAULT 'basic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plans" ON public.plans FOR SELECT USING (true);

-- User subscriptions table
CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_key text NOT NULL DEFAULT 'free',
  paypal_subscription_id text,
  paypal_plan_id text,
  status text NOT NULL DEFAULT 'free',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions" ON public.user_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role manages subscriptions" ON public.user_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX idx_user_subscriptions_user_id ON public.user_subscriptions (user_id);
CREATE INDEX idx_user_subscriptions_paypal_sub ON public.user_subscriptions (paypal_subscription_id);

-- PayPal webhook events table
CREATE TABLE public.paypal_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paypal_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  paypal_resource_id text,
  paypal_subscription_id text,
  processed boolean NOT NULL DEFAULT false,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.paypal_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages webhook events" ON public.paypal_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed plans
INSERT INTO public.plans (key, name, price_cents, currency, interval, paypal_plan_id, project_limit, notebook_limit, chats_per_project_limit, document_upload_limit, retrieval_level, latest_models_enabled, project_sharing_enabled, project_member_limit, notebook_sharing_enabled, notebook_member_limit, support_level) VALUES
  ('free', 'Free', 0, 'USD', 'forever', NULL, 3, 3, 1, 5, 'basic', false, false, 0, false, 0, 'basic'),
  ('basic_monthly', 'Basic', 900, 'USD', 'month', 'P-94V224809Y744903GNH3YJ5I', 10, 10, 5, 10, 'faster', false, true, 3, false, 0, 'email'),
  ('premium_monthly', 'Premium', 1900, 'USD', 'month', 'P-914500751X525453BNH3YLOA', NULL, NULL, NULL, 500, 'advanced', true, true, NULL, true, NULL, 'priority'),
  ('enterprise', 'Enterprise', NULL, 'USD', 'custom', NULL, NULL, NULL, NULL, NULL, 'advanced', true, true, NULL, true, NULL, 'dedicated');

-- Trigger for updated_at on user_subscriptions
CREATE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
