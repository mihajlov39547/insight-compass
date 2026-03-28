import React, { useState } from 'react';
import { Paperclip, Send, ChevronDown, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useApp } from '@/contexts/AppContext';
import { modelOptions, DEFAULT_MODEL_ID } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ChatInputProps {
  onSend: (message: string, modelId?: string) => void;
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
  const { setShowSettings, setShowDocuments, setDocumentScope, selectedChatId } = useApp();

  const currentModel = modelOptions.find(m => m.id === selectedModel) ?? modelOptions[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isGenerating) {
      onSend(message.trim(), selectedModel);
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleImprovePrompt = async () => {
    if (!message.trim() || isImproving) return;
    setIsImproving(true);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/improve-prompt`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
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
        <div className={cn(
          "relative rounded-xl border transition-all duration-200",
          isFocused ? "border-accent shadow-lg shadow-accent/10" : "border-border"
        )}>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={isGenerating ? "Waiting for response..." : "Ask a question about your documents..."}
            className="min-h-[56px] max-h-[200px] resize-none border-0 bg-transparent pr-32 focus-visible:ring-0 focus-visible:ring-offset-0"
            rows={1}
            disabled={isGenerating}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
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
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          {footerLeft ?? <span />}
          <span className="text-xs text-muted-foreground">
            {isGenerating ? 'AI is generating a response...' : <>Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to send</>}
          </span>
        </div>
      </form>
    </div>
  );
}
