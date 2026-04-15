// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RetrievalRequest {
  query: string;
  scope: "project" | "notebook" | "global";
  projectId?: string;
  notebookId?: string;
  chatId?: string;
  maxResults?: number;
}

interface HybridResult {
  documentId: string;
  fileName: string;
  chunkText: string;
  chunkIndex: number;
  chunkId: string;
  similarity: number;
  keywordRank: number;
  combinedScore: number;
  matchType: "semantic" | "keyword" | "hybrid" | "chunk" | "question";
  page: number | null;
  section: string | null;
  summary: string | null;
  projectId: string | null;
  chatId: string | null;
  notebookId: string | null;
  chunkSimilarity: number;
  questionSimilarity: number;
  keywordScore: number;
  finalScore: number;
  matchedQuestionText: string | null;
}

// ─── Local hash-based embedding (must match workflow document handlers) ──────────

const EMBED_DIM = 1536;

function hashCode(str: string, seed: number): number {
  let h = seed | 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

function localEmbedding(text: string): number[] {
  const vec = new Float64Array(EMBED_DIM);
  const lower = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = lower.split(/\s+/).filter(w => w.length >= 2);

  for (const w of words) {
    const idx = Math.abs(hashCode(w, 42)) % EMBED_DIM;
    const sign = (hashCode(w, 137) & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + " " + words[i + 1];
    const idx = Math.abs(hashCode(bigram, 99)) % EMBED_DIM;
    const sign = (hashCode(bigram, 211) & 1) === 0 ? 1 : -1;
    vec[idx] += sign * 0.7;
  }

  for (const w of words) {
    const padded = `#${w}#`;
    for (let i = 0; i < padded.length - 2; i++) {
      const tri = padded.slice(i, i + 3);
      const idx = Math.abs(hashCode(tri, 313)) % EMBED_DIM;
      const sign = (hashCode(tri, 479) & 1) === 0 ? 1 : -1;
      vec[idx] += sign * 0.4;
    }
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const result: number[] = new Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) result[i] = vec[i] / norm;
  return result;
}

function generateQueryEmbedding(query: string): number[] | null {
  try {
    return localEmbedding(query);
  } catch (e) {
    console.warn("Query embedding error:", e);
    return null;
  }
}

// ─── Retrieval weight configuration ────────────────────────────────

interface RetrievalWeights {
  chunkWeight: number;
  questionWeight: number;
  keywordWeight: number;
}

const DEFAULT_WEIGHTS: RetrievalWeights = {
  chunkWeight: 0.50,
  questionWeight: 0.30,
  keywordWeight: 0.20,
};

function validateWeights(raw: { chunk?: number; question?: number; keyword?: number }): RetrievalWeights {
  const c = Number(raw.chunk);
  const q = Number(raw.question);
  const k = Number(raw.keyword);

  if (!Number.isFinite(c) || !Number.isFinite(q) || !Number.isFinite(k)) return DEFAULT_WEIGHTS;
  if (c < 0 || q < 0 || k < 0) return DEFAULT_WEIGHTS;

  const sum = c + q + k;
  if (Math.abs(sum - 1.0) > 0.01) return DEFAULT_WEIGHTS;

  return { chunkWeight: c, questionWeight: q, keywordWeight: k };
}

async function loadRetrievalWeights(adminClient: any, userId: string): Promise<RetrievalWeights> {
  try {
    const { data, error } = await adminClient
      .from("user_settings")
      .select("retrieval_chunk_weight, retrieval_question_weight, retrieval_keyword_weight")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return DEFAULT_WEIGHTS;

    return validateWeights({
      chunk: data.retrieval_chunk_weight,
      question: data.retrieval_question_weight,
      keyword: data.retrieval_keyword_weight,
    });
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RetrievalRequest = await req.json();
    const { query, scope, projectId, notebookId, chatId, maxResults = 10 } = body;

    if (!query?.trim()) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const embedding = generateQueryEmbedding(query);

    // Fetch user-configured retrieval weights in parallel with search
    const weightsPromise = loadRetrievalWeights(adminClient, user.id);
    const keywordPromise = runKeywordSearch(userClient, query, scope, projectId, notebookId, chatId);
    const chunkSemanticPromise = runChunkSemanticSearch(userClient, embedding, scope, projectId, notebookId, chatId);
    const questionSemanticPromise = runQuestionSemanticSearch(userClient, embedding, scope, projectId, notebookId, chatId);
    const transcriptSemanticPromise = runTranscriptSemanticSearch(userClient, embedding, scope, projectId, notebookId);
    const transcriptQuestionSemanticPromise = runTranscriptQuestionSemanticSearch(userClient, embedding, scope, projectId, notebookId);

    const [weights, keywordResults, chunkSemanticResults, questionSemanticResults, transcriptSemanticResults, transcriptQuestionSemanticResults] = await Promise.all([
      weightsPromise,
      keywordPromise,
      chunkSemanticPromise,
      questionSemanticPromise,
      transcriptSemanticPromise,
      transcriptQuestionSemanticPromise,
    ]);

    const combined = await mergeResults(
      userClient,
      keywordResults,
      chunkSemanticResults,
      questionSemanticResults,
      transcriptSemanticResults,
      transcriptQuestionSemanticResults,
      maxResults,
      scope,
      projectId,
      notebookId,
      chatId,
      weights,
    );

    return new Response(JSON.stringify({ results: combined }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("hybrid-retrieval error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

interface KeywordHit {
  documentId: string;
  fileName: string;
  summary: string | null;
  snippet: string | null;
  rank: number;
  projectId: string | null;
  chatId: string | null;
  notebookId: string | null;
}

async function runKeywordSearch(
  client: any,
  query: string,
  scope: string, projectId?: string, notebookId?: string, chatId?: string
): Promise<KeywordHit[]> {
  try {
    let docQuery = client
      .from("documents")
      .select("id, file_name, summary, project_id, chat_id, notebook_id, processing_status")
      .eq("processing_status", "completed");

    if (scope === "project" && projectId) {
      if (chatId) {
        // In project chat, include both project-level docs and docs attached to this chat.
        docQuery = docQuery.or(`project_id.eq.${projectId},chat_id.eq.${chatId}`);
      } else {
        docQuery = docQuery.eq("project_id", projectId);
      }
    } else if (scope === "notebook" && notebookId) {
      docQuery = docQuery.eq("notebook_id", notebookId).eq("notebook_enabled", true);
    }

    const { data: docs } = await docQuery.limit(50);
    if (!docs || docs.length === 0) return [];

    const docIds = docs.map((d: any) => d.id);
    const { data: analyses } = await client
      .from("document_analysis")
      .select("document_id, normalized_search_text")
      .in("document_id", docIds);

    const results: KeywordHit[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length >= 2);

    for (const doc of docs) {
      const analysis = analyses?.find((a: any) => a.document_id === doc.id);
      const searchText = (analysis?.normalized_search_text || "").toLowerCase();
      const fileNameLower = doc.file_name.toLowerCase();
      const summaryLower = (doc.summary || "").toLowerCase();

      let score = 0;
      let matchedTerms = 0;

      for (const term of queryTerms) {
        if (fileNameLower.includes(term)) { score += 3; matchedTerms++; }
        if (summaryLower.includes(term)) { score += 2; matchedTerms++; }
        if (searchText.includes(term)) { score += 1; matchedTerms++; }
      }

      if (matchedTerms === 0) continue;

      let snippet: string | null = null;
      if (searchText) {
        const idx = searchText.indexOf(queryTerms[0]);
        if (idx >= 0) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(searchText.length, idx + 140);
          snippet = (start > 0 ? "…" : "") + searchText.slice(start, end).trim() + (end < searchText.length ? "…" : "");
        }
      }

      results.push({
        documentId: doc.id,
        fileName: doc.file_name,
        summary: doc.summary,
        snippet,
        rank: score / (queryTerms.length * 6),
        projectId: doc.project_id,
        chatId: doc.chat_id,
        notebookId: doc.notebook_id,
      });
    }

    results.sort((a, b) => b.rank - a.rank);
    return results.slice(0, 15);
  } catch (e) {
    console.warn("Keyword search failed:", e);
    return [];
  }
}

interface ChunkSemanticHit {
  chunkId: string;
  documentId: string;
  fileName: string;
  chunkText: string;
  chunkIndex: number;
  similarity: number;
  page: number | null;
  section: string | null;
  projectId: string | null;
  chatId: string | null;
  notebookId: string | null;
}

interface TranscriptSemanticHit {
  chunkId: string;
  resourceId: string;
  resourceTitle: string;
  chunkText: string;
  chunkIndex: number;
  similarity: number;
  normalizedUrl: string | null;
  projectId: string | null;
  notebookId: string | null;
}

interface TranscriptQuestionSemanticHit {
  questionId: string;
  chunkId: string;
  resourceId: string;
  resourceTitle: string;
  chunkText: string;
  chunkIndex: number;
  questionText: string;
  similarity: number;
  normalizedUrl: string | null;
  projectId: string | null;
  notebookId: string | null;
}

interface QuestionSemanticHit {
  chunkId: string;
  documentId: string;
  fileName: string;
  chunkText: string;
  chunkIndex: number;
  questionText: string;
  similarity: number;
  page: number | null;
  section: string | null;
  projectId: string | null;
  chatId: string | null;
  notebookId: string | null;
}

interface ChunkCandidate {
  chunkId: string;
  documentId: string;
  fileName: string;
  chunkText: string;
  chunkIndex: number;
  page: number | null;
  section: string | null;
  projectId: string | null;
  chatId: string | null;
  notebookId: string | null;
  summary: string | null;
  chunkSimilarityRaw: number;
  questionSimilarityRaw: number;
  keywordRaw: number;
  bestQuestionText: string | null;
}

async function runChunkSemanticSearch(
  userClient: any,
  embedding: number[] | null,
  scope: string,
  projectId?: string,
  notebookId?: string,
  chatId?: string
): Promise<ChunkSemanticHit[]> {
  try {
    if (!embedding) return [];

    const buildRpcParams = (filters?: { projectId?: string; notebookId?: string; chatId?: string }) => {
      const params: any = {
        query_embedding: JSON.stringify(embedding),
        match_count: 20,
        similarity_threshold: 0.15,
      };
      if (filters?.projectId) params.filter_project_id = filters.projectId;
      if (filters?.notebookId) params.filter_notebook_id = filters.notebookId;
      if (filters?.chatId) params.filter_chat_id = filters.chatId;
      return params;
    };

    const runRpc = async (filters?: { projectId?: string; notebookId?: string; chatId?: string }) => {
      const { data, error } = await userClient.rpc("search_document_chunks", buildRpcParams(filters));
      if (error) {
        console.warn("Chunk semantic search RPC error:", error);
        return [] as any[];
      }
      return data ?? [];
    };

    let rows: any[] = [];
    if (scope === "project" && projectId && chatId) {
      const [projectRows, chatRows] = await Promise.all([
        runRpc({ projectId }),
        runRpc({ chatId }),
      ]);
      rows = [...projectRows, ...chatRows];
    } else {
      rows = await runRpc({
        projectId: scope === "project" ? projectId : undefined,
        notebookId: scope === "notebook" ? notebookId : undefined,
        chatId,
      });
    }

    const deduped = new Map<string, any>();
    for (const row of rows) {
      const existing = deduped.get(row.chunk_id);
      if (!existing || Number(row.similarity ?? 0) > Number(existing.similarity ?? 0)) {
        deduped.set(row.chunk_id, row);
      }
    }

    return Array.from(deduped.values()).map((r: any) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      fileName: r.file_name,
      chunkText: r.chunk_text,
      chunkIndex: r.chunk_index,
      similarity: r.similarity,
      page: r.page,
      section: r.section,
      projectId: r.project_id,
      chatId: r.chat_id,
      notebookId: r.notebook_id,
    }));
  } catch (e) {
    console.warn("Chunk semantic search failed:", e);
    return [];
  }
}

async function runQuestionSemanticSearch(
  userClient: any,
  embedding: number[] | null,
  scope: string,
  projectId?: string,
  notebookId?: string,
  chatId?: string
): Promise<QuestionSemanticHit[]> {
  try {
    if (!embedding) return [];

    const buildRpcParams = (filters?: { projectId?: string; notebookId?: string; chatId?: string }) => {
      const params: any = {
        query_embedding: JSON.stringify(embedding),
        match_count: 30,
        similarity_threshold: 0.15,
      };
      if (filters?.projectId) params.filter_project_id = filters.projectId;
      if (filters?.notebookId) params.filter_notebook_id = filters.notebookId;
      if (filters?.chatId) params.filter_chat_id = filters.chatId;
      return params;
    };

    const runRpc = async (filters?: { projectId?: string; notebookId?: string; chatId?: string }) => {
      const { data, error } = await userClient.rpc("search_document_chunk_questions", buildRpcParams(filters));
      if (error) {
        console.warn("Question semantic search RPC error:", error);
        return [] as any[];
      }
      return data ?? [];
    };

    let rows: any[] = [];
    if (scope === "project" && projectId && chatId) {
      const [projectRows, chatRows] = await Promise.all([
        runRpc({ projectId }),
        runRpc({ chatId }),
      ]);
      rows = [...projectRows, ...chatRows];
    } else {
      rows = await runRpc({
        projectId: scope === "project" ? projectId : undefined,
        notebookId: scope === "notebook" ? notebookId : undefined,
        chatId,
      });
    }

    const deduped = new Map<string, any>();
    for (const row of rows) {
      const existing = deduped.get(row.chunk_id);
      if (!existing || Number(row.similarity ?? 0) > Number(existing.similarity ?? 0)) {
        deduped.set(row.chunk_id, row);
      }
    }

    return Array.from(deduped.values()).map((r: any) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      fileName: r.file_name,
      chunkText: r.chunk_text,
      chunkIndex: r.chunk_index,
      questionText: r.question_text,
      similarity: r.similarity,
      page: r.page,
      section: r.section,
      projectId: r.project_id,
      chatId: r.chat_id,
      notebookId: r.notebook_id,
    }));
  } catch (e) {
    console.warn("Question semantic search failed:", e);
    return [];
  }
}

async function runTranscriptSemanticSearch(
  userClient: any,
  embedding: number[] | null,
  scope: string,
  projectId?: string,
  notebookId?: string,
): Promise<TranscriptSemanticHit[]> {
  try {
    if (!embedding) return [];

    const buildRpcParams = (filters?: { projectId?: string; notebookId?: string }) => {
      const params: any = {
        query_embedding: JSON.stringify(embedding),
        match_count: 20,
        similarity_threshold: 0.15,
      };
      if (filters?.projectId) params.filter_project_id = filters.projectId;
      if (filters?.notebookId) params.filter_notebook_id = filters.notebookId;
      return params;
    };

    const runRpc = async (filters?: { projectId?: string; notebookId?: string }) => {
      const { data, error } = await userClient.rpc("search_link_transcript_chunks", buildRpcParams(filters));
      if (error) {
        console.warn("Transcript semantic search RPC error:", error);
        return [] as any[];
      }
      return data ?? [];
    };

    const rows = await runRpc({
      projectId: scope === "project" ? projectId : undefined,
      notebookId: scope === "notebook" ? notebookId : undefined,
    });

    const deduped = new Map<string, any>();
    for (const row of rows) {
      const existing = deduped.get(row.chunk_id);
      if (!existing || Number(row.similarity ?? 0) > Number(existing.similarity ?? 0)) {
        deduped.set(row.chunk_id, row);
      }
    }

    return Array.from(deduped.values()).map((r: any) => ({
      chunkId: r.chunk_id,
      resourceId: r.resource_id,
      resourceTitle: r.resource_title,
      chunkText: r.chunk_text,
      chunkIndex: r.chunk_index,
      similarity: r.similarity,
      normalizedUrl: r.normalized_url,
      projectId: r.project_id,
      notebookId: r.notebook_id,
    }));
  } catch (e) {
    console.warn("Transcript semantic search failed:", e);
    return [];
  }
}

async function runTranscriptQuestionSemanticSearch(
  userClient: any,
  embedding: number[] | null,
  scope: string,
  projectId?: string,
  notebookId?: string,
): Promise<TranscriptQuestionSemanticHit[]> {
  try {
    if (!embedding) return [];

    const buildRpcParams = (filters?: { projectId?: string; notebookId?: string }) => {
      const params: any = {
        query_embedding: JSON.stringify(embedding),
        match_count: 20,
        similarity_threshold: 0.15,
      };
      if (filters?.projectId) params.filter_project_id = filters.projectId;
      if (filters?.notebookId) params.filter_notebook_id = filters.notebookId;
      return params;
    };

    const runRpc = async (filters?: { projectId?: string; notebookId?: string }) => {
      const { data, error } = await userClient.rpc("search_link_transcript_chunk_questions", buildRpcParams(filters));
      if (error) {
        console.warn("Transcript question semantic search RPC error:", error);
        return [] as any[];
      }
      return data ?? [];
    };

    const rows = await runRpc({
      projectId: scope === "project" ? projectId : undefined,
      notebookId: scope === "notebook" ? notebookId : undefined,
    });

    const deduped = new Map<string, any>();
    for (const row of rows) {
      const existing = deduped.get(row.chunk_id);
      if (!existing || Number(row.similarity ?? 0) > Number(existing.similarity ?? 0)) {
        deduped.set(row.chunk_id, row);
      }
    }

    return Array.from(deduped.values()).map((r: any) => ({
      questionId: r.question_id,
      chunkId: r.chunk_id,
      resourceId: r.resource_id,
      resourceTitle: r.resource_title,
      chunkText: r.chunk_text,
      chunkIndex: r.chunk_index,
      questionText: r.question_text,
      similarity: r.similarity,
      normalizedUrl: r.normalized_url,
      projectId: r.project_id,
      notebookId: r.notebook_id,
    }));
  } catch (e) {
    console.warn("Transcript question semantic search failed:", e);
    return [];
  }
}

async function getKeywordFallbackChunks(
  client: any,
  missingDocIds: string[]
): Promise<Map<string, any>> {
  const fallback = new Map<string, any>();
  if (missingDocIds.length === 0) return fallback;

  const { data, error } = await client
    .from("document_chunks")
    .select("id, document_id, chunk_index, chunk_text, page, section, project_id, chat_id, notebook_id")
    .in("document_id", missingDocIds)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (error || !data) {
    if (error) console.warn("Keyword fallback chunk query failed:", error);
    return fallback;
  }

  for (const row of data) {
    if (!fallback.has(row.document_id)) fallback.set(row.document_id, row);
  }

  return fallback;
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function minMaxNormalize(values: number[]): (value: number) => number {
  const safe = values.map(clampNonNegative);
  const min = safe.length ? Math.min(...safe) : 0;
  const max = safe.length ? Math.max(...safe) : 0;
  if (max <= min) {
    return (v: number) => (clampNonNegative(v) > 0 ? 1 : 0);
  }
  return (v: number) => {
    const s = clampNonNegative(v);
    return (s - min) / (max - min);
  };
}

async function mergeResults(
  client: any,
  keywordHits: KeywordHit[],
  chunkHits: ChunkSemanticHit[],
  questionHits: QuestionSemanticHit[],
  transcriptHits: TranscriptSemanticHit[],
  transcriptQuestionHits: TranscriptQuestionSemanticHit[],
  maxResults: number,
  _scope: string,
  _projectId?: string,
  _notebookId?: string,
  _chatId?: string,
  weights: RetrievalWeights = DEFAULT_WEIGHTS,
): Promise<HybridResult[]> {
  const candidates = new Map<string, ChunkCandidate>();

  // Seed with chunk-semantic hits
  for (const hit of chunkHits) {
    const key = hit.chunkId;
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, {
        chunkId: hit.chunkId,
        documentId: hit.documentId,
        fileName: hit.fileName,
        chunkText: hit.chunkText,
        chunkIndex: hit.chunkIndex,
        page: hit.page,
        section: hit.section,
        projectId: hit.projectId,
        chatId: hit.chatId,
        notebookId: hit.notebookId,
        summary: null,
        chunkSimilarityRaw: clampNonNegative(hit.similarity),
        questionSimilarityRaw: 0,
        keywordRaw: 0,
        bestQuestionText: null,
      });
    } else {
      existing.chunkSimilarityRaw = Math.max(existing.chunkSimilarityRaw, clampNonNegative(hit.similarity));
    }
  }

  // Seed transcript chunk hits into the same candidate pool with pseudo-document IDs.
  for (const hit of transcriptHits) {
    const key = hit.chunkId;
    const pseudoDocumentId = `link:${hit.resourceId}`;
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, {
        chunkId: hit.chunkId,
        documentId: pseudoDocumentId,
        fileName: `${hit.resourceTitle} (Transcript)`,
        chunkText: hit.chunkText,
        chunkIndex: hit.chunkIndex,
        page: null,
        section: "Transcript",
        projectId: hit.projectId,
        chatId: null,
        notebookId: hit.notebookId,
        summary: hit.normalizedUrl,
        chunkSimilarityRaw: clampNonNegative(hit.similarity),
        questionSimilarityRaw: 0,
        keywordRaw: 0,
        bestQuestionText: null,
      });
    } else {
      existing.chunkSimilarityRaw = Math.max(existing.chunkSimilarityRaw, clampNonNegative(hit.similarity));
    }
  }

  // Aggregate transcript-question semantic hits back into transcript chunks
  for (const hit of transcriptQuestionHits) {
    const key = hit.chunkId;
    const pseudoDocumentId = `link:${hit.resourceId}`;
    const hitSim = clampNonNegative(hit.similarity);
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, {
        chunkId: hit.chunkId,
        documentId: pseudoDocumentId,
        fileName: `${hit.resourceTitle} (Transcript)`,
        chunkText: hit.chunkText,
        chunkIndex: hit.chunkIndex,
        page: null,
        section: "Transcript",
        projectId: hit.projectId,
        chatId: null,
        notebookId: hit.notebookId,
        summary: hit.normalizedUrl,
        chunkSimilarityRaw: 0,
        questionSimilarityRaw: hitSim,
        keywordRaw: 0,
        bestQuestionText: hit.questionText,
      });
    } else if (hitSim > existing.questionSimilarityRaw) {
      existing.questionSimilarityRaw = hitSim;
      existing.bestQuestionText = hit.questionText;
    }
  }

  // Aggregate question-semantic hits to parent chunks using max similarity per chunk
  for (const hit of questionHits) {
    const key = hit.chunkId;
    const existing = candidates.get(key);
    const hitSim = clampNonNegative(hit.similarity);
    if (!existing) {
      candidates.set(key, {
        chunkId: hit.chunkId,
        documentId: hit.documentId,
        fileName: hit.fileName,
        chunkText: hit.chunkText,
        chunkIndex: hit.chunkIndex,
        page: hit.page,
        section: hit.section,
        projectId: hit.projectId,
        chatId: hit.chatId,
        notebookId: hit.notebookId,
        summary: null,
        chunkSimilarityRaw: 0,
        questionSimilarityRaw: hitSim,
        keywordRaw: 0,
        bestQuestionText: hit.questionText,
      });
    } else {
      if (hitSim > existing.questionSimilarityRaw) {
        existing.questionSimilarityRaw = hitSim;
        existing.bestQuestionText = hit.questionText;
      }
    }
  }

  // Apply keyword score per document to all chunk candidates in that document
  const keywordByDoc = new Map<string, KeywordHit>();
  for (const kw of keywordHits) keywordByDoc.set(kw.documentId, kw);

  for (const candidate of candidates.values()) {
    const kw = keywordByDoc.get(candidate.documentId);
    if (!kw) continue;
    candidate.keywordRaw = clampNonNegative(kw.rank);
    candidate.summary = kw.summary;
  }

  // Ensure keyword-only docs still return chunk-based results (backward compatibility)
  const coveredDocs = new Set(Array.from(candidates.values()).map(c => c.documentId));
  const missingKeywordDocs = keywordHits
    .map(k => k.documentId)
    .filter((docId, idx, arr) => arr.indexOf(docId) === idx && !coveredDocs.has(docId));

  if (missingKeywordDocs.length > 0) {
    const fallbackChunks = await getKeywordFallbackChunks(client, missingKeywordDocs);
    for (const docId of missingKeywordDocs) {
      const row = fallbackChunks.get(docId);
      const kw = keywordByDoc.get(docId);
      if (!row || !kw) continue;

      candidates.set(row.id, {
        chunkId: row.id,
        documentId: docId,
        fileName: kw.fileName,
        chunkText: row.chunk_text || "",
        chunkIndex: row.chunk_index,
        page: row.page,
        section: row.section,
        projectId: row.project_id,
        chatId: row.chat_id,
        notebookId: row.notebook_id,
        summary: kw.summary,
        chunkSimilarityRaw: 0,
        questionSimilarityRaw: 0,
        keywordRaw: clampNonNegative(kw.rank),
        bestQuestionText: null,
      });
    }
  }

  const allCandidates = Array.from(candidates.values());
  if (allCandidates.length === 0) return [];

  // Normalize all score components to same scale before fusion
  const normChunk = minMaxNormalize(allCandidates.map(c => c.chunkSimilarityRaw));
  const normQuestion = minMaxNormalize(allCandidates.map(c => c.questionSimilarityRaw));
  const normKeyword = minMaxNormalize(allCandidates.map(c => c.keywordRaw));

  const scored: HybridResult[] = allCandidates.map((c) => {
    const chunkScore = normChunk(c.chunkSimilarityRaw);
    const questionScore = normQuestion(c.questionSimilarityRaw);
    const keywordScore = normKeyword(c.keywordRaw);

    const combinedScore =
      weights.chunkWeight * chunkScore +
      weights.questionWeight * questionScore +
      weights.keywordWeight * keywordScore;

    const hasChunk = c.chunkSimilarityRaw > 0;
    const hasQuestion = c.questionSimilarityRaw > 0;
    const hasKeyword = c.keywordRaw > 0;

    let matchType: HybridResult["matchType"] = "semantic";
    if (hasKeyword && (hasChunk || hasQuestion)) {
      matchType = "hybrid";
    } else if (hasKeyword) {
      matchType = "keyword";
    } else if (hasQuestion && c.questionSimilarityRaw > c.chunkSimilarityRaw) {
      matchType = "question";
    } else if (hasChunk) {
      matchType = "chunk";
    }

    return {
      documentId: c.documentId,
      fileName: c.fileName,
      chunkText: (c.chunkText || "").slice(0, 500),
      chunkIndex: c.chunkIndex,
      chunkId: c.chunkId,
      similarity: c.chunkSimilarityRaw,
      keywordRank: c.keywordRaw,
      combinedScore,
      matchType,
      page: c.page,
      section: c.section,
      summary: c.summary,
      projectId: c.projectId,
      chatId: c.chatId,
      notebookId: c.notebookId,
      chunkSimilarity: c.chunkSimilarityRaw,
      questionSimilarity: c.questionSimilarityRaw,
      keywordScore: c.keywordRaw,
      finalScore: combinedScore,
      matchedQuestionText: c.bestQuestionText || null,
    };
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  // Filter out weak keyword-only matches (no semantic backing)
  // Keep semantic/hybrid/question/chunk matches, or very strong keyword matches
  const filtered = scored.filter(r => {
    if (r.matchType === 'keyword') {
      // Only keep keyword-only if score is strong (0.3+) or if it's the last resort
      return r.combinedScore >= 0.3;
    }
    // Always keep semantic, hybrid, question, and chunk matches
    return true;
  });

  const docCounts = new Map<string, number>();
  const deduped: HybridResult[] = [];
  for (const r of filtered) {
    const count = docCounts.get(r.documentId) ?? 0;
    if (count >= 2) continue;
    docCounts.set(r.documentId, count + 1);
    deduped.push(r);
    if (deduped.length >= maxResults) break;
  }

  return deduped;
}
