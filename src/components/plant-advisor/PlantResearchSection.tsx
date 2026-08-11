import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, RefreshCw, Telescope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { ResearchTrace } from '@/components/chat/ResearchTrace';
import { SourceAttribution, type SourceItem } from '@/components/chat/SourceAttribution';
import { usePlantIdentifications, confidenceBucket } from '@/hooks/usePlantIdentifications';
import { usePlantAdvisorSettings } from '@/hooks/usePlantAdvisorSettings';
import { useExtractFollowUp } from '@/hooks/useExtractFollowUp';
import { useCrawlFollowUp } from '@/hooks/useCrawlFollowUp';
import {
  usePlantCaseChatMessages,
  useInvalidatePlantCaseChatMessages,
  type PlantChatUsedSource,
} from '@/hooks/usePlantCaseChatMessages';
import {
  usePlantCaseResearchQuota,
  useReservePlantResearchRun,
  useCompletePlantResearchRun,
  useFailPlantResearchRun,
} from '@/hooks/usePlantCaseResearchQuota';
import {
  runTavilyResearch,
  researchSourcesToUnified,
  type ResearchTraceState,
} from '@/services/research/tavilyResearch';
import {
  buildIdentifyResearchInput,
  polishIdentifyResearchAnswer,
  rankIdentifyResearchSources,
  researchSourceDomain,
} from '@/lib/plantResearchSafety';
import type { PlantCase } from '@/hooks/usePlantCases';

interface Props {
  plantCase: PlantCase;
  hasConfirmedIdentification: boolean;
}

function toSourceItems(list: PlantChatUsedSource[] | undefined): SourceItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && (s.title || s.url))
    .map((s, i) => ({
      id: s.id || `plant-research-src-${i}`,
      type: s.url ? 'web' : 'document',
      title: s.title || s.url || `Source ${i + 1}`,
      snippet: s.snippet || '',
      relevance: typeof s.score === 'number' ? s.score : 0,
      score: typeof s.score === 'number' ? s.score : undefined,
      url: s.url ?? undefined,
      documentId: s.url ? undefined : s.id,
    }));
}

/**
 * Plant Research — a dashboard artifact for Identify cases.
 *
 * Persisted as an assistant message with `metadata.kind = 'research'` (and
 * `metadata.researchType = 'plant_research'`) so the Plant Case chat can reuse
 * it as context. It is never rendered as a chronological chat message, and it
 * can only be launched from the dashboard.
 */
