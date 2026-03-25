import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export interface SourceItem {
  id: string;
  title: string;
  snippet: string;
  relevance: number;
  page?: number | null;
  section?: string | null;
  documentId?: string;
}

interface SourceAttributionProps {
  sources: SourceItem[];
  onSourceClick?: (source: SourceItem) => void;
}

export function SourceAttribution({ sources, onSourceClick }: SourceAttributionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!sources || sources.length === 0) return null;

  // Group by document
  const grouped = new Map<string, SourceItem[]>();
  for (const s of sources) {
    const key = s.documentId || s.id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  return (
    <div className="space-y-1.5 px-1 animate-fade-in">
      <p className="text-xs font-medium text-muted-foreground">Sources used</p>
      <div className="space-y-1">
        {Array.from(grouped.entries()).map(([docId, items]) => {
          const primary = items[0];
          const isExpanded = expandedId === docId;
          const hasSnippet = items.some(i => i.snippet && i.snippet.trim().length > 0);

          return (
            <Collapsible key={docId} open={isExpanded} onOpenChange={(open) => setExpandedId(open ? docId : null)}>
              <div className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  {hasSnippet && (
                    <CollapsibleTrigger asChild>
                      <button className="p-1.5 hover:bg-muted/60 rounded-l-lg transition-colors text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                    </CollapsibleTrigger>
                  )}
                  <button
                    className={cn(
                      "flex-1 flex items-center gap-2 py-1.5 pr-2 text-left transition-colors hover:bg-muted/60",
                      !hasSnippet && "pl-2 rounded-l-lg"
                    )}
                    onClick={() => onSourceClick?.(primary)}
                  >
                    <FileText className="h-3.5 w-3.5 text-accent shrink-0" />
                    <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
                      {primary.title}
                    </span>
                    {primary.page && (
                      <span className="text-[10px] text-muted-foreground">p.{primary.page}</span>
                    )}
                    {primary.section && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">§ {primary.section}</span>
                    )}
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 font-normal">
                      {Math.round(primary.relevance * 100)}%
                    </Badge>
                    {onSourceClick && (
                      <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    )}
                  </button>
                </div>

                <CollapsibleContent>
                  <div className="border-t border-border/40 px-3 py-2 space-y-2">
                    {items.filter(i => i.snippet && i.snippet.trim()).map((item, idx) => (
                      <div key={idx} className="text-[11px] leading-relaxed text-muted-foreground">
                        {item.page && items.length > 1 && (
                          <span className="text-[10px] font-medium text-foreground/70 mr-1">p.{item.page}:</span>
                        )}
                        <span className="italic">"{item.snippet.slice(0, 200)}{item.snippet.length > 200 ? '…' : ''}"</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
