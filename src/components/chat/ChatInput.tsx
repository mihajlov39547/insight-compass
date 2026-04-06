import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Send, ChevronDown, Sparkles, Loader2, Plus, Globe, X, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { useApp } from '@/contexts/useApp';
import { modelOptions, DEFAULT_MODEL_ID } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface ChatPromptOptions {
  useWebSearch: boolean;
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
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [isImproving, setIsImproving] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [promptOptions, setPromptOptions] = useState<ChatPromptOptions>({ useWebSearch: false });
  const [attachedImages, setAttachedImages] = useState<PastedImage[]>([]);
  const { setShowDocuments, setDocumentScope, selectedChatId } = useApp();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
        toast.error(`Maximum ${MAX_ATTACHED_IMAGES} images allowed`);
        return prev;
      }
      const toAdd = valid.slice(0, remaining);
      if (valid.length > remaining) {
        toast.error(`Only ${remaining} more image(s) can be attached`);
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
    if (hasContent && !isGenerating) {
      onSend(
        { text: message.trim(), options: promptOptions, images: attachedImages.length > 0 ? attachedImages : undefined },
        selectedModel
      );
      setMessage('');
      setAttachedImages([]);
      setPromptOptions({ useWebSearch: false });
    }
  };

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
      if (!resp.ok) throw new Error(data.error || 'Failed to improve prompt');
      if (data.improved) {
        setMessage(data.improved);
      }
    } catch (err: any) {
      console.error('Improve prompt error:', err);
      toast.error(err.message || 'Failed to improve prompt');
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
                      alt={`Attached ${idx + 1}`}
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
                {attachedImages.length < MAX_ATTACHED_IMAGES && (
                  <div className="h-16 w-16 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                )}
              </div>
            )}

            <div className="relative px-3 pt-2 pb-1">
              {variant === 'project' && promptOptions.useWebSearch && (
                <Globe className="absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              )}
              <Textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => handleMessageChange(e.target.value)}
                onPaste={handlePaste}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                placeholder={isGenerating ? "Waiting for response..." : "Ask a question about your documents..."}
                className={cn(
                  "w-full h-auto min-h-0 resize-none border-0 bg-transparent py-2 px-2 leading-5 transition-[height] duration-150 focus-visible:ring-0 focus-visible:ring-offset-0",
                  variant === 'project' && promptOptions.useWebSearch ? "pl-9" : "pl-2"
                )}
                rows={1}
                disabled={isGenerating}
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2 min-w-0 flex-nowrap">
              <div className="shrink-0 flex items-center">
                {variant === 'project' ? (
                  <Popover open={configOpen} onOpenChange={setConfigOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-lg border-border/80">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Enable web search for this prompt</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Applies only to the next message.</p>
                        </div>
                        <Switch
                          checked={promptOptions.useWebSearch}
                          onCheckedChange={(checked) => setPromptOptions((prev) => ({ ...prev, useWebSearch: checked }))}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span className="w-8 h-8 inline-block" />
                )}
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
                        <span className="hidden sm:inline">{isImproving ? 'Improving…' : 'Improve'}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Improve prompt with AI</TooltipContent>
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
                      </TooltipTrigger><TooltipContent>Attach files</TooltipContent></Tooltip>
                    </>
                  )}

                  <Button type="submit" size="icon" disabled={!message.trim() || isGenerating} className={cn("h-8 w-8 rounded-lg transition-all", message.trim() && !isGenerating ? "bg-accent hover:bg-accent/90 text-accent-foreground" : "bg-muted text-muted-foreground")}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>

                <span className="text-[10px] text-muted-foreground pr-0.5">
                  {isGenerating ? 'Generating…' : <>Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to send</>}
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
