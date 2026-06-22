import React from 'react';
import { Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useIsMessagePinned, useToggleMessagePin, type PinContext } from '@/hooks/useMessagePins';
import { toast } from 'sonner';

interface MessagePinButtonProps {
  ctx: PinContext | null;
  messageId: string;
  messageRole: string;
  content: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function MessagePinButton({ ctx, messageId, messageRole, content, className, size = 'sm' }: MessagePinButtonProps) {
  const { t } = useTranslation();
  const { pinned, pinId } = useIsMessagePinned(ctx, messageId);
  const toggle = useToggleMessagePin();

  if (!ctx) return null;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle.mutate(
      { ctx, messageId, messageRole, content, isCurrentlyPinned: pinned, pinId },
      {
        onError: (err: any) => {
          toast.error(err?.message || t('chatPins.toggleFailed', 'Failed to update pin'));
        },
      },
    );
  };

  const Icon = pinned ? Pin : Pin;
  const iconCls = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={pinned ? t('chatPins.unpin', 'Unpin message') : t('chatPins.pin', 'Pin message')}
      title={pinned ? t('chatPins.unpin', 'Unpin message') : t('chatPins.pin', 'Pin message')}
      disabled={toggle.isPending}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors',
        pinned
          ? 'bg-accent/15 text-accent hover:bg-accent/25'
          : 'bg-muted/50 text-muted-foreground/70 hover:text-foreground',
        toggle.isPending && 'opacity-60 cursor-wait',
        className,
      )}
    >
      <Icon className={cn(iconCls, pinned && 'fill-current')} />
      {pinned ? t('chatPins.pinned', 'Pinned') : t('chatPins.pin', 'Pin')}
    </button>
  );
}
