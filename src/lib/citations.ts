/**
 * Canonical citation normalization.
 *
 * This module provides a single, stable shape (`CanonicalCitation`) for
 * citation/source data that today lives under `message.sources` in many
 * different formats across Project Chat and Notebook Chat.
 *
 * IMPORTANT: This utility is additive only. It does NOT mutate, replace,
 * or persist any existing source payload. Existing UI (SourceAttribution,
 * extract, crawl, YouTube flows, etc.) keeps consuming the raw payload
 * exactly as before. Future components (e.g. a Citation Inspector) can
 * read the canonical shape produced here without each component having
 * to know about every payload variant.
 */

export type CanonicalSourceType =
  | "document"
  | "web"
  | "youtube"
  | "transcript"
  | "crawl"
  | "unknown";

export interface CanonicalCitation {
  citation_id: string;
  source_type: CanonicalSourceType;

  title: string;
  snippet: string | null;
  url: string | null;

  document_id: string | null;
  resource_link_id: string | null;
  chunk_id: string | null;
  chunk_index: number | null;

  page: number | null;
  section: string | null;

  score: number | null;
  relevance: number | null;

  match_type: string | null;
  matched_question_text: string | null;

  provider: string | null;
  external_url: string | null;

  timestamp_start: number | null;
  timestamp_end: number | null;

  metadata: Record<string, unknown>;
  raw: unknown;
}

export interface NormalizeOptions {
  messageId?: string;
  context?: "project" | "notebook";
}

export interface NormalizeItemOptions extends NormalizeOptions {
  index?: number;
  fallbackSourceType?: CanonicalSourceType;
  parentPayload?: unknown;
}

// ---------- internal helpers ----------

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = asString(v);
    if (s !== null) return s;
  }
  return null;
}

function firstNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = asNumber(v);
    if (n !== null) return n;
  }
  return null;
}

const KNOWN_KEYS = new Set([
  "id",
  "type",
  "title",
  "fileName",
  "snippet",
  "content",
  "excerpt",
  "summary",
  "description",
  "url",
  "documentId",
  "document_id",
  "resourceLinkId",
  "resource_link_id",
  "chunkId",
  "chunk_id",
  "chunkIndex",
  "chunk_index",
  "page",
  "section",
  "score",
  "relevance",
  "matchType",
  "match_type",
  "matchedQuestionText",
  "matched_question_text",
  "provider",
  "external_url",
  "externalUrl",
  "favicon",
  "timestamp_start",
  "timestampStart",
  "start",
  "startTime",
  "timestamp_end",
  "timestampEnd",
  "end",
  "endTime",
]);

function collectMetadata(item: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (KNOWN_KEYS.has(k)) continue;
    meta[k] = v;
  }
  return meta;
}

function inferSourceType(
  item: Record<string, unknown>,
  parentPayload: unknown,
  fallback: CanonicalSourceType,
  documentId: string | null,
  chunkId: string | null,
  url: string | null,
): CanonicalSourceType {
  const rawType = asString(item.type)?.toLowerCase() ?? null;
  if (rawType === "youtube") return "youtube";
  if (rawType === "web") return "web";
  if (rawType === "document") return "document";
  if (rawType === "transcript") return "transcript";
  if (rawType === "crawl") return "crawl";

  if (asString(item.videoId) || asString(item.video_id)) return "youtube";

  const id = asString(item.id);
  if (id && id.startsWith("crawl-")) return "crawl";
  if (isObj(parentPayload) && asString((parentPayload as Record<string, unknown>).augmentationMode) === "crawl") {
    return "crawl";
  }

  if (documentId && documentId.startsWith("link:")) return "transcript";
  if (documentId || chunkId) return "document";
  if (url) return "web";

  return fallback;
}

function buildCitationId(
  item: Record<string, unknown>,
  documentId: string | null,
  chunkId: string | null,
  chunkIndex: number | null,
  url: string | null,
  messageId: string | undefined,
  index: number | undefined,
): string {
  const id = asString(item.id);
  if (id) return id;
  if (chunkId) return chunkId;
  if (documentId && chunkIndex !== null) return `${documentId}#${chunkIndex}`;
  if (documentId) return documentId;
  if (url) return url;
  return `${messageId ?? "message"}-${index ?? 0}`;
}

// ---------- public API ----------

