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

const SCROLL_OFFSET_PX = 24;
const MAX_VISIBLE_ROWS = 100;

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
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Cap visible items, keep most-recent window when extremely long.
  const visibleItems = useMemo<NavItem[]>(() => {
    if (items.length <= MAX_VISIBLE_ROWS) return items;
    return items.slice(items.length - MAX_VISIBLE_ROWS);
  }, [items]);
  const trimmedCount = items.length - visibleItems.length;

  // Track viewport
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Detect scrollable — observe both container and inner content
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 40);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // Observe first child wrapper as well so newly streamed messages trigger update
    const inner = el.firstElementChild as HTMLElement | null;
    if (inner) ro.observe(inner);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollContainerRef, items.length]);

  // IntersectionObserver to track which user message is closest to top
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || visibleItems.length === 0) return;

    const visible = new Map<string, number>();
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
        let best: { id: string; dist: number } | null = null;
        for (const [id, top] of visible) {
          const dist = Math.abs(top);
          if (!best || dist < best.dist) best = { id, dist };
        }
        if (best) setActiveId(best.id);
      },
      { root, threshold: [0, 0.25, 0.5, 1], rootMargin: '0px 0px -60% 0px' },
    );

    for (const item of visibleItems) {
      const el = root.querySelector<HTMLElement>(`[data-chat-turn-id="${CSS.escape(item.id)}"]`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [scrollContainerRef, visibleItems]);

  const handleJump = useCallback(
    (id: string) => {
      const root = scrollContainerRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`[data-chat-turn-id="${CSS.escape(id)}"]`);
      if (!el) return;
      // Manual offset for comfortable spacing (avoids sticky header overlap)
      const rootRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const target = root.scrollTop + (elRect.top - rootRect.top) - SCROLL_OFFSET_PX;
      root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      setActiveId(id);
      el.classList.add('chat-turn-highlight');
      window.setTimeout(() => el.classList.remove('chat-turn-highlight'), 1500);
      onJumpToMessage?.(id);
      // Close popover after jump (consistent behavior)
      setPopoverOpen(false);
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

  // Keyboard handling on the listbox
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setPopoverOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex((prev) => {
        const next = Math.min(visibleItems.length - 1, (prev < 0 ? -1 : prev) + 1);
        rowRefs.current[next]?.focus();
        return next;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((prev) => {
        const next = Math.max(0, (prev < 0 ? visibleItems.length : prev) - 1);
        rowRefs.current[next]?.focus();
        return next;
      });
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      rowRefs.current[0]?.focus();
      setFocusIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = visibleItems.length - 1;
      rowRefs.current[last]?.focus();
      setFocusIndex(last);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && focusIndex >= 0) {
      e.preventDefault();
      const it = visibleItems[focusIndex];
      if (it) handleJump(it.id);
    }
  };

  // Auto-focus first option when popover opens via keyboard tab into it
  useEffect(() => {
    if (popoverOpen) {
      // pre-position focus on active row
      const idx = visibleItems.findIndex((i) => i.id === activeId);
      setFocusIndex(idx >= 0 ? idx : -1);
    } else {
      setFocusIndex(-1);
    }
  }, [popoverOpen, activeId, visibleItems]);

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
        className="pointer-events-auto flex flex-col items-end gap-1.5 py-2 px-1 max-h-full overflow-y-auto"
        aria-label="Chat question navigator"
        role="navigation"
      >
        {visibleItems.map((it) => {
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
              onFocus={openPopover}
              className={cn(
                'rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                heightClass,
                widthClass,
                active
                  ? 'bg-foreground/90 dark:bg-foreground scale-110'
                  : 'bg-muted-foreground/20 hover:bg-muted-foreground/50 dark:bg-muted-foreground/25 dark:hover:bg-muted-foreground/60',
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
          onKeyDown={onListKeyDown}
          tabIndex={-1}
          className="pointer-events-auto absolute right-7 top-0 w-72 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 animate-fade-in"
          role="listbox"
          aria-label="Previous questions"
          aria-activedescendant={focusIndex >= 0 ? `chat-nav-opt-${visibleItems[focusIndex]?.id}` : undefined}
        >
          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center justify-between">
            <span>Questions</span>
            {trimmedCount > 0 && (
              <span className="normal-case text-[10px] text-muted-foreground/80">
                showing last {visibleItems.length} of {items.length}
              </span>
            )}
          </div>
          {visibleItems.map((it, idx) => {
            const active = it.id === activeId;
            return (
              <button
                key={it.id}
                id={`chat-nav-opt-${it.id}`}
                ref={(el) => (rowRefs.current[idx] = el)}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={focusIndex === idx ? 0 : -1}
                title={it.fullText}
                onFocus={() => setFocusIndex(idx)}
                onClick={() => handleJump(it.id)}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded-md text-xs truncate transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
