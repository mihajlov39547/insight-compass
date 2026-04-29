// Client-side helper for the tavily-crawl edge function.
// Provides typed `runTavilyCrawl` and shared types reused by the chat UI.

import { getFunctionUrl } from '@/config/env';
import { authedFetchHeaders } from '@/lib/edge/invokeWithAuth';

export interface CrawlPageItem {
  url: string;
  title: string;
  favicon: string | null;
  raw_content: string;
}

export type CrawlExtractDepth = 'basic' | 'advanced';

export interface CrawlResponse {
  provider: 'tavily';
  augmentationMode: 'crawl';
  url: string;
  base_url: string;
  instructions: string | null;
  extract_depth: CrawlExtractDepth;
  max_depth: number;
  max_breadth: number;
  limit: number;
  results: CrawlPageItem[];
  page_count: number;
  response_time: number | null;
  request_id: string | null;
  synthesizedAnswer: string | null;
  synthesisError: string | null;
  synthesisModel: string | null;
}

export interface RunTavilyCrawlInput {
  url: string;
  instructions?: string | null;
  extract_depth?: CrawlExtractDepth;
  max_depth?: number;
  max_breadth?: number;
  limit?: number;
}

const CRAWL_URL = getFunctionUrl('/functions/v1/tavily-crawl');

export async function runTavilyCrawl(input: RunTavilyCrawlInput): Promise<CrawlResponse> {
  const resp = await fetch(CRAWL_URL, {
    method: 'POST',
    headers: await authedFetchHeaders(),
    body: JSON.stringify({
      url: input.url,
      instructions: input.instructions ?? null,
      extract_depth: input.extract_depth ?? 'basic',
      max_depth: input.max_depth,
      max_breadth: input.max_breadth,
      limit: input.limit,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'Crawl request failed' }));
    throw new Error(errBody.error || `Crawl failed (${resp.status})`);
  }

  return (await resp.json()) as CrawlResponse;
}

/**
 * Renders the crawl result as Markdown for the assistant chat bubble.
 * Synthesized answer (when present) is shown first, followed by per-page
 * sections.
 */
export function formatCrawlMarkdown(result: CrawlResponse): string {
  const lines: string[] = [];
  const total = result.page_count;
  const depthSuffix = result.extract_depth === 'advanced' ? ' · deep extract' : '';
  const headerLabel =
    total === 0
      ? `Crawl returned no readable pages${depthSuffix}`
      : `Crawled ${total} page${total === 1 ? '' : 's'} from ${result.base_url}${depthSuffix}`;
  lines.push(`**${headerLabel}**`);

  if (result.instructions) {
    lines.push('');
    lines.push(`> ${result.instructions}`);
  }

  if (result.synthesizedAnswer) {
    lines.push('');
    lines.push(result.synthesizedAnswer.trim());
  } else if (result.synthesisError && result.instructions) {
    lines.push('');
    lines.push(`_Synthesis unavailable: ${result.synthesisError}_`);
  }

  if (result.results.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('### Crawled pages');
    lines.push('');
    for (let i = 0; i < result.results.length; i++) {
      const r = result.results[i];
      let domain = '';
      try {
        domain = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {
        domain = '';
      }
      const content = (r.raw_content || '').trim();
      const MAX_PER_PAGE = 1800;
      const truncated = content.length > MAX_PER_PAGE;
      const display = truncated ? `${content.slice(0, MAX_PER_PAGE)}…` : content;
      const safeContent = display.length > 0 ? display : '_No readable content extracted from this page._';
      lines.push(`#### Page ${i + 1}: ${r.title}${domain ? ` — ${domain}` : ''}`);
      lines.push('');
      lines.push(safeContent);
      if (truncated) {
        lines.push('');
        lines.push(`_Truncated. View original: ${r.url}_`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
