/**
 * Build a structured Google Docs document model from a chat export.
 *
 * The model is a plain-text document plus arrays of styling ranges. The
 * edge function inserts the plain text into a freshly created Google Doc
 * (via reverse-chunk-at-index-1) and then translates these ranges into
 * `batchUpdate` style requests. Indexes are zero-based offsets into
 * `plainText`; the backend shifts them by +1 to map to Google Docs
 * indexes (the body starts at index 1).
 *
 * Intentional v1 scope: clean structured text + heading styles + bold
 * source titles + clickable links + italic timestamps. Full Markdown
 * conversion (tables, nested lists, images) is out of scope — we strip
 * the most common Markdown markers from assistant content so they do
 * not appear as raw syntax in the Doc.
 */

import {
  normalizeCitationsFromMessageSources,
  type CanonicalCitation,
} from "@/lib/citations";
import type { BuildExportArgs, ChatMessageLike, ChatExportOptions } from "@/lib/chatExport";

export type GDocTextStyleKind = "bold" | "italic" | "code" | "link" | "muted";

export interface GDocTextStyleRange {
  start: number;
  end: number;
  kind: GDocTextStyleKind;
  url?: string;
}

export type GDocNamedStyle =
  | "TITLE"
  | "HEADING_1"
  | "HEADING_2"
  | "HEADING_3"
  | "NORMAL_TEXT";

export interface GDocParagraphStyleRange {
  start: number;
  end: number;
  namedStyleType: GDocNamedStyle;
}

export interface GDocBulletRange {
  start: number;
  end: number;
}

export interface GDocModel {
  version: 1;
  plainText: string;
  textStyles: GDocTextStyleRange[];
  paragraphStyles: GDocParagraphStyleRange[];
  bullets: GDocBulletRange[];
}

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  muted?: boolean;
  link?: string;
}

const MAX_INLINE_LEN = 2000;

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function trimSnippet(s: string | null | undefined, full: boolean, max = 480): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  if (full) return t;
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
}

function sourceTypeLabel(t: CanonicalCitation["source_type"]): string {
  switch (t) {
    case "document": return "Document";
    case "web": return "Web";
    case "youtube": return "YouTube";
    case "transcript": return "Transcript";
    case "crawl": return "Crawl";
    default: return "Source";
  }
}

/**
 * Parse a single line of Markdown-ish text into styled segments.
 * Strips **bold**, *italic*, `code`, and [label](url) markers.
 */
function parseInline(line: string): Segment[] {
  if (!line) return [{ text: "" }];
  const segments: Segment[] = [];
  const re =
    /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:|mailto:)[^)\s]+\)|\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) {
      segments.push({ text: tok.slice(2, -2), bold: true });
    } else if (tok.startsWith("`")) {
      segments.push({ text: tok.slice(1, -1), code: true });
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\((.+)\)$/.exec(tok);
      if (lm) segments.push({ text: lm[1], link: lm[2] });
      else segments.push({ text: tok });
    } else {
      segments.push({ text: tok.slice(1, -1), italic: true });
    }
    last = m.index + tok.length;
  }
  if (last < line.length) segments.push({ text: line.slice(last) });
  return segments.length ? segments : [{ text: line }];
}

class DocBuilder {
  text = "";
  textStyles: GDocTextStyleRange[] = [];
  paragraphStyles: GDocParagraphStyleRange[] = [];
  bullets: GDocBulletRange[] = [];

