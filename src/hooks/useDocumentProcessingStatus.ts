import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface ActivityInfo {
  activityKey: string;
  activityName: string;
  handlerKey: string;
  status: string;
  isOptional: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  attemptCount: number;
  durationMs: number | null;
}

export interface ProcessingReadiness {
  textExtracted: boolean;
  languageDetected: boolean;
  summaryReady: boolean;
  keywordSearchReady: boolean;
  semanticSearchReady: boolean;
  hybridReady: boolean;
  groundedChatReady: boolean;
  questionEnrichmentReady: boolean;
}

export interface ProcessingMetrics {
  chunkCount: number;
  embeddingCount: number;
  embeddingCoverage: number;
  questionCount: number;
  embeddedQuestionCount: number;
}

export interface DocumentProcessingStatus {
  documentStatus: string;
  workflowStatus: string | null;
  workflowRunId: string | null;
  currentStage: string;
  runningActivities: ActivityInfo[];
  completedActivities: ActivityInfo[];
  failedActivities: ActivityInfo[];
  lastCompletedActivity: ActivityInfo | null;
  elapsedSeconds: number | null;
  progressPercent: number;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  readiness: ProcessingReadiness;
  metrics: ProcessingMetrics;
  warnings: string[];
}

export interface DocumentStatusPresentation {
  primaryLabel: string;
  primaryTone: 'ready' | 'partial' | 'processing' | 'failed';
  secondaryLabel: string | null;
  isCoreReady: boolean;
  isPartiallyReady: boolean;
}

const ACTIVITY_LABELS: Record<string, string> = {
  'document.prepare_run': 'Initializing',
  'document.load_source': 'Loading file',
  'document.compute_file_fingerprint': 'Computing fingerprint',
  'document.detect_file_type': 'Detecting file type',
  'document.inspect_pdf_text_layer': 'Inspecting PDF',
  'document.extract_pdf_text': 'Extracting PDF text',
  'document.extract_docx_text': 'Extracting DOCX text',
  'document.extract_doc_text': 'Extracting DOC text',
  'document.extract_spreadsheet_text': 'Extracting spreadsheet',
  'document.extract_presentation_text': 'Extracting presentation',
  'document.extract_email_text': 'Extracting email',
  'document.extract_plain_text_like_content': 'Extracting text',
  'document.extract_text': 'Extracting text',
  'document.ocr_pdf': 'OCR scanning PDF',
  'document.ocr_image': 'OCR scanning image',
  'document.extract_image_metadata': 'Reading image metadata',
  'document.normalize_technical_analysis_output': 'Normalizing content',
  'document.persist_analysis_metadata': 'Saving metadata',
  'document.assess_quality': 'Assessing quality',
  'document.detect_language_and_stats': 'Detecting language',
  'document.generate_summary': 'Generating summary',
  'document.build_search_index': 'Building search index',
  'document.chunk_text': 'Chunking for retrieval',
  'document.generate_chunk_embeddings': 'Generating embeddings',
  'document.generate_chunk_questions': 'Generating suggested questions',
  'document.finalize_document': 'Finalizing',
};

export function getActivityLabel(activityKey: string): string {
  return ACTIVITY_LABELS[activityKey] || activityKey.replace(/^document\./, '').replace(/_/g, ' ');
}

export function getUserFacingStage(status: DocumentProcessingStatus): string {
  if (status.documentStatus === 'completed') return 'Completed';
  if (status.documentStatus === 'failed') return 'Failed';

  if (status.runningActivities.length > 0) {
    return status.runningActivities
      .map(a => getActivityLabel(a.activityKey))
      .join(', ');
  }

  if (status.currentStage === 'queued') return 'Queued';
  if (status.currentStage.startsWith('after:')) {
    const afterKey = status.currentStage.replace('after:', '');
    return `After ${getActivityLabel(afterKey).toLowerCase()}`;
  }

  return getActivityLabel(status.currentStage);
}

const OPTIONAL_BACKGROUND_KEYS = new Set([
  'document.generate_chunk_questions',
]);

function getBackgroundLabel(activityKey: string): string {
  switch (activityKey) {
    case 'document.generate_chunk_questions':
      return 'Enhancing retrieval in background';
    default:
      return `Enhancing in background: ${getActivityLabel(activityKey).toLowerCase()}`;
  }
}

function getBlockingStageLabel(status: DocumentProcessingStatus): string {
  const blocking = status.runningActivities.filter(
    (a) => !a.isOptional && !OPTIONAL_BACKGROUND_KEYS.has(a.activityKey)
  );

  if (blocking.length > 0) {
    return blocking.map((a) => getActivityLabel(a.activityKey)).join(', ');
  }

  return getUserFacingStage(status);
}

