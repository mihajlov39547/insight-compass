// citation-details edge function
// Enriches a CanonicalCitation with backend-stored details (document chunk text,
// document metadata, resource link metadata, transcript chunk text).
// Read-only; uses an RLS-aware user client so existing policies enforce access.

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Traceability = "chunk" | "document" | "resource_link" | "url_only" | "none";

interface EnrichedCitationDetails {
  citation_id: string;
  found: boolean;
  traceability: Traceability;
  source_type: string;
  provider: string | null;
  title: string | null;
  snippet: string | null;
  excerpt: string | null;
  document_id: string | null;
  resource_link_id: string | null;
  chunk_id: string | null;
  chunk_index: number | null;
  page: number | null;
  section: string | null;
  url: string | null;
  external_url: string | null;
  score: number | null;
  relevance: number | null;
  match_type: string | null;
  matched_question_text: string | null;
  timestamp_start: number | null;
  timestamp_end: number | null;
  storage_mode: string | null;
  mime_type: string | null;
  external_modified_at: string | null;
  metadata: Record<string, unknown>;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function baseResult(input: any): EnrichedCitationDetails {
  return {
    citation_id: asStr(input.citation_id) ?? "",
    found: false,
    traceability: "none",
    source_type: asStr(input.source_type) ?? "unknown",
    provider: asStr(input.provider),
    title: asStr(input.title),
    snippet: asStr(input.snippet),
    excerpt: null,
    document_id: asStr(input.document_id),
    resource_link_id: asStr(input.resource_link_id),
    chunk_id: asStr(input.chunk_id),
    chunk_index: asNum(input.chunk_index),
    page: asNum(input.page),
    section: asStr(input.section),
    url: asStr(input.url),
    external_url: asStr(input.external_url),
    score: asNum(input.score),
    relevance: asNum(input.relevance),
    match_type: asStr(input.match_type),
    matched_question_text: asStr(input.matched_question_text),
    timestamp_start: asNum(input.timestamp_start),
    timestamp_end: asNum(input.timestamp_end),
    storage_mode: null,
    mime_type: null,
    external_modified_at: null,
    metadata:
      input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? input.metadata
        : {},
  };
}

function applyDocumentMeta(result: EnrichedCitationDetails, doc: any) {
  if (!doc) return;
  result.document_id = doc.id ?? result.document_id;
  result.title = result.title ?? doc.file_name ?? null;
  result.provider = result.provider ?? doc.provider ?? null;
  result.external_url = result.external_url ?? doc.external_url ?? null;
  result.external_modified_at = doc.external_modified_at ?? null;
  result.storage_mode = doc.storage_mode ?? null;
  result.mime_type = doc.mime_type ?? null;
  if (doc.external_metadata && typeof doc.external_metadata === "object") {
    result.metadata = { ...result.metadata, external_metadata: doc.external_metadata };
  }
}

function applyChunk(result: EnrichedCitationDetails, chunk: any) {
  if (!chunk) return;
  result.chunk_id = chunk.id ?? result.chunk_id;
  result.chunk_index = chunk.chunk_index ?? result.chunk_index;
  result.page = chunk.page ?? result.page;
  result.section = chunk.section ?? result.section;
  result.excerpt = chunk.chunk_text ?? result.excerpt;
  result.document_id = chunk.document_id ?? result.document_id;
  if (chunk.metadata_json && typeof chunk.metadata_json === "object") {
    result.metadata = { ...result.metadata, chunk_metadata: chunk.metadata_json };
  }
}

function applyResourceLink(result: EnrichedCitationDetails, link: any) {
  if (!link) return;
  result.resource_link_id = link.id ?? result.resource_link_id;
  result.title = result.title ?? link.title ?? null;
  result.provider = result.provider ?? link.provider ?? null;
  result.url = result.url ?? link.url ?? null;
  result.external_url = result.external_url ?? link.url ?? null;
  if (link.metadata && typeof link.metadata === "object") {
    result.metadata = { ...result.metadata, resource_metadata: link.metadata };
  }
}

function applyTranscriptChunk(result: EnrichedCitationDetails, chunk: any) {
  if (!chunk) return;
  result.chunk_id = chunk.id ?? result.chunk_id;
  result.chunk_index = chunk.chunk_index ?? result.chunk_index;
  result.excerpt = chunk.chunk_text ?? result.excerpt;
  result.resource_link_id = chunk.resource_link_id ?? result.resource_link_id;
  // NOTE: link_transcript_chunks does not currently have explicit timestamp
  // columns; attempt to read them from metadata_json if present, else null.
  const meta = chunk.metadata_json;
  if (meta && typeof meta === "object") {
    result.timestamp_start =
      result.timestamp_start ??
      asNum((meta as any).timestamp_start) ??
      asNum((meta as any).start) ??
      null;
    result.timestamp_end =
      result.timestamp_end ??
      asNum((meta as any).timestamp_end) ??
      asNum((meta as any).end) ??
      null;
    result.metadata = { ...result.metadata, transcript_metadata: meta };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) return jsonResponse({ error: "Server misconfigured" }, 500);

    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const input = body?.citation ?? body ?? {};
    if (!input || typeof input !== "object") {
      return jsonResponse({ error: "Missing citation payload" }, 400);
    }

    const result = baseResult(input);

    const sourceType = (asStr(input.source_type) ?? "").toLowerCase();
    const isTranscriptHint =
      sourceType === "transcript" ||
      (asStr(input.document_id)?.startsWith("link:") ?? false);

    // 1) Transcript path
    if (isTranscriptHint || (sourceType === "youtube" && result.resource_link_id)) {
      if (result.chunk_id) {
        const { data: tc } = await supabase
          .from("link_transcript_chunks")
          .select("id, resource_link_id, chunk_index, chunk_text, metadata_json")
          .eq("id", result.chunk_id)
          .maybeSingle();
        if (tc) {
          applyTranscriptChunk(result, tc);
          result.traceability = "chunk";
          result.found = true;
        }
      } else if (result.resource_link_id && result.chunk_index !== null) {
        const { data: tc } = await supabase
          .from("link_transcript_chunks")
          .select("id, resource_link_id, chunk_index, chunk_text, metadata_json")
          .eq("resource_link_id", result.resource_link_id)
          .eq("chunk_index", result.chunk_index)
          .maybeSingle();
        if (tc) {
          applyTranscriptChunk(result, tc);
          result.traceability = "chunk";
          result.found = true;
        }
      }

      if (result.resource_link_id) {
        const { data: link } = await supabase
          .from("resource_links")
          .select("id, title, url, provider, source_type, resource_type, metadata")
          .eq("id", result.resource_link_id)
          .maybeSingle();
        if (link) {
          applyResourceLink(result, link);
          if (!result.found) {
            result.traceability = "resource_link";
            result.found = true;
          }
        }
      }
    }

    // 2) Document chunk path
    if (!result.found && (result.chunk_id || result.document_id)) {
      let chunk: any = null;
      if (result.chunk_id) {
        const { data } = await supabase
          .from("document_chunks")
          .select("id, document_id, chunk_index, chunk_text, page, section, metadata_json")
          .eq("id", result.chunk_id)
          .maybeSingle();
        chunk = data;
      } else if (result.document_id && result.chunk_index !== null) {
        const { data } = await supabase
          .from("document_chunks")
          .select("id, document_id, chunk_index, chunk_text, page, section, metadata_json")
          .eq("document_id", result.document_id)
          .eq("chunk_index", result.chunk_index)
          .maybeSingle();
        chunk = data;
      }

      if (chunk) {
        applyChunk(result, chunk);
        const { data: doc } = await supabase
          .from("documents")
          .select(
            "id, file_name, provider, external_url, external_modified_at, external_metadata, storage_mode, mime_type",
          )
          .eq("id", chunk.document_id)
          .maybeSingle();
        applyDocumentMeta(result, doc);
        result.traceability = "chunk";
        result.found = true;
      } else if (result.document_id) {
        const { data: doc } = await supabase
          .from("documents")
          .select(
            "id, file_name, provider, external_url, external_modified_at, external_metadata, storage_mode, mime_type",
          )
          .eq("id", result.document_id)
          .maybeSingle();
        if (doc) {
          applyDocumentMeta(result, doc);
          result.traceability = "document";
          result.found = true;
        }
      }
    }

    // 3) Resource link path (non-transcript)
    if (!result.found && result.resource_link_id) {
      const { data: link } = await supabase
        .from("resource_links")
        .select("id, title, url, provider, source_type, resource_type, metadata")
        .eq("id", result.resource_link_id)
        .maybeSingle();
      if (link) {
        applyResourceLink(result, link);
        result.traceability = "resource_link";
        result.found = true;
      }
    }

    // 4) URL-only best-effort lookup
    if (!result.found && result.url) {
      const { data: link } = await supabase
        .from("resource_links")
        .select("id, title, url, provider, source_type, resource_type, metadata")
        .eq("url", result.url)
        .maybeSingle();
      if (link) {
        applyResourceLink(result, link);
        result.traceability = "resource_link";
        result.found = true;
      } else {
        result.traceability = "url_only";
        result.found = true;
      }
    }

    return jsonResponse(result, 200);
  } catch (_err) {
    // Never leak stack traces; surface a sanitized response.
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