  /** Append a paragraph composed of segments. Always ends with "\n". */
  para(
    segments: Segment[],
    opts: { style?: GDocNamedStyle; bullet?: boolean } = {},
  ): void {
    const paraStart = this.text.length;
    for (const seg of segments) {
      const segStart = this.text.length;
      // Soft cap to avoid runaway lines.
      const t = seg.text.length > MAX_INLINE_LEN
        ? seg.text.slice(0, MAX_INLINE_LEN) + "…"
        : seg.text;
      this.text += t;
      const segEnd = this.text.length;
      if (segEnd === segStart) continue;
      if (seg.bold) this.textStyles.push({ start: segStart, end: segEnd, kind: "bold" });
      if (seg.italic) this.textStyles.push({ start: segStart, end: segEnd, kind: "italic" });
      if (seg.code) this.textStyles.push({ start: segStart, end: segEnd, kind: "code" });
      if (seg.muted) this.textStyles.push({ start: segStart, end: segEnd, kind: "muted" });
      if (seg.link) {
        this.textStyles.push({ start: segStart, end: segEnd, kind: "link", url: seg.link });
      }
    }
    this.text += "\n";
    const paraEnd = this.text.length;
    if (opts.style && opts.style !== "NORMAL_TEXT") {
      this.paragraphStyles.push({ start: paraStart, end: paraEnd, namedStyleType: opts.style });
    }
    if (opts.bullet) {
      this.bullets.push({ start: paraStart, end: paraEnd });
    }
  }

  heading(text: string, level: 1 | 2 | 3): void {
    this.para([{ text }], {
      style: level === 1 ? "HEADING_1" : level === 2 ? "HEADING_2" : "HEADING_3",
    });
  }

  title(text: string): void {
    this.para([{ text }], { style: "TITLE" });
  }

  line(text: string): void {
    this.para(parseInline(text));
  }

  muted(text: string): void {
    this.para([{ text, italic: true, muted: true }]);
  }

  bullet(segments: Segment[]): void {
    this.para(segments, { bullet: true });
  }

  blank(): void {
    this.text += "\n";
  }

  build(): GDocModel {
    return {
      version: 1,
      plainText: this.text,
      textStyles: this.textStyles,
      paragraphStyles: this.paragraphStyles,
      bullets: this.bullets,
    };
  }
}

function pushAssistantContent(builder: DocBuilder, content: string): void {
  if (!content) return;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Fenced code blocks → keep as plain monospaced-styled lines.
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      builder.para([{ text: raw, code: true }]);
      continue;
    }

    if (/^\s*$/.test(raw)) {
      builder.blank();
      continue;
    }

    // Headings inside assistant content → demote to bold paragraphs so we
    // don't fight the document's own heading hierarchy.
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      builder.para([{ text: h[2].trim(), bold: true }]);
      continue;
    }

    // Horizontal rule → blank line.
    if (/^\s*-{3,}\s*$/.test(raw)) {
      builder.blank();
      continue;
    }

    // Blockquote.
    const bq = /^\s*>\s?(.*)$/.exec(raw);
    if (bq) {
      const segs = parseInline(bq[1]);
      segs.forEach(s => { s.italic = true; s.muted = true; });
      builder.para(segs);
      continue;
    }

    // Unordered list item.
    const ul = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (ul) {
      builder.bullet(parseInline(ul[1]));
      continue;
    }

    // Ordered list item (treat as bullet — Docs preset will render markers).
    const ol = /^\s*\d+\.\s+(.*)$/.exec(raw);
    if (ol) {
      builder.bullet(parseInline(ol[1]));
      continue;
    }

    // Table row: keep as plain line, strip pipes lightly so they're readable.
    if (/^\s*\|/.test(raw) && /\|\s*$/.test(raw)) {
      // Skip Markdown table separator rows like | --- | --- |.
      if (/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}\s*$/.test(raw)) continue;
      const cells = raw
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map(c => c.trim());
      builder.para(parseInline(cells.join("  •  ")));
      continue;
    }

    builder.line(raw);
  }
}

