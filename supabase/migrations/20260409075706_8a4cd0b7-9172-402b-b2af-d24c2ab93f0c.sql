-- Store service role key in vault for transcript worker cron auth
-- (reuses the existing email_queue_service_role_key if present)

-- Ensure the vault entry exists (idempotent — skip if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'email_queue_service_role_key'
  ) THEN
    RAISE NOTICE 'email_queue_service_role_key not found in vault; transcript cron auth may fail until it is added';
  END IF;
END;
$$;

-- Drop the old broken cron job (missing auth headers)
SELECT cron.unschedule('youtube-transcript-worker-minute');

-- Re-create with proper vault-based auth (same pattern as email queue)
SELECT cron.schedule(
  'youtube-transcript-worker-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/youtube-transcript-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := '{"max_jobs":10}'::jsonb
    );
  $$
);
