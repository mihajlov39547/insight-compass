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
  format: "markdown" | "print";
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
  extension: "md" | "html";
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

// ----- Minimal Markdown -> HTML converter for the print preview.
// Intentionally tiny; escapes HTML first so no unsafe HTML is produced.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // code spans
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italics
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => {
    const safeHref = /^(https?:|mailto:|\/|#)/i.test(href) ? href : "#";
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  return out;
}

export function markdownToSafeHtml(md: string): string {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw;
    if (inCode) {
      if (/^```/.test(line)) {
        html.push(`<pre><code${codeLang ? ` class="lang-${escapeHtml(codeLang)}"` : ""}>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        inCode = false;
        codeBuf = [];
        codeLang = "";
      } else {
        codeBuf.push(line);
      }
      continue;
    }
    const codeOpen = /^```(\w+)?\s*$/.exec(line);
    if (codeOpen) {
      flushPara();
      closeList();
      inCode = true;
      codeLang = codeOpen[1] ?? "";
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushPara();
      closeList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const lvl = h[1].length;
      html.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      closeList();
      html.push(`<blockquote>${renderInline(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want: "ul" | "ol" = ul ? "ul" : "ol";
      if (listType !== want) {
        closeList();
        html.push(`<${want}>`);
        listType = want;
      }
      html.push(`<li>${renderInline((ul ?? ol)![1])}</li>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      flushPara();
      closeList();
      html.push("<hr/>");
      continue;
    }
    para.push(line.trim());
  }
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  flushPara();
  closeList();
  return html.join("\n");
}

export interface OpenPrintPreviewArgs extends BuildExportArgs {
  filename?: string;
}

export function openPrintPreview(args: OpenPrintPreviewArgs): void {
  const { appName, contextType, contextName, chatTitle, exportedByLabel, messages, options } = args;
  const exportedAt = new Date().toLocaleString();

  const assistantMessages = messages.filter(m => m.role === "assistant");
  const totalSources = assistantMessages.reduce(
    (sum, m) => sum + normalizeCitationsFromMessageSources(m.sources, { messageId: m.id }).length,
    0,
  );

  let qIndex = 0;
  let aIndex = 0;
  const turnsHtml = messages
    .map(m => {
      const stamp = fmtDate(m.created_at);
      if (m.role === "user") {
        qIndex += 1;
        return `
          <section class="turn turn-user">
            <div class="bubble bubble-user">
              <header><span class="role">Q${qIndex} · User</span>${stamp ? `<span class="stamp">${escapeHtml(stamp)}</span>` : ""}</header>
              <div class="content">${markdownToSafeHtml(m.content || "")}</div>
            </div>
          </section>`;
      }
      if (m.role !== "assistant") return "";
      aIndex += 1;
      const citations = normalizeCitationsFromMessageSources(m.sources, { messageId: m.id });
      const sourcesHtml =
        options.includeSources && citations.length
          ? `<div class="sources">
              <h4>Sources</h4>
              <ol>
                ${citations
                  .map(c => {
                    const url = c.url ?? c.external_url;
                    const meta: string[] = [];
                    meta.push(sourceTypeLabel(c.source_type));
                    if (c.provider) meta.push(escapeHtml(c.provider));
                    if (c.page !== null) meta.push(`p.${c.page}`);
                    if (c.section) meta.push(escapeHtml(c.section));
                    if (c.relevance !== null || c.score !== null) {
                      const r = (c.relevance ?? c.score)!;
                      meta.push(r <= 1 ? `${Math.round(r * 100)}%` : `${Math.round(r)}`);
                    }
                    if (c.match_type) meta.push(escapeHtml(c.match_type));
                    const snippet =
                      options.includeSourceSnippets && c.snippet
                        ? `<div class="snippet">${markdownToSafeHtml(trimSnippet(c.snippet, options.includeFullCitationExcerpts))}</div>`
                        : "";
                    const titleHtml = url
                      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.title)}</a>`
                      : escapeHtml(c.title);
                    const urlHtml = url ? `<div class="url">${escapeHtml(url)}</div>` : "";
                    return `<li class="source"><div class="title">${titleHtml}</div><div class="meta">${meta.join(" · ")}</div>${urlHtml}${snippet}</li>`;
                  })
                  .join("")}
              </ol>
            </div>`
          : "";
      const traceHtml =
        options.includeRetrievalTraces
          ? (() => {
              const md = buildRetrievalMetadataMd(m.sources, citations);
              return md ? `<div class="trace">${markdownToSafeHtml(md)}</div>` : "";
            })()
          : "";
      return `
        <section class="turn turn-assistant">
          <div class="bubble bubble-assistant">
            <header><span class="role">A${aIndex} · Assistant</span>${stamp ? `<span class="stamp">${escapeHtml(stamp)}</span>` : ""}${m.model_id ? `<span class="model">${escapeHtml(m.model_id)}</span>` : ""}</header>
            <div class="content">${markdownToSafeHtml(m.content || "")}</div>
            ${traceHtml}
            ${sourcesHtml}
          </div>
        </section>`;
    })
    .join("\n");

  const css = `
    *,*::before,*::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color:#111; background:#f6f7f9; margin:0; padding:24px; line-height:1.55; }
    .page { max-width: 880px; margin: 0 auto; }
    .toolbar { position: sticky; top:0; background:#fff; border:1px solid #e3e6ea; border-radius:10px; padding:10px 14px; display:flex; gap:8px; align-items:center; justify-content:space-between; margin-bottom:18px; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
    .toolbar button { font: inherit; cursor:pointer; padding:6px 12px; border:1px solid #d4d8de; background:#fff; border-radius:6px; }
    .toolbar button.primary { background:#111; color:#fff; border-color:#111; }
    .doc-header { background:#fff; border:1px solid #e3e6ea; border-radius:10px; padding:20px 24px; margin-bottom:18px; }
    .doc-header h1 { margin:0 0 6px; font-size: 22px; }
    .doc-header .intro { color:#475569; font-size:13px; margin:8px 0 14px; }
    .meta-grid { display:grid; grid-template-columns: max-content 1fr; gap:4px 16px; font-size:12.5px; color:#334155; }
    .meta-grid dt { font-weight:600; color:#0f172a; }
    .meta-grid dd { margin:0; }
    .turn { margin: 14px 0; display:flex; }
    .turn-user { justify-content: flex-end; }
    .turn-assistant { justify-content: flex-start; }
    .bubble { border-radius: 14px; padding: 14px 16px; max-width: 78%; border:1px solid #e3e6ea; background:#fff; }
    .bubble-user { background:#eef4ff; border-color:#cfdcf7; }
    .bubble header { display:flex; gap:10px; align-items:baseline; font-size:11.5px; color:#64748b; margin-bottom:6px; }
    .bubble header .role { font-weight:600; color:#0f172a; }
    .content { font-size:14px; }
    .content h1 { font-size:18px; margin:10px 0 6px; }
    .content h2 { font-size:16px; margin:10px 0 6px; }
    .content h3, .content h4 { font-size:14px; margin:8px 0 4px; }
    .content p { margin: 6px 0; }
    .content ul, .content ol { padding-left: 22px; margin:6px 0; }
    .content code { background:#f1f3f5; padding:1px 5px; border-radius:4px; font-size: 12.5px; }
    .content pre { background:#0f172a; color:#f8fafc; padding:10px 12px; border-radius:8px; overflow:auto; font-size:12px; }
    .content pre code { background:transparent; color:inherit; padding:0; }
    .content blockquote { border-left:3px solid #cbd5e1; margin: 6px 0; padding:2px 10px; color:#475569; }
    .content a { color:#1d4ed8; }
    .trace { margin-top:10px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; font-size:12px; color:#334155; }
    .trace h4 { margin:0 0 4px; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; color:#475569; }
    .sources { margin-top:12px; }
    .sources h4 { font-size:12px; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin:6px 0 8px; }
    .sources ol { padding-left:0; list-style:none; counter-reset: src; }
    .source { counter-increment: src; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; margin-bottom:8px; background:#fafbfc; page-break-inside: avoid; }
    .source .title::before { content: counter(src) ". "; font-weight:600; color:#475569; }
    .source .title { font-weight:500; }
    .source .meta { font-size:11.5px; color:#64748b; margin-top:2px; }
    .source .url { font-size:11px; color:#1d4ed8; word-break: break-all; margin-top:2px; }
    .source .snippet { font-size:12px; color:#334155; background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:6px 8px; margin-top:6px; }
    footer.doc-footer { margin-top:24px; text-align:center; color:#94a3b8; font-size:11.5px; }

    @media print {
      @page { margin: 14mm; }
      body { background:#fff; padding:0; color:#000; }
      .toolbar { display:none !important; }
      .page { max-width:none; }
      .bubble { max-width:100%; border-color:#cbd5e1; box-shadow:none; }
      .bubble-user { background:#f1f5f9; }
      .turn { page-break-inside: avoid; }
      .source { page-break-inside: avoid; }
      a { color:#000; text-decoration: underline; }
      .content a[href]::after { content: " (" attr(href) ")"; font-size: 0.85em; color:#475569; }
    }
  `;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(appName)} Research Export — ${escapeHtml(contextName)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <div><strong>${escapeHtml(appName)}</strong> Research Export</div>
      <div>
        <button onclick="window.close()">Close</button>
        <button class="primary" onclick="window.print()">Print / Save as PDF</button>
      </div>
    </div>
    <header class="doc-header">
      <h1>${escapeHtml(appName)} Research Export</h1>
      <p class="intro">This export was generated from ${escapeHtml(appName)}. It contains the selected chat conversation, assistant responses, and source metadata available at export time.</p>
      <dl class="meta-grid">
        <dt>Exported at</dt><dd>${escapeHtml(exportedAt)}</dd>
        <dt>${contextType === "project" ? "Project" : "Notebook"}</dt><dd>${escapeHtml(contextName)}</dd>
        ${chatTitle ? `<dt>Chat</dt><dd>${escapeHtml(chatTitle)}</dd>` : ""}
        ${exportedByLabel ? `<dt>Exported by</dt><dd>${escapeHtml(exportedByLabel)}</dd>` : ""}
        <dt>Messages</dt><dd>${messages.length}</dd>
        <dt>Sources</dt><dd>${totalSources}</dd>
      </dl>
    </header>
    <main>${turnsHtml}</main>
    <footer class="doc-footer">${escapeHtml(appName)} · Generated ${escapeHtml(exportedAt)}</footer>
  </div>
</body>
</html>`;

  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
  if (!w) {
    // Popup blocked — fall back to data URL download
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
