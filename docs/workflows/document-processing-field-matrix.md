# Document Processing Field-to-Stage Matrix

Scope: current upload-to-ready document pipeline.

Important:
- The current document pipeline is stage-based inside one Edge Function, not yet modeled as durable workflow activities.
- "Activity owner" below means the processing stage and code block currently responsible for the value.

## 1. Processing Stage Map

| Stage (documents.processing_status) | Activity owner | What it does | Main writes |
| --- | --- | --- | --- |
| uploaded | Upload hook | Upload file and create document row | documents.file_name, file_type, mime_type, file_size, storage_path, processing_status |
| extracting_metadata | process-document | Start run, clear previous error, increment retry tracking | documents.retry_count, documents.last_retry_at, documents.processing_error |
| extracting_content | process-document | Download storage file and extract text by file type | intermediate extraction result |
| detecting_language | process-document | Compute word and character counts, detect language | documents.word_count, documents.char_count, documents.detected_language |
| summarizing | process-document | Call AI gateway to generate summary from cleaned text | intermediate summary text |
| indexing | process-document | Persist summary and searchable analysis text | documents.summary, document_analysis.extracted_text, document_analysis.normalized_search_text, document_analysis.indexed_at |
| chunking | process-document | Split extracted text into retrieval chunks | intermediate chunk array |
| generating_embeddings | process-document | Create local hash embeddings for chunks and store chunks | document_chunks.chunk_text, document_chunks.embedding, document_chunks.token_count |
| generating_chunk_questions | process-document | Generate grounded chunk questions and embed each question | document_chunk_questions.question_text, document_chunk_questions.embedding |
| completed | process-document | Mark pipeline successful | documents.processing_status = completed |
| failed | process-document | Mark pipeline failed with reason | documents.processing_status = failed, documents.processing_error |

## 2. UI Field-to-Owner Matrix

This maps the fields shown in the document dashboard/usability panel to their true source.

| UI field | Source of truth | Activity owner | How value is produced |
| --- | --- | --- | --- |
| File type | documents.file_type | Upload hook | Inserted from file extension at upload |
| MIME type | documents.mime_type | Upload hook | Inserted from browser file type |
| Size | documents.file_size | Upload hook | Inserted from file.size |
| Uploaded | documents.created_at | DB default at insert | Timestamp set when documents row is created |
| Language | documents.detected_language | detecting_language | detectLanguage over cleaned extracted text |
| Words | documents.word_count | detecting_language | countStats over effective extracted text |
| Characters | documents.char_count | detecting_language | countStats over effective extracted text |
| Chunks created | get_document_chunk_stats.chunk_count | chunking + generating_embeddings | Count of document_chunks rows per document |
| Embeddings created | get_document_chunk_stats.embedded_count | generating_embeddings | Count of document_chunks rows where embedding is not null |
| Embedding coverage | UI computed | UI formula | round(embedded_count / chunk_count * 100) |
| Semantic retrieval | UI computed | UI formula | Ready when embedded_count == chunk_count and chunk_count > 0 |
| Retry attempts | documents.retry_count | extracting_metadata | Incremented at processing start for each invocation |
| Last retry | documents.last_retry_at | extracting_metadata | Updated at processing start |
| Status | documents.processing_status | process-document stages | Current stage or terminal state |
| Summary | documents.summary | summarizing + indexing | AI-generated summary saved during indexing |
| Content analysis: Extracted text | document_analysis.extracted_text | indexing | Stored extracted text (up to limit) |
| Content analysis: Summary | documents.summary | summarizing + indexing | Same summary field shown in details |
| Content analysis: Detected language | documents.detected_language | detecting_language | Same language field shown in details |
| Retrieval pipeline: Chunked for retrieval | get_document_chunk_stats.chunk_count | chunking + generating_embeddings | Chunk count from RPC aggregation |
| Retrieval pipeline: Embeddings created | get_document_chunk_stats.embedded_count | generating_embeddings | Embedded chunk count from RPC aggregation |
| Retrieval pipeline: Avg chunk size | get_document_chunk_stats.avg_token_count | generating_embeddings | Average of document_chunks.token_count |
| Question enrichment: Generated questions | get_document_question_stats.question_count | generating_chunk_questions | Count of question rows |
| Question enrichment: Question embeddings created | get_document_question_stats.embedded_question_count | generating_chunk_questions | Count of question rows with embedding |
| Question enrichment: Question embedding coverage | UI computed | UI formula | round(embedded_question_count / question_count * 100) |
| Question enrichment: Question retrieval | UI computed | UI formula | Ready when all question embeddings exist and semantic retrieval is ready |
| Search capabilities: Keyword search | UI computed + DB search index | indexing | Marked available when status is completed; backed by document_analysis search_vector |
| Search capabilities: Semantic search | UI computed + vector RPC | generating_embeddings | Marked available when semanticReady; backed by search_document_chunks |
| Search capabilities: Hybrid retrieval | UI computed + hybrid function | generating_embeddings + generating_chunk_questions + indexing | Marked available when semanticReady; hybrid combines keyword + chunk semantic + question semantic |
| AI readiness: Usable in grounded chat | UI computed | UI formula | True when semanticReady |
| AI readiness: Ready for AI answers | UI computed | UI formula | True when semanticReady |

