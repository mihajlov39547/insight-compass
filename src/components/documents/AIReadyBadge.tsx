import React from 'react';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface AIReadyBadgeProps {
  isReady: boolean;
}

export function AIReadyBadge({ isReady }: AIReadyBadgeProps) {
  if (!isReady) return null;
  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-accent/10 text-accent border-accent/20">
      <Sparkles className="h-2.5 w-2.5" /> AI ready
    </Badge>
  );
}
