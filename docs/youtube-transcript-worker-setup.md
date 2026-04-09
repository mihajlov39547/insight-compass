# YouTube Transcript Worker Setup

## How it works

A pg_cron job fires every minute, calling the `youtube-transcript-worker` edge function.
The function claims queued jobs, fetches YouTube transcripts, chunks them, generates embeddings, and persists results.

## Authentication

The cron job authenticates via a **service_role JWT** stored in the database vault (`email_queue_service_role_key`). The worker also accepts an `x-worker-secret` header for manual invocation.

## Required secrets (Lovable Secrets)

| Secret | Purpose |
|---|---|
| `YOUTUBE_TRANSCRIPT_WORKER_SECRET` | Optional shared secret for manual worker invocation |

No other secrets are needed — the cron job uses the vault-stored service_role key automatically.

## Automatic setup

On Lovable Cloud, the cron job is configured automatically by a migration. No manual Supabase URL or key configuration is needed.

## Verification queries

### Check job status
```sql
SELECT status, count(*) FROM youtube_transcript_jobs GROUP BY status;
```

### Check cron job exists and has auth
```sql
SELECT jobname, schedule, LEFT(command, 300) FROM cron.job WHERE jobname LIKE '%youtube%';
```

### Check recent cron executions
```sql
-- Via Supabase analytics (edge function logs):
-- Look for POST 200 responses to youtube-transcript-worker
```

### Check vault secret exists
```sql
SELECT name FROM vault.secrets WHERE name = 'email_queue_service_role_key';
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Jobs stay `queued` | Cron job missing or returning 401 | Check cron.job exists; check vault secret |
| 404 responses | Edge function not deployed | Redeploy `youtube-transcript-worker` |
| 401 responses | Vault secret missing or invalid | Verify `email_queue_service_role_key` in vault |
| "No transcript tracks" | Video has no captions | Expected for some videos; job marked `failed` |
