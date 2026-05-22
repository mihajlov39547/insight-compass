// @ts-nocheck
/**
 * Unit tests for the readiness gate in finalizeDocumentStage.
 *
 * Covers Phase 4 verification:
 *   - required chunk persistence yields 0 rows → finalize fails (gate trips,
 *     document.processing_status flipped to 'failed', terminal error thrown)
 *   - chunks exist but none embedded → finalize fails (same)
 *   - chunks + embeddings present → finalize succeeds and document marked
 *     'completed'
 *
 * Run with:
 *   deno test supabase/functions/_shared/document-processing/finalize_test.ts \
 *     --allow-net --allow-env --no-check
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DocumentStageError,
  finalizeDocumentStage,
} from "./stages.ts";

interface UpdateCall {
  table: string;
  payload: Record<string, unknown>;
  id: string;
}

interface MockOptions {
  document: Record<string, unknown>;
  chunkCount: number;
  embeddedCount: number;
}

function makeMockSupabase(opts: MockOptions): {
  client: any;
  updates: UpdateCall[];
} {
  const updates: UpdateCall[] = [];
  let updateState: { table: string; payload: Record<string, unknown> } | null =
    null;

  function fromDocuments() {
    return {
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => ({ data: opts.document, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updateState = { table: "documents", payload };
        return {
          eq: async (_col: string, val: string) => {
            updates.push({ table: "documents", payload, id: val });
            return { error: null };
          },
        };
      },
    };
  }

  function fromDocumentChunks() {
    // Two variants used by the gate:
    // 1) total count: .select('id', {count:'exact',head:true}).eq('document_id', id)
    // 2) embedded count: chain adds .not('embedding','is',null)
    function buildQuery(withEmbeddingFilter: boolean) {
      return {
        not: (_col: string, _op: string, _val: any) => buildQuery(true),
        then: (resolve: (v: any) => void) => {
          // Promise-like: count comes from this object directly
          const count = withEmbeddingFilter
            ? opts.embeddedCount
            : opts.chunkCount;
          resolve({ count, error: null });
        },
      };
    }

    return {
      select: (_cols: string, _opts: { count: string; head: boolean }) => ({
        eq: (_col: string, _val: string) => buildQuery(false),
      }),
    };
  }

  return {
    client: {
      from: (table: string) => {
        if (table === "documents") return fromDocuments();
        if (table === "document_chunks") return fromDocumentChunks();
        throw new Error(`Unexpected table: ${table}`);
      },
    },
    updates,
  };
}

Deno.test("finalize gate: zero chunks → throws and flips document to failed", async () => {
  const { client, updates } = makeMockSupabase({
    document: { id: "doc-1", processing_status: "processing", processing_error: null },
    chunkCount: 0,
    embeddedCount: 0,
  });

  const error = await assertRejects(
    () => finalizeDocumentStage(client, "doc-1"),
    DocumentStageError,
  );
  assertEquals((error as DocumentStageError).code, "READINESS_GATE_FAILED");
  assertEquals((error as DocumentStageError).classification, "terminal");

  // Document was flipped to failed with a reason
  assertEquals(updates.length, 1);
  assertEquals(updates[0].table, "documents");
  assertEquals(updates[0].id, "doc-1");
  assertEquals(updates[0].payload.processing_status, "failed");
  const reason = String(updates[0].payload.processing_error ?? "");
  if (!reason.includes("no chunks")) {
    throw new Error(`Expected reason to mention 'no chunks', got: ${reason}`);
  }
});

Deno.test("finalize gate: chunks exist but zero embedded → throws and flips to failed", async () => {
  const { client, updates } = makeMockSupabase({
    document: { id: "doc-2", processing_status: "processing", processing_error: null },
    chunkCount: 12,
    embeddedCount: 0,
  });

  const error = await assertRejects(
    () => finalizeDocumentStage(client, "doc-2"),
    DocumentStageError,
  );
  assertEquals((error as DocumentStageError).code, "READINESS_GATE_FAILED");

  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload.processing_status, "failed");
  const reason = String(updates[0].payload.processing_error ?? "");
  if (!reason.includes("no embedded")) {
    throw new Error(`Expected reason to mention 'no embedded', got: ${reason}`);
  }
});

Deno.test("finalize gate: chunks + embeddings present → marks document completed", async () => {
  const { client, updates } = makeMockSupabase({
    document: { id: "doc-3", processing_status: "processing", processing_error: null },
    chunkCount: 8,
    embeddedCount: 8,
  });

  const result = await finalizeDocumentStage(client, "doc-3");
  assertEquals(result.final_status, "completed");
  assertEquals(result.chunk_count, 8);
  assertEquals(result.embedded_chunk_count, 8);

  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload.processing_status, "completed");
  assertEquals(updates[0].payload.processing_error, null);
});