function pushRetrievalMetadata(
  builder: DocBuilder,
  sources: unknown,
  citations: CanonicalCitation[],
  answerIndex: number,
): boolean {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return false;
  const s = sources as Record<string, unknown>;
  const items: Segment[][] = [];

  const augmentationMode = safeStr(s.augmentationMode);
  if (augmentationMode) items.push([{ text: "Mode: ", bold: true }, { text: augmentationMode }]);

  const wsr = s.webSearchResponse as Record<string, unknown> | undefined;
  if (wsr && typeof wsr === "object") {
    const provider = safeStr(wsr.provider) || safeStr(s.webSearchProvider);
    const query = safeStr(wsr.query);
    const results = Array.isArray(wsr.results) ? wsr.results.length : 0;
    if (provider) items.push([{ text: "Web provider: ", bold: true }, { text: provider }]);
    if (query) items.push([{ text: "Web query: ", bold: true }, { text: query }]);
    if (results) items.push([{ text: "Web results: ", bold: true }, { text: String(results) }]);
  } else if (safeStr(s.webSearchProvider)) {
    items.push([{ text: "Web provider: ", bold: true }, { text: safeStr(s.webSearchProvider) }]);
  }

  if (safeStr(s.youtubeProvider)) items.push([{ text: "YouTube provider: ", bold: true }, { text: safeStr(s.youtubeProvider) }]);
  if (safeStr(s.youtubeQuery)) items.push([{ text: "YouTube query: ", bold: true }, { text: safeStr(s.youtubeQuery) }]);

  const crawl = s.crawl as Record<string, unknown> | undefined;
  if (crawl && typeof crawl === "object") {
    if (safeStr(crawl.rootUrl)) items.push([{ text: "Crawl root: ", bold: true }, { text: safeStr(crawl.rootUrl) }]);
    const pageCount = Array.isArray(crawl.results)
      ? crawl.results.length
      : (typeof crawl.pageCount === "number" ? crawl.pageCount : null);
    if (pageCount !== null) items.push([{ text: "Crawl pages: ", bold: true }, { text: String(pageCount) }]);
  }

  if (citations.length) {
    const byType = citations.reduce<Record<string, number>>((acc, c) => {
      acc[c.source_type] = (acc[c.source_type] ?? 0) + 1;
      return acc;
    }, {});
    items.push([
      { text: "Citation summary: ", bold: true },
      { text: Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", ") },
    ]);
  }

  if (!items.length) return false;
  builder.heading(`Retrieval metadata for A${answerIndex}`, 3);
  items.forEach(seg => builder.bullet(seg));
  builder.blank();
  return true;
}

function pushSources(
  builder: DocBuilder,
  citations: CanonicalCitation[],
  opts: ChatExportOptions,
  answerIndex: number,
): void {
  if (!opts.includeSources || citations.length === 0) return;
  builder.heading(`Sources for A${answerIndex}`, 3);
  citations.forEach((c, i) => {
    const url = c.url ?? c.external_url ?? undefined;
    const safeUrl = url && /^(https?:|mailto:)/i.test(url) ? url : undefined;
    const titleText = `${i + 1}. ${c.title || "Untitled source"}`;
    builder.para(
      safeUrl
        ? [{ text: titleText, bold: true, link: safeUrl }]
        : [{ text: titleText, bold: true }],
    );

    const metaSegs: Segment[] = [
      { text: "Type: ", bold: true },
      { text: `${sourceTypeLabel(c.source_type)}${c.provider ? ` (${c.provider})` : ""}` },
    ];
    builder.bullet(metaSegs);
    if (safeUrl) {
      builder.bullet([{ text: "Link: ", bold: true }, { text: safeUrl, link: safeUrl }]);
    }
    if (c.page !== null) builder.bullet([{ text: "Page: ", bold: true }, { text: String(c.page) }]);
    if (c.section) builder.bullet([{ text: "Section: ", bold: true }, { text: c.section }]);
    if (c.timestamp_start !== null) {
      const range = c.timestamp_end !== null
        ? `${c.timestamp_start}–${c.timestamp_end}s`
        : `${c.timestamp_start}s`;
      builder.bullet([{ text: "Timestamp: ", bold: true }, { text: range }]);
    }
    if (c.relevance !== null || c.score !== null) {
      const r = (c.relevance ?? c.score!) as number;
      const pct = r <= 1 ? `${Math.round(r * 100)}%` : `${Math.round(r)}`;
      builder.bullet([{ text: "Relevance: ", bold: true }, { text: pct }]);
    }
    if (c.match_type) {
      builder.bullet([{ text: "Traceability: ", bold: true }, { text: c.match_type }]);
    }
    if (opts.includeTechnicalIds) {
      if (c.document_id) builder.bullet([{ text: "document_id: ", bold: true }, { text: c.document_id, code: true }]);
      if (c.chunk_id) builder.bullet([{ text: "chunk_id: ", bold: true }, { text: c.chunk_id, code: true }]);
      if (c.chunk_index !== null) builder.bullet([{ text: "chunk_index: ", bold: true }, { text: String(c.chunk_index), code: true }]);
      if (c.resource_link_id) builder.bullet([{ text: "resource_link_id: ", bold: true }, { text: c.resource_link_id, code: true }]);
    }
    if (opts.includeSourceSnippets && c.snippet) {
      builder.muted(trimSnippet(c.snippet, !!opts.includeFullCitationExcerpts));
    }
    builder.blank();
  });
}

