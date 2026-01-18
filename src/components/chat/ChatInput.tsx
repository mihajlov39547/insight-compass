import React, { useState } from 'react';
import { Paperclip, Send, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';

export function ChatInput() {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const { setShowSettings } = useApp();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      // Mock send - just clear the input
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="border-t border-border bg-card p-4">
      <form onSubmit={handleSubmit}>
        <div className={cn(
          "relative rounded-xl border transition-all duration-200",
          isFocused 
            ? "border-accent shadow-lg shadow-accent/10" 
            : "border-border"
        )}>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents..."
            className="min-h-[56px] max-h-[200px] resize-none border-0 bg-transparent pr-32 focus-visible:ring-0 focus-visible:ring-offset-0"
            rows={1}
          />
          
          {/* Action buttons */}
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  type="button"
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach files</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  type="button"
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSettings('prompt')}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Prompt settings</TooltipContent>
            </Tooltip>

            <Button 
              type="submit"
              size="icon"
              disabled={!message.trim()}
              className={cn(
                "h-8 w-8 rounded-lg transition-all",
                message.trim() 
                  ? "bg-accent hover:bg-accent/90 text-accent-foreground" 
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Hints */}
        <div className="flex items-center justify-end mt-2 px-1">
          <span className="text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to send
          </span>
        </div>
      </form>
    </div>
  );
}
