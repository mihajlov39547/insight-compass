import { useState } from 'react';
import {
  Globe,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  WebSearchPhase,
  WebSearchTraceEvent,
  WebSearchTraceState,
} from '@/services/web-search/webSearchTrace';

interface WebSearchTraceProps {
  trace: WebSearchTraceState;
  /** While the assistant is still streaming we keep the trace expanded. */
  isLive?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

const PHASE_LABEL: Record<WebSearchPhase, string> = {
  searching: 'Searching',
  found: 'Found sources',
  preparing: 'Preparing answer',
  complete: 'Complete',
  failed: 'Failed',
};

function StatusBadge({ phase, isLive }: { phase: WebSearchPhase; isLive?: boolean }) {
  const tone =
    phase === 'failed'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : phase === 'complete'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'border-accent/30 bg-accent/10 text-accent-foreground';

  const Icon =
    phase === 'failed'
      ? XCircle
      : phase === 'complete'
        ? CheckCircle2
        : phase === 'searching'
          ? Search
          : phase === 'found'
            ? Globe
            : Sparkles;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        tone
      )}
    >
      {isLive && phase !== 'complete' && phase !== 'failed' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {PHASE_LABEL[phase]}
    </span>
  );
}

function FaviconImg({ src, alt }: { src?: string | null; alt: string }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <Globe className="h-2.5 w-2.5" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setErrored(true)}
      className="h-3.5 w-3.5 shrink-0 rounded-sm bg-muted object-contain"
    />
  );
}

function eventLabel(evt: WebSearchTraceEvent): string {
  switch (evt.type) {
    case 'status':
      return evt.label;
    case 'results':
      return evt.count > 0 ? `Found ${evt.count} source${evt.count === 1 ? '' : 's'}` : 'No sources found';
    case 'done':
      return 'Done';
    case 'error':
      return `Failed: ${evt.message}`;
    default:
      return '';
  }
}

function eventIcon(evt: WebSearchTraceEvent): React.ReactNode {
  if (evt.type === 'status') {
    if (evt.phase === 'searching') return <Search className="h-3.5 w-3.5" />;
    if (evt.phase === 'preparing') return <Sparkles className="h-3.5 w-3.5" />;
    return <Globe className="h-3.5 w-3.5" />;
  }
  if (evt.type === 'results') return <Globe className="h-3.5 w-3.5" />;
  if (evt.type === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (evt.type === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Sparkles className="h-3.5 w-3.5" />;
}

function TraceRow({ evt }: { evt: WebSearchTraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasSources = evt.type === 'results' && evt.sources.length > 0;
  const isExpandable = hasSources;

  return (
    <li className="relative pl-6">
      <span className="absolute left-1.5 top-2 h-1.5 w-1.5 rounded-full bg-accent/70 ring-4 ring-background" />
      <div
        className={cn(
          'flex items-start gap-2 text-xs',
          isExpandable && 'cursor-pointer select-none'
        )}
        onClick={() => isExpandable && setExpanded((v) => !v)}
      >
        <span className="mt-0.5 text-muted-foreground">{eventIcon(evt)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-foreground">
            <span className="leading-snug">{eventLabel(evt)}</span>
            {isExpandable && (
              <span className="text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </span>
            )}
          </div>
          {expanded && hasSources && evt.type === 'results' && (
            <ul className="mt-1.5 space-y-1 rounded-md border border-border/60 bg-muted/40 p-2">
              {evt.sources.slice(0, 8).map((s, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[11px] text-foreground/80">
                  <FaviconImg src={s.favicon} alt="" />
                  <span className="truncate">{s.title}</span>
                  {s.domain && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {s.domain}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

export function WebSearchTrace({
  trace,
  isLive,
  defaultExpanded,
  className,
}: WebSearchTraceProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? !!isLive);

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card/60 backdrop-blur-sm',
        className
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-medium text-foreground">Web Search</span>
          <StatusBadge phase={trace.status} isLive={isLive} />
        </div>
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {trace.events.length === 0 ? (
            <p className="pl-2 text-xs text-muted-foreground">
              {isLive ? 'Starting search…' : 'No trace recorded.'}
            </p>
          ) : (
            <ol className="relative space-y-1.5 border-l border-border/60 pl-2">
              {trace.events.map((evt, i) => (
                <TraceRow key={`${evt.type}-${i}-${evt.ts}`} evt={evt} />
              ))}
            </ol>
          )}

          {trace.answer && (
            <div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Tavily summary
              </p>
              <p className="whitespace-pre-wrap text-[11px] leading-snug text-foreground/80">
                {trace.answer}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
