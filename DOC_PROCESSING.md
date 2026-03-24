**post-processing does extract text from uploaded files and stores it in DB**, and it also does **AI summarization**, but **it does not use embeddings** right now.

### Upload flow (what happens after user selects files)

1. Frontend uploads file bytes to Supabase Storage bucket `insight-navigator` in useDocuments.ts.  
2. It inserts a row in `documents` with `processing_status: 'uploaded'` in useDocuments.ts.  
3. It calls the edge function `/functions/v1/process-document` in useDocuments.ts.  
4. Retry uses the same function in useDocuments.ts.

### What “post-processing” is doing

In index.ts:

- Downloads file from storage.
- Extracts text by file type (`extractText()`):
  - PDF uses `unpdf` in index.ts and index.ts.
  - DOC/DOCX/XLSX/TXT paths are handled too.
- Runs quality checks (`readable`, score, noise, etc.).
- If extraction fails quality, marks document as failed and stores diagnostics in `document_analysis`.
- If extraction passes:
  - Updates document status through `extracting_content` → `detecting_language` → `summarizing` → `indexing` in index.ts and index.ts.
  - Stores extracted content in `document_analysis.extracted_text` and search-normalized text in `document_analysis.normalized_search_text` in index.ts.
  - Writes summary to `documents.summary`.

So yes, it is explicitly pulling text from uploaded files and persisting it.

### Is AI used to analyze documents?

**Yes, but only for summarization** in this processing pipeline:
- Uses `LOVABLE_API_KEY` and calls AI gateway during summarization in index.ts.

### Does it use embeddings?

**No embeddings found** in current doc processing/search path.

What exists instead:
- PostgreSQL full-text search (`tsvector`) on `normalized_search_text`:
  - `search_vector` column and trigger in 20260320153700_eb76e1bf-ad74-443f-9e7a-980733b75380.sql
  - search RPC `search_documents` using `ts_rank`/`ts_headline` in 20260320153700_eb76e1bf-ad74-443f-9e7a-980733b75380.sql
- Frontend search uses that RPC in useWorkspaceSearch.ts.

If you want, I can next map exactly how chat grounding selects document snippets (keyword RPC + extracted text fallback) and where that could be upgraded to embedding-based retrieval.

Read [](file:///c%3A/Projects/insight-compass/src/hooks/useAIChat.ts#320-320), lines 320 to 345

Searched for regex `documentContext|Relevant excerpt|Summary:|BEGIN DOCUMENTS|STRICT RULES` (`**/supabase/functions/chat/index.ts`), 8 results

Searched for regex `retrieveDocumentContext|search_documents|scopedDocs|relevantDocIds|docSnippets|analysis|extracted_text|normalized_search_text|orderedIds|topIds|snippet =|relevance =|documentContext` (`**/src/hooks/useAIChat.ts`), 20 results

Searched for regex `orderedIds|topIds|sources.push|contextForAI.push|analysis\?\.extracted_text|analysis\?\.normalized_search_text|searchResult\?\.rank|slice\(0, 2000\)|slice\(0, 200\)` (`**/src/hooks/useAIChat.ts`), 15 results

Searched for regex `retrieveDocumentContext\(|sources = retrieval\.sources|documentContext = retrieval\.contextForAI|fetch\(CHAT_URL|documentContext,|sources: \(sources.length > 0` (`**/src/hooks/useAIChat.ts`), 7 results

Searched for regex `extracted_text:|normalized_search_text:|searchText = normalizeForSearch|processing_status: "summarizing"|processing_status: "indexing"|summary: summary` (`**/supabase/functions/process-document/index.ts`), 8 results

Yes. Current grounding is a **keyword + fallback excerpt** pipeline, not embedding retrieval.

## Current grounding map (exact flow)

### 1) Upload/post-processing creates searchable text
- Upload triggers `process-document` from useDocuments.ts.
- In post-processing, extracted content is persisted to `document_analysis`:
  - `extracted_text` and `normalized_search_text` in index.ts.
  - Summary is generated and stored in `documents.summary` in index.ts.
- DB full-text index (`tsvector`) is built from `normalized_search_text`:
  - column + trigger in 20260320153700_eb76e1bf-ad74-443f-9e7a-980733b75380.sql.

### 2) Chat retrieval starts with keyword RPC
In `retrieveDocumentContext()`:
- Calls `search_documents(search_query)` with user message in useAIChat.ts.
- That SQL function ranks keyword matches with `ts_rank`/`tsquery` and returns snippet/rank in 20260320153700_eb76e1bf-ad74-443f-9e7a-980733b75380.sql.

### 3) Scope/fallback expansion
Still in `retrieveDocumentContext()`:
- Fetches all completed docs in the project (fallback pool) in useAIChat.ts.
- Splits into:
  - chat-bound docs (`chat_id === current chat`) useAIChat.ts
  - project-level docs (`chat_id is null`) useAIChat.ts
- Candidate IDs are union of:
  - keyword hits
  - all chat docs
  - first 10 project docs useAIChat.ts

### 4) Snippet and excerpt selection
- Loads `document_analysis.extracted_text` + `normalized_search_text` for candidates in useAIChat.ts.
- Ordering priority:
  1. chat docs
  2. keyword-ranked docs
  3. remaining project docs
  in useAIChat.ts
- Keeps top 8 docs in useAIChat.ts.
- Source snippet shown/cited:
  - RPC `snippet` if present, else `summary` useAIChat.ts
- AI excerpt payload fallback:
  - first `extracted_text.slice(0, 2000)`, else `normalized_search_text.slice(0, 2000)` useAIChat.ts

### 5) Grounded payload goes to chat edge function
- `documentContext` is passed in request body in useAIChat.ts.
- Edge chat function injects each doc’s `summary`/`excerpt` into prompt context in index.ts.

---

## Where to upgrade to embedding-based retrieval

### A) Ingestion/indexing layer (post-processing)
Upgrade point: index.ts
- After `effectiveText` is ready, create chunks (e.g., 400–800 tokens with overlap).
- Store chunks in a new table (`document_chunks`) with metadata (`document_id`, `chunk_index`, offsets, text).
- Generate embedding per chunk and store vector column (pgvector).

### B) DB retrieval function
Upgrade point: replace/augment `search_documents` in 20260320153700_eb76e1bf-ad74-443f-9e7a-980733b75380.sql
- Add `match_document_chunks(query_embedding, project_id, chat_id, k)` for vector similarity.
- Optionally keep keyword search and do hybrid score:
  - $s = \alpha \cdot s_{vector} + (1-\alpha) \cdot s_{keyword}$

### C) Chat retrieval client
Upgrade point: useAIChat.ts
- Replace `search_documents` call with embedding RPC (or hybrid).
- Build `documentContext` from top chunks (not first 2000 chars of whole doc).
- Keep per-source citations from chunk metadata.

### D) Prompt side can stay mostly unchanged
- `chat` edge function already accepts `documentContext` and renders excerpts in prompt in index.ts.
- Only payload quality improves when excerpts come from semantically matched chunks.

---

If wanted, next step is a concrete migration plan (tables, SQL functions, and minimal code edits) for hybrid retrieval without breaking current keyword search.