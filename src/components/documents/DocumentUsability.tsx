import React from 'react';
import { Check, X } from 'lucide-react';
import { DbDocument } from '@/hooks/useDocuments';

interface Props {
  doc: DbDocument;
}

function Row({ label, available }: { label: string; available: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {available ? (
        <Check className="h-3 w-3 text-green-600 shrink-0" />
      ) : (
        <X className="h-3 w-3 text-muted-foreground shrink-0" />
      )}
      <span className={available ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

export function DocumentUsability({ doc }: Props) {
  const isCompleted = doc.processing_status === 'completed';
  return (
    <div className="space-y-1.5 pt-2 border-t border-border">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">What's available</p>
      <Row label="Extracted text" available={isCompleted} />
      <Row label="Summary" available={!!doc.summary} />
      <Row label="Detected language" available={!!doc.detected_language} />
      <Row label="Search index" available={isCompleted} />
      <Row label="Searchable in workspace" available={isCompleted} />
    </div>
  );
}
