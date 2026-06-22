import React, { useState } from 'react';
import { Pin, X, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { usePinnedMessages, useUnpinMessage, type PinContext, type PinnedMessage } from '@/hooks/useMessagePins';
import { toast } from 'sonner';

const SCROLL_OFFSET_PX = 24;

interface PinnedMessagesPanelProps {
  ctx: PinContext | null;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}

export function PinnedMessagesPanel({ ctx, scrollContainerRef }: PinnedMessagesPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: pins = [], isLoading } = usePinnedMessages(ctx);
  const unpin = useUnpinMessage();

  if (!ctx) return null;

  const count = pins.length;

  const handleJump = (pin: PinnedMessage) => {
    const root = scrollContainerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-chat-turn-id="${CSS.escape(pin.message_id)}"]`);
    if (!el) {
      toast.message(t('chatPins.notLoaded', 'This message is not currently loaded.'));
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = root.scrollTop + (elRect.top - rootRect.top) - SCROLL_OFFSET_PX;
    root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    el.classList.add('chat-turn-highlight');
    window.setTimeout(() => el.classList.remove('chat-turn-highlight'), 1500);
    setOpen(false);
  };

  const handleUnpin = (pin: PinnedMessage) => {
    if (!ctx) return;
    unpin.mutate(
      { pinId: pin.id, ctx },
      { onError: (err: any) => toast.error(err?.message || t('chatPins.unpinFailed', 'Failed to unpin')) },
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label={t('chatPins.panelTitle', 'Pinned messages')}
                className="relative h-8 w-8 inline-flex items-center justify-center rounded-full border border-border/60 bg-background/90 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-background shadow-sm transition-colors"
              >
                <Pin className={cn('h-4 w-4', count > 0 && 'fill-current text-accent')} />
                {count > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-accent-foreground text-[9px] font-semibold inline-flex items-center justify-center">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            </SheetTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {t('chatPins.panelTitle', 'Pinned messages')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Pin className="h-4 w-4 text-accent fill-current" />
            {t('chatPins.panelTitle', 'Pinned messages')}
            {count > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({count})</span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : pins.length === 0 ? (
            <div className="text-center py-12">
              <Pin className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {t('chatPins.empty', 'No pinned messages yet')}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {t('chatPins.emptyHint', 'Pin important moments to find them quickly later.')}
              </p>
            </div>
          ) : (
            pins.map((pin) => (
              <div
                key={pin.id}
                className="group rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                    {pin.message_role === 'user'
                      ? t('chatPins.you', 'You')
                      : t('chatPins.assistant', 'Assistant')}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {new Date(pin.pinned_at).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 line-clamp-3 mb-2">
                  {pin.message_snippet}
                </p>
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleUnpin(pin)}
                    disabled={unpin.isPending}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive px-2 py-1 rounded hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    {t('chatPins.unpinAction', 'Unpin')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleJump(pin)}
                    className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 px-2 py-1 rounded hover:bg-accent/10 transition-colors"
                  >
                    {t('chatPins.jump', 'Jump to message')}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
