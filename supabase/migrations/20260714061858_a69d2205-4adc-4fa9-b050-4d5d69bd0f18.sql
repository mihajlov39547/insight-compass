CREATE OR REPLACE FUNCTION public.reserve_plant_ai_scan_usage(
  p_user_id uuid,
  p_provider text,
  p_month_key text,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  -- Ensure the row exists; ON CONFLICT DO NOTHING for a clean upsert path.
  INSERT INTO public.plant_identification_usage (user_id, provider, month_key, request_count)
  VALUES (p_user_id, p_provider, p_month_key, 0)
  ON CONFLICT (user_id, provider, month_key) DO NOTHING;

  -- Lock the row atomically before check/increment.
  SELECT request_count INTO v_count
  FROM public.plant_identification_usage
  WHERE user_id = p_user_id
    AND provider = p_provider
    AND month_key = p_month_key
  FOR UPDATE;

  IF v_count >= p_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'used', v_count,
      'limit', p_limit,
      'remaining', 0
    );
  END IF;

  UPDATE public.plant_identification_usage
  SET request_count = request_count + 1,
      updated_at = now()
  WHERE user_id = p_user_id
    AND provider = p_provider
    AND month_key = p_month_key
  RETURNING request_count INTO v_count;

  RETURN jsonb_build_object(
    'allowed', true,
    'used', v_count,
    'limit', p_limit,
    'remaining', GREATEST(0, p_limit - v_count)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reserve_plant_ai_scan_usage(uuid, text, text, integer) TO authenticated, service_role;