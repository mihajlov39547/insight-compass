import { useState } from 'react';
import {
  Telescope,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Sparkles,
  PenLine,
  ListChecks,
  Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResearchTraceEvent, ResearchPhase, ResearchTraceState } from '@/services/research/tavilyResearch';

interface ResearchTraceProps {
  trace: ResearchTraceState;
  /** While the assistant message is still streaming we want the trace expanded. */
  isLive?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

const PHASE_LABEL: Record<ResearchPhase, string> = {
  planning: 'Planning',
  searching: 'Searching',
  analyzing: 'Analyzing',
  writing: 'Writing',
  complete: 'Complete',
  failed: 'Failed',
};

const PHASE_ICON: Record<ResearchPhase, React.ComponentType<{ className?: string }>> = {
  planning: ListChecks,
  searching: Search,
  analyzing: Brain,
  writing: PenLine,
  complete: CheckCircle2,
  failed: XCircle,
};

function StatusBadge({ phase, isLive }: { phase: ResearchPhase; isLive?: boolean }) {
  const Icon = PHASE_ICON[phase];
  const tone =
    phase === 'failed'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : phase === 'complete'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'border-accent/30 bg-accent/10 text-accent-foreground';

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

function eventIcon(evt: ResearchTraceEvent): React.ReactNode {
  if (evt.type === 'plan') return <ListChecks className="h-3.5 w-3.5" />;
  if (evt.type === 'tool') {
    if (evt.toolName === 'WebSearch' || evt.toolName === 'ResearchSubtopic')
      return <Search className="h-3.5 w-3.5" />;
    if (evt.toolName === 'Generating') return <PenLine className="h-3.5 w-3.5" />;
    if (evt.toolName === 'Planning') return <ListChecks className="h-3.5 w-3.5" />;
    return <Sparkles className="h-3.5 w-3.5" />;
  }
  if (evt.type === 'status') {
    const phase = evt.phase;
    if (phase) {
      const Icon = PHASE_ICON[phase];
      return <Icon className="h-3.5 w-3.5" />;
    }
    return <Sparkles className="h-3.5 w-3.5" />;
  }
  if (evt.type === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (evt.type === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Sparkles className="h-3.5 w-3.5" />;
}

function eventLabel(evt: ResearchTraceEvent): string {
  switch (evt.type) {
    case 'status':
      return evt.label;
    case 'plan':
      return 'Research plan ready';
    case 'step':
      return evt.text;
    case 'tool':
      return evt.summary;
    case 'note':
      return evt.text;
    case 'done':
      return 'Research complete';
    case 'error':
      return `Failed: ${evt.message}`;
    default:
      return '';
  }
}

function TraceRow({ evt }: { evt: ResearchTraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasQueries = evt.type === 'tool' && Array.isArray(evt.queries) && evt.queries.length > 0;
  const hasPlan = evt.type === 'plan' && !!evt.text;
  const isExpandable = hasQueries || hasPlan;

  return (
    <li className="relative pl-6">
      {/* timeline dot */}
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
          {expanded && hasQueries && (
            <ul className="mt-1.5 space-y-0.5 rounded-md border border-border/60 bg-muted/40 p-2">
              {evt.type === 'tool' &&
                evt.queries!.map((q, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <Search className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="break-words">{q}</span>
                  </li>
                ))}
            </ul>
          )}
          {expanded && hasPlan && (
            <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {evt.type === 'plan' ? evt.text : ''}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export function ResearchTrace({ trace, isLive, defaultExpanded, className }: ResearchTraceProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? !!isLive);

  // Filter trace into a tight, user-friendly stream — drop bare status rows
  // that duplicate information already conveyed by tool rows.
  const displayed = trace.events.filter((evt, i, arr) => {
    if (evt.type === 'status') {
      // Drop status rows that are immediately followed by a tool row of the same phase.
      const next = arr[i + 1];
      if (next && next.type === 'tool') {
        const sameish =
          (evt.phase === 'planning' && next.toolName === 'Planning') ||
          (evt.phase === 'searching' &&
            (next.toolName === 'WebSearch' || next.toolName === 'ResearchSubtopic')) ||
          (evt.phase === 'writing' && next.toolName === 'Generating');
        if (sameish) return false;
      }
    }
    return true;
  });

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
          <Telescope className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-medium text-foreground">Research Trace</span>
          <StatusBadge phase={trace.status} isLive={isLive} />
        </div>
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {displayed.length === 0 ? (
            <p className="pl-2 text-xs text-muted-foreground">
              {isLive ? 'Starting research…' : 'No trace recorded.'}
            </p>
          ) : (
            <ol className="relative space-y-1.5 border-l border-border/60 pl-2">
              {displayed.map((evt, i) => (
                <TraceRow key={`${evt.type}-${i}-${evt.ts}`} evt={evt} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
