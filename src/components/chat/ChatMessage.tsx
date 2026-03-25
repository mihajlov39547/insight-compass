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

  // Map sources to SourceItem format
  const sourceItems: SourceItem[] = (message.sources || []).map((s: any, i: number) => ({
    id: s.id || `src-${i}`,
    documentId: s.documentId || s.id || `src-${i}`,
    title: s.title,
    snippet: s.snippet || '',
    relevance: s.relevance ?? 0,
    page: s.page ?? null,
    section: s.section ?? null,
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
