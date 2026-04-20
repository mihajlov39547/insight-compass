import React from 'react';
import { User, Sparkles, Bot, Copy, Check, Trash2, Layers, Loader2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { modelOptions } from '@/config/modelOptions';
import { Message } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { MarkdownContent } from './MarkdownContent';
import { SourceAttribution, SourceItem } from './SourceAttribution';
import { ResearchTrace } from './ResearchTrace';
import { WebSearchTrace } from './WebSearchTrace';
import type { ResearchTraceState } from '@/services/research/tavilyResearch';
import type { WebSearchTraceState } from '@/services/web-search/webSearchTrace';
import type { ExtractDepth } from '@/services/tavily-extract';
import type { ExtractSelection } from './SourceAttribution';
import { useApp } from '@/contexts/useApp';

interface ChatMessageProps {
  message: Message;
  onRetry?: () => void;
  onDeletePair?: (id: string) => void;
  onExtract?: (selections: ExtractSelection[], question: string | null, depth?: ExtractDepth) => void | Promise<void>;
  isExtracting?: boolean;
}

export function ChatMessage({ message, onRetry, onDeletePair, onExtract, isExtracting }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const { setActiveView, setSelectedProjectId } = useApp();
  const [copied, setCopied] = React.useState(false);
  const [reExtractRequested, setReExtractRequested] = React.useState(false);
  const modelName = message.modelId 
    ? modelOptions.find(m => m.id === message.modelId)?.name ?? message.modelId.split('/').pop()
    : null;

  const handleSourceClick = (source: SourceItem) => {
    // Navigate to project documents view to show the document
    setActiveView('project-documents');
  };

  const extractSourceEntries = (raw: any): any[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') {
      if (Array.isArray(raw.combinedSources)) return raw.combinedSources;
      const documentSources = Array.isArray(raw.documentSources) ? raw.documentSources : [];
      const webSources = Array.isArray(raw.webSources) ? raw.webSources : [];
      return [...documentSources, ...webSources];
    }
    return [];
  };

  const getResponseLengthLabel = (raw: any): string | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = typeof raw.responseLength === 'string' ? raw.responseLength.toLowerCase() : '';
    if (value === 'concise') return 'Concise';
    if (value === 'detailed') return 'Detailed';
    if (value === 'standard') return 'Standard';
    return null;
  };

  const responseLengthLabel = getResponseLengthLabel(message.sources);

  const persistedResearchTrace: ResearchTraceState | null = (() => {
    const raw = message.sources as any;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const t = raw.researchTrace;
    if (!t || typeof t !== 'object' || !Array.isArray(t.events)) return null;
    return t as ResearchTraceState;
  })();

  const persistedWebSearchTrace: WebSearchTraceState | null = (() => {
    const raw = message.sources as any;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const t = raw.webSearchTrace;
    if (!t || typeof t !== 'object' || !Array.isArray(t.events)) return null;
    return t as WebSearchTraceState;
  })();

  // Detect if this assistant message is itself a Tavily Extract result, and
  // surface the depth + original selections so we can offer a one-click
  // "Re-extract with deeper depth" when the original was 'basic'.
  const extractMeta: {
    depth: ExtractDepth;
    selections: ExtractSelection[];
    question: string | null;
  } | null = (() => {
    const raw = message.sources as any;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.augmentationMode !== 'extract') return null;
    const ex = raw.extract;
    if (!ex || typeof ex !== 'object') return null;
    const depth: ExtractDepth = ex.extractDepth === 'advanced' ? 'advanced' : 'basic';
    const items: ExtractSelection[] = Array.isArray(raw.items)
      ? raw.items
          .filter((it: any) => it && typeof it.url === 'string' && it.url.length > 0)
          .map((it: any) => ({ url: it.url, title: it.title ?? null, favicon: it.favicon ?? null }))
      : [];
    if (items.length === 0) return null;
    return { depth, selections: items, question: typeof ex.query === 'string' ? ex.query : null };
  })();

  const canDeepReExtract =
    !!extractMeta &&
    extractMeta.depth === 'basic' &&
    !!onExtract &&
    !reExtractRequested;

  const handleDeepReExtract = async () => {
    if (!extractMeta || !onExtract) return;
    setReExtractRequested(true);
    try {
      await onExtract(extractMeta.selections, extractMeta.question, 'advanced');
    } catch {
      // Allow retry on failure
      setReExtractRequested(false);
    }
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  // Map sources to SourceItem format
  const sourceItems: SourceItem[] = extractSourceEntries(message.sources).map((s: any, i: number) => ({
    id: s.id || `src-${i}`,
    type: s.type === 'web' || (!!s.url && !s.documentId) ? 'web' : 'document',
    documentId: s.documentId || s.id || `src-${i}`,
    title: s.title || s.fileName || s.url || `Source ${i + 1}`,
    snippet: s.snippet || s.content || s.excerpt || s.summary || '',
    relevance: typeof s.relevance === 'number' ? s.relevance : (typeof s.score === 'number' ? Math.max(0, Math.min(1, s.score)) : 0),
    page: s.page ?? null,
    section: s.section ?? null,
    url: s.url,
    favicon: s.favicon ?? null,
    score: s.score,
    chunkId: s.chunkId,
    chunkIndex: s.chunkIndex,
    matchType: s.matchType,
    matchedQuestionText: s.matchedQuestionText ?? null,
  }));

  return (
    <div className={cn(
      "flex gap-3 animate-fade-in",
      isUser ? "flex-row-reverse" : "flex-row"
    )}>
      <Avatar className={cn(
        "h-8 w-8 shrink-0",
        isUser ? "bg-primary" : "bg-gradient-to-br from-accent to-accent/70"
      )}>
        <AvatarFallback className={cn(
          isUser ? "bg-primary text-primary-foreground" : "bg-transparent text-accent-foreground"
        )}>
          {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={cn(
        "max-w-[75%] space-y-2",
        isUser ? "items-end" : "items-start"
      )}>
        <div className={cn(
          isUser ? "chat-bubble-user" : "chat-bubble-assistant"
        )}>
          {isUser ? <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div> : <MarkdownContent content={message.content} />}
        </div>

        {/* Persisted research trace */}
        {!isUser && persistedResearchTrace && (
          <ResearchTrace trace={persistedResearchTrace} />
        )}

        {/* Persisted web search trace */}
        {!isUser && !persistedResearchTrace && persistedWebSearchTrace && (
          <WebSearchTrace trace={persistedWebSearchTrace} />
        )}

        {/* Sources */}
        {!isUser && sourceItems.length > 0 && (
          <SourceAttribution
            sources={sourceItems}
            onSourceClick={handleSourceClick}
            onExtract={onExtract ? (sels, q) => onExtract(sels, q, 'basic') : undefined}
            isExtracting={isExtracting}
          />
        )}

        {/* One-click deeper re-extract for thin/basic extracts */}
        {!isUser && canDeepReExtract && (
          <div className="px-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleDeepReExtract}
              disabled={isExtracting}
              className="h-7 text-[10px] gap-1.5"
              title="Re-runs Tavily Extract on the same sources with extract_depth=advanced for richer content."
            >
              {isExtracting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Layers className="h-3 w-3" />
              )}
              {isExtracting ? 'Re-extracting…' : 'Re-extract with deeper depth'}
            </Button>
          </div>
        )}

        {/* Timestamp + AI indicator */}
        <div className={cn(
          "flex items-center gap-2 px-1 flex-wrap",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
          <p className="text-[10px] text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          {isUser && onDeletePair && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  Delete
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Message</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this question and its corresponding answer from the system and database. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDeletePair(message.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!isUser && (
            <>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
                <Bot className="h-2.5 w-2.5" />
                AI-generated{modelName ? ` · ${modelName}` : ''}
              </span>
              {responseLengthLabel && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
                  {responseLengthLabel}
                </span>
              )}
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded hover:text-foreground transition-colors"
              >
                {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
