/**
 * Chat conversation export utilities.
 *
 * Builds Markdown and printable HTML exports of Project / Notebook chat
 * conversations using the canonical citation normalization from
 * `src/lib/citations.ts`. Intentionally additive — no UI/backend behavior
 * changes, no external network requests.
 */

import {
  normalizeCitationsFromMessageSources,
  type CanonicalCitation,
} from "@/lib/citations";

export interface ChatExportOptions {
  format: "markdown" | "pdf";
  includeSources: boolean;
  includeSourceSnippets: boolean;
  includeTechnicalIds: boolean;
  includeRetrievalTraces: boolean;
  includeFullCitationExcerpts: boolean;
  includePinnedSummary?: boolean;
}

export interface ChatMessageLike {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  sources?: unknown;
  created_at?: string | null;
  model_id?: string | null;
}

export interface BuildExportArgs {
  appName: string;
  contextType: "project" | "notebook";
  contextName: string;
  chatTitle?: string;
  exportedByLabel?: string;
  messages: ChatMessageLike[];
  options: ChatExportOptions;
  pinnedMessageIds?: string[];
}

const SNIPPET_MAX = 480;

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function trimSnippet(s: string | null | undefined, full: boolean): string {
  if (!s) return "";
  const t = s.trim();
  if (full) return t;
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX).trimEnd() + "…" : t;
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

function sanitizeFilename(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 80) || "export"
  );
}

