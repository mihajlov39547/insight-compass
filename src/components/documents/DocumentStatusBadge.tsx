import React from 'react';
import { CheckCircle2, AlertCircle, Loader2, Search, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const STAGE_LABELS: Record<string, string> = {
  uploaded: 'Queued',
  extracting_metadata: 'Extracting metadata',
  extracting_content: 'Analyzing content',
  detecting_language: 'Detecting language',
  summarizing: 'Generating summary',
  indexing: 'Creating search index',
};

export function DocumentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 border-green-500/20">
          <Search className="h-2.5 w-2.5" /> Searchable
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-destructive/10 text-destructive border-destructive/20">
          <AlertCircle className="h-2.5 w-2.5" /> Failed
        </Badge>
      );
    default: {
      const label = STAGE_LABELS[status] || 'Processing';
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-amber-500/10 text-amber-700 border-amber-500/20">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> {label}
        </Badge>
      );
    }
  }
}
