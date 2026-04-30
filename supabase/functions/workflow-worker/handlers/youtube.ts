import type { HandlerExecutionInput } from "../contracts.ts";
import type { HandlerOutput } from "../handler-interface.ts";

/**
 * YouTube processing workflow handlers — Phase 1 STUBS.
 *
 * These return ok:true with an inert payload so we can:
 *   1. Register a `youtube_processing_v1` workflow definition
 *   2. Trigger smoke runs and observe activity_runs in diagnostics
 *
 * Phase 2 will replace each stub with real logic ported from
 * supabase/functions/youtube-transcript-worker/.
 */

function stub(handlerKey: string) {
  return async function (input: HandlerExecutionInput): Promise<HandlerOutput> {
    return {
      ok: true,
      output_payload: {
        handler: handlerKey,
        stub: true,
        executed_at: new Date().toISOString(),
        activity_key: input.activity_key,
        workflow_run_id: input.workflow_run_id,
        message: `Stub handler for ${handlerKey} — Phase 2 will implement real logic`,
      },
    };
  };
}

export const youtubeClassifyResource = stub("youtube.classify_resource");
export const youtubeFetchTranscript = stub("youtube.fetch_transcript");
export const youtubePersistTranscriptChunks = stub("youtube.persist_transcript_chunks");
export const youtubeGenerateTranscriptChunkEmbeddings = stub(
  "youtube.generate_transcript_chunk_embeddings"
);
export const youtubeGenerateTranscriptChunkQuestions = stub(
  "youtube.generate_transcript_chunk_questions"
);
export const youtubeGenerateTranscriptQuestionEmbeddings = stub(
  "youtube.generate_transcript_question_embeddings"
);
export const youtubeFinalizeResourceStatus = stub("youtube.finalize_resource_status");
