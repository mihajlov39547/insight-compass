import { useEffect, useMemo, useRef } from 'react';
import { Loader2, Check, AlertCircle, Clock, CircleDashed, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowDag, WorkflowDagNode, WorkflowNodeStatus } from '@/hooks/useWorkflowDag';

const NODE_W = 180;
const NODE_H = 48;
const COL_GAP = 12;
const ROW_GAP = 28;
const PAD = 12;

function statusStyles(status: WorkflowNodeStatus) {
  switch (status) {
    case 'completed':
      return 'bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-400';
    case 'failed':
    case 'dead_letter':
      return 'bg-destructive/10 border-destructive/50 text-destructive';
    case 'running':
    case 'claimed':
      return 'bg-primary/10 border-primary/50 text-primary';
    case 'queued':
    case 'waiting_retry':
      return 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400';
    case 'skipped':
    case 'cancelled':
      return 'bg-muted/40 border-border text-muted-foreground';
    case 'pending':
    default:
      return 'bg-card border-border text-muted-foreground';
  }
}

function StatusIcon({ status }: { status: WorkflowNodeStatus }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (status === 'completed') return <Check className={cls} />;
  if (status === 'failed' || status === 'dead_letter') return <AlertCircle className={cls} />;
  if (status === 'running' || status === 'claimed') return <Loader2 className={cn(cls, 'animate-spin')} />;
  if (status === 'queued' || status === 'waiting_retry') return <Clock className={cls} />;
  if (status === 'skipped' || status === 'cancelled') return <SkipForward className={cls} />;
  return <CircleDashed className={cls} />;
}

interface Laid {
  node: WorkflowDagNode;
  col: number;
  row: number;
  x: number;
  y: number;
}

function layout(dag: WorkflowDag): { nodes: Laid[]; width: number; height: number; byKey: Map<string, Laid> } {
  const nodeMap = new Map(dag.nodes.map((n) => [n.key, n]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const k of nodeMap.keys()) {
    incoming.set(k, []);
    outgoing.set(k, []);
  }
  for (const e of dag.edges) {
    if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
      outgoing.get(e.from)!.push(e.to);
      incoming.get(e.to)!.push(e.from);
    }
  }

  // Depth = longest path from any entry / orphan-root
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  function dfs(k: string): number {
    if (depth.has(k)) return depth.get(k)!;
    if (visiting.has(k)) return 0; // cycle guard
    visiting.add(k);
    const preds = incoming.get(k) || [];
    const d = preds.length === 0 ? 0 : Math.max(...preds.map(dfs)) + 1;
    visiting.delete(k);
    depth.set(k, d);
    return d;
  }
  for (const k of nodeMap.keys()) dfs(k);

  // Group by depth — depth becomes the ROW (top-down layout)
  const rows = new Map<number, WorkflowDagNode[]>();
  for (const n of dag.nodes) {
    const d = depth.get(n.key) ?? 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d)!.push(n);
  }
  for (const arr of rows.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  const sortedRows = [...rows.keys()].sort((a, b) => a - b);
  const laid: Laid[] = [];
  const byKey = new Map<string, Laid>();
  sortedRows.forEach((rowIdx, rIndex) => {
    rows.get(rowIdx)!.forEach((node, col) => {
      const x = PAD + col * (NODE_W + COL_GAP);
      const y = PAD + rIndex * (NODE_H + ROW_GAP);
      const item = { node, col, row: rIndex, x, y };
      laid.push(item);
      byKey.set(node.key, item);
    });
  });

  const maxCols = Math.max(...[...rows.values()].map((c) => c.length), 1);
  const width = PAD * 2 + maxCols * NODE_W + (maxCols - 1) * COL_GAP;
  const height = PAD * 2 + (sortedRows.length || 1) * NODE_H + Math.max(0, sortedRows.length - 1) * ROW_GAP;
  return { nodes: laid, width, height, byKey };
}

export function WorkflowDiagram({ dag }: { dag: WorkflowDag | null | undefined }) {
  const data = useMemo(() => (dag ? layout(dag) : null), [dag]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to first failed node so failures are always visible
  useEffect(() => {
    if (!data || !scrollRef.current) return;
    const failed = data.nodes.find(
      (n) => n.node.status === 'failed' || n.node.status === 'dead_letter',
    );
    if (failed) {
      scrollRef.current.scrollTo({ top: Math.max(0, failed.y - 80), behavior: 'smooth' });
    }
  }, [data]);


  if (!dag) {
    return (
      <div className="text-xs text-muted-foreground italic px-2 py-6 text-center">
        No workflow run found for this resource yet.
      </div>
    );
  }
  if (!data) return null;

  const counts = dag.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.status] = (acc[n.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{dag.workflow_key}</span>
          {' • '}
          <span>status: {dag.workflow_status}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {counts.completed ? <span className="text-green-600">✓ {counts.completed}</span> : null}
          {counts.running || counts.claimed ? <span className="text-primary">⟳ {(counts.running || 0) + (counts.claimed || 0)}</span> : null}
          {counts.failed || counts.dead_letter ? <span className="text-destructive">✕ {(counts.failed || 0) + (counts.dead_letter || 0)}</span> : null}
          {counts.pending ? <span>○ {counts.pending}</span> : null}
        </div>
      </div>

      <div className="overflow-auto rounded-md border border-border bg-muted/20 max-h-[75vh]">
        <div className="relative" style={{ width: data.width, height: data.height }}>
          <svg width={data.width} height={data.height} className="absolute inset-0 pointer-events-none">
            <defs>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-border" />
              </marker>
            </defs>
            {dag.edges.map((e, i) => {
              const from = data.byKey.get(e.from);
              const to = data.byKey.get(e.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H;
              const x2 = to.x + NODE_W / 2;
              const y2 = to.y;
              const my = (y1 + y2) / 2;
              const path = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
              const active = to.node.status === 'running' || to.node.status === 'claimed';
              return (
                <path
                  key={i}
                  d={path}
                  className={cn('fill-none', active ? 'stroke-primary/60' : 'stroke-border')}
                  strokeWidth={1.5}
                  markerEnd="url(#wf-arrow)"
                />
              );
            })}
          </svg>

          {data.nodes.map(({ node, x, y }) => (
            <div
              key={node.key}
              className={cn(
                'absolute rounded-md border px-2.5 py-1.5 text-[11px] shadow-sm transition-colors',
                statusStyles(node.status),
              )}
              style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              title={node.error_message || node.name}
            >
              <div className="flex items-center gap-1.5">
                <StatusIcon status={node.status} />
                <span className="font-medium truncate flex-1" title={node.key}>{node.name || node.key}</span>
                {node.is_entry && <span className="text-[9px] uppercase opacity-60">in</span>}
                {node.is_terminal && <span className="text-[9px] uppercase opacity-60">end</span>}
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] opacity-75">
                <span className="truncate">{node.status}</span>
                <span className="tabular-nums">
                  {node.attempt_count > 0 ? `×${node.attempt_count}` : ''}
                  {node.is_optional ? ' · opt' : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
