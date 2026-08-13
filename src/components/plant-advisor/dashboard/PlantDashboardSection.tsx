import React, { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export type SectionStatusTone = 'ready' | 'pending' | 'warning' | 'optional';

interface Props {
  icon: ReactNode;
  title: string;
  /** One-line scannable summary shown while collapsed. */
  summary?: ReactNode;
  statusLabel?: string;
  statusTone?: SectionStatusTone;
  /** Short preview bullets rendered above the collapsed toggle. */
  preview?: string[];
  expandLabel: string;
  collapseLabel: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

const TONE_CLASS: Record<SectionStatusTone, string> = {
  ready: 'border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  pending: 'border-transparent bg-muted text-muted-foreground',
  warning: 'border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300',
  optional: 'border-transparent bg-muted text-muted-foreground',
};

/**
 * Shared shell for every Plant Case dashboard card: compact summary by default,
 * full existing section content behind an expandable details area.
 */
export function PlantDashboardSection({
  icon,
  title,
  summary,
  statusLabel,
  statusTone = 'pending',
  preview,
  expandLabel,
  collapseLabel,
  actions,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-xl border border-border/60 bg-card/80 shadow-sm">
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">{title}</h3>
              {statusLabel && (
                <Badge variant="outline" className={cn('text-[10px]', TONE_CLASS[statusTone])}>
                  {statusLabel}
                </Badge>
              )}
            </div>
            {summary && <div className="text-xs text-muted-foreground mt-1">{summary}</div>}
          </div>
          {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
        </div>

        {preview && preview.length > 0 && !open && (
          <ul className="space-y-1 pl-1">
            {preview.map((p, i) => (
              <li key={i} className="text-xs text-foreground/80 flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
        )}

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2 text-xs text-muted-foreground">
              <ChevronDown className={cn('h-3.5 w-3.5 mr-1.5 transition-transform', open && 'rotate-180')} />
              {open ? collapseLabel : expandLabel}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
        </Collapsible>
      </div>
    </section>
  );
}