function getBackgroundActivityLabel(status: DocumentProcessingStatus): string | null {
  const background = status.runningActivities.find(
    (a) => a.isOptional || OPTIONAL_BACKGROUND_KEYS.has(a.activityKey)
  );
  if (!background) return null;
  return getBackgroundLabel(background.activityKey);
}

export function deriveDocumentStatusPresentation(
  status: DocumentProcessingStatus
): DocumentStatusPresentation {
  if (status.documentStatus === 'failed') {
    return {
      primaryLabel: 'Failed',
      primaryTone: 'failed',
      secondaryLabel: null,
      isCoreReady: false,
      isPartiallyReady: false,
    };
  }

  const hasChunks = status.metrics.chunkCount > 0;
  const hasEmbeddings = status.metrics.embeddingCount > 0 && status.metrics.embeddingCoverage >= 90;
  const searchReady = status.readiness.keywordSearchReady || status.readiness.semanticSearchReady || status.readiness.hybridReady;
  const coreReady = status.readiness.textExtracted && hasChunks && hasEmbeddings && searchReady;
  const partiallyReady = status.readiness.textExtracted && (searchReady || hasEmbeddings);

  const backgroundLabel = getBackgroundActivityLabel(status);

  if (coreReady || status.readiness.groundedChatReady || status.documentStatus === 'completed') {
    return {
      primaryLabel: status.readiness.groundedChatReady ? 'Ready for chat' : 'Ready for search and chat',
      primaryTone: 'ready',
      secondaryLabel: backgroundLabel,
      isCoreReady: true,
      isPartiallyReady: false,
    };
  }

  if (partiallyReady) {
    return {
      primaryLabel: 'Partially ready',
      primaryTone: 'partial',
      secondaryLabel: backgroundLabel,
      isCoreReady: false,
      isPartiallyReady: true,
    };
  }

  return {
    primaryLabel: getBlockingStageLabel(status),
    primaryTone: 'processing',
    secondaryLabel: backgroundLabel,
    isCoreReady: false,
    isPartiallyReady: false,
  };
}

export function useDocumentProcessingStatus(documentId: string | null, enabled = true) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['document-processing-status', documentId],
    queryFn: async (): Promise<DocumentProcessingStatus | null> => {
      if (!documentId) return null;

      const { data, error } = await supabase.rpc(
        'get_document_processing_status' as any,
        { p_document_id: documentId }
      );

      if (error) {
        console.warn('[processing-status] RPC error', error.message);
        return null;
      }

      if (!data || (data as any).error) return null;

      const raw = data as any;
      return {
        documentStatus: raw.documentStatus ?? 'unknown',
        workflowStatus: raw.workflowStatus ?? null,
        workflowRunId: raw.workflowRunId ?? null,
        currentStage: raw.currentStage ?? 'unknown',
        runningActivities: raw.runningActivities ?? [],
        completedActivities: raw.completedActivities ?? [],
        failedActivities: raw.failedActivities ?? [],
        lastCompletedActivity: raw.lastCompletedActivity ?? null,
        elapsedSeconds: raw.elapsedSeconds ?? null,
        progressPercent: raw.progressPercent ?? 0,
        startedAt: raw.startedAt ?? null,
        completedAt: raw.completedAt ?? null,
        retryCount: raw.retryCount ?? 0,
        readiness: {
          textExtracted: raw.readiness?.textExtracted ?? false,
          languageDetected: raw.readiness?.languageDetected ?? false,
          summaryReady: raw.readiness?.summaryReady ?? false,
          keywordSearchReady: raw.readiness?.keywordSearchReady ?? false,
          semanticSearchReady: raw.readiness?.semanticSearchReady ?? false,
          hybridReady: raw.readiness?.hybridReady ?? false,
          groundedChatReady: raw.readiness?.groundedChatReady ?? false,
          questionEnrichmentReady: raw.readiness?.questionEnrichmentReady ?? false,
        },
        metrics: {
          chunkCount: raw.metrics?.chunkCount ?? 0,
          embeddingCount: raw.metrics?.embeddingCount ?? 0,
          embeddingCoverage: raw.metrics?.embeddingCoverage ?? 0,
          questionCount: raw.metrics?.questionCount ?? 0,
          embeddedQuestionCount: raw.metrics?.embeddedQuestionCount ?? 0,
        },
        warnings: raw.warnings ?? [],
      };
    },
    enabled: !!user && !!documentId && enabled,
    refetchInterval: (query) => {
      const status = query.state.data;
      if (!status) return 3000;
      if (status.documentStatus === 'completed' || status.documentStatus === 'failed') return false;
      // Poll faster while actively processing
      if (status.runningActivities.length > 0) return 2000;
      return 3000;
    },
  });
}
