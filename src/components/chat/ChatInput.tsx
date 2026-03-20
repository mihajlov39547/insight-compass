import React, { useState } from 'react';
import { Paperclip, Send, Settings2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useApp } from '@/contexts/AppContext';
import { modelOptions, DEFAULT_MODEL_ID } from '@/data/mockData';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string, modelId?: string) => void;
  isGenerating?: boolean;
}

export function ChatInput({ onSend, isGenerating }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const { setShowSettings, setShowDocuments, setDocumentScope, selectedChatId } = useApp();

  const currentModel = modelOptions.find(m => m.id === selectedModel) ?? modelOptions[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && selectedChatId && !isGenerating) {
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

  if (!selectedChatId) return null;

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
            <div className="h-4 w-px bg-border" />
            <Tooltip><TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setShowDocuments(true)}>
                <Paperclip className="h-4 w-4" />
              </Button>
            </TooltipTrigger><TooltipContent>Attach files</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setShowSettings('prompt')}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger><TooltipContent>Prompt settings</TooltipContent></Tooltip>
            <Button type="submit" size="icon" disabled={!message.trim() || isGenerating} className={cn("h-8 w-8 rounded-lg transition-all", message.trim() && !isGenerating ? "bg-accent hover:bg-accent/90 text-accent-foreground" : "bg-muted text-muted-foreground")}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-end mt-2 px-1">
          <span className="text-xs text-muted-foreground">
            {isGenerating ? 'AI is generating a response...' : <>Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to send</>}
          </span>
        </div>
      </form>
    </div>
  );
}
