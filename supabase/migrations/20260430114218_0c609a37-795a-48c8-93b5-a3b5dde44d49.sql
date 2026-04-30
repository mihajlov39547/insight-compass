-- Lock down trigger-only function from being called directly via PostgREST
REVOKE EXECUTE ON FUNCTION public.enforce_share_plan_limits() FROM PUBLIC, anon, authenticated;

-- Add explicit deny-all policies on tables that should only be accessed via service-role
-- (RLS is already enabled; these policies make the deny-all posture explicit and silence linter)
CREATE POLICY "Deny all client access to password_reset_tokens"
  ON public.password_reset_tokens
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny all client access to pending_registrations"
  ON public.pending_registrations
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);