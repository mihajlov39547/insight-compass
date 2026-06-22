import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export interface SearchableMessage {
  id: string;
  role: string;
  content: string;
}

interface ChatSearchControlProps {
  messages: SearchableMessage[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  mode: 'project' | 'notebook';
  onJumpToMessage?: (id: string) => void;
}

interface SearchResult {
  id: string;
  role: string;
  snippet: string;
}

const MIN_QUERY = 2;
const SCROLL_OFFSET_PX = 24;

function buildSnippet(content: string, query: string): string {
  const lc = content.toLowerCase();
  const i = lc.indexOf(query.toLowerCase());
  if (i < 0) return content.slice(0, 80);
  const start = Math.max(0, i - 30);
  const end = Math.min(content.length, i + query.length + 50);
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
}

function isMac() {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function ChatSearchControl({
  messages,
  scrollContainerRef,
  mode,
  onJumpToMessage,
}: ChatSearchControlProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showPopover, setShowPopover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const placeholder = mode === 'notebook'
    ? t('projectDashboard.searchInNotebook', 'Search in this notebook')
    : t('projectDashboard.searchInChat', 'Search in this chat');

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < MIN_QUERY) return [];
    const out: SearchResult[] = [];
    for (const m of messages) {
      const content = (m.content || '').trim();
      if (!content) continue;
      if (content.toLowerCase().includes(q)) {
        out.push({ id: m.id, role: m.role, snippet: buildSnippet(content, q) });
      }
    }
    return out;
  }, [query, messages]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const jumpTo = useCallback((index: number) => {
    if (results.length === 0) return;
    const safe = ((index % results.length) + results.length) % results.length;
    setActiveIndex(safe);
    const target = results[safe];
    const root = scrollContainerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-chat-turn-id="${CSS.escape(target.id)}"]`);
    if (!el) return;
    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = root.scrollTop + (elRect.top - rootRect.top) - SCROLL_OFFSET_PX;
    root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    el.classList.add('chat-turn-highlight');
    window.setTimeout(() => el.classList.remove('chat-turn-highlight'), 1500);
    onJumpToMessage?.(target.id);
  }, [results, scrollContainerRef, onJumpToMessage]);

  const next = useCallback(() => jumpTo(activeIndex + 1), [jumpTo, activeIndex]);
  const prev = useCallback(() => jumpTo(activeIndex - 1), [jumpTo, activeIndex]);

  const clear = useCallback(() => {
    setQuery('');
    setShowPopover(false);
    inputRef.current?.blur();
  }, []);

  // Global Ctrl/Cmd+F focuses our search while mounted
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'f' || e.key === 'F')) {
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName;
        const isEditable = active?.isContentEditable;
        // Allow native find if user is editing rich text outside our control
        if (isEditable) return;
        // If focus is in our own input, do nothing extra
        if (active === inputRef.current) {
          e.preventDefault();
          inputRef.current?.select();
          return;
        }
        // Allow native find if focused inside another text input/textarea (e.g., composer)
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          // Override anyway — chat search is the expected affordance
        }
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clear();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      prev();
    }
  };

  const active = focused || query.length > 0;
  const hasQuery = query.trim().length >= MIN_QUERY;
  const resultCount = results.length;
  const shortcutLabel = isMac() ? '⌘F' : 'Ctrl F';

  // Close popover when click outside
  useEffect(() => {
    if (!showPopover) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setShowPopover(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showPopover]);

  const topResults = results.slice(0, 5);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center transition-[width] duration-200 ease-out',
        active ? 'w-80' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 w-full h-9 rounded-full border bg-secondary/40 hover:bg-secondary/60 transition-colors px-2.5',
          active ? 'border-ring/50 bg-background shadow-sm ring-1 ring-ring/10' : 'border-border/60',
        )}
      >
        <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowPopover(true);
          }}
          onFocus={() => { setFocused(true); if (query) setShowPopover(true); }}
          onBlur={() => setFocused(false)}
          onKeyDown={onInputKeyDown}
          className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground min-w-0"
        />

        {hasQuery ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <span
              className="text-[11px] tabular-nums text-muted-foreground px-1"
              aria-live="polite"
              aria-atomic="true"
            >
              {resultCount > 0
                ? `${activeIndex + 1}/${resultCount}`
                : t('projectDashboard.searchNoResults', 'No results')}
            </span>
            <button
              type="button"
              aria-label={t('projectDashboard.searchPrev', 'Previous result')}
              disabled={resultCount === 0}
              onClick={prev}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('projectDashboard.searchNext', 'Next result')}
              disabled={resultCount === 0}
              onClick={next}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('projectDashboard.searchClear', 'Clear search')}
              onClick={clear}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <kbd
            className="hidden md:inline-flex shrink-0 items-center rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            aria-hidden="true"
          >
            {shortcutLabel}
          </kbd>
        )}
      </div>

      {showPopover && hasQuery && resultCount > 0 && (
        <div
          role="listbox"
          aria-label={t('projectDashboard.searchResults', 'Search results')}
          className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 animate-fade-in"
        >
          {topResults.map((r, idx) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={idx === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { jumpTo(idx); setShowPopover(false); }}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                idx === activeIndex
                  ? 'bg-accent/15 text-foreground'
                  : 'text-foreground/80 hover:bg-muted',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground shrink-0">
                  {r.role === 'user' ? t('projectDashboard.searchYou', 'You') : t('projectDashboard.searchAssistant', 'Assistant')}
                </span>
                <span className="truncate">{r.snippet}</span>
              </div>
            </button>
          ))}
          {results.length > topResults.length && (
            <div className="px-2 py-1 text-[10px] text-muted-foreground/80">
              {t('projectDashboard.searchMore', { count: results.length - topResults.length, defaultValue: '+{{count}} more' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
