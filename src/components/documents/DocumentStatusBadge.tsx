import React from 'react';
import { AlertCircle, Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';

const STAGE_KEYS: Record<string, string> = {
  uploaded: 'uploaded',
  extracting_metadata: 'extracting_metadata',
  extracting_content: 'extracting_content',
  detecting_language: 'detecting_language',
  summarizing: 'summarizing',
  indexing: 'indexing',
  chunking: 'chunking',
  generating_embeddings: 'generating_embeddings',
  embedding: 'embedding',
  generating_chunk_questions: 'generating_chunk_questions',
};

export function DocumentStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  switch (status) {
    case 'completed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 border-green-500/20">
          <Search className="h-2.5 w-2.5" /> {t('documentStatus.searchable')}
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-destructive/10 text-destructive border-destructive/20">
          <AlertCircle className="h-2.5 w-2.5" /> {t('documentStatus.failed')}
        </Badge>
      );
    default: {
      const stageKey = STAGE_KEYS[status];
      const label = stageKey ? t(`documentStatus.stages.${stageKey}`) : t('documentStatus.processing');
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-amber-500/10 text-amber-700 border-amber-500/20">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> {label}
        </Badge>
      );
    }
  }
}
