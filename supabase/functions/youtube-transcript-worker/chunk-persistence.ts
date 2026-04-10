/**
 * Transcript chunking and persistence logic.
 */
import { chunkText, estimateTokenCount } from "../_shared/document-processing/chunking.ts";
import { generateEmbeddingsLocal } from "../_shared/document-processing/embeddings.ts";

export function buildTranscriptChunks(
  transcript: string
): Array<{ chunk_index: number; chunk_text: string; token_count: number }> {
  const chunks = chunkText(transcript);
  if (chunks.length === 0) {
    const fallback = transcript.trim();
    if (!fallback) return [];
    return [
      {
        chunk_index: 0,
        chunk_text: fallback,
        token_count: estimateTokenCount(fallback),
      },
    ];
  }
  return chunks.map((chunk) => ({
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    token_count: estimateTokenCount(chunk.chunk_text),
  }));
}

export async function persistTranscriptChunks(
  supabase: any,
  resourceId: string,
  transcript: string
): Promise<number> {
  const { data: linkRow, error: linkError } = await supabase
    .from("resource_links")
    .select("id, user_id, project_id, notebook_id")
    .eq("id", resourceId)
    .single();

  if (linkError || !linkRow) {
    throw new Error(
      `Unable to load resource link context: ${linkError?.message || "not found"}`
    );
  }

  const chunks = buildTranscriptChunks(transcript);
  if (chunks.length === 0) {
    throw new Error("Transcript content is empty after normalization");
  }

  const embeddings = generateEmbeddingsLocal(
    chunks.map((c) => c.chunk_text)
  );

  const { error: deleteError } = await supabase
    .from("link_transcript_chunks")
    .delete()
    .eq("resource_link_id", resourceId);

  if (deleteError) {
    throw new Error(`Failed to clear existing chunks: ${deleteError.message}`);
  }

  const rows = chunks.map((chunk, index) => ({
    resource_link_id: linkRow.id,
    user_id: linkRow.user_id,
    project_id: linkRow.project_id || null,
    notebook_id: linkRow.notebook_id || null,
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    embedding: embeddings[index] ? JSON.stringify(embeddings[index]) : null,
    token_count: chunk.token_count,
    metadata_json: {
      source: "youtube_transcript",
      worker: "youtube-transcript-worker",
    },
  }));

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error: insertError } = await supabase
      .from("link_transcript_chunks")
      .insert(batch);
    if (insertError) {
      throw new Error(`Failed to persist chunk batch: ${insertError.message}`);
    }
  }

  return rows.length;
}
