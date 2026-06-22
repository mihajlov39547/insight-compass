import React from 'react';
import { PinnedMessagesPanel } from './PinnedMessagesPanel';
import { ChatSearchControl } from './ChatSearchControl';
import type { PinContext } from '@/hooks/useMessagePins';

interface ChatFloatingToolsProps {
  pinCtx: PinContext | null;
  searchMode: 'project' | 'notebook';
  messages: Array<{ id: string; role: string; content: string }>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Reusable floating toolbar anchored top-right of the chat transcript.
 * Groups the pinned-messages panel and the in-chat search control so
 * placement, spacing and z-index stay consistent across Project Chat
 * and Notebook Chat — and don't conflict with the minimap or
 * scroll-to-top button.
 */
export function ChatFloatingTools({ pinCtx, searchMode, messages, scrollContainerRef }: ChatFloatingToolsProps) {
  return (
    <div className="absolute top-3 right-12 md:right-14 z-20 hidden md:flex items-center gap-2">
      {pinCtx && (
        <PinnedMessagesPanel ctx={pinCtx} scrollContainerRef={scrollContainerRef} />
      )}
      <ChatSearchControl
        mode={searchMode}
        variant="inline"
        messages={messages}
        scrollContainerRef={scrollContainerRef}
      />
    </div>
  );
}