## 3. How Summary Is Generated

| Step | Owner | Behavior |
| --- | --- | --- |
| 1 | summarizing | Uses cleaned extracted text and takes first 8000 chars |
| 2 | summarizing | If LOVABLE_API_KEY exists and text length > 50, calls AI gateway chat completions |
| 3 | summarizing | Uses model google/gemini-2.5-flash-lite with prompt: concise factual 2-5 sentence summary |
| 4 | indexing | Persists returned text to documents.summary |
| 5 | UI render | Displays documents.summary in dashboard and usability sections |

## 4. Reference Anchors

| Area | Reference |
| --- | --- |
| Upload insert + trigger | [src/hooks/useDocuments.ts](src/hooks/useDocuments.ts#L146), [src/hooks/useDocuments.ts](src/hooks/useDocuments.ts#L166) |
| Processor stages | [supabase/functions/process-document/index.ts](supabase/functions/process-document/index.ts#L845), [supabase/functions/process-document/index.ts](supabase/functions/process-document/index.ts#L1228) |
| Summary generation | [supabase/functions/process-document/index.ts](supabase/functions/process-document/index.ts#L938), [supabase/functions/process-document/index.ts](supabase/functions/process-document/index.ts#L964), [supabase/functions/process-document/index.ts](supabase/functions/process-document/index.ts#L974) |
| Chunk stats RPC | [supabase/migrations/20260325184010_97e562ab-f33b-495e-94bb-87cde8792e6b.sql](supabase/migrations/20260325184010_97e562ab-f33b-495e-94bb-87cde8792e6b.sql#L1), [src/hooks/useDocumentChunkStats.ts](src/hooks/useDocumentChunkStats.ts#L24) |
| Question stats RPC | [supabase/migrations/20260325214500_6e6f5f9e-2c6e-4d4a-8aa2-8e9f5d0d8f10.sql](supabase/migrations/20260325214500_6e6f5f9e-2c6e-4d4a-8aa2-8e9f5d0d8f10.sql#L1), [src/hooks/useDocumentQuestionStats.ts](src/hooks/useDocumentQuestionStats.ts#L29) |
| Dashboard fields | [src/components/documents/DocumentDashboard.tsx](src/components/documents/DocumentDashboard.tsx#L328), [src/components/documents/DocumentUsability.tsx](src/components/documents/DocumentUsability.tsx#L68) |
| Semantic and question retrieval RPCs | [supabase/migrations/20260325172144_d36c6990-54c3-44ec-b4b9-0d23215e616a.sql](supabase/migrations/20260325172144_d36c6990-54c3-44ec-b4b9-0d23215e616a.sql#L6), [supabase/migrations/20260325223500_2b3e5e93-1f52-4efb-9b52-4d8b6a7af4f2.sql](supabase/migrations/20260325223500_2b3e5e93-1f52-4efb-9b52-4d8b6a7af4f2.sql#L1), [supabase/functions/hybrid-retrieval/index.ts](supabase/functions/hybrid-retrieval/index.ts#L188) |
