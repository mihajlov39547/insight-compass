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

// ---------------------------------------------------------------------------
// Research Trace — user-facing, normalized, deduped timeline of research work.
// Persisted into message.sources.researchTrace and rendered by <ResearchTrace/>.
// ---------------------------------------------------------------------------

export type ResearchPhase =
  | 'planning'
  | 'searching'
  | 'analyzing'
  | 'writing'
  | 'complete'
  | 'failed';

export type ResearchTraceEvent =
  | { type: 'status'; label: string; phase?: ResearchPhase; ts: number }
  | { type: 'plan'; text: string; ts: number }
  | { type: 'step'; text: string; phase?: ResearchPhase; ts: number }
  | {
      type: 'tool';
      toolName: string;
      summary: string;
      queries?: string[];
      count?: number;
      ts: number;
    }
  | { type: 'note'; text: string; ts: number }
  | { type: 'done'; ts: number }
  | { type: 'error'; message: string; ts: number };

export interface ResearchTraceState {
  status: ResearchPhase;
  events: ResearchTraceEvent[];
}

export interface RunResearchOptions {
  input: string;
  model?: ResearchModel;
  signal?: AbortSignal;
  onEvent?: (event: ResearchEvent) => void;
  onTrace?: (state: ResearchTraceState) => void;
}

export interface ResearchResult {
  finalText: string;
  sources: ResearchSourceItem[];
  errored: boolean;
  errorMessage?: string;
  trace: ResearchTraceState;
}

// Map a Tavily tool name → user-facing phase + verb.
function phaseForTool(name: string): { phase: ResearchPhase; verb: string } {
  switch (name) {
    case 'Planning':
      return { phase: 'planning', verb: 'Building research plan' };
    case 'WebSearch':
      return { phase: 'searching', verb: 'Searching the web' };
    case 'ResearchSubtopic':
      return { phase: 'searching', verb: 'Researching subtopic' };
    case 'Generating':
      return { phase: 'writing', verb: 'Writing final report' };
    default:
      return { phase: 'analyzing', verb: name };
  }
}

function phaseForStatus(label: string): ResearchPhase | undefined {
  const l = label.toLowerCase();
  if (l.includes('plan')) return 'planning';
  if (l.includes('search')) return 'searching';
  if (l.includes('subtopic') || l.includes('analy') || l.includes('think')) return 'analyzing';
  if (l.includes('writ') || l.includes('report') || l.includes('generat')) return 'writing';
  return undefined;
}

class TraceBuilder {
  private events: ResearchTraceEvent[] = [];
  private status: ResearchPhase = 'planning';
  private notify?: (state: ResearchTraceState) => void;
  // Coalesce repeated tool calls within the same logical phase.
  // Key = toolName; value = index in events for the active aggregated row.
  private toolAggregateIdx: Record<string, number> = {};

  constructor(notify?: (state: ResearchTraceState) => void) {
    this.notify = notify;
  }

  private emit() {
    this.notify?.({ status: this.status, events: [...this.events] });
  }

  private push(evt: ResearchTraceEvent) {
    // Dedupe: drop identical consecutive status entries.
    const last = this.events[this.events.length - 1];
    if (
      last &&
      last.type === 'status' &&
      evt.type === 'status' &&
      last.label === evt.label
    ) {
      return;
    }
    if (
      last &&
      last.type === 'step' &&
      evt.type === 'step' &&
      last.text === evt.text
    ) {
      return;
    }
    this.events.push(evt);
  }

  setStatus(phase: ResearchPhase) {
    this.status = phase;
  }

  addStatus(label: string) {
    const phase = phaseForStatus(label);
    if (phase) this.status = phase;
    this.push({ type: 'status', label, phase, ts: Date.now() });
    // Reset tool aggregation when phase shifts.
    if (phase) this.toolAggregateIdx = {};
    this.emit();
  }

