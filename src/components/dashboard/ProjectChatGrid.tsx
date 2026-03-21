import React, { useState, useMemo } from 'react';
import { MessageSquare, FileText, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/contexts/AppContext';
import { DbChat } from '@/hooks/useChats';
import { useChatPreviews } from '@/hooks/useChatPreviews';
import { formatDistanceToNow } from 'date-fns';

const BATCH_SIZE = 6;

function formatActivity(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return formatDistanceToNow(date, { addSuffix: true });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface Props {
  chats: DbChat[];
}

export function ProjectChatGrid({ chats }: Props) {
  const { setSelectedChatId } = useApp();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  const chatIds = useMemo(() => chats.map(c => c.id), [chats]);
  const { data: previews = {} } = useChatPreviews(chatIds);

  const visibleChats = chats.slice(0, visibleCount);
  const hasMore = chats.length > visibleCount;
  const allShown = visibleCount >= chats.length;

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">
          Chats ({chats.length})
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleChats.map((chat) => {
          const preview = previews[chat.id];
          const docCount = preview?.docCount || 0;
          const lastMessage = preview?.lastMessage;

          return (
            <button
              key={chat.id}
              className="group p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 text-left transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5 cursor-pointer active:scale-[0.99]"
              onClick={() => setSelectedChatId(chat.id)}
            >
              {/* Title */}
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-accent shrink-0" />
                <span className="font-medium text-sm text-foreground truncate">
                  {chat.name}
                </span>
              </div>

              {/* Preview */}
              <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem] mb-2.5">
                {lastMessage || 'No messages yet'}
              </p>

              {/* Metadata row */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  <span>{docCount} doc{docCount !== 1 ? 's' : ''}</span>
                </div>
                <span className="ml-auto">{formatActivity(chat.updated_at)}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Progressive load / all shown */}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-accent hover:text-accent/80 gap-1"
          onClick={() => setVisibleCount(prev => prev + BATCH_SIZE)}
        >
          View all {chats.length} chats
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      )}
      {allShown && chats.length > BATCH_SIZE && (
        <p className="mt-3 text-xs text-muted-foreground text-center">All chats shown</p>
      )}
    </div>
  );
}
