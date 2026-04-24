import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Send, ChevronDown, Sparkles, Loader2, Plus, Globe, X, ImageIcon, Telescope, Youtube, BookOpen, Search, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { modelOptions, DEFAULT_MODEL_ID } from '@/config/modelOptions';
import { useApp } from '@/contexts/useApp';
import { useNotebooks } from '@/hooks/useNotebooks';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export type PromptAugmentationMode = 'none' | 'web_search' | 'research' | 'youtube_search' | 'notebook';

export interface ChatPromptOptions {
  /** Legacy convenience flag — true iff augmentationMode === 'web_search'. */
  useWebSearch: boolean;
  augmentationMode: PromptAugmentationMode;
  /** Tavily research model. Defaults to 'auto'. */
  researchModel?: 'mini' | 'pro' | 'auto';
  /** Required when augmentationMode === 'notebook' */
  notebookId?: string;
  /** Display name for selected notebook (used for chip + downstream metadata) */
  notebookName?: string;
}

export interface PastedImage {
  file: File;
  previewUrl: string;
}

export interface ChatSendPayload {
  text: string;
  options: ChatPromptOptions;
  images?: PastedImage[];
}

const MAX_TEXTAREA_ROWS = 5;
const MAX_ATTACHED_IMAGES = 5;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];

interface ChatInputProps {
  onSend: (payload: ChatSendPayload, modelId?: string) => void;
  isGenerating?: boolean;
  previousUserMessage?: string;
  previousAssistantMessage?: string;
  /** 'project' shows attach + settings; 'notebook' hides them */
  variant?: 'project' | 'notebook';
  /** Optional footer left content (e.g. source count) */
  footerLeft?: React.ReactNode;
}