export function buildExportFilename(args: {
  contextType: "project" | "notebook";
  contextName: string;
  date?: Date;
  extension: "md" | "html" | "pdf";
}): string {
  const date = args.date ?? new Date();
  const dateStr = date.toISOString().slice(0, 10);
  const ctx = sanitizeFilename(args.contextName || args.contextType);
  const prefix = args.contextType === "project" ? "project-chat" : "notebook-chat";
  return `researcher-${prefix}-${ctx}-${dateStr}.${args.extension}`;
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

function buildRetrievalMetadataMd(
  sources: unknown,
  citations: CanonicalCitation[],
): string {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return "";
  const s = sources as Record<string, unknown>;
  const lines: string[] = [];
  const augmentationMode = safeStr(s.augmentationMode);
  if (augmentationMode) lines.push(`- Mode: \`${augmentationMode}\``);

  const webSearchResponse = s.webSearchResponse as Record<string, unknown> | undefined;
  if (webSearchResponse && typeof webSearchResponse === "object") {
    const provider = safeStr(webSearchResponse.provider) || safeStr(s.webSearchProvider);
    const query = safeStr(webSearchResponse.query);
    const answer = safeStr(webSearchResponse.answer);
    const results = Array.isArray(webSearchResponse.results) ? webSearchResponse.results.length : 0;
    if (provider) lines.push(`- Web provider: ${provider}`);
    if (query) lines.push(`- Web query: ${query}`);
    if (results) lines.push(`- Web results: ${results}`);
    if (answer) lines.push(`- Provider answer: ${trimSnippet(answer, false)}`);
  } else if (safeStr(s.webSearchProvider)) {
    lines.push(`- Web provider: ${safeStr(s.webSearchProvider)}`);
  }

  if (safeStr(s.youtubeProvider)) lines.push(`- YouTube provider: ${safeStr(s.youtubeProvider)}`);
  if (safeStr(s.youtubeQuery)) lines.push(`- YouTube query: ${safeStr(s.youtubeQuery)}`);

  const crawl = s.crawl as Record<string, unknown> | undefined;
  if (crawl && typeof crawl === "object") {
    if (safeStr(crawl.rootUrl)) lines.push(`- Crawl root: ${safeStr(crawl.rootUrl)}`);
    const pageCount = Array.isArray(crawl.results) ? crawl.results.length : (typeof crawl.pageCount === "number" ? crawl.pageCount : null);
    if (pageCount !== null) lines.push(`- Crawl pages: ${pageCount}`);
    if (safeStr(crawl.instructions)) lines.push(`- Crawl instructions: ${trimSnippet(safeStr(crawl.instructions), false)}`);
  }

  if (citations.length > 0) {
    const byType = citations.reduce<Record<string, number>>((acc, c) => {
      acc[c.source_type] = (acc[c.source_type] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(byType)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    if (summary) lines.push(`- Citation summary: ${summary}`);
  }

  if (lines.length === 0) return "";
  return ["#### Retrieval metadata", ...lines, ""].join("\n");
}

function buildSourcesMd(
  citations: CanonicalCitation[],
  opts: ChatExportOptions,
  answerIndex: number,
): string {
  if (!opts.includeSources || citations.length === 0) return "";
  const lines: string[] = [`#### Sources for A${answerIndex}`, ""];
  citations.forEach((c, i) => {
    lines.push(`**${i + 1}. ${c.title}**`);
    lines.push(`- Type: ${sourceTypeLabel(c.source_type)}${c.provider ? ` (${c.provider})` : ""}`);
    const url = c.url ?? c.external_url;
    if (url) lines.push(`- Link: ${url}`);
    if (c.page !== null) lines.push(`- Page: ${c.page}`);
    if (c.section) lines.push(`- Section: ${c.section}`);
    if (c.timestamp_start !== null) {
      const range = c.timestamp_end !== null ? `${c.timestamp_start}–${c.timestamp_end}` : `${c.timestamp_start}`;
      lines.push(`- Timestamp: ${range}s`);
    }
    if (c.relevance !== null || c.score !== null) {
      const r = c.relevance ?? c.score!;
      const pct = r <= 1 ? `${Math.round(r * 100)}%` : `${Math.round(r)}`;
      lines.push(`- Relevance: ${pct}`);
    }
    if (c.match_type) lines.push(`- Traceability: ${c.match_type}`);
    if (c.matched_question_text) lines.push(`- Matched question: ${trimSnippet(c.matched_question_text, false)}`);
    if (opts.includeTechnicalIds) {
      if (c.document_id) lines.push(`- document_id: \`${c.document_id}\``);
      if (c.chunk_id) lines.push(`- chunk_id: \`${c.chunk_id}\``);
      if (c.chunk_index !== null) lines.push(`- chunk_index: \`${c.chunk_index}\``);
      if (c.resource_link_id) lines.push(`- resource_link_id: \`${c.resource_link_id}\``);
    }
    if (opts.includeSourceSnippets && c.snippet) {
      lines.push("");
      lines.push("> " + trimSnippet(c.snippet, opts.includeFullCitationExcerpts).split("\n").join("\n> "));
    }
    lines.push("");
  });
  return lines.join("\n");
}

export function buildChatMarkdownExport(args: BuildExportArgs): string {
  const { appName, contextType, contextName, chatTitle, exportedByLabel, messages, options } = args;

  const exportedAt = new Date().toLocaleString();
  const assistantMessages = messages.filter(m => m.role === "assistant");
  const allCitations = assistantMessages.flatMap(m =>
    normalizeCitationsFromMessageSources(m.sources, { messageId: m.id }),
  );

  const out: string[] = [];
  out.push(`# ${appName} Research Export`);
  out.push("");
  out.push(
    `_This export was generated from ${appName}. It contains the selected chat conversation, assistant responses, and source metadata available at export time._`,
  );
  out.push("");
  out.push("| Field | Value |");
  out.push("| --- | --- |");
  out.push(`| Exported at | ${exportedAt} |`);
  out.push(`| App | ${appName} |`);
  out.push(`| ${contextType === "project" ? "Project" : "Notebook"} | ${contextName} |`);
  if (chatTitle) out.push(`| Chat | ${chatTitle} |`);
  if (exportedByLabel) out.push(`| Exported by | ${exportedByLabel} |`);
  out.push(`| Messages | ${messages.length} |`);
  out.push(`| Sources | ${allCitations.length} |`);
  out.push("");

  if (options.includePinnedSummary && args.pinnedMessageIds && args.pinnedMessageIds.length > 0) {
    out.push("## Pinned messages");
    out.push("");
    args.pinnedMessageIds.forEach(id => {
      const m = messages.find(mm => mm.id === id);
      if (!m) return;
      out.push(`- **${m.role === "user" ? "Question" : "Answer"}**: ${trimSnippet(m.content, false)}`);
    });
    out.push("");
  }

  out.push("## Conversation");
  out.push("");

  let qIndex = 0;
  let aIndex = 0;
  messages.forEach(m => {
    const stamp = fmtDate(m.created_at);
    if (m.role === "user") {
      qIndex += 1;
      out.push(`### Q${qIndex} — User`);
      if (stamp) out.push(`_${stamp}_`);
      out.push("");
      out.push("> " + (m.content || "").split("\n").join("\n> "));
      out.push("");
    } else if (m.role === "assistant") {
      aIndex += 1;
      out.push(`### A${aIndex} — Assistant`);
      if (stamp) out.push(`_${stamp}_${m.model_id ? ` · model: \`${m.model_id}\`` : ""}`);
      out.push("");
      out.push(m.content || "");
      out.push("");
      const citations = normalizeCitationsFromMessageSources(m.sources, { messageId: m.id });
      if (options.includeRetrievalTraces) {
        const trace = buildRetrievalMetadataMd(m.sources, citations);
        if (trace) out.push(trace);
      }
      const sources = buildSourcesMd(citations, options, aIndex);
      if (sources) out.push(sources);
    }
  });

  out.push("");
  out.push("---");
  out.push(`_${appName} · Generated ${exportedAt}_`);
  return out.join("\n");
}

export function downloadMarkdown(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
// PDF export (lazy-loaded pdfmake, client-side, no popup).
// ============================================================

type PdfContent = any; // pdfmake content nodes — shape is dynamic.

function pdfInline(text: string): PdfContent[] {
  // Convert inline markdown (bold, italic, code, links) into pdfmake text runs.
  // Escapes nothing — pdfmake renders plain strings safely (no HTML).
  const runs: PdfContent[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) {
      runs.push({ text: tok.slice(2, -2), bold: true });
    } else if (tok.startsWith("`")) {
      runs.push({ text: tok.slice(1, -1), background: "#f1f3f5" });
    } else if (tok.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        const safe = /^(https?:|mailto:)/i.test(href) ? href : "";
        runs.push(safe ? { text: label, link: safe, color: "#1d4ed8", decoration: "underline" } : { text: label });
      }
    } else {
      runs.push({ text: tok.slice(1, -1), italics: true });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

function markdownToPdfContent(md: string): PdfContent[] {
  if (!md) return [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: PdfContent[] = [];
  let i = 0;
  let para: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: PdfContent[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push({ text: pdfInline(para.join(" ")), margin: [0, 2, 0, 4] });
      para = [];
    }
  };
  const flushList = () => {
    if (listType && listItems.length) {
      out.push(listType === "ul" ? { ul: listItems, margin: [0, 2, 0, 4] } : { ol: listItems, margin: [0, 2, 0, 4] });
    }
    listType = null;
    listItems = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const codeFence = /^```(\w+)?\s*$/.exec(line);
    if (codeFence) {
      flushPara();
      flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push({
        text: buf.join("\n"),
        bold: false,
        fontSize: 9,
        background: "#f1f3f5",
        margin: [0, 4, 0, 6],
        preserveLeadingSpaces: true,
      });
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const lvl = h[1].length;
      const sizes = [16, 14, 13, 12, 11, 11];
      out.push({
        text: pdfInline(h[2]),
        fontSize: sizes[lvl - 1],
        bold: true,
        margin: [0, lvl === 1 ? 8 : 6, 0, 4],
      });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      flushList();
      out.push({
        text: pdfInline(line.replace(/^\s*>\s?/, "")),
        italics: true,
        color: "#475569",
        margin: [10, 2, 0, 4],
      });
      i++;
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want: "ul" | "ol" = ul ? "ul" : "ol";
      if (listType && listType !== want) flushList();
      listType = want;
      listItems.push({ text: pdfInline((ul ?? ol)![1]) });
      i++;
      continue;
    }

    if (/^---+$/.test(line)) {
      flushPara();
      flushList();
      out.push({ canvas: [{ type: "line", x1: 0, y1: 2, x2: 515, y2: 2, lineWidth: 0.5, lineColor: "#cbd5e1" }], margin: [0, 4, 0, 4] });
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  flushList();
  return out;
}

function buildRetrievalTraceLines(sources: unknown, citations: CanonicalCitation[]): string[] {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return [];
  const s = sources as Record<string, unknown>;
  const lines: string[] = [];
  const augmentationMode = safeStr(s.augmentationMode);
  if (augmentationMode) lines.push(`Mode: ${augmentationMode}`);
  const wsr = s.webSearchResponse as Record<string, unknown> | undefined;
  if (wsr && typeof wsr === "object") {
    const provider = safeStr(wsr.provider) || safeStr(s.webSearchProvider);
    if (provider) lines.push(`Web provider: ${provider}`);
    if (safeStr(wsr.query)) lines.push(`Web query: ${safeStr(wsr.query)}`);
    const results = Array.isArray(wsr.results) ? wsr.results.length : 0;
    if (results) lines.push(`Web results: ${results}`);
  } else if (safeStr(s.webSearchProvider)) {
    lines.push(`Web provider: ${safeStr(s.webSearchProvider)}`);
  }
  if (safeStr(s.youtubeProvider)) lines.push(`YouTube provider: ${safeStr(s.youtubeProvider)}`);
  if (safeStr(s.youtubeQuery)) lines.push(`YouTube query: ${safeStr(s.youtubeQuery)}`);
  const crawl = s.crawl as Record<string, unknown> | undefined;
  if (crawl && typeof crawl === "object") {
    if (safeStr(crawl.rootUrl)) lines.push(`Crawl root: ${safeStr(crawl.rootUrl)}`);
    const pageCount = Array.isArray(crawl.results) ? crawl.results.length : (typeof crawl.pageCount === "number" ? crawl.pageCount : null);
    if (pageCount !== null) lines.push(`Crawl pages: ${pageCount}`);
  }
  if (citations.length) {
    const byType = citations.reduce<Record<string, number>>((acc, c) => {
      acc[c.source_type] = (acc[c.source_type] ?? 0) + 1;
      return acc;
    }, {});
    lines.push(`Citation summary: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  }
  return lines;
}

function buildPdfDocDefinition(args: BuildExportArgs): any {
  const { appName, contextType, contextName, chatTitle, exportedByLabel, messages, options } = args;
  const exportedAt = new Date().toLocaleString();
  const assistantMessages = messages.filter(m => m.role === "assistant");
  const allCitations = assistantMessages.flatMap(m =>
    normalizeCitationsFromMessageSources(m.sources, { messageId: m.id }),
  );

  const content: PdfContent[] = [];

  content.push({ text: `${appName} Research Export`, fontSize: 20, bold: true, margin: [0, 0, 0, 6] });
  content.push({
    text: `This export was generated from ${appName}. It contains the selected chat conversation, assistant responses, and source metadata available at export time.`,
    fontSize: 10,
    color: "#475569",
    margin: [0, 0, 0, 10],
  });

  const metaRows: PdfContent[][] = [];
  const pushMeta = (k: string, v: string) => metaRows.push([{ text: k, bold: true, fontSize: 10 }, { text: v, fontSize: 10 }]);
  pushMeta("Exported at", exportedAt);
  pushMeta("App", appName);
  pushMeta(contextType === "project" ? "Project" : "Notebook", contextName);
  if (chatTitle) pushMeta("Chat", chatTitle);
  if (exportedByLabel) pushMeta("Exported by", exportedByLabel);
  pushMeta("Messages", String(messages.length));
  pushMeta("Sources", String(allCitations.length));

  content.push({
    table: { widths: ["auto", "*"], body: metaRows },
    layout: {
      hLineWidth: () => 0.3,
      vLineWidth: () => 0,
      hLineColor: () => "#e2e8f0",
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 16],
  });

  if (options.includePinnedSummary && args.pinnedMessageIds && args.pinnedMessageIds.length > 0) {
    content.push({ text: "Pinned messages", fontSize: 13, bold: true, margin: [0, 4, 0, 6] });
    args.pinnedMessageIds.forEach(id => {
      const m = messages.find(mm => mm.id === id);
      if (!m) return;
      content.push({
        text: [
          { text: m.role === "user" ? "Question: " : "Answer: ", bold: true },
          { text: trimSnippet(m.content, false) },
        ],
        fontSize: 10,
        margin: [0, 0, 0, 3],
      });
    });
    content.push({ text: "", margin: [0, 0, 0, 6] });
  }

  content.push({ text: "Conversation", fontSize: 14, bold: true, margin: [0, 6, 0, 8] });

  let qIndex = 0;
  let aIndex = 0;
  messages.forEach(m => {
    const stamp = fmtDate(m.created_at);
    if (m.role === "user") {
      qIndex += 1;
      content.push({
        stack: [
          { text: `Q${qIndex} — User${stamp ? `  ·  ${stamp}` : ""}`, fontSize: 10, bold: true, color: "#0f172a", margin: [0, 0, 0, 4] },
          ...markdownToPdfContent(m.content || ""),
        ],
        margin: [0, 4, 0, 8],
        unbreakable: false,
      });
      return;
    }
    if (m.role !== "assistant") return;
    aIndex += 1;
    const citations = normalizeCitationsFromMessageSources(m.sources, { messageId: m.id });

    const block: PdfContent[] = [
      {
        text: `A${aIndex} — Assistant${stamp ? `  ·  ${stamp}` : ""}${m.model_id ? `  ·  ${m.model_id}` : ""}`,
        fontSize: 10,
        bold: true,
        color: "#0f172a",
        margin: [0, 0, 0, 4],
      },
      ...markdownToPdfContent(m.content || ""),
    ];

    if (options.includeRetrievalTraces) {
      const trace = buildRetrievalTraceLines(m.sources, citations);
      if (trace.length) {
        block.push({
          stack: [
            { text: "Retrieval metadata", fontSize: 9, bold: true, color: "#475569", margin: [0, 0, 0, 2] },
            ...trace.map(l => ({ text: l, fontSize: 9, color: "#334155" })),
          ],
          margin: [0, 4, 0, 4],
        });
      }
    }

    if (options.includeSources && citations.length) {
      const srcStack: PdfContent[] = [
        { text: `Sources for A${aIndex}`, fontSize: 10, bold: true, color: "#475569", margin: [0, 6, 0, 4] },
      ];
      citations.forEach((c, idx) => {
        const url = c.url ?? c.external_url;
        const meta: string[] = [sourceTypeLabel(c.source_type)];
        if (c.provider) meta.push(c.provider);
        if (c.page !== null) meta.push(`p.${c.page}`);
        if (c.section) meta.push(c.section);
        if (c.timestamp_start !== null) {
          meta.push(c.timestamp_end !== null ? `${c.timestamp_start}–${c.timestamp_end}s` : `${c.timestamp_start}s`);
        }
        if (c.relevance !== null || c.score !== null) {
          const r = (c.relevance ?? c.score)!;
          meta.push(r <= 1 ? `${Math.round(r * 100)}%` : `${Math.round(r)}`);
        }
        if (c.match_type) meta.push(c.match_type);

        const itemStack: PdfContent[] = [
          {
            text: [
              { text: `${idx + 1}. `, bold: true },
              url ? { text: c.title, link: url, color: "#1d4ed8", decoration: "underline" } : { text: c.title },
            ],
            fontSize: 10,
          },
          { text: meta.join(" · "), fontSize: 8.5, color: "#64748b", margin: [0, 1, 0, 0] },
        ];
        if (url) itemStack.push({ text: url, fontSize: 8, color: "#1d4ed8", margin: [0, 1, 0, 0] });
        if (options.includeTechnicalIds) {
          const ids: string[] = [];
          if (c.document_id) ids.push(`document_id: ${c.document_id}`);
          if (c.chunk_id) ids.push(`chunk_id: ${c.chunk_id}`);
          if (c.chunk_index !== null) ids.push(`chunk_index: ${c.chunk_index}`);
          if (c.resource_link_id) ids.push(`resource_link_id: ${c.resource_link_id}`);
          if (ids.length) itemStack.push({ text: ids.join("  ·  "), fontSize: 8, color: "#475569", margin: [0, 1, 0, 0] });
        }
        if (options.includeSourceSnippets && c.snippet) {
          itemStack.push({
            text: trimSnippet(c.snippet, options.includeFullCitationExcerpts),
            fontSize: 9,
            color: "#334155",
            margin: [0, 3, 0, 0],
            italics: true,
          });
        }
        srcStack.push({ stack: itemStack, margin: [0, 0, 0, 6] });
      });
      block.push({ stack: srcStack });
    }

    content.push({ stack: block, margin: [0, 4, 0, 10] });
  });

  return {
    info: {
      title: `${appName} Research Export — ${contextName}`,
      author: exportedByLabel || appName,
      subject: chatTitle || `${contextType} chat export`,
    },
    pageSize: "A4",
    pageMargins: [40, 50, 40, 50],
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.35, color: "#111111" },
    footer: (current: number, total: number) => ({
      columns: [
        { text: `${appName} · ${contextName}`, fontSize: 8, color: "#94a3b8", margin: [40, 0, 0, 0] },
        { text: `Page ${current} / ${total}`, alignment: "right", fontSize: 8, color: "#94a3b8", margin: [0, 0, 40, 0] },
      ],
    }),
    content,
  };
}

let pdfMakeCache: any = null;

const PDFMAKE_FONT_FILES = [
  "Roboto-Regular.ttf",
  "Roboto-Medium.ttf",
  "Roboto-Italic.ttf",
  "Roboto-MediumItalic.ttf",
] as const;

function looksLikePdfMakeVfs(value: unknown): value is Record<string, string | { data: string; encoding?: string }> {
  return !!value && typeof value === "object" && PDFMAKE_FONT_FILES.every(file => file in value);
}

async function loadPdfMake(): Promise<any> {
  if (pdfMakeCache) return pdfMakeCache;
  const [pdfMakeMod, vfsMod]: any[] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod;
  const vfsCandidates = [
    vfsMod?.pdfMake?.vfs,
    vfsMod?.default?.pdfMake?.vfs,
    vfsMod?.default?.vfs,
    vfsMod?.vfs,
    vfsMod?.default,
    vfsMod,
  ];
  const vfsCandidate = vfsCandidates.find(looksLikePdfMakeVfs);
  const vfs = vfsCandidate ? { ...vfsCandidate } : undefined;

  if (!vfs || !vfs["Roboto-Medium.ttf"]) {
    if (import.meta.env.DEV) {
      console.error(
        "pdfmake vfs_fonts import shape:",
        Object.keys(vfsMod ?? {}),
        vfsMod?.default ? Object.keys(vfsMod.default) : [],
      );
    }
    throw new Error("PDF fonts were not loaded correctly.");
  }

  const fonts = {
    Roboto: {
      normal: "Roboto-Regular.ttf",
      bold: "Roboto-Medium.ttf",
      italics: "Roboto-Italic.ttf",
      bolditalics: "Roboto-MediumItalic.ttf",
    },
  };

  if (typeof pdfMake.addVirtualFileSystem === "function") {
    pdfMake.addVirtualFileSystem(vfs);
  } else {
    pdfMake.vfs = vfs;
  }

  if (typeof pdfMake.addFonts === "function") {
    pdfMake.addFonts(fonts);
  } else {
    pdfMake.fonts = { ...(pdfMake.fonts ?? {}), ...fonts };
  }

  pdfMakeCache = pdfMake;
  return pdfMake;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getPdfBlob(pdfDoc: any): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = pdfDoc.getBlob((blob: Blob) => resolve(blob));
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

export async function downloadChatPdf(args: BuildExportArgs): Promise<void> {
  const pdfMake = await loadPdfMake();
  const docDef = buildPdfDocDefinition(args);
  const filename = buildExportFilename({
    contextType: args.contextType,
    contextName: args.contextName,
    extension: "pdf",
  });
  const blob = await getPdfBlob(pdfMake.createPdf(docDef));
  triggerBlobDownload(blob, filename);
}

