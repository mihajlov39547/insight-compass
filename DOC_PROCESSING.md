# Document Processing and Retrieval (Current State)

This document reflects the **current implementation** of upload processing, indexing, and retrieval.

Workflow activity inventory (used now vs ready-but-unwired vs partial/deferred) is maintained in:

- `docs/workflows/document-analysis-status.md`

## 1) What is implemented today

### Upload and trigger flow

After a user selects files:

1. Frontend uploads bytes to Supabase Storage bucket `insight-navigator`.
2. Frontend inserts a row in `documents` with `processing_status: 'uploaded'`.
3. Frontend starts a durable workflow run via `workflow-start` for definition `document_processing_v1`.
4. Retry action starts/restarts the workflow path.

### Durable workflow document processing

Document processing is executed by the durable workflow engine as a DAG of activities:

1. `document.prepare_run` — initialize processing, clear errors, increment retry count
2. `document.load_source` — download file from storage
3. `document.extract_text` — extract and clean text by file type (PDF, DOC, DOCX, XLS/XLSX, TXT/MD/CSV/RTF)
4. `document.assess_quality` — quality gate for extracted text readability
5. `document.detect_language_and_stats` — detect language, compute word/char counts
6. `document.generate_summary` — AI summary generation (soft-required: degrades to null on failure)
7. `document.build_search_index` — build normalized search text and index metadata
8. `document.chunk_text` — split text into retrieval chunks
9. `document.generate_chunk_embeddings` — compute local hash embeddings for chunks
10. `document.generate_chunk_questions` — generate grounded per-chunk questions (optional/non-fatal)
11. `document.finalize_document` — set terminal `completed` or `failed` status

Each activity writes directly to domain tables (`documents`, `document_analysis`, `document_chunks`, `document_chunk_questions`), preserving incremental visibility during processing.

### Chunking and embeddings

Implemented:

- Text is chunked into passages with overlap.
- Chunks are stored in `document_chunks`.
- `pgvector` is enabled and `document_chunks.embedding vector(1536)` is present.
- Embeddings are generated with a **local hash-based embedding** function (deterministic, no external embedding model dependency).
- Processing fails if chunking succeeds but zero embeddings are generated.

### Retrieval

Implemented retrieval modes:

1. **Keyword retrieval (FTS)**
   - `search_documents(search_query)` over `document_analysis.search_vector` (`tsvector` + `GIN` + `ts_rank`/`ts_headline`).
   - Used by workspace/global search UI.

2. **Hybrid retrieval for chat grounding**
   - Edge function `hybrid-retrieval` combines:
     - keyword scoring over document text/summary/file name, and
     - semantic similarity over `document_chunks.embedding` via `search_document_chunks(...)`.
   - `useAIChat` uses `hybridRetrieve(...)` and builds `documentContext` from top chunks.

### Readiness stats and UI

Implemented:

- RPC `get_document_chunk_stats(doc_ids uuid[])` returns per-document:
  - `chunk_count`
  - `embedded_count`
  - `avg_token_count`
- `useDocumentChunkStats` hook uses this RPC (lightweight, avoids transferring vectors).
- Document UI surfaces:
  - chunking status,
  - embedding coverage,
  - semantic/hybrid readiness,
  - AI readiness indicators.

---

## 2) Summary of implementation coverage

- ✅ Ingestion now includes chunking + embeddings via durable workflow.
- ✅ DB supports vector storage and semantic retrieval RPC.
- ✅ Chat grounding is hybrid (semantic + keyword), not keyword-only.
- ✅ Readiness/health metrics are exposed via RPC and shown in UI.
- ✅ Full-text keyword search remains active and is still used for workspace search.

---

## 3) Recommended next steps

Priority is ordered by impact and effort.

### P0 (high impact, low-medium effort)

1. **Backfill legacy documents**
   - Ensure older `completed` documents are chunked/embedded.
   - Add a one-off job or admin action that re-runs processing for documents with missing chunks/embeddings.

2. **Add observability for retrieval quality**
   - Log/query metrics:
     - retrieval latency,
     - semantic hit rate,
     - hybrid score distribution,
     - empty-context rate.
   - Add dashboard widgets for these metrics.

3. **Operational safeguards**
   - Add retry/backoff for chunk insert batches.
   - Add clear alerting for repeated `embedding_generation_failed` cases.

### P1 (medium impact, medium effort)

4. **Improve hybrid scoring calibration**
   - Tune weighting between semantic and keyword terms.
   - Consider per-query adaptive weighting (short keyword query vs natural language query).

5. **Chunk quality improvements**
   - Add optional structure-aware chunking (headings, page boundaries, tables).
   - Preserve richer metadata (`page`, `section`) where available per file type.

6. **Workspace search optional hybrid mode**
   - Keep current keyword path as default.
   - Add optional semantic/hybrid mode for workspace search results.

### P2 (longer-term)

7. **Re-ranking layer**
   - Add lightweight reranker for top-N chunks before prompt injection.

8. **Embedding strategy roadmap**
   - Keep local hash embeddings as reliable baseline.
   - Optionally support pluggable external embeddings behind a feature flag for A/B evaluation.

9. **Citation quality UX**
   - Show page/section anchors consistently when metadata exists.
   - Improve snippet rendering and duplicate-chunk suppression in sources.
