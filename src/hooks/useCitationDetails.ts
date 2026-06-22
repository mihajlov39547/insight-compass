import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CanonicalCitation, CanonicalSourceType } from "@/lib/citations";

export interface EnrichedCitationDetails {
  citation_id: string;
  found: boolean;
  traceability: "chunk" | "document" | "resource_link" | "url_only" | "none";

  source_type: CanonicalSourceType | string;
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

/**
 * Build a minimal payload for the citation-details edge function.
 * Avoids sending bulky `raw` payloads from `CanonicalCitation`.
 */
export function buildCitationDetailsPayload(c: CanonicalCitation) {
  const metaSize = (() => {
    try {
      return JSON.stringify(c.metadata ?? {}).length;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  })();

  return {
    citation_id: c.citation_id,
    source_type: c.source_type,
    title: c.title,
    snippet: c.snippet,
    url: c.url,
    document_id: c.document_id,
    resource_link_id: c.resource_link_id,
    chunk_id: c.chunk_id,
    chunk_index: c.chunk_index,
    page: c.page,
    section: c.section,
    score: c.score,
    relevance: c.relevance,
    match_type: c.match_type,
    matched_question_text: c.matched_question_text,
    provider: c.provider,
    external_url: c.external_url,
    timestamp_start: c.timestamp_start,
    timestamp_end: c.timestamp_end,
    // Only include metadata when it's reasonably small (<4KB).
    metadata: metaSize <= 4096 ? c.metadata : {},
  };
}

export function citationDetailsQueryKey(c: CanonicalCitation | null) {
  if (!c) return ["citation-details", null] as const;
  return [
    "citation-details",
    c.citation_id,
    c.source_type,
    c.chunk_id,
    c.document_id,
    c.resource_link_id,
    c.chunk_index,
    c.url,
  ] as const;
}

export function useCitationDetails(citation: CanonicalCitation | null) {
  return useQuery<EnrichedCitationDetails>({
    queryKey: citationDetailsQueryKey(citation),
    enabled: !!citation,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!citation) throw new Error("No citation provided");
      const { data, error } = await supabase.functions.invoke("citation-details", {
        body: buildCitationDetailsPayload(citation),
      });
      if (error) throw error;
      return data as EnrichedCitationDetails;
    },
  });
}