function pinnedSummary(
  builder: DocBuilder,
  messages: ChatMessageLike[],
  pinnedIds: string[],
): void {
  builder.heading("Pinned messages", 1);
  pinnedIds.forEach(id => {
    const m = messages.find(mm => mm.id === id);
    if (!m) return;
    builder.bullet([
      { text: m.role === "user" ? "Question: " : "Answer: ", bold: true },
      { text: trimSnippet(m.content, false) },
    ]);
  });
  builder.blank();
}

export function buildChatGoogleDocModel(args: BuildExportArgs): GDocModel {
  const { appName, contextType, contextName, chatTitle, exportedByLabel, messages, options } = args;
  const exportedAt = new Date().toLocaleString();
  const assistantMessages = messages.filter(m => m.role === "assistant");
  const allCitations = assistantMessages.flatMap(m =>
    normalizeCitationsFromMessageSources(m.sources, { messageId: m.id }),
  );

  const b = new DocBuilder();

  // Title + intro.
  b.title(`${appName} Research Export`);
  b.muted(
    `This export was generated from ${appName}. It contains the selected chat conversation, assistant responses, and source metadata available at export time.`,
  );
  b.blank();

  // Export details.
  b.heading("Export details", 1);
  const pushMeta = (k: string, v: string) => {
    if (!v) return;
    b.bullet([{ text: `${k}: `, bold: true }, { text: v }]);
  };
  pushMeta("Exported at", exportedAt);
  pushMeta("App", appName);
  pushMeta(contextType === "project" ? "Project" : "Notebook", contextName);
  if (chatTitle) pushMeta("Chat title", chatTitle);
  if (exportedByLabel) pushMeta("Exported by", exportedByLabel);
  pushMeta("Message count", String(messages.length));
  pushMeta("Source count", String(allCitations.length));
  b.blank();

  // Pinned summary.
  if (options.includePinnedSummary && args.pinnedMessageIds && args.pinnedMessageIds.length > 0) {
    pinnedSummary(b, messages, args.pinnedMessageIds);
  }

  // Conversation.
  b.heading("Conversation", 1);
  let qIndex = 0;
  let aIndex = 0;
  messages.forEach(m => {
    const stamp = fmtDate(m.created_at);
    if (m.role === "user") {
      qIndex += 1;
      b.heading(`Q${qIndex} — User`, 2);
      if (stamp) b.muted(stamp);
      pushAssistantContent(b, m.content || "");
      b.blank();
    } else if (m.role === "assistant") {
      aIndex += 1;
      b.heading(`A${aIndex} — Assistant`, 2);
      if (stamp) {
        const suffix = m.model_id ? ` · model: ${m.model_id}` : "";
        b.muted(stamp + suffix);
      }
      pushAssistantContent(b, m.content || "");
      b.blank();
      const citations = normalizeCitationsFromMessageSources(m.sources, { messageId: m.id });
      if (options.includeRetrievalTraces) {
        pushRetrievalMetadata(b, m.sources, citations, aIndex);
      }
      pushSources(b, citations, options, aIndex);
    }
  });

  b.blank();
  b.muted(`${appName} · Generated ${exportedAt}`);

  return b.build();
}
