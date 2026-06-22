import React from 'react';
import { Share2, Download } from 'lucide-react';
import { PinnedMessagesPanel } from './PinnedMessagesPanel';
import { ChatSearchControl } from './ChatSearchControl';
import type { PinContext } from '@/hooks/useMessagePins';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from 'react-i18next';

interface ChatFloatingToolsProps {
  pinCtx: PinContext | null;
  searchMode: 'project' | 'notebook';
  messages: Array<{ id: string; role: string; content: string }>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onShare?: () => void;
  onExport?: () => void;
}

/**
 * Reusable floating toolbar anchored top-right of the chat transcript.
 * Groups the pinned-messages panel and the in-chat search control so
 * placement, spacing and z-index stay consistent across Project Chat
 * and Notebook Chat — and don't conflict with the minimap or
 * scroll-to-top button.
 */
export function ChatFloatingTools({ pinCtx, searchMode, messages, scrollContainerRef, onShare, onExport }: ChatFloatingToolsProps) {
  const { t } = useTranslation();
  const iconBtn = "h-8 w-8 inline-flex items-center justify-center rounded-full border border-border/60 bg-background/90 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-background shadow-sm transition-colors";
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
      {onExport && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onExport}
                aria-label={t('chatExport.title', 'Export conversation')}
                className={iconBtn}
              >
                <Download className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t('chatExport.title', 'Export conversation')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {onShare && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onShare}
                aria-label={t('projectDashboard.share', 'Share')}
                className={iconBtn}
              >
                <Share2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t('projectDashboard.share', 'Share')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
