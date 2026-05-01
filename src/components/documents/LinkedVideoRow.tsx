import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Trash2,
  Video,
  Check,
  Clock,
  Loader2,
  AlertCircle,
  Zap,
  Search,
  Brain,
  MessageSquareText,
  HelpCircle,
  Languages,
  FileText,
  FileSearch,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Resource } from '@/lib/resourceClassification';
import { useResourceTranscriptDebug } from '@/hooks/useResourceTranscriptDebug';
import { useResourceTranscriptPipelineStats } from '@/hooks/useResourceTranscriptPipelineStats';
import { useResourceWorkflowTimeline, type WorkflowActivityRun } from '@/hooks/useResourceWorkflowTimeline';
import { useTranslation } from 'react-i18next';

function formatDurationFromMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function mapTranscriptStatus(resource: Resource): 'completed' | 'failed' | 'processing' {
  if (resource.transcriptStatus === 'ready') return 'completed';
  if (resource.transcriptStatus === 'failed') return 'failed';
  return 'processing';
}

function VideoStatusBadge({ status }: { status: 'completed' | 'failed' | 'processing' }) {
  const { t } = useTranslation();
  if (status === 'completed') {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 border-green-500/20">
        <Search className="h-2.5 w-2.5" /> {t('documentStatus.searchable')}
      </Badge>
    );
  }

  if (status === 'failed') {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-destructive/10 text-destructive border-destructive/20">
        <AlertCircle className="h-2.5 w-2.5" /> {t('documentStatus.failed')}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-amber-500/10 text-amber-700 border-amber-500/20">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t('documentStatus.processing')}
    </Badge>
  );
}

