import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coins, Loader2, RefreshCw, Telescope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { ResearchTrace } from '@/components/chat/ResearchTrace';
import { SourceAttribution, type SourceItem } from '@/components/chat/SourceAttribution';
import { usePlantIdentifications } from '@/hooks/usePlantIdentifications';
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
  buildIncomeResearchInput,
  polishIncomeResearchAnswer,
  rankIncomeResearchSources,
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
      id: s.id || `income-src-${i}`,
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
 * Income Research — a dashboard artifact for Increase Income cases.
 *
 * The result is persisted as an assistant message with
 * `metadata.kind = 'income_research'` so the Plant Case chat can reuse it as
 * context, but it is never rendered as a chronological chat message.
 */
export function PlantIncomeResearchSection({ plantCase, hasConfirmedIdentification }: Props) {
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
        m.metadata?.kind === 'income_research' &&
        !m.metadata?.superseded,
    );
    const latest = rows[rows.length - 1];
    if (!latest) return null;
    return {
      id: latest.id,
      content: polishIncomeResearchAnswer(latest.content),
      sourcesUsed: latest.metadata?.sourcesUsed,
      trace:
        (latest.metadata?.research as { trace?: ResearchTraceState } | undefined)?.trace ?? null,
    };
  }, [messages]);

  const canRun =
    hasConfirmedIdentification && !!confirmedIdent && !quota.exhausted && !running;

  const quotaLabel = quota.exhausted
    ? t('plantAdvisor.income.quotaUsed', { used: quota.used, limit: quota.limit })
    : quota.retryAvailable
      ? t('plantAdvisor.income.quotaRetry')
      : t('plantAdvisor.income.quotaAvailable', { used: quota.used, limit: quota.limit });

  const run = async () => {
    if (!canRun || !confirmedIdent) return;
    setRunning(true);
    setLiveTrace(null);
    let runId: string | null = null;
    try {
      runId = await reserveRun.mutateAsync({ caseId, researchType: 'income_research' });

      const scientific =
        confirmedIdent.scientific_name_without_author || confirmedIdent.scientific_name || null;
      const input = buildIncomeResearchInput(confirmedIdent.common_name, scientific, advisorLang, {
        location: plantCase.location_text,
        cropContext: plantCase.crop_context,
        notes: plantCase.notes,
        family: confirmedIdent.family,
        genus: confirmedIdent.genus,
      });

      const result = await runTavilyResearch({
        input,
        model: 'auto',
        responseLanguage: advisorLang,
        onTrace: (state) => setLiveTrace(state),
      });
      const answer = polishIncomeResearchAnswer(result.finalText || '');
      if (!answer.trim()) throw new Error(result.errorMessage || 'empty_reply');

      const sourcesUsed: PlantChatUsedSource[] = rankIncomeResearchSources(
        researchSourcesToUnified(result.sources),
      ).map((s, i) => ({
        id: s.id || `income-research-${i}`,
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
        researchType: 'income_research',
        content: answer,
        metadata: {
          kind: 'income_research',
          goal: plantCase.user_goal ?? null,
          model: 'tavily-research:auto',
          responseLanguage: advisorLang,
          sourcesUsed,
          research: { trace: result.trace, raw: result.finalText },
        },
      });
      await invalidateChatMessages(caseId);
      setLiveTrace(null);
      toast.success(t('plantAdvisor.income.doneToast'));
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
          ? t('plantAdvisor.income.quotaUsed', { used: quota.limit, limit: quota.limit })
          : msg === 'needs_confirmed_plant'
            ? t('plantAdvisor.income.requireConfirmation')
            : t('plantAdvisor.income.failedRetry'),
      );
    } finally {
      setRunning(false);
    }
  };

  const msgId = artifact?.id ?? 'income-research';
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
          <Coins className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{t('plantAdvisor.income.title')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('plantAdvisor.income.helper')}</p>
        </div>
        {artifact && !running && (
          <Button size="sm" variant="outline" onClick={run} disabled={!canRun}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            {t('plantAdvisor.income.refresh')}
          </Button>
        )}
      </div>

      {!hasConfirmedIdentification ? (
        <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
          {t('plantAdvisor.income.requireConfirmation')}
        </div>
      ) : running ? (
        <div className="space-y-2">
          {liveTrace && <ResearchTrace trace={liveTrace} isLive />}
          <div className="text-sm flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('plantAdvisor.income.running')}
          </div>
        </div>
      ) : artifact ? (
        <div className="space-y-2">
          {artifact.trace && <ResearchTrace trace={artifact.trace} />}
          <div className="text-sm">
            <MarkdownContent content={artifact.content} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t('plantAdvisor.income.byline')}
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
                  q?.trim() ? q : t('plantAdvisor.income.extractFocus'),
                )
              }
              isExtracting={isExtracting && extractingMessageId === msgId}
              onCrawl={(sel, instructions) =>
                runCrawl(
                  extractScope,
                  msgId,
                  sel,
                  instructions?.trim() ? instructions : t('plantAdvisor.income.extractFocus'),
                )
              }
              isCrawling={isCrawling && crawlingMessageId === msgId}
              crawlingUrl={crawlingMessageId === msgId ? null : undefined}
            />
          )}
          <div className="text-[11px] text-muted-foreground">{quotaLabel}</div>
          <p className="text-[11px] italic text-muted-foreground">
            {t('plantAdvisor.income.disclaimer')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {t('plantAdvisor.income.placeholderText')}
          </div>
          <div className="text-[11px] text-muted-foreground">{quotaLabel}</div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={run} disabled={!canRun}>
            <Telescope className="h-3.5 w-3.5" />
            <span className="text-xs">{t('plantAdvisor.income.run')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
