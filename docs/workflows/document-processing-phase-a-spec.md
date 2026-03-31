# Phase A Specification: Document Processing Migration to Durable Workflow

Status: Phase A complete (specification only)

Scope:
- Freeze current document-processing behavior exactly as implemented today.
- Define the target durable-workflow activity model and ownership contracts for a later implementation phase.

Non-goals in this phase:
- No runtime or behavior changes.
- No schema, migration, RLS, helper SQL, Edge Function, upload, UI, or retrieval behavior changes.
- No traffic switch to durable workflow engine.
- No handler implementation.
- No pg_cron or pgmq activation.

## 1. Current Pipeline Freeze (Do-Not-Regress Reference)

Production path remains:
1. Upload creates a `documents` row with `processing_status = uploaded`.
2. Frontend calls `functions/v1/process-document` with `documentId`.
3. The Edge Function executes staged updates in `documents.processing_status`.
4. Final state is `completed` or `failed` in the same function path.

Reference freeze matrix:
- [docs/workflows/document-processing-field-matrix.md](docs/workflows/document-processing-field-matrix.md)

### 1.1 Trigger Paths

Current trigger sources:
1. Standard file upload flow in `useUploadDocuments` (fire-and-forget call to `process-document`).
2. Manual retry flow (`useRetryProcessing`) calls the same function.
3. Notebook note-source reprocess path also resets `documents` row and calls `process-document`.

### 1.2 Current Stage Sequence

Current status progression in `documents.processing_status`:
1. `uploaded`
2. `extracting_metadata`
3. `extracting_content`
4. `detecting_language`
5. `summarizing`
6. `indexing`
7. `chunking`
8. `generating_embeddings`
9. `generating_chunk_questions`
10. `completed` (or `failed` on terminal path)

### 1.3 Current Terminal and Failure Semantics

1. Terminal success: `documents.processing_status = completed`, `processing_error = null`.
2. Terminal failure: `documents.processing_status = failed`, `processing_error` populated.
3. Extraction quality failure is terminal.
4. Embedding generation is terminal only when chunks exist and all embeddings fail.
5. Question generation is currently non-fatal by behavior:
   - per-chunk generation errors are skipped;
   - question insert batch errors are logged and pipeline still completes.

### 1.4 UI/Data Visibility Expectations to Preserve

1. Dashboard and usability panels read directly from domain tables and RPC aggregations.
2. User-visible values become available incrementally while processing is still in progress.
3. Summary, index, chunk, embedding, and question-derived metrics are not deferred until full completion.

## 2. Future Durable Workflow Activity Decomposition

Target workflow activities (logical equivalent of current pipeline):
1. `document.prepare_run`
2. `document.load_source`
3. `document.extract_text`
4. `document.assess_quality`
5. `document.detect_language_and_stats`
6. `document.generate_summary`
7. `document.build_search_index`
8. `document.chunk_text`
9. `document.generate_chunk_embeddings`
10. `document.generate_chunk_questions`
11. `document.finalize_document`

Retry policy lock for all activities in this workflow:
- `max_attempts = 2` total (1 initial + 1 retry)

### 2.1 Activity Contracts

