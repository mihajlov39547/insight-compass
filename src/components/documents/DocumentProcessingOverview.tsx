import React from 'react';
import {
  Check, X, Loader2, Clock, AlertTriangle, Zap,
  FileSearch, Languages, FileText, Search, Brain, MessageSquareText, HelpCircle
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  DocumentProcessingStatus,
  ActivityInfo,
  ProcessingReadiness,
} from '@/hooks/useDocumentProcessingStatus';
import {
  deriveDocumentStatusPresentation,
  getActivityLabel,
} from '@/hooks/useDocumentProcessingStatus';
import { useTranslation } from 'react-i18next';

interface Props {
  status: DocumentProcessingStatus;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Check className="h-3.5 w-3.5 text-green-600" />;
    case 'failed':
      return <X className="h-3.5 w-3.5 text-destructive" />;
    case 'running':
    case 'claimed':
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />;
  }
}

function OverallStatusBadge({ status }: { status: DocumentProcessingStatus }) {
  const presentation = deriveDocumentStatusPresentation(status);

  if (presentation.primaryTone === 'ready') {
    return (
      <Badge className="bg-green-500/10 text-green-700 border-green-500/20 gap-1.5 text-xs">
        <Check className="h-3 w-3" /> {presentation.primaryLabel}
      </Badge>
    );
  }

  if (presentation.primaryTone === 'failed') {
    return (
      <Badge variant="destructive" className="gap-1.5 text-xs">
        <X className="h-3 w-3" /> {presentation.primaryLabel}
      </Badge>
    );
  }

  if (presentation.primaryTone === 'partial') {
    return (
      <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/20 gap-1.5 text-xs">
        <Zap className="h-3 w-3" /> {presentation.primaryLabel}
      </Badge>
    );
  }

  return (
    <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/20 gap-1.5 text-xs">
      <Loader2 className="h-3 w-3 animate-spin" /> {presentation.primaryLabel}
    </Badge>
  );
}

function CurrentProcessingSection({ status }: { status: DocumentProcessingStatus }) {
  const { t } = useTranslation();
  const presentation = deriveDocumentStatusPresentation(status);
  const isTerminal = status.documentStatus === 'completed' || status.documentStatus === 'failed';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <OverallStatusBadge status={status} />
        {status.progressPercent > 0 && !isTerminal && (
          <span className="text-[11px] text-muted-foreground tabular-nums">{status.progressPercent}%</span>
        )}
      </div>

      {!isTerminal && status.progressPercent > 0 && (
        <Progress value={status.progressPercent} className="h-1.5" />
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        {status.runningActivities.length > 0 && presentation.primaryTone === 'processing' && (
          <div className="col-span-2">
            <span className="text-muted-foreground">{t('documentProcessing.runningNow')} </span>
            <span className="text-foreground font-medium">
              {status.runningActivities.map(a => getActivityLabel(a.activityKey)).join(', ')}
            </span>
          </div>
        )}
        {presentation.secondaryLabel && (
          <div className="col-span-2">
            <span className="text-muted-foreground">{t('documentProcessing.background')} </span>
            <span className="text-foreground">{presentation.secondaryLabel}</span>
          </div>
        )}
        {status.lastCompletedActivity && (
          <div className="col-span-2">
            <span className="text-muted-foreground">{t('documentProcessing.lastCompleted')} </span>
            <span className="text-foreground">{getActivityLabel(status.lastCompletedActivity.activityKey)}</span>
            {status.lastCompletedActivity.durationMs != null && (
              <span className="text-muted-foreground/70 ml-1">({formatMs(status.lastCompletedActivity.durationMs)})</span>
            )}
          </div>
        )}
        {status.elapsedSeconds != null && (
          <div>
            <span className="text-muted-foreground">{t('documentProcessing.elapsed')} </span>
            <span className="text-foreground tabular-nums">{formatDuration(status.elapsedSeconds)}</span>
          </div>
        )}
        {status.retryCount > 0 && (
          <div>
            <span className="text-muted-foreground">{t('documentProcessing.retries')} </span>
            <span className="text-foreground tabular-nums">{status.retryCount}</span>
          </div>
        )}
      </div>

      {status.warnings.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-500/5 rounded px-2 py-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{status.warnings[0]}</span>
        </div>
      )}
    </div>
  );
}

interface ReadinessCardProps {
  label: string;
  ready: boolean;
  icon: React.ReactNode;
  detail?: string;
}

