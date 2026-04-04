# Phase A Specification: Document Processing via Durable Workflow

Status: implemented. This spec defined the target workflow model; the implementation is now live.

## 1. Activity Decomposition

Document processing runs as a DAG of workflow activities:

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

Retry policy: every activity has `max_attempts = 2` total (1 initial + 1 retry).

## 2. Required vs Optional Classification

Required:
1. `document.prepare_run`
2. `document.load_source`
3. `document.extract_text`
4. `document.assess_quality`
5. `document.detect_language_and_stats`
6. `document.generate_summary` (soft-required semantics: degrades to null on AI failure)
7. `document.build_search_index`
8. `document.chunk_text`
9. `document.generate_chunk_embeddings`
10. `document.finalize_document`

Optional/non-fatal:
1. `document.generate_chunk_questions`

## 3. DAG Edges

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

`document.generate_chunk_questions` is intentionally not a predecessor of `document.finalize_document` to preserve non-fatal semantics.

## 4. Persistence Contract

User-visible and retrieval-critical values are written directly to domain tables by each owning activity. `activity_runs.output_payload` carries small orchestration diagnostics only. Workflow context is not used for large text/blob state.

## 5. Terminal and Failure Semantics

- Terminal success: `documents.processing_status = completed`, `processing_error = null`
- Terminal failure: `documents.processing_status = failed`, `processing_error` populated
- Quality gate failure is terminal
- Summary generation is soft-required (degrades to null)
- Question generation is optional/non-fatal even after retry exhaustion