| Activity | Purpose | Inputs | Domain table writes (authoritative) | Activity output payload (small, orchestration-oriented) | Failure behavior | Required/Optional | Retry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `document.prepare_run` | Initialize a processing run | `document_id` | `documents.processing_status = extracting_metadata`; clear `processing_error`; increment `retry_count`; set `last_retry_at` | `document_id`, `user_id`, `storage_path`, `mime_type`, `file_name`, `file_size` | Terminal on missing/inaccessible document row | Required | 2 |
| `document.load_source` | Validate/download source from storage | prepare output | set stage `extracting_content` | `source_available`, `content_length`, `storage_path`, `mime_type`, `file_name` | Terminal on download failure after retry budget | Required | 2 |
| `document.extract_text` | Extract and clean text by file type | load_source output | upsert `document_analysis.extracted_text` (bounded), extraction metadata in `document_analysis.metadata_json` | `extraction_method`, `extraction_encoding`, `raw_text_length`, `cleaned_text_length`, `line_count` | Terminal on extraction infrastructure failure | Required | 2 |
| `document.assess_quality` | Evaluate text readability/noise and enforce quality gate | extracted text reference | update quality diagnostics in `document_analysis.metadata_json`; on hard fail, set `documents.processing_error` for operator visibility | `quality_score`, `quality_reason`, `readable`, `script_ratios` | Terminal when quality gate is unreadable (preserve current behavior) | Required | 2 |
| `document.detect_language_and_stats` | Detect language/script and compute counts | quality-approved extracted text | `documents.processing_status = detecting_language`; write `documents.detected_language`, `word_count`, `char_count`; update metadata | `detected_language`, `detected_script`, `language_confidence`, `word_count`, `char_count` | Should degrade to `unknown` language when detection confidence is low; terminal only on unrecoverable processing error | Required | 2 |
| `document.generate_summary` | Generate concise summary text | language/stats output + extracted text | `documents.processing_status = summarizing`; write `documents.summary` (nullable) | `summary_present`, `summary_length`, `model`, `summary_warning` | Soft-required behavior: AI/model errors do not fail document processing; activity must complete with `summary = null` and warning metadata | Required (soft-required semantics) | 2 |
| `document.build_search_index` | Build normalized search text and index metadata | extracted text + `documents.summary` + language/stats | `documents.processing_status = indexing`; upsert `document_analysis.normalized_search_text`, `indexed_at`, metadata | `indexed`, `normalized_text_length`, `indexed_at` | Terminal on persistence/index write failure | Required | 2 |
| `document.chunk_text` | Produce retrieval chunks and persist chunk rows | extracted text + scope ids | `documents.processing_status = chunking`; delete stale `document_chunks`; insert chunk rows with `embedding = null`, `token_count` set | `chunk_count`, `avg_token_estimate` | Non-terminal for `chunk_count = 0`; terminal on chunk persistence failure | Required | 2 |
| `document.generate_chunk_embeddings` | Compute and persist chunk embeddings | chunk rows | `documents.processing_status = generating_embeddings`; update `document_chunks.embedding` | `chunk_count`, `embedded_count`, `coverage_percent` | Preserve current semantics: terminal only when chunks exist and all embeddings fail; no-op success when chunk_count is 0 | Required | 2 |
| `document.generate_chunk_questions` | Generate and store grounded per-chunk questions | chunk rows + detected language | `documents.processing_status = generating_chunk_questions`; delete stale `document_chunk_questions`; insert question rows/embeddings | `question_count`, `embedded_question_count`, `chunks_with_questions_count`, warnings | Optional/non-fatal by policy. Even if both attempts fail terminally, workflow continues and finalizes success if required activities succeeded | Optional | 2 |
| `document.finalize_document` | Apply final document state | upstream activity statuses + key counters | on success: `documents.processing_status = completed`, clear `processing_error`; on required failure path: `documents.processing_status = failed`, set `processing_error` | `final_status`, `required_failures`, `optional_failures`, `finalized_at` | Terminal activity should always execute as final gate for user-facing status consistency | Required | 2 |

## 3. Field-to-Activity Ownership (Future Workflow)

This table assigns ownership for user-visible fields and retrieval readiness in the durable workflow version.

| Field / capability | Owner activity | Persistence target | Visibility expectation |
| --- | --- | --- | --- |
| `documents.processing_status` (stage transitions) | Each owning stage + `document.finalize_document` | `documents` | Incremental stage visibility during run; terminal value from finalizer |
| `documents.processing_error` | failing required stage + `document.finalize_document` | `documents` | Visible immediately on failure path; finalizer enforces terminal consistency |
| `documents.detected_language` | `document.detect_language_and_stats` | `documents` | Visible before workflow completion |
| `documents.word_count` | `document.detect_language_and_stats` | `documents` | Visible before workflow completion |
| `documents.char_count` | `document.detect_language_and_stats` | `documents` | Visible before workflow completion |
| `documents.summary` | `document.generate_summary` | `documents` | Visible as soon as summary stage finishes; may be null on soft-required degradation |
| `document_analysis.extracted_text` | `document.extract_text` | `document_analysis` | Persisted early; not stored in workflow context |
| `document_analysis.normalized_search_text` | `document.build_search_index` | `document_analysis` | Available before final completion |
| `document_analysis.metadata_json` | `extract_text`, `assess_quality`, `detect_language_and_stats`, `build_search_index` | `document_analysis` | Incrementally enriched |
| `document_chunks` rows (`chunk_text`, `token_count`) | `document.chunk_text` | `document_chunks` | Visible immediately after chunk stage |
| `document_chunks.embedding` | `document.generate_chunk_embeddings` | `document_chunks` | Drives semantic/hybrid readiness |
| `document_chunk_questions` rows | `document.generate_chunk_questions` | `document_chunk_questions` | Non-fatal enrichment; may be partial/absent |
| `document_chunk_questions.embedding` | `document.generate_chunk_questions` | `document_chunk_questions` | Non-fatal enrichment |
| Dashboard chunk stats (`chunk_count`, `embedded_count`, `avg_token_count`) | chunk + embedding owners | RPC over `document_chunks` | Incremental visibility preserved |
| Dashboard question stats (`question_count`, `embedded_question_count`, `chunks_with_questions_count`) | question owner | RPC over `document_chunk_questions` | Incremental visibility preserved |
| Semantic retrieval readiness | `document.generate_chunk_embeddings` | derived from chunks/embeddings | Ready when embeddings satisfy existing UI condition |
| Keyword search readiness | `document.build_search_index` | `document_analysis` search text/vector pipeline | Ready when indexing writes complete |
| Hybrid retrieval readiness | `build_search_index` + `generate_chunk_embeddings` (+ optional question enrichment) | retrieval functions over documents/chunks/questions | Ready with required retrieval artifacts; question branch improves quality but is non-fatal |

