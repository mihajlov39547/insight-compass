# Document Processing Field-to-Stage Matrix

Scope: current upload-to-ready document pipeline via durable workflow.

## 1. Processing Stage Map

| Stage (documents.processing_status) | Activity owner | What it does | Main writes |
| --- | --- | --- | --- |
| uploaded | Upload hook | Upload file and create document row | documents.file_name, file_type, mime_type, file_size, storage_path, processing_status |
| extracting_metadata | document.prepare_run | Start run, clear previous error, increment retry tracking | documents.retry_count, documents.last_retry_at, documents.processing_error |
| extracting_content | document.load_source | Download storage file and extract text by file type | intermediate extraction result |
| detecting_language | document.detect_language_and_stats | Compute word and character counts, detect language | documents.word_count, documents.char_count, documents.detected_language |
| summarizing | document.generate_summary | Call AI gateway to generate summary from cleaned text | documents.summary |
| indexing | document.build_search_index | Persist searchable analysis text | document_analysis.extracted_text, document_analysis.normalized_search_text, document_analysis.indexed_at |
| chunking | document.chunk_text | Split extracted text into retrieval chunks | document_chunks rows |
| generating_embeddings | document.generate_chunk_embeddings | Create local hash embeddings for chunks | document_chunks.embedding, document_chunks.token_count |
| generating_chunk_questions | document.generate_chunk_questions | Generate grounded chunk questions and embed each question | document_chunk_questions.question_text, document_chunk_questions.embedding |
| completed | document.finalize_document | Mark pipeline successful | documents.processing_status = completed |
| failed | document.finalize_document | Mark pipeline failed with reason | documents.processing_status = failed, documents.processing_error |

## 2. UI Field-to-Owner Matrix

| UI field | Source of truth | Activity owner | How value is produced |
| --- | --- | --- | --- |
| File type | documents.file_type | Upload hook | Inserted from file extension at upload |
| MIME type | documents.mime_type | Upload hook | Inserted from browser file type |
| Size | documents.file_size | Upload hook | Inserted from file.size |
| Uploaded | documents.created_at | DB default at insert | Timestamp set when documents row is created |
| Language | documents.detected_language | document.detect_language_and_stats | detectLanguage over cleaned extracted text |
| Words | documents.word_count | document.detect_language_and_stats | countStats over effective extracted text |
| Characters | documents.char_count | document.detect_language_and_stats | countStats over effective extracted text |
| Chunks created | get_document_chunk_stats.chunk_count | document.chunk_text + document.generate_chunk_embeddings | Count of document_chunks rows per document |
| Embeddings created | get_document_chunk_stats.embedded_count | document.generate_chunk_embeddings | Count of document_chunks rows where embedding is not null |
| Embedding coverage | UI computed | UI formula | round(embedded_count / chunk_count * 100) |
| Semantic retrieval | UI computed | UI formula | Ready when embedded_count == chunk_count and chunk_count > 0 |
| Retry attempts | documents.retry_count | document.prepare_run | Incremented at processing start for each invocation |
| Last retry | documents.last_retry_at | document.prepare_run | Updated at processing start |
| Status | documents.processing_status | workflow activity stages | Current stage or terminal state |
| Summary | documents.summary | document.generate_summary | AI-generated summary |
| Content analysis: Extracted text | document_analysis.extracted_text | document.extract_text | Stored extracted text (up to limit) |
| Content analysis: Detected language | documents.detected_language | document.detect_language_and_stats | Language field |
| Retrieval pipeline: Chunked for retrieval | get_document_chunk_stats.chunk_count | document.chunk_text | Chunk count from RPC aggregation |
| Retrieval pipeline: Embeddings created | get_document_chunk_stats.embedded_count | document.generate_chunk_embeddings | Embedded chunk count from RPC aggregation |
| Retrieval pipeline: Avg chunk size | get_document_chunk_stats.avg_token_count | document.generate_chunk_embeddings | Average of document_chunks.token_count |
| Question enrichment: Generated questions | get_document_question_stats.question_count | document.generate_chunk_questions | Count of question rows |
| Question enrichment: Question embeddings created | get_document_question_stats.embedded_question_count | document.generate_chunk_questions | Count of question rows with embedding |
| Search capabilities: Keyword search | UI computed + DB search index | document.build_search_index | Backed by document_analysis search_vector |
| Search capabilities: Semantic search | UI computed + vector RPC | document.generate_chunk_embeddings | Backed by search_document_chunks |
| Search capabilities: Hybrid retrieval | UI computed + hybrid function | multiple activities | Combines keyword + chunk semantic + question semantic |
| AI readiness: Usable in grounded chat | UI computed | UI formula | True when semanticReady |
| AI readiness: Ready for AI answers | UI computed | UI formula | True when semanticReady |
