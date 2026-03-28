import React from 'react';
import { Search, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface WorkspaceContextHeaderProps {
  title: React.ReactNode;
  subtitle?: string | null;
  showShare?: boolean;
  onShare?: () => void;
}

export function WorkspaceContextHeader({
  title,
  subtitle,
  showShare = false,
  onShare,
}: WorkspaceContextHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card shrink-0 animate-fade-in">
      <div className="flex-1 min-w-0">
        <div className="text-lg font-semibold text-foreground truncate">{title}</div>
        <p className="text-xs text-muted-foreground truncate">{subtitle || 'No description'}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search in this chat" className="pl-9 h-8 text-sm bg-secondary/50" />
        </div>

        {showShare && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onShare}>
            <Share2 className="h-4 w-4" /> Share
          </Button>
        )}
      </div>
    </div>
  );
}
