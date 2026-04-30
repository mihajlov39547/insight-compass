-- Password reset tokens (5-digit OTP, hashed). Backend-only access.
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON public.password_reset_tokens(expires_at);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies: service_role bypasses RLS; everyone else is denied.

-- Cleanup helper
CREATE OR REPLACE FUNCTION public.cleanup_expired_password_reset_tokens()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.password_reset_tokens
  WHERE expires_at < now() - INTERVAL '1 hour'
     OR (used_at IS NOT NULL AND used_at < now() - INTERVAL '1 hour');
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_password_reset_tokens() FROM anon, public, authenticated;

-- Reuse existing updated_at trigger pattern if present
DROP TRIGGER IF EXISTS set_password_reset_tokens_updated_at ON public.password_reset_tokens;
CREATE TRIGGER set_password_reset_tokens_updated_at
BEFORE UPDATE ON public.password_reset_tokens
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();