export function ChatInput({ onSend, isGenerating, previousUserMessage, previousAssistantMessage, variant = 'project', footerLeft }: ChatInputProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [isImproving, setIsImproving] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [promptOptions, setPromptOptions] = useState<ChatPromptOptions>({
    useWebSearch: false,
    augmentationMode: 'none',
    researchModel: 'auto',
  });
  const [attachedImages, setAttachedImages] = useState<PastedImage[]>([]);
  const [notebookSearch, setNotebookSearch] = useState('');
  const { setShowDocuments, setDocumentScope, selectedChatId } = useApp();
  const { data: notebooks = [] } = useNotebooks();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const filteredNotebooks = useMemo(() => {
    const q = notebookSearch.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks.filter((n) => n.name.toLowerCase().includes(q));
  }, [notebooks, notebookSearch]);

  const selectedNotebook = useMemo(
    () => notebooks.find((n) => n.id === promptOptions.notebookId) ?? null,
    [notebooks, promptOptions.notebookId]
  );

  const currentModel = modelOptions.find(m => m.id === selectedModel) ?? modelOptions[0];

  const getTextareaHeights = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return { minHeight: 36, maxHeight: 120 };

    const computed = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const padding = Number.parseFloat(computed.paddingTop) + Number.parseFloat(computed.paddingBottom);
    const border = Number.parseFloat(computed.borderTopWidth) + Number.parseFloat(computed.borderBottomWidth);

    return {
      minHeight: lineHeight + padding + border,
      maxHeight: lineHeight * MAX_TEXTAREA_ROWS + padding + border,
    };
  }, []);


  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = 'auto';

    const { minHeight, maxHeight } = getTextareaHeights();

    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [getTextareaHeights]);

  useEffect(() => {
    resizeTextarea();
  }, [message, resizeTextarea]);

  const hasContent = message.trim() || attachedImages.length > 0;

  const addImages = useCallback((files: File[]) => {
    const valid = files.filter(f => ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (valid.length === 0) return;
    setAttachedImages(prev => {
      const remaining = MAX_ATTACHED_IMAGES - prev.length;
      if (remaining <= 0) {
        toast.error(t('chatInput.imageMaxToast', { count: MAX_ATTACHED_IMAGES }));
        return prev;
      }
      const toAdd = valid.slice(0, remaining);
      if (valid.length > remaining) {
        toast.error(t('chatInput.imageRemainingToast', { count: remaining }));
      }
      return [...prev, ...toAdd.map(file => ({ file, previewUrl: URL.createObjectURL(file) }))];
    });
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      attachedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasContent || isGenerating) return;
    if (promptOptions.augmentationMode === 'notebook' && !promptOptions.notebookId) {
      toast.error(t('chatInput.notebook.missingToast'));
      return;
    }
    onSend(
      { text: message.trim(), options: promptOptions, images: attachedImages.length > 0 ? attachedImages : undefined },
      selectedModel
    );
    setMessage('');
    setAttachedImages([]);
    setPromptOptions({ useWebSearch: false, augmentationMode: 'none', researchModel: 'auto' });
    setNotebookSearch('');
  };

  const setAugmentation = useCallback((mode: PromptAugmentationMode) => {
    setPromptOptions((prev) => ({
      ...prev,
      augmentationMode: mode,
      useWebSearch: mode === 'web_search',
      // Clear notebook selection when leaving notebook mode
      notebookId: mode === 'notebook' ? prev.notebookId : undefined,
      notebookName: mode === 'notebook' ? prev.notebookName : undefined,
    }));
  }, []);

  const selectNotebook = useCallback((id: string, name: string) => {
    setPromptOptions((prev) => ({
      ...prev,
      augmentationMode: 'notebook',
      useWebSearch: false,
      notebookId: id,
      notebookName: name,
    }));
  }, []);

  const clearNotebook = useCallback(() => {
    setPromptOptions((prev) => ({ ...prev, notebookId: undefined, notebookName: undefined }));
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleMessageChange = (nextValue: string) => {
    setMessage(nextValue);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const el = textareaRef.current;
    if (!el) return;

    // Check for pasted images first
    const imageFiles: File[] = [];
    if (e.clipboardData.files.length > 0) {
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        const file = e.clipboardData.files[i];
        if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      addImages(imageFiles);
      return;
    }

    // Try HTML first for formatted content, convert to plain text fallback
    const htmlContent = e.clipboardData.getData('text/html');
    const plainText = e.clipboardData.getData('text/plain') || e.clipboardData.getData('text');
    const pasteText = htmlContent ? (plainText || '') : plainText;
    if (!pasteText) return;

    e.preventDefault();
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const nextValue = message.slice(0, start) + pasteText + message.slice(end);
    setMessage(nextValue);

    // Restore cursor position after paste
    requestAnimationFrame(() => {
      const newPos = start + pasteText.length;
      el.selectionStart = el.selectionEnd = newPos;
    });
  };

  const handleImprovePrompt = async () => {
    if (!message.trim() || isImproving) return;
    setIsImproving(true);
    try {
      const resp = await fetch(
        getFunctionUrl('/functions/v1/improve-prompt'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            prompt: message,
            previousUserMessage: previousUserMessage || undefined,
            previousAssistantMessage: previousAssistantMessage || undefined,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || t('chatInput.improveError'));
      if (data.improved) {
        setMessage(data.improved);
      }
    } catch (err: any) {
      console.error('Improve prompt error:', err);
      toast.error(err.message || t('chatInput.improveError'));
    } finally {
      setIsImproving(false);
    }
  };

  if (variant === 'project' && !selectedChatId) return null;

  return (
    <div className="border-t border-border bg-card p-4">
      <form onSubmit={handleSubmit}>
        <div className="w-full max-w-[75%] mx-auto">
          <div
            className={cn(
              "rounded-xl border transition-all duration-200",
              isFocused ? "border-accent shadow-lg shadow-accent/10" : "border-border"
            )}
          >
            {/* Image previews */}
            {attachedImages.length > 0 && (
              <div className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto">
                {attachedImages.map((img, idx) => (
                  <div key={idx} className="relative group shrink-0">
                    <img
                      src={img.previewUrl}
                      alt={t('chatInput.imageAlt', { index: idx + 1 })}
                      className="h-16 w-16 rounded-lg object-cover border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Selected notebook chip (notebook mode) */}
            {promptOptions.augmentationMode === 'notebook' && selectedNotebook && (
              <div className="flex items-center gap-2 px-3 pt-2 pb-0">
                <div className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-foreground">
                  <BookOpen className="h-3.5 w-3.5 text-accent" />
                  <span className="font-medium truncate max-w-[200px]">{selectedNotebook.name}</span>
                  <button
                    type="button"
                    onClick={clearNotebook}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    aria-label={t('chatInput.notebook.remove')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
            {promptOptions.augmentationMode === 'notebook' && !selectedNotebook && (
              <div className="px-3 pt-2 pb-0 text-xs text-destructive flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" /> {t('chatInput.notebook.required')}
              </div>
            )}

            <div className="relative px-3 pt-2 pb-1">
              {promptOptions.augmentationMode === 'web_search' && (
                <Globe className="absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              )}
              {promptOptions.augmentationMode === 'research' && (
                <Telescope className="absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 text-accent" />
              )}
              {promptOptions.augmentationMode === 'youtube_search' && (
                <Youtube className="absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
              )}
              {promptOptions.augmentationMode === 'notebook' && (
                <BookOpen className="absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 text-accent" />
              )}
              <Textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => handleMessageChange(e.target.value)}
                onPaste={handlePaste}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isGenerating
                    ? t('chatInput.placeholders.waiting')
                    : promptOptions.augmentationMode === 'research'
                      ? t('chatInput.placeholders.research')
                      : promptOptions.augmentationMode === 'youtube_search'
                        ? t('chatInput.placeholders.youtube')
                        : promptOptions.augmentationMode === 'notebook'
                          ? (selectedNotebook ? t('chatInput.placeholders.notebookGrounded', { name: selectedNotebook.name }) : t('chatInput.placeholders.notebookSelect'))
                          : t('chatInput.placeholders.default')
                }
                className={cn(
                  'w-full h-auto min-h-0 resize-none border-0 bg-transparent py-2 px-2 leading-5 transition-[height] duration-150 focus-visible:ring-0 focus-visible:ring-offset-0',
                  promptOptions.augmentationMode !== 'none' ? 'pl-9' : 'pl-2'
                )}
                rows={1}
                disabled={isGenerating}
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2 min-w-0 flex-nowrap">
              <div className="shrink-0 flex items-center">
                <Popover open={configOpen} onOpenChange={setConfigOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={cn(
                        'h-8 w-8 rounded-lg border-border/80',
                        promptOptions.augmentationMode !== 'none' && 'border-accent text-accent'
                      )}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5" /> {t('chatInput.modes.webSearch')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('chatInput.modes.webSearchDesc')}
                        </p>
                      </div>
                      <Switch
                        checked={promptOptions.augmentationMode === 'web_search'}
                        onCheckedChange={(checked) => setAugmentation(checked ? 'web_search' : 'none')}
                      />
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <Telescope className="h-3.5 w-3.5" /> {t('chatInput.modes.research')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('chatInput.modes.researchDesc')}
                        </p>
                      </div>
                      <Switch
                        checked={promptOptions.augmentationMode === 'research'}
                        onCheckedChange={(checked) => setAugmentation(checked ? 'research' : 'none')}
                      />
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <Youtube className="h-3.5 w-3.5 text-destructive" /> {t('chatInput.modes.youtube')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('chatInput.modes.youtubeDesc')}
                        </p>
                      </div>
                      <Switch
                        checked={promptOptions.augmentationMode === 'youtube_search'}
                        onCheckedChange={(checked) => setAugmentation(checked ? 'youtube_search' : 'none')}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                            <BookOpen className="h-3.5 w-3.5 text-accent" /> {t('chatInput.modes.notebook')}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t('chatInput.modes.notebookDesc')}
                          </p>
                        </div>
                        <Switch
                          checked={promptOptions.augmentationMode === 'notebook'}
                          onCheckedChange={(checked) => setAugmentation(checked ? 'notebook' : 'none')}
                        />
                      </div>

                      {promptOptions.augmentationMode === 'notebook' && (
                        <div className="rounded-md border border-border/70 bg-muted/30 p-2 space-y-2">
                          {notebooks.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-3">
                              {t('chatInput.modes.noNotebooks')}
                            </p>
                          ) : (
                            <>
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                  value={notebookSearch}
                                  onChange={(e) => setNotebookSearch(e.target.value)}
                                  placeholder={t('chatInput.modes.searchPlaceholder')}
                                  className="h-8 pl-7 text-xs"
                                />
                              </div>
                              <div className="max-h-48 overflow-y-auto space-y-0.5">
                                {filteredNotebooks.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-2">{t('chatInput.modes.noMatches')}</p>
                                ) : (
                                  filteredNotebooks.map((nb) => {
                                    const active = promptOptions.notebookId === nb.id;
                                    return (
                                      <button
                                        type="button"
                                        key={nb.id}
                                        onClick={() => selectNotebook(nb.id, nb.name)}
                                        className={cn(
                                          'w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                                          active ? 'bg-accent/15 text-accent-foreground' : 'hover:bg-muted'
                                        )}
                                      >
                                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
                                        <span className="flex-1 truncate">{nb.name}</span>
                                        {active && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {promptOptions.augmentationMode !== 'none' && (
                      <p className="text-[10px] text-muted-foreground border-t border-border/60 pt-2">
                        {t('chatInput.modes.appliesNext')}
                      </p>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              <div className="shrink-0 flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5 flex-nowrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-8 px-2 text-xs gap-1 transition-opacity",
                          message.trim() ? "text-muted-foreground hover:text-accent" : "opacity-0 pointer-events-none"
                        )}
                        onClick={handleImprovePrompt}
                        disabled={!message.trim() || isImproving || isGenerating}
                      >
                        {isImproving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        <span className="hidden sm:inline">{isImproving ? t('chatInput.improving') : t('chatInput.improve')}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('chatInput.improveTooltip')}</TooltipContent>
                  </Tooltip>

                  <div className="h-4 w-px bg-border" />

                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground gap-1">
                            <span className="max-w-[100px] truncate">{currentModel.name}</span>
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px]">
                        <p className="font-medium">{currentModel.name}</p>
                        <p className="text-xs text-muted-foreground">{currentModel.description}</p>
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" className="w-48">
                      {modelOptions.map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onClick={() => setSelectedModel(model.id)}
                          className={cn(
                            "text-sm",
                            selectedModel === model.id && "bg-accent/10 text-accent font-medium"
                          )}
                        >
                          {model.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {variant === 'project' && (
                    <>
                      <div className="h-4 w-px bg-border" />
                      <Tooltip><TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => { setDocumentScope('chat'); setShowDocuments(true); }}>
                          <Paperclip className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger><TooltipContent>{t('chatInput.attach')}</TooltipContent></Tooltip>
                    </>
                  )}

                  <Button type="submit" size="icon" disabled={!hasContent || isGenerating} className={cn("h-8 w-8 rounded-lg transition-all", hasContent && !isGenerating ? "bg-accent hover:bg-accent/90 text-accent-foreground" : "bg-muted text-muted-foreground")}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>

                <span className="text-[10px] text-muted-foreground pr-0.5">
                  {isGenerating ? t('chatInput.generating') : <>{t('chatInput.pressEnter')} <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> {t('chatInput.pressEnterSuffix')}</>}
                </span>
              </div>
            </div>
          </div>
        </div>
        {footerLeft ? <div className="mt-2 px-1">{footerLeft}</div> : null}
      </form>
    </div>
  );
}
