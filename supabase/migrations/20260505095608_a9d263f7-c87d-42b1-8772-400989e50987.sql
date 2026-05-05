
-- Function to downgrade expired cancelled subscriptions
CREATE OR REPLACE FUNCTION public.downgrade_expired_subscriptions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT us.id AS sub_id, us.user_id
    FROM user_subscriptions us
    WHERE us.cancel_at_period_end = true
      AND us.current_period_end IS NOT NULL
      AND us.current_period_end <= now()
      AND us.status IN ('active', 'cancelled')
  LOOP
    UPDATE user_subscriptions
      SET status = 'cancelled', cancel_at_period_end = false, updated_at = now()
      WHERE id = rec.sub_id;
    UPDATE profiles
      SET plan = 'free', updated_at = now()
      WHERE user_id = rec.user_id;
  END LOOP;
END;
$$;

-- Schedule it to run every hour
SELECT cron.schedule(
  'downgrade-expired-subscriptions',
  '0 * * * *',
  $$SELECT public.downgrade_expired_subscriptions()$$
);
