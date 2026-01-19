import React from 'react';
import { User, Sparkles, FileText } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Message, modelOptions } from '@/data/mockData';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const modelName = message.modelId 
    ? modelOptions.find(m => m.id === message.modelId)?.name 
    : null;

  return (
    <div className={cn(
      "flex gap-3 animate-fade-in",
      isUser ? "flex-row-reverse" : "flex-row"
    )}>
      {/* Avatar */}
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

      {/* Message Content */}
      <div className={cn(
        "max-w-[75%] space-y-2",
        isUser ? "items-end" : "items-start"
      )}>
        <div className={cn(
          isUser ? "chat-bubble-user" : "chat-bubble-assistant"
        )}>
          {/* Render markdown-like content */}
          <MessageContent content={message.content} />
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <div className="space-y-1.5 px-1">
            <p className="text-xs font-medium text-muted-foreground">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((source, idx) => (
                <Badge 
                  key={idx} 
                  variant="secondary" 
                  className="gap-1.5 py-1 px-2 text-xs font-normal cursor-pointer hover:bg-secondary/80"
                >
                  <FileText className="h-3 w-3" />
                  <span className="truncate max-w-[150px]">{source.title}</span>
                  <span className="text-accent font-medium">{Math.round(source.relevance * 100)}%</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Timestamp and Model Tag */}
        <div className={cn(
          "flex items-center gap-2 px-1",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
          <p className="text-[10px] text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          {modelName && (
            <span className="text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
              {modelName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  // Simple markdown-like parsing
  const lines = content.split('\n');
  
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        // Headers
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <p key={idx} className="font-semibold text-foreground">
              {line.replace(/\*\*/g, '')}
            </p>
          );
        }
        
        // Bold text within line
        if (line.includes('**')) {
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={idx}>
              {parts.map((part, partIdx) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={partIdx}>{part.replace(/\*\*/g, '')}</strong>;
                }
                return <span key={partIdx}>{part}</span>;
              })}
            </p>
          );
        }
        
        // List items
        if (line.startsWith('- ') || line.match(/^\d+\.\s/)) {
          const text = line.replace(/^[-\d.]\s*/, '');
          return (
            <div key={idx} className="flex gap-2">
              <span className="text-accent">•</span>
              <span>{text}</span>
            </div>
          );
        }
        
        // Tables (simple detection)
        if (line.includes('|')) {
          const cells = line.split('|').filter(c => c.trim());
          if (cells.length > 0 && !line.includes('---')) {
            return (
              <div key={idx} className="flex gap-4 py-1 text-xs">
                {cells.map((cell, cellIdx) => (
                  <span key={cellIdx} className="min-w-[60px]">{cell.trim()}</span>
                ))}
              </div>
            );
          }
          return null;
        }
        
        // Code blocks
        if (line.startsWith('`') && line.endsWith('`')) {
          return (
            <code key={idx} className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
              {line.replace(/`/g, '')}
            </code>
          );
        }
        
        // Empty lines
        if (line.trim() === '') {
          return <div key={idx} className="h-2" />;
        }
        
        // Regular text
        return <p key={idx}>{line}</p>;
      })}
    </div>
  );
}
