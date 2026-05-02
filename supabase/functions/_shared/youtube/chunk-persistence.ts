/**
 * Transcript chunking and persistence logic.
 */
import { chunkText, estimateTokenCount } from "../document-processing/chunking.ts";
import { generateEmbeddingsLocal, localEmbedding } from "../document-processing/embeddings.ts";
import { getModelForTask } from "../ai/task-model-config.ts";

interface TranscriptPersistenceStats {
  chunkCount: number;
  questionCount: number;
  embeddedQuestionCount: number;
}

function buildTranscriptQuestionsLocal(chunkText: string): string[] {
  const normalized = chunkText
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const topic = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 7)
    .join(" ")
    .trim();

  if (!topic) return [];

  return [
    `What is discussed in this transcript segment about ${topic}?`,
    `Which key details are mentioned in this segment about ${topic}?`,
  ];
}

async function buildTranscriptQuestionsAI(chunkText: string, lovableApiKey: string): Promise<string[]> {
  const transcriptQuestionModel = getModelForTask("transcript_question_generation");
  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: transcriptQuestionModel,
      messages: [
        {
          role: "system",
          content: `You generate short questions answerable only from the given transcript segment. Rules:\n- Generate 1 to 2 questions.\n- Questions must be grounded in the text only.\n- Keep each question under 20 words.\n- Return ONLY a JSON array of strings.`,
        },
        {
          role: "user",
          content: `Generate grounded questions for this transcript segment:\n\n${String(chunkText || "").slice(0, 3000)}`,
        },
      ],
    }),
  });

  if (!aiResp.ok) return [];

  const aiData = await aiResp.json();
  const raw = aiData.choices?.[0]?.message?.content || "";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let questions: string[];
  try {
    questions = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(questions)) return [];

  return questions
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, 2);
}

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
): Promise<TranscriptPersistenceStats> {
  const transcriptQuestionModel = getModelForTask("transcript_question_generation");
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

  const { data: persistedChunks, error: persistedChunksError } = await supabase
    .from("link_transcript_chunks")
    .select("id, chunk_index, chunk_text")
    .eq("resource_link_id", resourceId)
    .order("chunk_index", { ascending: true });

  if (persistedChunksError) {
    throw new Error(`Failed to load persisted transcript chunks: ${persistedChunksError.message}`);
  }

  const { error: deleteQuestionsError } = await supabase
    .from("link_transcript_chunk_questions")
    .delete()
    .eq("resource_link_id", resourceId);

  if (deleteQuestionsError) {
    throw new Error(`Failed to clear existing transcript questions: ${deleteQuestionsError.message}`);
  }

  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")?.trim() || "";
  const questionRows: any[] = [];

  for (const chunk of persistedChunks || []) {
    let questions: string[] = [];

    if (lovableApiKey) {
      try {
        questions = await buildTranscriptQuestionsAI(chunk.chunk_text, lovableApiKey);
      } catch {
        questions = [];
      }
    }

    if (questions.length === 0) {
      questions = buildTranscriptQuestionsLocal(chunk.chunk_text);
    }

    questions.slice(0, 2).forEach((questionText, idx) => {
      let embedding: string | null = null;
      try {
        embedding = JSON.stringify(localEmbedding(questionText));
      } catch {
        embedding = null;
      }

      questionRows.push({
        chunk_id: chunk.id,
        resource_link_id: linkRow.id,
        user_id: linkRow.user_id,
        project_id: linkRow.project_id || null,
        notebook_id: linkRow.notebook_id || null,
        question_text: questionText,
        position: idx + 1,
        embedding,
        generation_model: lovableApiKey ? transcriptQuestionModel : "local-template-v1",
        embedding_version: "local-hash-v1",
        is_grounded: true,
        metadata_json: {
          source: "youtube_transcript",
          worker: "youtube-transcript-worker",
        },
      });
    });
  }

  for (let i = 0; i < questionRows.length; i += 50) {
    const batch = questionRows.slice(i, i + 50);
    const { error: insertQuestionError } = await supabase
      .from("link_transcript_chunk_questions")
      .insert(batch);
    if (insertQuestionError) {
      throw new Error(`Failed to persist transcript question batch: ${insertQuestionError.message}`);
    }
  }

  return {
    chunkCount: rows.length,
    questionCount: questionRows.length,
    embeddedQuestionCount: questionRows.filter((row) => row.embedding != null).length,
  };
}
