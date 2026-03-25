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
  similarity: number;
  keywordRank: number;
  combinedScore: number;
  matchType: "semantic" | "keyword" | "hybrid";
  page: number | null;
  section: string | null;
  summary: string | null;
  projectId: string | null;
  chatId: string | null;
  notebookId: string | null;
}

// ─── Local hash-based embedding (must match process-document) ──────────

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

    const keywordPromise = runKeywordSearch(adminClient, user.id, query, scope, projectId, notebookId);
    const semanticPromise = LOVABLE_API_KEY
      ? runSemanticSearch(adminClient, userClient, query, LOVABLE_API_KEY, scope, projectId, notebookId, chatId)
      : Promise.resolve([]);

    const [keywordResults, semanticResults] = await Promise.all([keywordPromise, semanticPromise]);

    const combined = mergeResults(keywordResults, semanticResults, maxResults);

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
  client: any, userId: string, query: string,
  scope: string, projectId?: string, notebookId?: string
): Promise<KeywordHit[]> {
  try {
    let docQuery = client
      .from("documents")
      .select("id, file_name, summary, project_id, chat_id, notebook_id, processing_status")
      .eq("user_id", userId)
      .eq("processing_status", "completed");

    if (scope === "project" && projectId) {
      docQuery = docQuery.eq("project_id", projectId);
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

interface SemanticHit {
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

async function runSemanticSearch(
  adminClient: any, userClient: any, query: string, apiKey: string,
  scope: string, projectId?: string, notebookId?: string, chatId?: string
): Promise<SemanticHit[]> {
  try {
    const embedding = await generateQueryEmbedding(query, apiKey);
    if (!embedding) return [];

    const rpcParams: any = {
      query_embedding: JSON.stringify(embedding),
      match_count: 15,
      similarity_threshold: 0.15,
    };

    if (scope === "project" && projectId) {
      rpcParams.filter_project_id = projectId;
    }
    if (scope === "notebook" && notebookId) {
      rpcParams.filter_notebook_id = notebookId;
    }
    if (chatId) {
      rpcParams.filter_chat_id = chatId;
    }

    const { data, error } = await userClient.rpc("search_document_chunks", rpcParams);

    if (error) {
      console.warn("Semantic search RPC error:", error);
      return [];
    }

    return (data ?? []).map((r: any) => ({
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
    console.warn("Semantic search failed:", e);
    return [];
  }
}

function mergeResults(
  keywordHits: KeywordHit[],
  semanticHits: SemanticHit[],
  maxResults: number
): HybridResult[] {
  const resultMap = new Map<string, HybridResult>();

  for (const hit of semanticHits) {
    const key = `${hit.documentId}:${hit.chunkIndex}`;
    resultMap.set(key, {
      documentId: hit.documentId,
      fileName: hit.fileName,
      chunkText: hit.chunkText.slice(0, 500),
      chunkIndex: hit.chunkIndex,
      similarity: hit.similarity,
      keywordRank: 0,
      combinedScore: hit.similarity * 0.6,
      matchType: "semantic",
      page: hit.page,
      section: hit.section,
      summary: null,
      projectId: hit.projectId,
      chatId: hit.chatId,
      notebookId: hit.notebookId,
    });
  }

  for (const hit of keywordHits) {
    let boosted = false;
    for (const [key, existing] of resultMap.entries()) {
      if (existing.documentId === hit.documentId) {
        existing.keywordRank = hit.rank;
        existing.combinedScore = existing.similarity * 0.6 + hit.rank * 0.4;
        existing.matchType = "hybrid";
        existing.summary = hit.summary;
        boosted = true;
      }
    }

    if (!boosted) {
      const key = `kw:${hit.documentId}`;
      resultMap.set(key, {
        documentId: hit.documentId,
        fileName: hit.fileName,
        chunkText: hit.snippet || hit.summary || "",
        chunkIndex: -1,
        similarity: 0,
        keywordRank: hit.rank,
        combinedScore: hit.rank * 0.4,
        matchType: "keyword",
        page: null,
        section: null,
        summary: hit.summary,
        projectId: hit.projectId,
        chatId: hit.chatId,
        notebookId: hit.notebookId,
      });
    }
  }

  const results = Array.from(resultMap.values());
  results.sort((a, b) => b.combinedScore - a.combinedScore);

  const docCounts = new Map<string, number>();
  const deduped: HybridResult[] = [];
  for (const r of results) {
    const count = docCounts.get(r.documentId) ?? 0;
    if (count >= 2) continue;
    docCounts.set(r.documentId, count + 1);
    deduped.push(r);
    if (deduped.length >= maxResults) break;
  }

  return deduped;
}