export function normalizeSourceItemToCitation(
  item: unknown,
  options: NormalizeItemOptions = {},
): CanonicalCitation | null {
  if (!isObj(item)) return null;

  const {
    messageId,
    index,
    fallbackSourceType = "unknown",
    parentPayload,
  } = options;

  const title =
    firstString(item.title, item.fileName, item.url) ??
    `Source ${typeof index === "number" ? index + 1 : ""}`.trim();

  const snippet = firstString(item.snippet, item.content, item.excerpt, item.summary, item.description);
  const url = firstString(item.url, item.external_url, item.externalUrl);

  const documentId = firstString(item.documentId, item.document_id);
  const resourceLinkId = firstString(item.resourceLinkId, item.resource_link_id);
  const chunkId = firstString(item.chunkId, item.chunk_id);
  const chunkIndex = firstNumber(item.chunkIndex, item.chunk_index);

  const page = firstNumber(item.page);
  const section = firstString(item.section);

  const score = firstNumber(item.score);
  const relevance = firstNumber(item.relevance);

  const matchType = firstString(item.matchType, item.match_type);
  const matchedQuestionText = firstString(item.matchedQuestionText, item.matched_question_text);

  const provider = firstString(item.provider);
  const externalUrl = firstString(item.external_url, item.externalUrl);

  const timestampStart = firstNumber(item.timestamp_start, item.timestampStart, item.start, item.startTime);
  const timestampEnd = firstNumber(item.timestamp_end, item.timestampEnd, item.end, item.endTime);

  const sourceType = inferSourceType(item, parentPayload, fallbackSourceType, documentId, chunkId, url);

  const metadata = collectMetadata(item);

  const citationId = buildCitationId(item, documentId, chunkId, chunkIndex, url, messageId, index);

  return {
    citation_id: citationId,
    source_type: sourceType,
    title,
    snippet,
    url,
    document_id: documentId,
    resource_link_id: resourceLinkId,
    chunk_id: chunkId,
    chunk_index: chunkIndex,
    page,
    section,
    score,
    relevance,
    match_type: matchType,
    matched_question_text: matchedQuestionText,
    provider,
    external_url: externalUrl,
    timestamp_start: timestampStart,
    timestamp_end: timestampEnd,
    metadata,
    raw: item,
  };
}

function pushUnique(
  out: CanonicalCitation[],
  seen: Set<string>,
  citation: CanonicalCitation | null,
): void {
  if (!citation) return;
  // Dedupe by citation_id, then by URL when present.
  const key = citation.citation_id || citation.url || "";
  if (key && seen.has(key)) return;
  if (citation.url && seen.has(`url:${citation.url}`)) return;
  if (key) seen.add(key);
  if (citation.url) seen.add(`url:${citation.url}`);
  out.push(citation);
}

function normalizeArray(
  arr: unknown,
  options: NormalizeItemOptions,
  out: CanonicalCitation[],
  seen: Set<string>,
): void {
  if (!Array.isArray(arr)) return;
  arr.forEach((item, i) => {
    const c = normalizeSourceItemToCitation(item, {
      ...options,
      index: i,
    });
    pushUnique(out, seen, c);
  });
}

export function normalizeCitationsFromMessageSources(
  sources: unknown,
  options: NormalizeOptions = {},
): CanonicalCitation[] {
  const out: CanonicalCitation[] = [];
  const seen = new Set<string>();

  if (!sources) return out;

  // Plain array payload (legacy shape).
  if (Array.isArray(sources)) {
    normalizeArray(sources, { ...options, parentPayload: sources }, out, seen);
    return out;
  }

  if (!isObj(sources)) return out;

  const parent = sources;
  const baseOpts: NormalizeItemOptions = { ...options, parentPayload: parent };

  const combined = parent.combinedSources;
  const items = parent.items;
  const documentSources = parent.documentSources;
  const webSources = parent.webSources;
  const youtubeSources = parent.youtubeSources;
  const webSearchResponse = parent.webSearchResponse;
  const crawl = parent.crawl;

  // 1. combinedSources first.
  if (Array.isArray(combined) && combined.length > 0) {
    normalizeArray(combined, baseOpts, out, seen);
  } else if (Array.isArray(items) && items.length > 0) {
    // 2. else items (notebook / extract / crawl follow-up)
    const isCrawl = asString(parent.augmentationMode) === "crawl";
    normalizeArray(
      items,
      { ...baseOpts, fallbackSourceType: isCrawl ? "crawl" : "unknown" },
      out,
      seen,
    );
  } else {
    // 3. else merge document/web/youtube buckets.
    if (Array.isArray(documentSources)) {
      normalizeArray(documentSources, { ...baseOpts, fallbackSourceType: "document" }, out, seen);
    }
    if (Array.isArray(webSources)) {
      normalizeArray(webSources, { ...baseOpts, fallbackSourceType: "web" }, out, seen);
    }
    if (Array.isArray(youtubeSources)) {
      normalizeArray(youtubeSources, { ...baseOpts, fallbackSourceType: "youtube" }, out, seen);
    }
  }

  // 4. webSearchResponse.results — only add what isn't already represented.
  if (isObj(webSearchResponse)) {
    const results = (webSearchResponse as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      normalizeArray(results, { ...baseOpts, fallbackSourceType: "web" }, out, seen);
    }
  }

  // 5. crawl.results, optional, deduped.
  if (isObj(crawl)) {
    const results = (crawl as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      normalizeArray(results, { ...baseOpts, fallbackSourceType: "crawl" }, out, seen);
    }
  }

  return out;
}
