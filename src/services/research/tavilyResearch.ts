// Shared frontend client for the tavily-research edge function.
// Reads the normalized SSE protocol defined in supabase/functions/tavily-research/index.ts
// and exposes a typed async generator + a high-level helper that streams into callbacks.

import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';

const RESEARCH_URL = getFunctionUrl('/functions/v1/tavily-research');

export type ResearchModel = 'mini' | 'pro' | 'auto';

export interface ResearchSourceItem {
  url: string;
  title?: string;
  favicon?: string | null;
  domain?: string;
}

export type ResearchEvent =
  | { type: 'status'; label: string; detail?: string }
  | { type: 'tool'; name: string; queries?: string[] }
  | { type: 'tool_result'; name: string; sources?: ResearchSourceItem[] }
  | { type: 'content_delta'; text: string }
  | { type: 'sources'; sources: ResearchSourceItem[] }
  | { type: 'done'; finalText?: string }
  | { type: 'error'; message: string };

export interface RunResearchOptions {
  input: string;
  model?: ResearchModel;
  signal?: AbortSignal;
  onEvent?: (event: ResearchEvent) => void;
}

export interface ResearchResult {
  finalText: string;
  sources: ResearchSourceItem[];
  errored: boolean;
  errorMessage?: string;
}

export async function runTavilyResearch({
  input,
  model = 'auto',
  signal,
  onEvent,
}: RunResearchOptions): Promise<ResearchResult> {
  const resp = await fetch(RESEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ input, model }),
    signal,
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'Research request failed' }));
    throw new Error(errBody.error || `Research request failed (${resp.status})`);
  }
  if (!resp.body) throw new Error('Research stream returned no body');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let sources: ResearchSourceItem[] = [];
  let errored = false;
  let errorMessage: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);

      const dataLine = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!dataLine) continue;

      let evt: ResearchEvent | null = null;
      try {
        evt = JSON.parse(dataLine) as ResearchEvent;
      } catch {
        continue;
      }
      if (!evt) continue;

      onEvent?.(evt);

      if (evt.type === 'content_delta') {
        finalText += evt.text;
      } else if (evt.type === 'sources') {
        sources = evt.sources;
      } else if (evt.type === 'done') {
        if (evt.finalText && evt.finalText.length > finalText.length) {
          finalText = evt.finalText;
        }
      } else if (evt.type === 'error') {
        errored = true;
        errorMessage = evt.message;
      }
    }
  }

  return { finalText, sources, errored, errorMessage };
}

export function researchSourcesToUnified(
  sources: ResearchSourceItem[]
): Array<{
  id: string;
  type: 'web';
  title: string;
  snippet: string;
  relevance: number;
  url: string;
  favicon: string | null;
}> {
  return sources.map((s, idx) => ({
    id: `research-${idx}`,
    type: 'web',
    title: s.title || s.url,
    snippet: s.domain ? s.domain : '',
    relevance: 1 - idx / Math.max(sources.length, 1),
    url: s.url,
    favicon: s.favicon ?? null,
  }));
}
