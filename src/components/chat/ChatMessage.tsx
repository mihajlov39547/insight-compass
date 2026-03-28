import React from 'react';
import { User, Sparkles, Bot } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Message, modelOptions } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { MarkdownContent } from './MarkdownContent';
import { SourceAttribution, SourceItem } from './SourceAttribution';
import { useApp } from '@/contexts/AppContext';

interface ChatMessageProps {
  message: Message;
  onRetry?: () => void;
}

export function ChatMessage({ message, onRetry }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const { setActiveView, setSelectedProjectId } = useApp();
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

        {/* Sources */}
        {!isUser && sourceItems.length > 0 && (
          <SourceAttribution sources={sourceItems} onSourceClick={handleSourceClick} />
        )}

        {/* Timestamp + AI indicator */}
        <div className={cn(
          "flex items-center gap-2 px-1 flex-wrap",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
          <p className="text-[10px] text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          {!isUser && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
              <Bot className="h-2.5 w-2.5" />
              AI-generated{modelName ? ` · ${modelName}` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
