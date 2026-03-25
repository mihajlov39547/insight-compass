import React from 'react';
import { Check, X, Sparkles } from 'lucide-react';
import { DbDocument } from '@/hooks/useDocuments';
import type { ChunkStats } from '@/hooks/useDocumentChunkStats';

interface Props {
  doc: DbDocument;
  chunkStats?: ChunkStats;
}

function Row({ label, available, detail }: { label: string; available: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {available ? (
        <Check className="h-3 w-3 text-green-600 shrink-0" />
      ) : (
        <X className="h-3 w-3 text-muted-foreground shrink-0" />
      )}
      <span className={available ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      {detail && <span className="text-muted-foreground/70 ml-auto text-[11px]">{detail}</span>}
    </div>
  );
}

export function DocumentUsability({ doc, chunkStats }: Props) {
  const isCompleted = doc.processing_status === 'completed';
  const hasChunks = (chunkStats?.chunkCount ?? 0) > 0;
  const hasEmbeddings = (chunkStats?.embeddedCount ?? 0) > 0;
  const allEmbedded = hasChunks && chunkStats!.embeddedCount === chunkStats!.chunkCount;
  const semanticReady = isCompleted && allEmbedded;

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      {/* Content analysis */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Content analysis</p>
        <Row label="Extracted text" available={isCompleted} />
        <Row label="Summary" available={!!doc.summary} />
        <Row label="Detected language" available={!!doc.detected_language} detail={doc.detected_language?.toUpperCase()} />
      </div>

      {/* Search capabilities */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Search capabilities</p>
        <Row label="Keyword search" available={isCompleted} />
        <Row
          label="Chunked for retrieval"
          available={hasChunks}
          detail={hasChunks ? `${chunkStats!.chunkCount} chunks` : undefined}
        />
        <Row
          label="Embeddings available"
          available={hasEmbeddings}
          detail={hasEmbeddings ? `${chunkStats!.embeddedCount}/${chunkStats!.chunkCount}` : undefined}
        />
        <Row label="Semantic search" available={semanticReady} />
        <Row label="Hybrid retrieval" available={semanticReady} />
      </div>

      {/* AI readiness */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">AI readiness</p>
        <Row label="Usable in grounded chat" available={semanticReady} />
        <Row label="Ready for AI answers" available={semanticReady} />
      </div>

      {/* Chunk metadata summary */}
      {hasChunks && chunkStats!.avgTokenCount != null && (
        <div className="text-[11px] text-muted-foreground/70 pt-1">
          Avg. chunk size: ~{Math.round(chunkStats!.avgTokenCount)} tokens
        </div>
      )}
    </div>
  );
}