function ReadinessCard({ label, ready, icon, detail }: ReadinessCardProps) {
  return (
    <div className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs border transition-colors ${
      ready
        ? 'bg-green-500/5 border-green-500/20 text-green-700'
        : 'bg-muted/30 border-border text-muted-foreground'
    }`}>
      <div className="shrink-0">{icon}</div>
      <span className="flex-1">{label}</span>
      {ready ? (
        <Check className="h-3 w-3 shrink-0" />
      ) : (
        <Clock className="h-3 w-3 shrink-0 opacity-40" />
      )}
      {detail && <span className="text-[10px] opacity-70">{detail}</span>}
    </div>
  );
}

function ReadinessSection({ readiness, metrics }: { readiness: ProcessingReadiness; metrics: DocumentProcessingStatus['metrics'] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentProcessing.readiness')}</p>
      <div className="grid grid-cols-2 gap-1.5">
        <ReadinessCard label={t('documentProcessing.items.textExtracted')} ready={readiness.textExtracted} icon={<FileText className="h-3 w-3" />} />
        <ReadinessCard label={t('documentProcessing.items.languageDetected')} ready={readiness.languageDetected} icon={<Languages className="h-3 w-3" />} />
        <ReadinessCard label={t('documentProcessing.items.summary')} ready={readiness.summaryReady} icon={<FileSearch className="h-3 w-3" />} />
        <ReadinessCard label={t('documentProcessing.items.keywordSearch')} ready={readiness.keywordSearchReady} icon={<Search className="h-3 w-3" />} />
        <ReadinessCard
          label={t('documentProcessing.items.semanticSearch')}
          ready={readiness.semanticSearchReady}
          icon={<Brain className="h-3 w-3" />}
          detail={metrics.chunkCount > 0 ? `${metrics.embeddingCoverage}%` : undefined}
        />
        <ReadinessCard label={t('documentProcessing.items.hybridRetrieval')} ready={readiness.hybridReady} icon={<Zap className="h-3 w-3" />} />
        <ReadinessCard label={t('documentProcessing.items.groundedChat')} ready={readiness.groundedChatReady} icon={<MessageSquareText className="h-3 w-3" />} />
        <ReadinessCard
          label={t('documentProcessing.items.questionEnrichment')}
          ready={readiness.questionEnrichmentReady}
          icon={<HelpCircle className="h-3 w-3" />}
          detail={metrics.questionCount > 0 ? `${metrics.questionCount}` : undefined}
        />
      </div>
    </div>
  );
}

function MetricsSection({ metrics }: { metrics: DocumentProcessingStatus['metrics'] }) {
  const { t } = useTranslation();
  if (metrics.chunkCount === 0 && metrics.questionCount === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentProcessing.metrics')}</p>
      <div className="flex flex-wrap gap-3 text-xs">
        {metrics.chunkCount > 0 && (
          <div>
            <span className="text-muted-foreground">{t('documentProcessing.metricLabels.chunks')} </span>
            <span className="text-foreground font-medium tabular-nums">{metrics.chunkCount}</span>
          </div>
        )}
        {metrics.embeddingCount > 0 && (
          <div>
            <span className="text-muted-foreground">{t('documentProcessing.metricLabels.embeddings')} </span>
            <span className="text-foreground font-medium tabular-nums">{metrics.embeddingCount}/{metrics.chunkCount}</span>
          </div>
        )}
        {metrics.embeddingCoverage > 0 && (
          <div>
            <span className="text-muted-foreground">{t('documentProcessing.metricLabels.coverage')} </span>
            <span className="text-foreground font-medium tabular-nums">{metrics.embeddingCoverage}%</span>
          </div>
        )}
        {metrics.questionCount > 0 && (
          <div>
            <span className="text-muted-foreground">{t('documentProcessing.metricLabels.questions')} </span>
            <span className="text-foreground font-medium tabular-nums">{metrics.questionCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTimeline({ status }: { status: DocumentProcessingStatus }) {
  const { t } = useTranslation();
  const allActivities = [
    ...status.completedActivities,
    ...status.runningActivities,
    ...status.failedActivities,
  ].sort((a, b) => {
    const aTime = a.startedAt || a.finishedAt || '';
    const bTime = b.startedAt || b.finishedAt || '';
    return aTime.localeCompare(bTime);
  });

  if (allActivities.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('documentProcessing.activityTimeline')}</p>
      <div className="space-y-0.5">
        {allActivities.map((activity, idx) => (
          <div key={`${activity.activityKey}-${idx}`} className="flex items-center gap-2 text-[11px]">
            <StatusIcon status={activity.status} />
            <span className={activity.status === 'completed' ? 'text-foreground' : activity.status === 'failed' ? 'text-destructive' : 'text-foreground font-medium'}>
              {getActivityLabel(activity.activityKey)}
            </span>
            {activity.isOptional && (
              <span className="text-[9px] text-muted-foreground/60 italic">{t('documentProcessing.optional')}</span>
            )}
            <span className="ml-auto text-muted-foreground/50 tabular-nums">
              {activity.durationMs != null ? formatMs(activity.durationMs) : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocumentProcessingOverview({ status }: Props) {
  return (
    <div className="space-y-3 pt-2 border-t border-border">
      <CurrentProcessingSection status={status} />
      <ReadinessSection readiness={status.readiness} metrics={status.metrics} />
      <MetricsSection metrics={status.metrics} />
      <ActivityTimeline status={status} />
    </div>
  );
}
