// Lightweight, normalized trace model for the per-prompt web-search flow.
// Designed to feel like a slimmer cousin of ResearchTraceState — same shape,
// fewer event types, simpler phases. Persisted into message.sources.webSearchTrace.

import type { WebSearchResponse, WebSearchResult } from './types';

export type WebSearchPhase =
  | 'searching'
  | 'found'
  | 'preparing'
  | 'complete'
  | 'failed';

export interface WebSearchSourcePreview {
  title: string;
  url: string;
  domain?: string | null;
  favicon?: string | null;
}

export type WebSearchTraceEvent =
  | { type: 'status'; label: string; phase: WebSearchPhase; ts: number }
  | {
      type: 'results';
      count: number;
      sources: WebSearchSourcePreview[];
      answer?: string | null;
      ts: number;
    }
  | { type: 'done'; ts: number }
  | { type: 'error'; message: string; ts: number };

export interface WebSearchTraceState {
  status: WebSearchPhase;
  events: WebSearchTraceEvent[];
  answer?: string | null;
  sources: WebSearchSourcePreview[];
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function toWebSearchSourcePreviews(
  results: WebSearchResult[] | null | undefined
): WebSearchSourcePreview[] {
  if (!results || !Array.isArray(results)) return [];
  // Dedupe by URL while preserving rank order.
  const seen = new Set<string>();
  const out: WebSearchSourcePreview[] = [];
  for (const r of results) {
    const url = typeof r?.url === 'string' ? r.url.trim() : '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: r.title || url,
      url,
      domain: safeDomain(url),
      favicon: r.favicon ?? null,
    });
  }
  return out;
}

export class WebSearchTraceBuilder {
  private events: WebSearchTraceEvent[] = [];
  private status: WebSearchPhase = 'searching';
  private answer: string | null | undefined;
  private sources: WebSearchSourcePreview[] = [];
  private notify?: (state: WebSearchTraceState) => void;

  constructor(notify?: (state: WebSearchTraceState) => void) {
    this.notify = notify;
  }

  private emit() {
    this.notify?.(this.snapshot());
  }

  start() {
    this.status = 'searching';
    this.events.push({
      type: 'status',
      label: 'Searching the web',
      phase: 'searching',
      ts: Date.now(),
    });
    this.emit();
  }

  results(response: WebSearchResponse | null) {
    if (!response) {
      this.status = 'failed';
      this.events.push({
        type: 'error',
        message: 'No web results returned',
        ts: Date.now(),
      });
      this.emit();
      return;
    }
    const sources = toWebSearchSourcePreviews(response.results);
    const rawAnswer =
      typeof (response.rawProviderResponse as Record<string, unknown> | undefined)?.answer === 'string'
        ? ((response.rawProviderResponse as Record<string, unknown>).answer as string)
        : null;
    this.sources = sources;
    this.answer = rawAnswer;
    this.status = 'found';
    this.events.push({
      type: 'results',
      count: sources.length,
      sources,
      answer: rawAnswer,
      ts: Date.now(),
    });
    this.emit();
  }

  preparingAnswer() {
    this.status = 'preparing';
    this.events.push({
      type: 'status',
      label: 'Preparing grounded answer',
      phase: 'preparing',
      ts: Date.now(),
    });
    this.emit();
  }

  done() {
    this.status = 'complete';
    this.events.push({ type: 'done', ts: Date.now() });
    this.emit();
  }

  fail(message: string) {
    this.status = 'failed';
    this.events.push({ type: 'error', message, ts: Date.now() });
    this.emit();
  }

  snapshot(): WebSearchTraceState {
    return {
      status: this.status,
      events: [...this.events],
      answer: this.answer ?? null,
      sources: [...this.sources],
    };
  }
}
