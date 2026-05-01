-- Phase 3 regression: verify workflow-produced transcript data is retrieval-ready
-- Compare chunk + question indexing between resources to confirm parity.
--
-- Expected: all rows have embedding, search_vector, embedding_version = 'local-hash-v1',
-- is_grounded = true, and consistent metadata_json.worker values.

WITH resource_summary AS (
  SELECT
    rl.id                       AS resource_link_id,
    rl.title,
    rl.media_video_id,
    rl.transcript_status,
    rl.created_at,
    -- Chunk stats
    (SELECT count(*)            FROM link_transcript_chunks c      WHERE c.resource_link_id = rl.id)                          AS chunk_count,
    (SELECT count(*)            FROM link_transcript_chunks c      WHERE c.resource_link_id = rl.id AND c.embedding IS NOT NULL)   AS chunks_with_embedding,
    (SELECT count(*)            FROM link_transcript_chunks c      WHERE c.resource_link_id = rl.id AND c.search_vector IS NOT NULL) AS chunks_with_search_vector,
    -- Question stats
    (SELECT count(*)            FROM link_transcript_chunk_questions q WHERE q.resource_link_id = rl.id)                          AS question_count,
    (SELECT count(*)            FROM link_transcript_chunk_questions q WHERE q.resource_link_id = rl.id AND q.embedding IS NOT NULL)   AS questions_with_embedding,
    -- Worker tag
    (SELECT DISTINCT metadata_json->>'worker' FROM link_transcript_chunk_questions q WHERE q.resource_link_id = rl.id LIMIT 1) AS question_worker,
    (SELECT DISTINCT q.embedding_version      FROM link_transcript_chunk_questions q WHERE q.resource_link_id = rl.id LIMIT 1) AS question_embedding_version
  FROM resource_links rl
  WHERE rl.provider = 'youtube'
    AND rl.transcript_status = 'ready'
  ORDER BY rl.created_at DESC
  LIMIT 20
)
SELECT
  resource_link_id,
  title,
  media_video_id,
  transcript_status,
  chunk_count,
  chunks_with_embedding,
  chunks_with_search_vector,
  question_count,
  questions_with_embedding,
  question_worker,
  question_embedding_version,
  -- Parity checks
  CASE WHEN chunk_count = chunks_with_embedding AND chunk_count = chunks_with_search_vector
       THEN '✅' ELSE '❌' END                                          AS chunk_index_ok,
  CASE WHEN question_count = questions_with_embedding
       THEN '✅' ELSE '❌' END                                          AS question_index_ok,
  CASE WHEN question_embedding_version = 'local-hash-v1'
       THEN '✅' ELSE '❌' END                                          AS embedding_version_ok
FROM resource_summary
ORDER BY created_at DESC;
