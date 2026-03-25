import React from 'react';
import { Check, X, Info } from 'lucide-react';
import { DbDocument } from '@/hooks/useDocuments';
import type { ChunkStats } from '@/hooks/useDocumentChunkStats';
import type { QuestionStats } from '@/hooks/useDocumentQuestionStats';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  doc: DbDocument;
  chunkStats?: ChunkStats;
  questionStats?: QuestionStats;
}

function Row({ label, available, detail, hint }: { label: string; available: boolean; detail?: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {available ? (
        <Check className="h-3 w-3 text-green-600 shrink-0" />
      ) : (
        <X className="h-3 w-3 text-muted-foreground shrink-0" />
      )}
      <span className={available ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      {hint && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/50 shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] text-xs">
              {hint}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {detail && <span className="text-muted-foreground/70 ml-auto text-[11px]">{detail}</span>}
    </div>
  );
}

export function DocumentUsability({ doc, chunkStats, questionStats }: Props) {
  const toSafeInt = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  const isCompleted = doc.processing_status === 'completed';
  const hasChunks = (chunkStats?.chunkCount ?? 0) > 0;
  const hasEmbeddings = (chunkStats?.embeddedCount ?? 0) > 0;
  const allEmbedded = hasChunks && chunkStats!.embeddedCount === chunkStats!.chunkCount;
  const semanticReady = isCompleted && allEmbedded;
  const embeddingCoverage = hasChunks
    ? Math.round((chunkStats!.embeddedCount / chunkStats!.chunkCount) * 100)
    : 0;

  const questionCount = toSafeInt(questionStats?.questionCount);
  const embeddedQuestionCount = toSafeInt(questionStats?.embeddedQuestionCount);
  const allQuestionsEmbedded = questionCount > 0 && embeddedQuestionCount === questionCount;
  const questionEmbeddingCoverage = questionCount > 0
    ? Math.round((embeddedQuestionCount / questionCount) * 100)
    : 0;

  const questionRetrievalStatus = questionCount === 0
    ? 'Not ready'
    : (allQuestionsEmbedded && semanticReady ? 'Ready' : 'Partial');

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      {/* Content analysis */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Content analysis</p>
        <Row label="Extracted text" available={isCompleted} hint="Raw text has been extracted from the document" />
        <Row label="Summary" available={!!doc.summary} hint="An AI-generated summary of the document content" />
        <Row label="Detected language" available={!!doc.detected_language} detail={doc.detected_language?.toUpperCase()} />
      </div>

      {/* Retrieval pipeline */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Retrieval pipeline</p>
        <Row
          label="Chunked for retrieval"
          available={hasChunks}
          detail={hasChunks ? `${chunkStats!.chunkCount} chunks` : undefined}
          hint="Document split into smaller passages for precise retrieval"
        />
        <Row
          label="Embeddings created"
          available={hasEmbeddings}
          detail={hasEmbeddings ? `${chunkStats!.embeddedCount}/${chunkStats!.chunkCount} (${embeddingCoverage}%)` : undefined}
          hint="Document prepared for meaning-based search, not only exact keywords"
        />
        {hasChunks && chunkStats!.avgTokenCount != null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70 pl-5">
            Avg. chunk size: ~{Math.round(chunkStats!.avgTokenCount)} tokens
          </div>
        )}
      </div>

      {/* Question enrichment */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Question enrichment</p>
        <Row
          label="Generated questions"
          available={questionCount > 0}
          detail={questionCount.toLocaleString()}
          hint="Total generated question rows for this document"
        />
        <Row
          label="Question embeddings created"
          available={embeddedQuestionCount > 0}
          detail={questionCount > 0 ? `${embeddedQuestionCount}/${questionCount}` : '0/0'}
          hint="Question rows with non-null embedding vectors"
        />
        <Row
          label="Question embedding coverage"
          available={questionCount > 0}
          detail={`${questionEmbeddingCoverage}%`}
          hint="Percentage of question rows that have embeddings"
        />
        <Row
          label="Question retrieval"
          available={questionRetrievalStatus === 'Ready'}
          detail={questionRetrievalStatus}
          hint="Ready: all questions embedded and chunk retrieval ready. Partial: some embeddings missing. Not ready: no questions."
        />
      </div>

      {/* Search capabilities */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Search capabilities</p>
        <Row label="Keyword search" available={isCompleted} hint="Find documents by exact words and phrases" />
        <Row
          label="Semantic search"
          available={semanticReady}
          hint="AI finds relevant passages even when wording differs from your query"
        />
        <Row
          label="Hybrid retrieval"
          available={semanticReady}
          hint="Combines keyword and semantic search for the best results"
        />
      </div>

      {/* AI readiness */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">AI readiness</p>
        <Row
          label="Usable in grounded chat"
          available={semanticReady}
          hint="AI answers can reference this document's content for more accurate responses"
        />
        <Row
          label="Ready for AI answers"
          available={semanticReady}
          hint="All retrieval stages complete — this document fully supports AI-powered Q&A"
        />
      </div>
    </div>
  );
}
