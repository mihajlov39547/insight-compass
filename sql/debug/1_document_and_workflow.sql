-- 1_ Document + latest workflow runs tied to this document
-- Replace <DOC_ID> before running.

select
  d.id as document_id,
  d.file_name,
  d.storage_path,
  d.processing_status as document_processing_status,
  d.processing_error as document_processing_error,
  d.created_at as document_created_at,
  d.updated_at as document_updated_at,
  wr.id as workflow_run_id,
  wr.status as workflow_status,
  wr.started_at as workflow_started_at,
  wr.completed_at as workflow_completed_at,
  wr.updated_at as workflow_updated_at,
  wr.failure_reason as workflow_failure_reason
from public.documents d
left join public.workflow_runs wr
  on wr.trigger_entity_type = 'document'
 and wr.trigger_entity_id = d.id
where d.id = '846fdf74-6e18-458c-b150-10bf804ebfb4'::uuid
order by wr.created_at desc
limit 10;
