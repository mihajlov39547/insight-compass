REVOKE EXECUTE ON FUNCTION public.reserve_plant_ai_scan_usage(uuid, text, text, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_plant_ai_scan_usage(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_plant_ai_scan_usage(uuid, text, text, integer) TO service_role;
