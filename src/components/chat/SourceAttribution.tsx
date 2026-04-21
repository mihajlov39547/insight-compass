import React, { useMemo, useState } from 'react';
import { FileText, ChevronDown, ChevronRight, ExternalLink, Globe, ScanText, X, Loader2, Network } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export interface SourceItem {
  id: string;
  title: string;
  snippet: string;
  relevance: number;
  type?: 'document' | 'web';
  page?: number | null;
  section?: string | null;
  documentId?: string;
  chunkId?: string;
  chunkIndex?: number;
  matchType?: 'semantic' | 'keyword' | 'hybrid' | 'chunk' | 'question';
  matchedQuestionText?: string | null;
  url?: string;
  favicon?: string | null;
  score?: number;
}

export interface ExtractSelection {
  url: string;
  title?: string | null;
  favicon?: string | null;
}

export interface CrawlSelectionInput {
  url: string;
  title?: string | null;
  favicon?: string | null;
}

interface SourceAttributionProps {
  sources: SourceItem[];
  onSourceClick?: (source: SourceItem) => void;
  /**
   * When provided, enables a "Select to extract" mode that lets users pick one
   * or more web sources and trigger content extraction. Only web sources can
   * be selected (extract works on URLs).
   */
  onExtract?: (selections: ExtractSelection[], question: string | null) => void | Promise<void>;
  isExtracting?: boolean;
  /**
   * When provided, renders a per-source "Crawl" button on web sources. Crawl
   * always operates on a single URL and supports optional natural-language
   * instructions.
   */
  onCrawl?: (selection: CrawlSelectionInput, instructions: string | null) => void | Promise<void>;
  isCrawling?: boolean;
  crawlingUrl?: string | null;
}

