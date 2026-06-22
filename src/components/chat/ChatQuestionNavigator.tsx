import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface NavigatorMessage {
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
}

interface ChatQuestionNavigatorProps {
  messages: NavigatorMessage[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onJumpToMessage?: (id: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  fullText: string;
  answerSize: 'sm' | 'md' | 'lg';
}

function classifyAnswerSize(len: number): 'sm' | 'md' | 'lg' {
  if (len < 400) return 'sm';
  if (len < 1500) return 'md';
  return 'lg';
}

export function ChatQuestionNavigator({ messages, scrollContainerRef, onJumpToMessage }: ChatQuestionNavigatorProps) {
  const items = useMemo<NavItem[]>(() => {
    const out: NavItem[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'user') continue;
      const next = messages[i + 1];
      const answerLen = next && next.role === 'assistant' ? (next.content?.length ?? 0) : 0;
      const text = (m.content || '').trim();
      out.push({
        id: m.id,
        label: text.slice(0, 120),
        fullText: text,
        answerSize: classifyAnswerSize(answerLen),
      });
    }
    return out;
  }, [messages]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  // Track viewport
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Detect scrollable
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 40);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollContainerRef, items.length]);

  // IntersectionObserver to track which user message is closest to top
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || items.length === 0) return;

    const visible = new Map<string, number>(); // id -> top offset within root
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.chatTurnId;
          if (!id) continue;
          if (e.isIntersecting) {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const rootRect = root.getBoundingClientRect();
            visible.set(id, rect.top - rootRect.top);
          } else {
            visible.delete(id);
          }
        }
        // Pick id with smallest |top| (closest to top edge)
        let best: { id: string; dist: number } | null = null;
        for (const [id, top] of visible) {
          const dist = Math.abs(top);
          if (!best || dist < best.dist) best = { id, dist };
        }
        if (best) setActiveId(best.id);
      },
      { root, threshold: [0, 0.25, 0.5, 1], rootMargin: '0px 0px -60% 0px' },
    );

    const elements: HTMLElement[] = [];
    for (const item of items) {
      const el = root.querySelector<HTMLElement>(`[data-chat-turn-id="${CSS.escape(item.id)}"]`);
      if (el) {
        observer.observe(el);
        elements.push(el);
      }
    }
    return () => observer.disconnect();
  }, [scrollContainerRef, items]);

  const handleJump = useCallback(
    (id: string) => {
      const root = scrollContainerRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`[data-chat-turn-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
      el.classList.add('chat-turn-highlight');
      window.setTimeout(() => el.classList.remove('chat-turn-highlight'), 1500);
      onJumpToMessage?.(id);
    },
    [scrollContainerRef, onJumpToMessage],
  );

  const openPopover = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setPopoverOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPopoverOpen(false), 180);
  };

  // Escape closes popover
  useEffect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [popoverOpen]);

  if (isMobile) return null;
  if (items.length < 3) return null;
  if (!scrollable) return null;

  return (
    <div
      className="absolute right-1.5 top-4 bottom-4 z-20 hidden md:flex items-start pointer-events-none"
      onMouseEnter={openPopover}
      onMouseLeave={scheduleClose}
    >
      <div
        ref={railRef}
        className="pointer-events-auto flex flex-col items-end gap-1.5 py-2 px-1"
        aria-label="Chat question navigator"
      >
        {items.map((it) => {
          const active = it.id === activeId;
          const widthClass =
            it.answerSize === 'lg' ? 'w-5' : it.answerSize === 'md' ? 'w-4' : 'w-2.5';
          const heightClass = it.answerSize === 'lg' ? 'h-1' : 'h-0.5';
          return (
            <button
              key={it.id}
              type="button"
              aria-label={`Jump to question: ${it.fullText}`}
              onClick={() => handleJump(it.id)}
              className={cn(
                'rounded-full transition-all',
                heightClass,
                widthClass,
                active
                  ? 'bg-foreground/80 scale-110'
                  : 'bg-muted-foreground/30 hover:bg-muted-foreground/60',
              )}
            />
          );
        })}
      </div>

      {popoverOpen && (
        <div
          ref={popoverRef}
          onMouseEnter={openPopover}
          onMouseLeave={scheduleClose}
          className="pointer-events-auto absolute right-7 top-0 w-72 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 animate-fade-in"
          role="listbox"
        >
          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Questions
          </div>
          {items.map((it) => {
            const active = it.id === activeId;
            return (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={active}
                title={it.fullText}
                onClick={() => {
                  handleJump(it.id);
                }}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded-md text-xs truncate transition-colors',
                  active
                    ? 'bg-accent/15 text-foreground font-medium'
                    : 'text-foreground/80 hover:bg-muted',
                )}
              >
                {it.label || '(empty question)'}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
