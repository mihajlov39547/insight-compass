# Phase C: Workflow Context Patching (Document Workflow)

Status: active design/implementation artifact for durable workflow migration.

Scope of this phase:
- Enable orchestrator-side context patch merge for lightweight orchestration metadata.
- Keep domain tables as the only authoritative business persistence for document processing.

## 1. What Workflow Context Is Used For

`workflow_runs.context` is used as a compact orchestration snapshot only.

Examples of allowed values:
- extraction method/encoding
- quality flags and score summary
- detected language/script confidence summary
- chunk/question/embedding counts
- warning/degradation flags for optional activities
- final workflow-level status summary fields

## 2. What Must Stay Out of Workflow Context

Large or business-authoritative payloads must not be stored in `workflow_runs.context`:
- full extracted text
- normalized search text
- chunk arrays
- embeddings
- question lists
- other large user-facing artifacts

These remain in domain tables:
- `documents`
- `document_analysis`
- `document_chunks`
- `document_chunk_questions`

## 3. Merge Policy (Locked)

Context patches are merged by orchestrator logic, not handlers.

Policy:
1. Shallow top-level object merge.
2. Later completed activity patch wins on top-level key collisions.
3. Merge occurs only after handler result is accepted by orchestrator.
4. No deep merge semantics are relied on.

Practical ordering rule:
- Patches are applied in activity completion order as persisted by worker processing.
- Under concurrency, optimistic retries are used; final persisted write order is accepted for lightweight metadata.

## 4. Safety and Size Boundaries

Context patch application enforces lightweight bounds:
- top-level key count cap
- max patch byte size cap
- max context byte size cap
- string length cap
- arrays are not persisted via context patch sanitizer
- nested objects are limited to shallow primitive summaries

If a patch exceeds policy bounds, patching is skipped and business persistence is unaffected.

## 5. Persistence Authority Contract

Authoritative business persistence is unchanged:
- handlers continue writing business-visible data directly to domain tables at stage completion.
- context patch values are non-authoritative orchestration metadata only.

This keeps existing dashboard/usability compatibility and avoids context as a business dependency.

## 6. Document Activities Emitting Context Patch

Selected document handlers emit lightweight context patches:
1. `document.extract_text`
2. `document.assess_quality`
3. `document.detect_language_and_stats`
4. `document.generate_summary`
5. `document.chunk_text`
6. `document.generate_chunk_embeddings`
7. `document.generate_chunk_questions`
8. `document.finalize_document`

Handlers may omit context patch where no useful lightweight metadata exists.

## 7. Non-Goals Preserved

This phase does not:
- switch uploads to workflow engine
- switch production traffic off current `process-document`
- activate `pg_cron` or `pgmq`
- move business-critical persistence into workflow context
- alter schema/migrations/RLS/helper SQL