export function PlantResearchSection({ plantCase, hasConfirmedIdentification }: Props) {
  const { t } = useTranslation();
  const caseId = plantCase.id;
  const { data: idents = [] } = usePlantIdentifications(caseId);
  const confirmedIdent = idents.find((i) => i.is_confirmed) || null;
  const { data: messages = [] } = usePlantCaseChatMessages(caseId);
  const invalidateChatMessages = useInvalidatePlantCaseChatMessages();

  const { identificationLanguage } = usePlantAdvisorSettings();
  const advisorLang: 'en' | 'sr' = identificationLanguage === 'sr' ? 'sr' : 'en';

  const { runExtract, isExtracting, extractingMessageId } = useExtractFollowUp();
  const { runCrawl, isCrawling, crawlingMessageId } = useCrawlFollowUp();

  const { quota } = usePlantCaseResearchQuota();
  const reserveRun = useReservePlantResearchRun();
  const completeRun = useCompletePlantResearchRun();
  const failRun = useFailPlantResearchRun();

  const [running, setRunning] = useState(false);
  const [liveTrace, setLiveTrace] = useState<ResearchTraceState | null>(null);

  const artifact = useMemo(() => {
    const rows = messages.filter(
      (m) =>
        m.role === 'assistant' &&
        (m.metadata?.kind === 'research' ||
          (m.metadata as Record<string, unknown> | undefined)?.researchType === 'plant_research') &&
        !m.metadata?.superseded,
    );
    const latest = rows[rows.length - 1];
    if (!latest) return null;
    return {
      id: latest.id,
      content: polishIdentifyResearchAnswer(latest.content),
      sourcesUsed: latest.metadata?.sourcesUsed,
      trace:
        (latest.metadata?.research as { trace?: ResearchTraceState } | undefined)?.trace ?? null,
    };
  }, [messages]);

  const lowConfidence = confidenceBucket(confirmedIdent?.score) === 'low';

  const canRun = hasConfirmedIdentification && !!confirmedIdent && !quota.exhausted && !running;

  const quotaLabel = quota.exhausted
    ? t('plantAdvisor.plantResearch.quotaUsed', { used: quota.used, limit: quota.limit })
    : quota.retryAvailable
      ? t('plantAdvisor.plantResearch.quotaRetry')
      : t('plantAdvisor.plantResearch.quotaAvailable', { used: quota.used, limit: quota.limit });

  const run = async () => {
    if (!canRun || !confirmedIdent) return;
    setRunning(true);
    setLiveTrace(null);
    let runId: string | null = null;
    try {
      runId = await reserveRun.mutateAsync({ caseId, researchType: 'plant_research' });

      const scientific =
        confirmedIdent.scientific_name_without_author || confirmedIdent.scientific_name || null;
      const input = buildIdentifyResearchInput(
        confirmedIdent.common_name,
        scientific,
        advisorLang,
      );

      const result = await runTavilyResearch({
        input,
        model: 'auto',
        responseLanguage: advisorLang,
        onTrace: (state) => setLiveTrace(state),
      });
      const answer = polishIdentifyResearchAnswer(result.finalText || '');
      if (!answer.trim()) throw new Error(result.errorMessage || 'empty_reply');

      const sourcesUsed: PlantChatUsedSource[] = rankIdentifyResearchSources(
        researchSourcesToUnified(result.sources),
      ).map((s, i) => ({
        id: s.id || `plant-research-${i}`,
        provider: 'tavily-research',
        title: s.title,
        url: s.url,
        domain: s.url ? researchSourceDomain(s.url) : null,
        score: s.relevance,
        snippet: s.snippet || null,
        authorityScore: String(s.authorityScore),
      }));

      await completeRun.mutateAsync({
        runId,
        caseId,
        researchType: 'plant_research',
        content: answer,
        metadata: {
          kind: 'research',
          researchType: 'plant_research',
          goal: plantCase.user_goal ?? null,
          model: 'tavily-research:auto',
          responseLanguage: advisorLang,
          sourcesUsed,
          research: { trace: result.trace, raw: result.finalText },
        },
      });
      await invalidateChatMessages(caseId);
      setLiveTrace(null);
      toast.success(t('plantAdvisor.plantResearch.doneToast'));
    } catch (e) {
      const msg = (e as Error).message;
      if (runId && msg !== 'quota_exhausted') {
        try {
          await failRun.mutateAsync({ runId, reason: msg });
        } catch {
          /* best effort — stale runs are released server-side */
        }
      }
      toast.error(
        msg === 'quota_exhausted'
          ? t('plantAdvisor.plantResearch.quotaUsed', { used: quota.limit, limit: quota.limit })
          : msg === 'needs_confirmed_plant'
            ? t('plantAdvisor.plantResearch.requireConfirmation')
            : t('plantAdvisor.plantResearch.failedRetry'),
      );
    } finally {
      setRunning(false);
    }
  };

  const msgId = artifact?.id ?? 'plant-research';
  const sourceItems = toSourceItems(artifact?.sourcesUsed);
  const extractScope = {
    kind: 'plant_case' as const,
    caseId,
    lang: advisorLang,
    goal: plantCase.user_goal,
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Telescope className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{t('plantAdvisor.plantResearch.title')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('plantAdvisor.plantResearch.helper')}
          </p>
        </div>
        {artifact && !running && (
          <Button size="sm" variant="outline" onClick={run} disabled={!canRun}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            {t('plantAdvisor.plantResearch.refresh')}
          </Button>
        )}
      </div>

      {!hasConfirmedIdentification ? (
        <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
          {t('plantAdvisor.plantResearch.requireConfirmation')}
        </div>
      ) : (
        <>
          {lowConfidence && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{t('plantAdvisor.plantResearch.lowConfidence')}</span>
            </div>
          )}
          {running ? (
            <div className="space-y-2">
              {liveTrace && <ResearchTrace trace={liveTrace} isLive />}
              <div className="text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('plantAdvisor.plantResearch.running')}
              </div>
            </div>
          ) : artifact ? (
            <div className="space-y-2">
              {artifact.trace && <ResearchTrace trace={artifact.trace} />}
              <div className="text-sm">
                <MarkdownContent content={artifact.content} />
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t('plantAdvisor.plantResearch.byline')}
              </div>
              {sourceItems.length > 0 && (
                <SourceAttribution
                  sources={sourceItems}
                  messageId={msgId}
                  context="project"
                  onExtract={(sels, q) =>
                    runExtract(
                      extractScope,
                      msgId,
                      sels,
                      q?.trim() ? q : t('plantAdvisor.plantResearch.extractFocus'),
                    )
                  }
                  isExtracting={isExtracting && extractingMessageId === msgId}
                  onCrawl={(sel, instructions) =>
                    runCrawl(
                      extractScope,
                      msgId,
                      sel,
                      instructions?.trim()
                        ? instructions
                        : t('plantAdvisor.plantResearch.extractFocus'),
                    )
                  }
                  isCrawling={isCrawling && crawlingMessageId === msgId}
                  crawlingUrl={crawlingMessageId === msgId ? null : undefined}
                />
              )}
              <div
                className="text-[11px] text-muted-foreground"
                title={t('plantAdvisor.plantResearch.quotaTooltip')}
              >
                {quotaLabel}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t('plantAdvisor.plantResearch.placeholderText')}
              </div>
              <div
                className="text-[11px] text-muted-foreground"
                title={t('plantAdvisor.plantResearch.quotaTooltip')}
              >
                {quotaLabel}
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={run} disabled={!canRun}>
                <Telescope className="h-3.5 w-3.5" />
                <span className="text-xs">{t('plantAdvisor.plantResearch.run')}</span>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
