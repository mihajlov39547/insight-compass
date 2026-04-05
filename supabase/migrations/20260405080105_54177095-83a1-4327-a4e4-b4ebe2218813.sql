
-- Update worker cron to run every 30 seconds with higher batch size
SELECT cron.unschedule('workflow-worker-shadow');

SELECT cron.schedule(
  'workflow-worker-poll',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/workflow-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kcnh6d3VkaHRta3lxY3h3dmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5OTQ2NjAsImV4cCI6MjA4OTU3MDY2MH0.2EZVGthInapEDDEpTD3DSTHde92lMmCNd_H9V97gyC8"}'::jsonb,
    body := '{"max_activities_to_process": 10, "lease_seconds": 300, "debug": false}'::jsonb
  ) AS request_id;
  $$
);
