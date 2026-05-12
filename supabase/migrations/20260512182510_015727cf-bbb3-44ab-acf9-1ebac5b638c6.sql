UPDATE resource_links rl
SET transcript_status = 'failed',
    transcript_error = ar.error_message,
    transcript_updated_at = now()
FROM workflow_runs wr
JOIN activity_runs ar
  ON ar.workflow_run_id = wr.id
 AND ar.activity_key = 'fetch_transcript'
 AND ar.status = 'failed'
WHERE wr.trigger_entity_id = rl.id
  AND wr.status = 'failed'
  AND rl.transcript_status = 'processing';