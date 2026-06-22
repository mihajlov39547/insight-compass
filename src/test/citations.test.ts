import { describe, it, expect } from "vitest";
import {
  normalizeCitationsFromMessageSources,
  normalizeSourceItemToCitation,
} from "@/lib/citations";

describe("normalizeCitationsFromMessageSources", () => {
  it("normalizes Project combinedSources with a document item", () => {
    const sources = {
      combinedSources: [
        {
          id: "doc-1",
          type: "document",
          title: "Spec.pdf",
          snippet: "Important paragraph",
          documentId: "doc-1",
          chunkId: "chunk-7",
          chunkIndex: 7,
          page: 3,
          section: "2.1",
          score: 0.82,
          relevance: 0.91,
          matchType: "semantic",
          matchedQuestionText: "What is X?",
        },
      ],
    };
    const out = normalizeCitationsFromMessageSources(sources, { context: "project" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source_type: "document",
      document_id: "doc-1",
      chunk_id: "chunk-7",
      chunk_index: 7,
      page: 3,
      section: "2.1",
      score: 0.82,
      relevance: 0.91,
      match_type: "semantic",
      matched_question_text: "What is X?",
    });
  });

  it("normalizes Notebook items with a document item", () => {
    const sources = {
      items: [
        { id: "n-1", documentId: "d-2", chunkId: "c-1", title: "Notes", snippet: "hello" },
      ],
    };
    const out = normalizeCitationsFromMessageSources(sources, { context: "notebook" });
    expect(out[0].source_type).toBe("document");
    expect(out[0].document_id).toBe("d-2");
  });

  it("normalizes a Tavily web item with url and score", () => {
    const sources = {
      webSources: [{ id: "w-1", type: "web", title: "Article", url: "https://ex.com", score: 0.7 }],
    };
    const out = normalizeCitationsFromMessageSources(sources);
    expect(out[0].source_type).toBe("web");
    expect(out[0].url).toBe("https://ex.com");
    expect(out[0].score).toBe(0.7);
  });

  it("normalizes a crawl follow-up with augmentationMode crawl", () => {
    const sources = {
      augmentationMode: "crawl",
      items: [{ id: "crawl-1", url: "https://site.com/page", title: "Page" }],
    };
    const out = normalizeCitationsFromMessageSources(sources);
    expect(out[0].source_type).toBe("crawl");
    expect(out[0].url).toBe("https://site.com/page");
  });

  it("normalizes a YouTube item with videoId", () => {
    const sources = {
      youtubeSources: [
        { id: "yt-1", title: "Vid", url: "https://youtu.be/abc", videoId: "abc" },
      ],
    };
    const out = normalizeCitationsFromMessageSources(sources);
    expect(out[0].source_type).toBe("youtube");
    expect(out[0].metadata.videoId).toBe("abc");
  });

  it("normalizes a Google Drive/Docs-like document item without provider", () => {
    const sources = {
      combinedSources: [
        { id: "g-1", documentId: "gdoc-xyz", chunkId: "ch-0", chunkIndex: 0, title: "Plan.docx" },
      ],
    };
    const out = normalizeCitationsFromMessageSources(sources);
    expect(out[0].source_type).toBe("document");
    expect(out[0].provider).toBeNull();
    expect(out[0].document_id).toBe("gdoc-xyz");
  });

  it("dedupes citations by id and url", () => {
    const sources = {
      documentSources: [{ id: "d-1", documentId: "d-1", title: "A" }],
      webSources: [{ id: "d-1", url: "https://ex.com", title: "Dup" }],
      webSearchResponse: { results: [{ id: "w-2", url: "https://ex.com", title: "Same URL" }] },
    };
    const out = normalizeCitationsFromMessageSources(sources);
    // Two unique: id d-1 and url https://ex.com
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns [] for null/garbage input", () => {
    expect(normalizeCitationsFromMessageSources(null)).toEqual([]);
    expect(normalizeCitationsFromMessageSources(undefined)).toEqual([]);
    expect(normalizeCitationsFromMessageSources("nope")).toEqual([]);
  });

  it("handles malformed numerics defensively", () => {
    const c = normalizeSourceItemToCitation({
      id: "x",
      page: "not-a-number",
      score: "0.5",
      chunkIndex: null,
    });
    expect(c?.page).toBeNull();
    expect(c?.score).toBe(0.5);
    expect(c?.chunk_index).toBeNull();
  });
});