  addTool(name: string, queries?: string[]) {
    const { phase, verb } = phaseForTool(name);
    this.status = phase;

    // For Planning / Generating — single descriptive row, no counter.
    if (name === 'Planning' || name === 'Generating') {
      this.push({
        type: 'tool',
        toolName: name,
        summary: verb,
        queries,
        ts: Date.now(),
      });
      this.emit();
      return;
    }

    // For repeating tools (WebSearch / ResearchSubtopic) — coalesce.
    const aggKey = name;
    const existingIdx = this.toolAggregateIdx[aggKey];
    if (existingIdx !== undefined) {
      const existing = this.events[existingIdx];
      if (existing && existing.type === 'tool') {
        const newCount = (existing.count ?? 1) + 1;
        const mergedQueries = existing.queries ?? [];
        if (queries && queries.length) {
          for (const q of queries) {
            if (!mergedQueries.includes(q)) mergedQueries.push(q);
          }
        }
        const summary =
          name === 'WebSearch'
            ? `Executed ${newCount} web searches`
            : name === 'ResearchSubtopic'
              ? `Researched ${newCount} subtopics`
              : `${verb} (${newCount})`;
        this.events[existingIdx] = {
          ...existing,
          summary,
          queries: mergedQueries.length ? mergedQueries : undefined,
          count: newCount,
          ts: Date.now(),
        };
        this.emit();
        return;
      }
    }

    const summary =
      name === 'WebSearch'
        ? 'Executed 1 web search'
        : name === 'ResearchSubtopic'
          ? 'Researched 1 subtopic'
          : verb;
    this.events.push({
      type: 'tool',
      toolName: name,
      summary,
      queries,
      count: 1,
      ts: Date.now(),
    });
    this.toolAggregateIdx[aggKey] = this.events.length - 1;
    this.emit();
  }

  addPlan(text: string) {
    this.status = 'planning';
    this.push({ type: 'plan', text, ts: Date.now() });
    this.emit();
  }

  markContentStarted() {
    if (this.status !== 'writing' && this.status !== 'complete') {
      this.status = 'writing';
      this.push({ type: 'status', label: 'Writing report', phase: 'writing', ts: Date.now() });
      this.emit();
    }
  }

  markDone() {
    this.status = 'complete';
    this.events.push({ type: 'done', ts: Date.now() });
    this.emit();
  }

  markError(message: string) {
    this.status = 'failed';
    this.events.push({ type: 'error', message, ts: Date.now() });
    this.emit();
  }

  snapshot(): ResearchTraceState {
    return { status: this.status, events: [...this.events] };
  }
}

export async function runTavilyResearch({
  input,
  model = 'auto',
  signal,
  onEvent,
  onTrace,
}: RunResearchOptions): Promise<ResearchResult> {
  const trace = new TraceBuilder(onTrace);

  let resp: Response;
  try {
    resp = await fetch(RESEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ input, model }),
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Research request failed';
    trace.markError(msg);
    throw new Error(msg);
  }

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'Research request failed' }));
    const msg = errBody.error || `Research request failed (${resp.status})`;
    trace.markError(msg);
    throw new Error(msg);
  }
  if (!resp.body) {
    const msg = 'Research stream returned no body';
    trace.markError(msg);
    throw new Error(msg);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let sources: ResearchSourceItem[] = [];
  let errored = false;
  let errorMessage: string | undefined;
  let contentStarted = false;

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

      if (evt.type === 'status') {
        trace.addStatus(evt.label);
      } else if (evt.type === 'tool') {
        trace.addTool(evt.name, evt.queries);
      } else if (evt.type === 'tool_result') {
        // Tool results are reflected via final sources event; no extra trace row.
      } else if (evt.type === 'content_delta') {
        if (!contentStarted) {
          contentStarted = true;
          trace.markContentStarted();
        }
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
        trace.markError(evt.message);
      }
    }
  }

  if (!errored) {
    trace.markDone();
  }

  return { finalText, sources, errored, errorMessage, trace: trace.snapshot() };
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
  // Cap at top 5 — sources are already ordered by Tavily relevance.
  const top = sources.slice(0, 5);
  return top.map((s, idx) => ({
    id: `research-${idx}`,
    type: 'web',
    title: s.title || s.url,
    snippet: s.domain ? s.domain : '',
    relevance: 1 - idx / Math.max(top.length, 1),
    url: s.url,
    favicon: s.favicon ?? null,
  }));
}
