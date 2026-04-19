// Client-side helper for the tavily-extract edge function.
// Provides typed `runTavilyExtract` and shared types reused by the chat UI.

import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';

export interface ExtractSourceItem {
  url: string;
  title: string;
  favicon: string | null;
  raw_content: string;
}

export interface ExtractFailedItem {
  url: string;
  error: string;
}

export interface ExtractResponse {
  provider: 'tavily';
  augmentationMode: 'extract';
  query: string | null;
  urls: string[];
  results: ExtractSourceItem[];
  failed_results: ExtractFailedItem[];
  response_time: number | null;
  request_id: string | null;
  synthesizedAnswer: string | null;
  synthesisError: string | null;
  synthesisModel: string | null;
}

export interface RunTavilyExtractInput {
  urls: string[];
  query?: string | null;
}

const EXTRACT_URL = getFunctionUrl('/functions/v1/tavily-extract');

export async function runTavilyExtract(input: RunTavilyExtractInput): Promise<ExtractResponse> {
  const resp = await fetch(EXTRACT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      urls: input.urls,
      query: input.query ?? null,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'Extract request failed' }));
    throw new Error(errBody.error || `Extract failed (${resp.status})`);
  }

  return (await resp.json()) as ExtractResponse;
}

/**
 * Renders the extract result as Markdown for the assistant chat bubble.
 * Synthesized answer (when present) is shown first, followed by per-source
 * collapsible sections via <details>. Failures are listed in compact form.
 */
export function formatExtractMarkdown(
  result: ExtractResponse,
  selectedTitles?: Array<{ url: string; title?: string | null }>
): string {
  const titleByUrl = new Map<string, string>();
  for (const s of selectedTitles ?? []) {
    if (s.url && s.title) titleByUrl.set(s.url, s.title);
  }

  const lines: string[] = [];
  const total = result.results.length;
  const headerLabel =
    total === 0
      ? 'Extract returned no readable content'
      : `Extracted from ${total} source${total === 1 ? '' : 's'}`;
  lines.push(`**${headerLabel}**`);

  if (result.query) {
    lines.push('');
    lines.push(`> ${result.query}`);
  }

  if (result.synthesizedAnswer) {
    lines.push('');
    lines.push(result.synthesizedAnswer.trim());
  } else if (result.synthesisError && result.query) {
    lines.push('');
    lines.push(`_Synthesis unavailable: ${result.synthesisError}_`);
  }

  if (result.results.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('### Extracted content');
    lines.push('');
    for (let i = 0; i < result.results.length; i++) {
      const r = result.results[i];
      const displayTitle = titleByUrl.get(r.url) || r.title || r.url;
      let domain = '';
      try {
        domain = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {
        domain = '';
      }
      const content = (r.raw_content || '').trim();
      const MAX_PER_SOURCE = 2400;
      const truncated = content.length > MAX_PER_SOURCE;
      const display = truncated ? `${content.slice(0, MAX_PER_SOURCE)}…` : content;
      const safeContent = display.length > 0 ? display : '_No readable content extracted._';
      lines.push(`#### Source ${i + 1}: ${displayTitle}${domain ? ` — ${domain}` : ''}`);
      lines.push('');
      lines.push(safeContent);
      if (truncated) {
        lines.push('');
        lines.push(`_Truncated. View original: ${r.url}_`);
      }
      lines.push('');
    }
  }

  if (result.failed_results.length > 0) {
    lines.push('');
    lines.push('### Failed sources');
    lines.push('');
    for (const f of result.failed_results) {
      lines.push(`- ${f.url} — _${f.error}_`);
    }
  }

  return lines.join('\n');
}