## 4. Persistence Contract (Domain Tables vs Activity Output vs Context)

Locked principle for this migration:
1. User-visible and retrieval-critical values are written directly to existing domain tables when their owning activity completes.
2. `activity_runs.output_payload` carries small orchestration diagnostics/counters, not authoritative business state.
3. Workflow context is not used for large text/blob-like state in this migration.

### 4.1 Domain Persistence Rules by Activity

| Activity | Write to `documents` | Write to `document_analysis` | Write to `document_chunks` | Write to `document_chunk_questions` | Output payload only |
| --- | --- | --- | --- | --- | --- |
| prepare_run | Yes | No | No | No | run metadata |
| load_source | stage status only | No | No | No | source diagnostics |
| extract_text | stage and fail diagnostics as needed | Yes (`extracted_text`, extraction metadata) | No | No | extraction summary |
| assess_quality | fail diagnostics as needed | Yes (quality metadata) | No | No | quality verdict |
| detect_language_and_stats | Yes (`detected_language`, counts) | metadata enrich | No | No | language/stats summary |
| generate_summary | Yes (`summary`, stage status) | No | No | No | summary metadata/warnings |
| build_search_index | stage status only | Yes (`normalized_search_text`, `indexed_at`, metadata) | No | No | indexing counters |
| chunk_text | stage status only | No | Yes (chunk rows, token_count, null embeddings) | No | chunk counters |
| generate_chunk_embeddings | stage status only | No | Yes (embeddings) | No | embedding counters |
| generate_chunk_questions | stage status only | No | No | Yes (questions + embeddings) | question counters/warnings |
| finalize_document | Yes (terminal status/error) | No | No | No | final status/counters |

## 5. Required vs Optional Classification

Locked classification:

Required:
1. `document.prepare_run`
2. `document.load_source`
3. `document.extract_text`
4. `document.assess_quality`
5. `document.detect_language_and_stats`
6. `document.generate_summary` (soft-required semantics)
7. `document.build_search_index`
8. `document.chunk_text`
9. `document.generate_chunk_embeddings`
10. `document.finalize_document`

Optional/non-fatal:
1. `document.generate_chunk_questions`

Rationale:
1. Summary generation in current behavior is non-fatal for model/gateway issues; this is preserved as soft-required semantics within a required stage (degrade to `summary = null` rather than failing document processing).
2. Question generation is enrichment-only and must remain non-fatal by workflow policy, including after retry exhaustion.

## 6. Exact Workflow DAG (Phase A Locked)

### 6.1 Edges

1. `document.prepare_run -> document.load_source`
2. `document.load_source -> document.extract_text`
3. `document.extract_text -> document.assess_quality`
4. `document.assess_quality -> document.detect_language_and_stats`
5. `document.detect_language_and_stats -> document.generate_summary`
6. `document.generate_summary -> document.build_search_index`
7. `document.detect_language_and_stats -> document.chunk_text`
8. `document.chunk_text -> document.generate_chunk_embeddings`
9. `document.chunk_text -> document.generate_chunk_questions`
10. `document.build_search_index -> document.finalize_document`
11. `document.generate_chunk_embeddings -> document.finalize_document`

### 6.2 DAG Note on Optional Branch

`document.generate_chunk_questions` is intentionally not a predecessor of `document.finalize_document`.

Reason:
1. The current scheduler semantics are all-predecessor-complete for downstream queueing.
2. Optional activity terminal failure should not block completion.
3. This preserves current non-fatal question-generation behavior without requiring conditional edges or skipped-status semantics in this migration.

## 7. Retry Policy Lock

Locked for this workflow:
1. Every activity has `max_attempts = 2` total.
2. One initial attempt + one retry.
3. If both attempts fail, activity is terminal failed.
4. Exception by workflow policy interpretation:
   - `document.generate_chunk_questions` remains optional/non-fatal to workflow outcome, even when terminally failed after both attempts.
5. Attempt history and diagnostics must remain visible via activity attempts/events in the implementation phase.

## 8. Deferred Items (Explicitly Out of Phase A)

These are acknowledged and intentionally deferred:
1. Context patching from handler results is defined but not wired.
2. pgmq/pg_cron integration is schema-ready but not active.
3. Document durable-workflow handlers are not implemented yet.
4. Conditional edge evaluation is deferred and not required for this first document workflow.

## 9. Implementation Readiness Statement

This Phase A specification fully defines:
1. Current behavior freeze boundaries.
2. Activity decomposition and ownership.
3. Persistence contract.
4. Required vs optional policy.
5. Exact DAG and retry lock.

A follow-up implementation phase can now build real handlers and workflow definition wiring without guessing and without changing production traffic until explicit cutover approval.