export function SourceAttribution({ sources, onSourceClick, onExtract, isExtracting, onCrawl, isCrawling, crawlingUrl }: SourceAttributionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [questionDraft, setQuestionDraft] = useState('');
  const [questionOpen, setQuestionOpen] = useState(false);
  const [crawlPopoverUrl, setCrawlPopoverUrl] = useState<string | null>(null);
  const [crawlInstructions, setCrawlInstructions] = useState('');

  // Group by document (or url for web). Memoized so hooks below don't depend on a fresh Map each render.
  const grouped = useMemo(() => {
    const map = new Map<string, SourceItem[]>();
    for (const s of sources ?? []) {
      const key = s.type === 'web' ? (s.url || s.id) : (s.documentId || s.id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [sources]);

  const extractCandidates = useMemo(() => {
    // Only web sources are extract-eligible. One entry per unique URL.
    const seen = new Set<string>();
    const out: ExtractSelection[] = [];
    for (const s of sources) {
      const isWeb = s.type === 'web' || (!!s.url && !s.documentId);
      if (!isWeb) continue;
      const url = s.url?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: s.title, favicon: s.favicon ?? null });
    }
    return out;
  }, [sources]);

  const extractEnabled = !!onExtract && extractCandidates.length > 0;

  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedUrls(new Set(extractCandidates.map((c) => c.url)));
  };

  const clearSelection = () => {
    setSelectedUrls(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedUrls(new Set());
    setQuestionDraft('');
    setQuestionOpen(false);
  };

  const runExtract = async (withQuestion: boolean) => {
    if (!onExtract || selectedUrls.size === 0) return;
    const selections = extractCandidates.filter((c) => selectedUrls.has(c.url));
    const q = withQuestion ? questionDraft.trim() : '';
    setQuestionOpen(false);
    await onExtract(selections, q.length > 0 ? q : null);
    exitSelectMode();
  };

  if (!sources || sources.length === 0) return null;

  return (
    <div className="space-y-1.5 px-1 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Sources used</p>
        {extractEnabled && (
          selectMode ? (
            <button
              type="button"
              onClick={exitSelectMode}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              aria-label="Cancel selection"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
              aria-label="Select sources to extract"
            >
              <ScanText className="h-3 w-3" /> Select to extract
            </button>
          )
        )}
      </div>

      <div className="space-y-1">
        {Array.from(grouped.entries()).map(([docId, items]) => {
          const primary = items[0];
          const sourceType = primary.type ?? 'document';
          const isWeb = sourceType === 'web';
          const isExpanded = expandedId === docId;
          const hasSnippet = items.some(i => i.snippet && i.snippet.trim().length > 0);
          const displayTitle = primary.title || (isWeb ? 'Web result' : 'Document source');
          const domain = primary.url ? (() => {
            try {
              return new URL(primary.url).hostname.replace(/^www\./, '');
            } catch {
              return null;
            }
          })() : null;

          const url = primary.url?.trim() || '';
          const isExtractable = selectMode && isWeb && !!url;
          const isSelected = isExtractable && selectedUrls.has(url);

          return (
            <Collapsible key={docId} open={isExpanded} onOpenChange={(open) => setExpandedId(open ? docId : null)}>
              <div className={cn(
                "rounded-lg border overflow-hidden transition-colors",
                isSelected ? "border-accent/60 bg-accent/5" : "border-border/60 bg-muted/30"
              )}>
                <div className="flex items-center gap-1.5">
                  {selectMode && (
                    <div className="pl-2 py-1.5">
                      {isExtractable ? (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(url)}
                          aria-label={`Select ${displayTitle}`}
                          className="h-3.5 w-3.5"
                        />
                      ) : (
                        <div className="h-3.5 w-3.5 rounded-sm border border-dashed border-muted-foreground/40" title="Not extractable" />
                      )}
                    </div>
                  )}
                  {hasSnippet && (
                    <CollapsibleTrigger asChild>
                      <button className={cn(
                        "p-1.5 hover:bg-muted/60 transition-colors text-muted-foreground",
                        !selectMode && "rounded-l-lg"
                      )}>
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                    </CollapsibleTrigger>
                  )}
                  <button
                    className={cn(
                      "flex-1 flex items-center gap-2 py-1.5 pr-2 text-left transition-colors hover:bg-muted/60",
                      !hasSnippet && !selectMode && "pl-2 rounded-l-lg",
                      !hasSnippet && selectMode && "pl-2"
                    )}
                    onClick={() => {
                      if (selectMode && isExtractable) {
                        toggleSelect(url);
                        return;
                      }
                      if (isWeb && primary.url) {
                        window.open(primary.url, '_blank', 'noopener,noreferrer');
                        return;
                      }
                      onSourceClick?.(primary);
                    }}
                  >
                    {isWeb ? (
                      primary.favicon ? (
                        <img src={primary.favicon} alt="" className="h-3.5 w-3.5 rounded-sm shrink-0" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                      )
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-accent shrink-0" />
                    )}
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-normal shrink-0">
                      {isWeb ? 'Web' : 'Document'}
                    </Badge>
                    <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
                      {displayTitle}
                    </span>
                    {isWeb && domain && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[90px]">{domain}</span>
                    )}
                    {primary.page && (
                      <span className="text-[10px] text-muted-foreground">p.{primary.page}</span>
                    )}
                    {primary.section && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">§ {primary.section}</span>
                    )}
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 font-normal">
                      {Math.round(primary.relevance * 100)}%
                    </Badge>
                    {!selectMode && (isWeb || onSourceClick) && (
                      <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    )}
                  </button>
                  {/* Per-source Crawl trigger (web sources only, not in select mode) */}
                  {!selectMode && isWeb && !!url && !!onCrawl && (
                    <Popover
                      open={crawlPopoverUrl === url}
                      onOpenChange={(open) => {
                        if (open) {
                          setCrawlPopoverUrl(url);
                          setCrawlInstructions('');
                        } else if (crawlPopoverUrl === url) {
                          setCrawlPopoverUrl(null);
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "shrink-0 inline-flex items-center gap-1 px-1.5 py-1 mr-1 rounded text-[10px] text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50",
                          )}
                          disabled={isCrawling}
                          title="Crawl this site"
                          aria-label={`Crawl ${displayTitle}`}
                        >
                          {isCrawling && crawlingUrl === url ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Network className="h-3 w-3" />
                          )}
                          <span className="hidden sm:inline">Crawl</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-3" align="end">
                        <div className="space-y-2">
                          <p className="text-xs font-medium">Crawl this site</p>
                          <p className="text-[10px] text-muted-foreground">
                            We'll crawl pages from this URL. Add optional natural-language instructions to focus the crawl and trigger an AI summary.
                          </p>
                          <div className="text-[10px] text-muted-foreground/80 truncate">
                            <span className="font-mono">{url}</span>
                          </div>
                          <Input
                            autoFocus
                            placeholder="Optional: e.g. Find pages about pricing"
                            value={crawlInstructions}
                            onChange={(e) => setCrawlInstructions(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const instr = crawlInstructions.trim();
                                setCrawlPopoverUrl(null);
                                onCrawl?.(
                                  { url, title: displayTitle, favicon: primary.favicon ?? null },
                                  instr.length > 0 ? instr : null,
                                );
                              }
                            }}
                            className="h-8 text-xs"
                            maxLength={1000}
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px]"
                              onClick={() => setCrawlPopoverUrl(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-[10px] bg-accent text-accent-foreground hover:bg-accent/90 gap-1"
                              onClick={() => {
                                const instr = crawlInstructions.trim();
                                setCrawlPopoverUrl(null);
                                onCrawl?.(
                                  { url, title: displayTitle, favicon: primary.favicon ?? null },
                                  instr.length > 0 ? instr : null,
                                );
                              }}
                              disabled={isCrawling}
                            >
                              <Network className="h-3 w-3" />
                              Crawl
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                <CollapsibleContent>
                  <div className="border-t border-border/40 px-3 py-2 space-y-2">
                    {items.filter(i => i.snippet && i.snippet.trim()).map((item, idx) => (
                      <div key={idx} className="text-[11px] leading-relaxed text-muted-foreground space-y-1">
                        <div>
                          {item.page && items.length > 1 && (
                            <span className="text-[10px] font-medium text-foreground/70 mr-1">p.{item.page}:</span>
                          )}
                          <span className="italic">"{item.snippet.slice(0, 200)}{item.snippet.length > 200 ? '…' : ''}"</span>
                        </div>
                        {item.matchType && !isWeb && (
                          <div className="flex items-center gap-2 text-[10px] text-foreground/60">
                            <span className="font-medium">Match:</span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3 font-normal capitalize">
                              {item.matchType}
                            </Badge>
                          </div>
                        )}
                        {item.matchedQuestionText && !isWeb && (
                          <div className="border-l-2 border-accent/30 pl-2 py-0.5 space-y-0.5">
                            <div className="text-[10px] font-medium text-foreground/70">Matched question:</div>
                            <div className="text-[10px] italic text-foreground/60 max-h-[40px] overflow-hidden">
                              "{item.matchedQuestionText.slice(0, 120)}{item.matchedQuestionText.length > 120 ? '…' : ''}"
                            </div>
                          </div>
                        )}
                        {isWeb && item.url && (
                          <div className="text-[10px] text-foreground/60 truncate">
                            {item.url}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>

      {selectMode && (
        <div className="flex items-center flex-wrap gap-2 pt-1.5 px-1 animate-fade-in border-t border-border/40 mt-1">
          <span className="text-[10px] text-muted-foreground">
            {selectedUrls.size} of {extractCandidates.length} selected
          </span>
          <button
            type="button"
            onClick={selectedUrls.size === extractCandidates.length ? clearSelection : selectAll}
            className="text-[10px] text-accent hover:underline"
            disabled={isExtracting}
          >
            {selectedUrls.size === extractCandidates.length ? 'Clear' : 'Select all'}
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <Popover open={questionOpen} onOpenChange={setQuestionOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1"
                  disabled={selectedUrls.size === 0 || isExtracting}
                >
                  Extract + ask
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="end">
                <div className="space-y-2">
                  <p className="text-xs font-medium">Optional follow-up question</p>
                  <p className="text-[10px] text-muted-foreground">
                    We'll extract the selected sources and an AI will answer using only that content.
                  </p>
                  <Input
                    autoFocus
                    placeholder="e.g. What are the main takeaways?"
                    value={questionDraft}
                    onChange={(e) => setQuestionDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && questionDraft.trim()) {
                        e.preventDefault();
                        runExtract(true);
                      }
                    }}
                    className="h-8 text-xs"
                    maxLength={1000}
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[10px]"
                      onClick={() => setQuestionOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-[10px] bg-accent text-accent-foreground hover:bg-accent/90"
                      onClick={() => runExtract(true)}
                      disabled={!questionDraft.trim() || isExtracting}
                    >
                      Run
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              className="h-7 text-[10px] bg-accent text-accent-foreground hover:bg-accent/90 gap-1"
              onClick={() => runExtract(false)}
              disabled={selectedUrls.size === 0 || isExtracting}
            >
              {isExtracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanText className="h-3 w-3" />}
              {isExtracting ? 'Extracting…' : 'Extract'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