function ReadinessCard({
  label,
  ready,
  icon,
  detail,
}: {
  label: string;
  ready: boolean;
  icon: React.ReactNode;
  detail?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs border transition-colors ${
        ready
          ? 'bg-green-500/5 border-green-500/20 text-green-700'
          : 'bg-muted/30 border-border text-muted-foreground'
      }`}
    >
      <div className="shrink-0">{icon}</div>
      <span className="flex-1">{label}</span>
      {ready ? <Check className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0 opacity-40" />}
      {detail && <span className="text-[10px] opacity-70">{detail}</span>}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-foreground font-medium truncate" title={value}>
        {value}
      </p>
    </div>
  );
}

export function LinkedVideoRow({
  resource,
  isExpanded,
  onToggle,
  onDelete,
  onRetry,
  isDeleting,
  isRetrying,
}: {
  resource: Resource;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRetry: () => void;
  isDeleting: boolean;
  isRetrying: boolean;
}) {
  const { t } = useTranslation();
  const effectiveStatus = mapTranscriptStatus(resource);
  const { data: debug } = useResourceTranscriptDebug(resource.id, isExpanded || effectiveStatus === 'processing');
  const { data: stats } = useResourceTranscriptPipelineStats(resource.id, isExpanded || effectiveStatus === 'processing');
  const { data: workflowTimeline } = useResourceWorkflowTimeline(resource.id, isExpanded || effectiveStatus === 'processing');

  const chunkCount = stats?.chunkCount || 0;
  const embeddingCount = stats?.embeddingCount || 0;
  const embeddingCoverage = stats?.embeddingCoverage || 0;
  const questionCount = stats?.questionCount || 0;
  const transcriptReady = resource.transcriptStatus === 'ready';
  const isAIReady = transcriptReady && chunkCount > 0 && embeddingCoverage >= 90;

  // Activity key → user-friendly label mapping
  const activityLabels: Record<string, string> = {
    classify_resource: t('linkedVideo.stages.classify', 'Classifying resource'),
    fetch_transcript: t('linkedVideo.stages.fetching'),
    persist_transcript_chunks: t('linkedVideo.stages.chunking'),
    generate_transcript_chunk_embeddings: t('linkedVideo.stages.embeddings'),
    generate_transcript_chunk_questions: t('linkedVideo.stages.questions'),
    generate_transcript_question_embeddings: t('linkedVideo.stages.questionEmbeddings', 'Question embeddings'),
    finalize_resource_status: t('linkedVideo.stages.finalize'),
  };

  // Map workflow activity status to our display status
  function mapActivityStatus(s: string): 'success' | 'failed' | 'skipped' | 'running' {
    if (s === 'completed') return 'success';
    if (s === 'failed' || s === 'dead_letter') return 'failed';
    if (s === 'running' || s === 'claimed') return 'running';
    return 'skipped';
  }

  // Build timeline: prefer workflow-native data, fall back to legacy debug
  const timeline = workflowTimeline
    ? workflowTimeline.activities.map((a) => ({
        key: a.activity_key,
        label: activityLabels[a.activity_key] || a.activity_key,
        status: mapActivityStatus(a.status),
        detail: a.finished_at && a.started_at
          ? formatDurationFromMs(new Date(a.finished_at).getTime() - new Date(a.started_at).getTime())
          : a.error_message
            ? a.error_message.slice(0, 60)
            : null,
        isOptional: a.is_optional,
        errorMessage: a.error_message,
        attemptCount: a.attempt_count,
      }))
    : [
        {
          key: 'serpapi_primary',
          label: t('linkedVideo.stages.fetching'),
          status: (debug?.stages?.find((s) => s.stage === 'serpapi_primary')?.status || 'skipped') as 'success' | 'failed' | 'skipped' | 'running',
          detail: debug?.stages?.find((s) => s.stage === 'serpapi_primary')?.reason || null,
          isOptional: false,
          errorMessage: null as string | null,
          attemptCount: 0,
        },
        {
          key: 'page_probe',
          label: t('linkedVideo.stages.metadataProbe'),
          status: (debug?.stages?.find((s) => s.stage === 'page_fetch')?.status || 'skipped') as 'success' | 'failed' | 'skipped' | 'running',
          detail: debug?.stages?.find((s) => s.stage === 'page_fetch')?.reason || null,
          isOptional: false,
          errorMessage: null as string | null,
          attemptCount: 0,
        },
        {
          key: 'chunking',
          label: t('linkedVideo.stages.chunking'),
          status: (chunkCount > 0 ? 'success' : transcriptReady ? 'failed' : 'skipped') as 'success' | 'failed' | 'skipped',
          detail: chunkCount > 0 ? t('linkedVideo.details.chunksFmt', { count: chunkCount }) : null,
          isOptional: false,
          errorMessage: null as string | null,
          attemptCount: 0,
        },
        {
          key: 'embeddings',
          label: t('linkedVideo.stages.embeddings'),
          status: (embeddingCount > 0 ? 'success' : transcriptReady ? 'failed' : 'skipped') as 'success' | 'failed' | 'skipped',
          detail: embeddingCount > 0 ? `${embeddingCount}/${chunkCount}` : null,
          isOptional: false,
          errorMessage: null as string | null,
          attemptCount: 0,
        },
        {
          key: 'questions',
          label: t('linkedVideo.stages.questions'),
          status: (questionCount > 0 ? 'success' : 'skipped') as 'success' | 'skipped',
          detail: questionCount > 0 ? t('linkedVideo.details.questionsFmt', { count: questionCount }) : t('documentProcessing.optional'),
          isOptional: true,
          errorMessage: null as string | null,
          attemptCount: 0,
        },
        {
          key: 'finalize',
          label: t('linkedVideo.stages.finalize'),
          status: (transcriptReady ? 'success' : resource.transcriptStatus === 'failed' ? 'failed' : 'skipped') as 'success' | 'failed' | 'skipped',
          detail: debug?.totalDurationMs ? formatDurationFromMs(debug.totalDurationMs) : null,
          isOptional: false,
          errorMessage: null as string | null,
          attemptCount: 0,
        },
      ];

  // Total workflow duration from first started to last finished
  const workflowDuration = workflowTimeline
    ? (() => {
        const starts = workflowTimeline.activities.filter(a => a.started_at).map(a => new Date(a.started_at!).getTime());
        const ends = workflowTimeline.activities.filter(a => a.finished_at).map(a => new Date(a.finished_at!).getTime());
        if (starts.length && ends.length) return formatDurationFromMs(Math.max(...ends) - Math.min(...starts));
        return null;
      })()
    : formatDurationFromMs(debug?.totalDurationMs ?? null);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="rounded-lg border border-border bg-card transition-shadow hover:shadow-sm">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 p-3 text-left">
            <div className={cn('p-2 rounded-md bg-muted shrink-0 text-red-500')}>
              <Video className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-foreground truncate" title={resource.title}>
                  {resource.title}
                </p>
                <VideoStatusBadge status={effectiveStatus} />
                {isAIReady && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 border-green-500/20">
                    <Zap className="h-2.5 w-2.5" /> {t('aiReady')}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('linkedVideo.video')} • {t('linkedVideo.linked')}
                {resource.mediaVideoId ? ` • ${resource.mediaVideoId}` : ''}
                {resource.mediaChannelName ? ` • ${resource.mediaChannelName}` : ''}
                {' • '}
                {new Date(resource.uploadedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {resource.transcriptStatus === 'failed' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry();
                  }}
                  disabled={isRetrying}
                  title={t('linkedVideo.retryTranscript')}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                disabled={isDeleting}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 border-t border-border">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 py-3 text-xs">
              <MetaItem label={t('documentDashboard.meta.fileType')} value={t('linkedVideo.video')} />
              <MetaItem label={t('documentDashboard.meta.provider')} value={resource.provider || 'youtube'} />
              <MetaItem label={t('documentDashboard.meta.size')} value={`${resource.sizeBytes || 0} B`} />
              <MetaItem label={t('documentDashboard.meta.uploaded')} value={new Date(resource.uploadedAt).toLocaleString()} />
              {resource.mediaVideoId && <MetaItem label={t('documentDashboard.meta.videoId')} value={resource.mediaVideoId} />}
              {resource.mediaChannelName && <MetaItem label={t('documentDashboard.meta.channel')} value={resource.mediaChannelName} />}
              {resource.detectedLanguage && <MetaItem label={t('documentDashboard.meta.language')} value={resource.detectedLanguage.toUpperCase()} />}
              <MetaItem label={t('documentDashboard.meta.transcriptStatus')} value={resource.transcriptStatus || 'none'} />
            </div>

            {resource.processingError && (
              <div className="text-xs text-destructive bg-destructive/5 rounded p-2 mb-3">
                <span className="font-medium">{t('documentDashboard.errorLabel')} </span>
                {resource.processingError}
              </div>
            )}

            {resource.summary && (
              <div className="mb-3">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{t('documentDashboard.summary')}</p>
                <p className="text-xs text-foreground leading-relaxed">{resource.summary}</p>
              </div>
            )}

            <div className="space-y-3 pt-2 border-t border-border">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <VideoStatusBadge status={effectiveStatus} />
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {workflowDuration || '—'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{t('documentProcessing.lastCompleted')} </span>
                    <span className="text-foreground">
                      {timeline.filter((a) => a.status === 'success').slice(-1)[0]?.label || '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentProcessing.readiness')}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <ReadinessCard label={t('documentProcessing.items.textExtracted')} ready={transcriptReady} icon={<FileText className="h-3 w-3" />} />
                  <ReadinessCard label={t('documentProcessing.items.languageDetected')} ready={!!debug?.serpapiLanguageCode} icon={<Languages className="h-3 w-3" />} />
                  <ReadinessCard label={t('documentProcessing.items.summary')} ready={!!resource.summary} icon={<FileSearch className="h-3 w-3" />} />
                  <ReadinessCard label={t('documentProcessing.items.keywordSearch')} ready={transcriptReady && chunkCount > 0} icon={<Search className="h-3 w-3" />} />
                  <ReadinessCard label={t('documentProcessing.items.semanticSearch')} ready={embeddingCoverage >= 90 && chunkCount > 0} icon={<Brain className="h-3 w-3" />} detail={chunkCount > 0 ? `${embeddingCoverage}%` : undefined} />
                  <ReadinessCard label={t('documentProcessing.items.hybridRetrieval')} ready={transcriptReady && chunkCount > 0} icon={<Zap className="h-3 w-3" />} />
                  <ReadinessCard label={t('documentProcessing.items.groundedChat')} ready={transcriptReady && chunkCount > 0} icon={<MessageSquareText className="h-3 w-3" />} />
                  <ReadinessCard label={t('documentProcessing.items.questionEnrichment')} ready={questionCount > 0} icon={<HelpCircle className="h-3 w-3" />} detail={questionCount > 0 ? `${questionCount}` : undefined} />
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentProcessing.metrics')}</p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">{t('documentProcessing.metricLabels.chunks')} </span>
                    <span className="text-foreground font-medium tabular-nums">{chunkCount}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('documentProcessing.metricLabels.embeddings')} </span>
                    <span className="text-foreground font-medium tabular-nums">{embeddingCount}/{chunkCount}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('documentProcessing.metricLabels.coverage')} </span>
                    <span className="text-foreground font-medium tabular-nums">{embeddingCoverage}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('documentProcessing.metricLabels.questions')} </span>
                    <span className="text-foreground font-medium tabular-nums">{questionCount}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentProcessing.activityTimeline')}</p>
                <div className="space-y-0.5">
                  {timeline.map((activity) => (
                    <div key={activity.key} className="flex items-center gap-2 text-[11px]">
                      {activity.status === 'success' ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : activity.status === 'failed' ? (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                      ) : activity.status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                      <span className={activity.status === 'failed' ? 'text-destructive' : 'text-foreground'}>{activity.label}</span>
                      {activity.isOptional && (
                        <span className="text-[9px] text-muted-foreground/60 italic">{t('documentProcessing.optional')}</span>
                      )}
                      {activity.attemptCount > 1 && (
                        <span className="text-[9px] text-muted-foreground/60">×{activity.attemptCount}</span>
                      )}
                      <span className="ml-auto text-muted-foreground/50 tabular-nums">{activity.detail || ''}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
