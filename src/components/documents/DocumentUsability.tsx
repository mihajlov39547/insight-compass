import React from 'react';
import { Check, X, Info } from 'lucide-react';
import { DbDocument } from '@/hooks/useDocuments';
import type { ChunkStats } from '@/hooks/useDocumentChunkStats';
import type { QuestionStats } from '@/hooks/useDocumentQuestionStats';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
    ? t('documentUsability.notReady')
    : (allQuestionsEmbedded && semanticReady ? t('documentUsability.ready') : t('documentUsability.partial'));

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      {/* Content analysis */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentUsability.contentAnalysis')}</p>
        <Row label={t('documentUsability.extractedText')} available={isCompleted} hint={t('documentUsability.extractedTextHint')} />
        <Row label={t('documentUsability.summary')} available={!!doc.summary} hint={t('documentUsability.summaryHint')} />
        <Row label={t('documentUsability.detectedLanguage')} available={!!doc.detected_language} detail={doc.detected_language?.toUpperCase()} />
      </div>

      {/* Retrieval pipeline */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentUsability.retrievalPipeline')}</p>
        <Row
          label={t('documentUsability.chunkedForRetrieval')}
          available={hasChunks}
          detail={hasChunks ? t('documentUsability.chunksDetail', { count: chunkStats!.chunkCount }) : undefined}
          hint={t('documentUsability.chunkedHint')}
        />
        <Row
          label={t('documentUsability.embeddingsCreated')}
          available={hasEmbeddings}
          detail={hasEmbeddings ? `${chunkStats!.embeddedCount}/${chunkStats!.chunkCount} (${embeddingCoverage}%)` : undefined}
          hint={t('documentUsability.embeddingsHint')}
        />
        {hasChunks && chunkStats!.avgTokenCount != null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70 pl-5">
            {t('documentUsability.avgChunkSize', { tokens: Math.round(chunkStats!.avgTokenCount) })}
          </div>
        )}
      </div>

      {/* Question enrichment */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentUsability.questionEnrichment')}</p>
        <Row
          label={t('documentUsability.generatedQuestions')}
          available={questionCount > 0}
          detail={questionCount.toLocaleString()}
          hint={t('documentUsability.generatedQuestionsHint')}
        />
        <Row
          label={t('documentUsability.questionEmbeddingsCreated')}
          available={embeddedQuestionCount > 0}
          detail={questionCount > 0 ? `${embeddedQuestionCount}/${questionCount}` : '0/0'}
          hint={t('documentUsability.questionEmbeddingsHint')}
        />
        <Row
          label={t('documentUsability.questionEmbeddingCoverage')}
          available={questionCount > 0}
          detail={`${questionEmbeddingCoverage}%`}
          hint={t('documentUsability.questionEmbeddingCoverageHint')}
        />
        <Row
          label={t('documentUsability.questionRetrieval')}
          available={questionRetrievalStatus === t('documentUsability.ready')}
          detail={questionRetrievalStatus}
          hint={t('documentUsability.questionRetrievalHint')}
        />
      </div>

      {/* Search capabilities */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentUsability.searchCapabilities')}</p>
        <Row label={t('documentUsability.keywordSearch')} available={isCompleted} hint={t('documentUsability.keywordSearchHint')} />
        <Row
          label={t('documentUsability.semanticSearch')}
          available={semanticReady}
          hint={t('documentUsability.semanticSearchHint')}
        />
        <Row
          label={t('documentUsability.hybridRetrieval')}
          available={semanticReady}
          hint={t('documentUsability.hybridRetrievalHint')}
        />
      </div>

      {/* AI readiness */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentUsability.aiReadiness')}</p>
        <Row
          label={t('documentUsability.usableInGrounded')}
          available={semanticReady}
          hint={t('documentUsability.usableInGroundedHint')}
        />
        <Row
          label={t('documentUsability.readyForAi')}
          available={semanticReady}
          hint={t('documentUsability.readyForAiHint')}
        />
      </div>
    </div>
  );
}
