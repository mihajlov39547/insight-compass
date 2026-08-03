import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MessageSquare, Send, Loader2, AlertTriangle, Info, Camera, ShieldAlert, Telescope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { ResearchTrace } from '@/components/chat/ResearchTrace';
import { SourceAttribution, type SourceItem } from '@/components/chat/SourceAttribution';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import { usePlantIdentifications, confidenceBucket } from '@/hooks/usePlantIdentifications';
import { usePlantDiagnoses, usePlantDiagnosisInterpretations } from '@/hooks/usePlantDiagnoses';
import { usePlantCaseGrounding } from '@/hooks/usePlantCaseGrounding';
import { usePlantAdvisorSettings } from '@/hooks/usePlantAdvisorSettings';
import { useExtractFollowUp } from '@/hooks/useExtractFollowUp';
import { useCrawlFollowUp } from '@/hooks/useCrawlFollowUp';
import { useAuth } from '@/contexts/useAuth';
import {
  runTavilyResearch,
  researchSourcesToUnified,
  type ResearchTraceState,
} from '@/services/research/tavilyResearch';
import { buildIdentifyResearchInput, scrubTreatmentGuidance } from '@/lib/plantResearchSafety';
import {
  usePlantCaseChatMessages,
  useInvalidatePlantCaseChatMessages,
  type PlantChatUsedSource,
} from '@/hooks/usePlantCaseChatMessages';
import type { PlantCase, PlantCaseGoal } from '@/hooks/usePlantCases';

interface Props {
  plantCase: PlantCase;
  onBack: () => void;
}

interface Msg {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sourcesUsed?: PlantChatUsedSource[];
  researchTrace?: ResearchTraceState | null;
  isResearch?: boolean;
}


/** Map persisted plant-chat sources onto the shared Project Chat source model. */
function toSourceItems(list: PlantChatUsedSource[] | undefined): SourceItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && (s.title || s.url))
    .map((s, i) => ({
      id: s.id || `plant-src-${i}`,
      type: s.url ? 'web' : 'document',
      title: s.title || s.url || `Source ${i + 1}`,
      snippet: s.snippet || '',
      relevance: typeof s.score === 'number' ? s.score : 0,
      score: typeof s.score === 'number' ? s.score : undefined,
      url: s.url ?? undefined,
      documentId: s.url ? undefined : s.id,
    }));
}


interface PlantChatGoalConfig {
  assistantTitleKey: string;
  modeBadgeKey: string;
  introKey: string;
}

/**
 * Centralized configuration for plant-case chat goals.
 * Extend with future goals (e.g. `physiological_disorder`, `pest_damage`,
 * `treat_recover`) once those enum values ship in the case type.
 * TODO: physiological_disorder — plant confirmed, care/environment stress workflow.
 * TODO: pest_damage — plant confirmed, pest-focused triage workflow.
 * TODO: treat_recover — post-diagnosis follow-up and recovery monitoring.
 */
const PLANT_CHAT_GOAL_CONFIG = {
  identify: {
    assistantTitleKey: 'plantAdvisor.chat.assistantTitle.identify',
    modeBadgeKey: 'plantAdvisor.chat.modeBadge.identify',
    introKey: 'plantAdvisor.chat.intro.identify',
  },
  diagnose: {
    assistantTitleKey: 'plantAdvisor.chat.assistantTitle.diagnose',
    modeBadgeKey: 'plantAdvisor.chat.modeBadge.diagnose',
    introKey: 'plantAdvisor.chat.intro.diagnose',
  },
  improve_growth: {
    assistantTitleKey: 'plantAdvisor.chat.assistantTitle.improve_growth',
    modeBadgeKey: 'plantAdvisor.chat.modeBadge.improve_growth',
    introKey: 'plantAdvisor.chat.intro.improve_growth',
  },
  increase_income: {
    assistantTitleKey: 'plantAdvisor.chat.assistantTitle.increase_income',
    modeBadgeKey: 'plantAdvisor.chat.modeBadge.increase_income',
    introKey: 'plantAdvisor.chat.intro.increase_income',
  },
} satisfies Partial<Record<PlantCaseGoal, PlantChatGoalConfig>>;

const DEFAULT_GOAL_CONFIG: PlantChatGoalConfig = {
  assistantTitleKey: 'plantAdvisor.chat.assistantTitle.default',
  modeBadgeKey: 'plantAdvisor.chat.modeBadge.default',
  introKey: 'plantAdvisor.chat.intro.default',
};

function goalConfig(goal: PlantCaseGoal | null | undefined): PlantChatGoalConfig {
  if (goal && goal in PLANT_CHAT_GOAL_CONFIG) {
    return (PLANT_CHAT_GOAL_CONFIG as Record<string, PlantChatGoalConfig>)[goal];
  }
  return DEFAULT_GOAL_CONFIG;
}

/**
 * Provider identification scores are normalized in the 0..1 range, so a gap of
 * 0.1 corresponds to a 10 percentage-point difference between the top hit and
 * the nearest competitor. Anything tighter than this is treated as a "close
 * alternative" and lowers our confidence in the top pick.
 */
const CLOSE_ALTERNATIVE_SCORE_GAP = 0.1;

interface NameableIdent {
  common_name?: string | null;
  scientific_name?: string | null;
  scientific_name_without_author?: string | null;
}

/**
 * Format a plant identification for display. Prefers "Common — Scientific"
 * when both are available so scientific workflows (e.g. Rubus) can disambiguate.
 */
function formatPlantName(i: NameableIdent | null | undefined): string {
  if (!i) return '—';
  const common = i.common_name?.trim();
  const scientific = (i.scientific_name_without_author || i.scientific_name || '').trim();
  if (common && scientific) return `${common} — ${scientific}`;
  return common || scientific || '—';
}

export function PlantCaseChatPanel({ plantCase, onBack }: Props) {
  const { t } = useTranslation();
  const { data: images = [] } = usePlantCaseImages(plantCase.id);
  const { data: idents = [] } = usePlantIdentifications(plantCase.id);
  const { data: diagnoses = [] } = usePlantDiagnoses(plantCase.id);
  const { data: interpretation } = usePlantDiagnosisInterpretations(plantCase.id);
  const { data: grounding } = usePlantCaseGrounding(plantCase.id);
  const hasGrowthGrounding =
    !!grounding && (grounding.status === 'success' || grounding.status === 'partial');
  const isImproveGrowth = plantCase.user_goal === 'improve_growth';

  const confirmedIdent = idents.find((i) => i.is_confirmed) || null;
  const topIdent = confirmedIdent || idents[0] || null;
  const alts = idents.filter((i) => i.id !== topIdent?.id).slice(0, 4);

  // Guarantee "nearest competitor" is truly the highest-scoring alternative,
  // regardless of the order returned by the provider hook.
  const sortedAlternatives = useMemo(
    () => [...alts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [alts],
  );

  const identBucket = confidenceBucket(topIdent?.score ?? null);

  const confirmedDiag = diagnoses.find((d) => d.is_confirmed) || null;
  const topDiag = confirmedDiag || diagnoses[0] || null;
  const diagBucket = confidenceBucket(topDiag?.score ?? null);

  const goal = plantCase.user_goal;
  const cfg = goalConfig(goal);
  const isIdentify = goal === 'identify';
  const isDiagnose = goal === 'diagnose';

  // Uncertainty heuristics
  const topScore = topIdent?.score ?? null;
  const nextScore = sortedAlternatives[0]?.score ?? null;
  const closeAlternatives =
    topScore != null && nextScore != null &&
    topScore - nextScore < CLOSE_ALTERNATIVE_SCORE_GAP;
  const identUncertain = identBucket === 'low' || closeAlternatives;

  const aiBest = interpretation?.interpretation?.bestCandidates?.[0] ?? null;
  const aiVsConfirmedMismatch =
    !!confirmedDiag && !!aiBest && aiBest.name && confirmedDiag.name &&
    aiBest.name.trim().toLowerCase() !== confirmedDiag.name.trim().toLowerCase();

  const diagLowRelevance =
    !!topDiag && topDiag.plant_relevance && topDiag.plant_relevance !== 'high';
  const needsMoreEvidence =
    (interpretation?.interpretation?.needsMoreEvidence?.length ?? 0) > 0;
  const noDiagnosesYet = isDiagnose && !!confirmedIdent && diagnoses.length === 0;
  const diagUncertain =
    isDiagnose && !!confirmedIdent && diagnoses.length > 0 &&
    (diagBucket === 'low' || diagLowRelevance || needsMoreEvidence);

  const introContent = useMemo(() => {
    if (isImproveGrowth) {
      const key = hasGrowthGrounding
        ? 'plantAdvisor.chat.intro.improve_growth_with_grounding'
        : 'plantAdvisor.chat.intro.improve_growth_no_grounding';
      return t(key, { title: plantCase.title });
    }
    return t(cfg.introKey, { title: plantCase.title });
  }, [t, cfg.introKey, plantCase.title, isImproveGrowth, hasGrowthGrounding]);

  const {
    data: persistedMessages = [],
    isLoading: messagesLoading,
  } = usePlantCaseChatMessages(plantCase.id);
  const invalidateChatMessages = useInvalidatePlantCaseChatMessages();

  // Plant Advisor identification language drives AI-generated source summaries.
  const { identificationLanguage } = usePlantAdvisorSettings();
  const advisorLang: 'en' | 'sr' = identificationLanguage === 'sr' ? 'sr' : 'en';
  const { runExtract, isExtracting, extractingMessageId } = useExtractFollowUp();
  const { runCrawl, isCrawling, crawlingMessageId } = useCrawlFollowUp();


  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  // Optimistic messages shown while awaiting the assistant reply.
  // Cleared after the query invalidation returns persisted rows.
  const [optimistic, setOptimistic] = useState<Msg[]>([]);
  // Rolling follow-up suggestions returned by the backend (not persisted).
  const [followUps, setFollowUps] = useState<string[] | null>(null);
  const [askedQuestions, setAskedQuestions] = useState<string[]>([]);
  const followUpsRequestedRef = useRef(false);

  const hasPersistedHistory = persistedMessages.length > 0;


  const displayMessages = useMemo<Msg[]>(() => {
    if (hasPersistedHistory) {
      return [
        ...persistedMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sourcesUsed: m.role === 'assistant' ? m.metadata?.sourcesUsed : undefined,
          researchTrace:
            m.role === 'assistant'
              ? ((m.metadata?.research as { trace?: ResearchTraceState } | undefined)?.trace ?? null)
              : null,
          isResearch: m.role === 'assistant' && m.metadata?.kind === 'research',
        } as Msg)),

        ...optimistic,
      ];
    }
    // No persisted history yet — show the grounding-aware intro.
    // Do NOT persist the intro; it's derived and re-renders with grounding data.
    return [{ role: 'assistant', content: introContent }, ...optimistic];
  }, [hasPersistedHistory, persistedMessages, optimistic, introContent]);


  const quickQuestions = useMemo<string[]>(() => {
    const q = (k: string) => t(`plantAdvisor.chat.qq.${k}`);
    if (isIdentify) {
      return [
        q('identifyFeaturesConfirm'),
        q('identifyDiffFromAlternative'),
        q('identifyWhyUncertain'),
        q('identifyCheckDetails'),
        q('identifyPhotosToImprove'),
        q('identifyExplainAlternatives'),
        q('identifyHowConfident'),
        q('identifyCouldBeSimilar'),
      ];
    }
    if (isDiagnose) {
      if (!confirmedIdent) {
        return [
          q('diagnoseWhyConfirmFirst'),
          q('uploadForDiagnosis'),
          q('identifyPhotosToImprove'),
        ];
      }
      if (diagnoses.length === 0) {
        return [
          q('diagnosePrepPhotos'),
          q('diagnoseSymptomsToCheck'),
          q('diagnoseWhatToAvoid'),
        ];
      }
      if (confirmedDiag) {
        return [
          q('explainConfirmed'),
          q('evidenceSupports'),
          q('diagnoseSymptomsToCheck'),
          q('diagnoseWhatToAvoid'),
          q('monitorNext'),
        ];
      }
      return [
        q('diagnoseWhichCandidateLikely'),
        q('diagnoseSymptomsNext'),
        q('diagnosePestOrStress'),
        q('diagnoseMostLikely'),
        q('diagnoseCouldBeDiseasePestStress'),
        q('diagnoseCouldBeDeficiency'),
        q('diagnoseCouldBePesticide'),
        q('diagnoseSymptomsToCheck'),
        q('diagnosePhotosToImprove'),
        q('diagnoseWhatToAvoid'),
      ];
    }
    if (goal === 'improve_growth') {
      if (hasGrowthGrounding) {
        return [
          q('growthEncourageTaller'),
          q('growthWaterSunSoilFirst'),
          q('growthSafestLowConf'),
          q('growthPruneStructure'),
          q('growthMonitorPests'),
          q('growthLocalRelevance'),
        ];
      }
      return [
        q('growthHowWater'),
        q('growthHowMuchSun'),
        q('growthSoil'),
        q('growthWhenPrune'),
        q('growthLimitsLocation'),
        q('growthMonitorMonth'),
        q('growthReliabilityLowConf'),
      ];
    }
    return [
      q('identifyPhotosToImprove'),
      q('diagnoseWhatToAvoid'),
    ];
  }, [t, isIdentify, isDiagnose, goal, confirmedIdent, confirmedDiag, diagnoses.length, hasGrowthGrounding]);

  // AI-generated content (answers + rolling follow-ups) follows the Plant
  // Advisor "Identification language" setting, not the global UI language.
  // Static labels keep using normal app i18n.
  const langCode = advisorLang;


  // When the user runs Extract/Crawl without typing instructions, steer the
  // summary toward what this goal actually needs.
  const defaultSourceFocus = useMemo<string | null>(() => {
    if (isIdentify) return t('plantAdvisor.chat.extractFocus.identify');
    if (isDiagnose) return t('plantAdvisor.chat.extractFocus.diagnose');
    return null;
  }, [t, isIdentify, isDiagnose]);

  // Suggestions shown right now: backend follow-ups once a turn exists,
  // starter questions only for an empty chat. Never repeat asked questions.
  const visibleSuggestions = useMemo(() => {
    const base = followUps ?? (hasPersistedHistory ? [] : quickQuestions);
    return base.filter((q) => !askedQuestions.includes(q)).slice(0, 4);
  }, [followUps, hasPersistedHistory, quickQuestions, askedQuestions]);

  // Reopening a persisted chat: derive follow-ups from the last assistant answer.
  useEffect(() => {
    if (!hasPersistedHistory || followUps !== null || followUpsRequestedRef.current) return;
    followUpsRequestedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('plant-case-chat', {
          body: {
            caseId: plantCase.id,
            lang: langCode,
            followUpsOnly: true,
            messages: persistedMessages.map((m) => ({ role: m.role, content: m.content })),
          },
        });
        const list = (data as any)?.suggestedFollowUps;
        if (!cancelled && Array.isArray(list)) setFollowUps(list.filter((s: unknown) => typeof s === 'string'));
      } catch {
        /* suggestions are best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [hasPersistedHistory, followUps, persistedMessages, plantCase.id, langCode]);

  // ---------------------------------------------------------------------------
  // Deep research (Tavily) — reuses the Project/Notebook chat research flow.
  // Enabled for Identify cases with a confirmed identification.
  // ---------------------------------------------------------------------------
  const { user } = useAuth();
  const [researching, setResearching] = useState(false);
  const [liveTrace, setLiveTrace] = useState<ResearchTraceState | null>(null);

  const researchEnabled = isIdentify;
  const canResearch = researchEnabled && !!confirmedIdent && !pending && !researching;
  const researchTooltip = !confirmedIdent
    ? t('plantAdvisor.chat.research.needsConfirmed')
    : t('plantAdvisor.chat.research.tooltip');

  const runResearch = async () => {
    if (!canResearch || !confirmedIdent || !user) return;
    setResearching(true);
    setLiveTrace(null);
    try {
      const scientific =
        confirmedIdent.scientific_name_without_author || confirmedIdent.scientific_name || null;
      const researchInput = buildIdentifyResearchInput(
        confirmedIdent.common_name,
        scientific,
        advisorLang,
      );
      const result = await runTavilyResearch({
        input: researchInput,
        model: 'auto',
        responseLanguage: advisorLang,
        onTrace: (state) => setLiveTrace(state),
      });
      const answer = scrubTreatmentGuidance(result.finalText || '');
      if (!answer.trim()) throw new Error(result.errorMessage || 'empty_reply');

      const sourcesUsed: PlantChatUsedSource[] = researchSourcesToUnified(result.sources).map(
        (s, i) => ({
          id: s.id || `research-${i}`,
          provider: 'tavily-research',
          title: s.title,
          url: s.url,
          domain: s.snippet || null,
          score: s.relevance,
          snippet: s.snippet || null,
        }),
      );

      const { error } = await supabase.from('plant_case_chat_messages').insert({
        user_id: user.id,
        case_id: plantCase.id,
        role: 'assistant',
        content: answer,
        metadata: {
          kind: 'research',
          goal: goal ?? null,
          model: 'tavily-research:auto',
          responseLanguage: advisorLang,
          sourcesUsed,
          research: { trace: result.trace, raw: result.finalText },
        } as unknown as Record<string, never>,

      });
      if (error) throw error;
      await invalidateChatMessages(plantCase.id);
      setLiveTrace(null);
    } catch (e) {
      toast.error(
        t('plantAdvisor.chat.research.failed', {
          defaultValue: (e as Error).message,
        }),
      );
    } finally {
      setResearching(false);
    }
  };


  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || pending) return;
    setInput('');
    // Full conversation history sent to the model = persisted rows + the new user turn.
    const historyForModel: Msg[] = [
      ...persistedMessages.map((m) => ({ role: m.role, content: m.content } as Msg)),
      { role: 'user', content: text },
    ];
    setOptimistic([{ role: 'user', content: text }]);
    // Hide the clicked suggestion immediately.
    setAskedQuestions((prev) => (prev.includes(text) ? prev : [...prev, text]));
    setFollowUps((prev) => (prev ? prev.filter((q) => q !== text) : prev));
    setPending(true);
    try {
      const { data, error } = await supabase.functions.invoke('plant-case-chat', {
        body: {
          caseId: plantCase.id,
          lang: langCode,
          messages: historyForModel.map((m) => ({ role: m.role, content: m.content })),
        },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let code: string | undefined;
        try {
          const b = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          code = b?.error;
        } catch { /* ignore */ }
        throw new Error(code || error.message || 'chat_failed');
      }
      const reply = (data as any)?.reply;
      if (typeof reply !== 'string' || !reply.trim()) throw new Error('empty_reply');
      const nextFollowUps = (data as any)?.suggestedFollowUps;
      followUpsRequestedRef.current = true;
      setFollowUps(
        Array.isArray(nextFollowUps)
          ? nextFollowUps.filter((s: unknown) => typeof s === 'string')
          : [],
      );
      // Refetch persisted messages; clear optimistic overlay once the persisted rows arrive.
      await invalidateChatMessages(plantCase.id);
      setOptimistic([]);

    } catch (e) {
      const msg = (e as Error).message;
      // Drop the optimistic user message on failure so the user can retry.
      setOptimistic([]);
      toast.error(
        t(`plantAdvisor.chat.errors.${msg}`, {
          defaultValue: t('plantAdvisor.chat.errors.generic'),
        }),
      );
    } finally {
      setPending(false);
    }
  };

  const confidenceLabel = (b: 'high' | 'medium' | 'low' | null | undefined) =>
    b ? t(`plantAdvisor.identify.confidence.${b}`) : null;

  const relevanceLabel = (r: string | null | undefined) => {
    if (!r) return null;
    return t(`plantAdvisor.diagnose.relevance.${r}`, { defaultValue: r });
  };

  const showDiagnosisContext = isDiagnose;
  const showRecommendedPhotos = isIdentify && identUncertain;
  const showSymptomPhotos =
    isDiagnose && !!confirmedIdent &&
    (diagnoses.length === 0 || diagBucket === 'low' || diagLowRelevance || needsMoreEvidence);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <MessageSquare className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-medium truncate">{plantCase.title}</div>
            <Badge variant="outline" className="text-[10px] flex-shrink-0">
              {t(cfg.modeBadgeKey)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {t(cfg.assistantTitleKey)}
          </div>
        </div>
        {researchEnabled && (
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0 gap-1.5"
            onClick={runResearch}
            disabled={!canResearch}
            title={researchTooltip}
            aria-label={t('plantAdvisor.chat.research.label')}
          >
            {researching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Telescope className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline text-xs">{t('plantAdvisor.chat.research.label')}</span>
          </Button>
        )}
      </div>


      {/* Uncertainty banners */}
      {isIdentify && identUncertain && (
        <div className="border-b border-border px-4 py-2 bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{t('plantAdvisor.chat.banners.identifyLowConfidence')}</span>
        </div>
      )}
      {diagUncertain && (
        <div className="border-b border-border px-4 py-2 bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{t('plantAdvisor.chat.banners.diagnoseUncertain')}</span>
        </div>
      )}
      {isDiagnose && aiVsConfirmedMismatch && (
        <div className="border-b border-border px-4 py-2 bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{t('plantAdvisor.chat.warnings.aiMismatch')}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Structured case context */}
        <div className="rounded-md border border-border bg-muted/30 text-xs">
          {/* Case summary */}
          <section className="p-3 space-y-1">
            <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
              {t('plantAdvisor.chat.sections.caseSummary')}
            </div>
            <div className="text-muted-foreground">
              <span className="text-foreground">{t('plantAdvisor.fields.goal')}:</span>{' '}
              {goal ? t(`plantAdvisor.goals.${goal}`) : '—'}
            </div>
            {plantCase.location_text && (
              <div className="text-muted-foreground">
                <span className="text-foreground">{t('plantAdvisor.fields.location')}:</span>{' '}
                {plantCase.location_text}
              </div>
            )}
            {plantCase.crop_context && (
              <div className="text-muted-foreground">
                <span className="text-foreground">{t('plantAdvisor.fields.crop')}:</span>{' '}
                {plantCase.crop_context}
              </div>
            )}
            <div className="text-muted-foreground">
              {t('plantAdvisor.chat.imagesAttached', { count: images.length })}
            </div>
          </section>

          {/* Confirmed / suggested plant */}
          {topIdent && (
            <section className="p-3 border-t border-border/50 space-y-1">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
                {confirmedIdent
                  ? t('plantAdvisor.identify.confirmedPlant')
                  : t('plantAdvisor.identify.suggestedPlant')}
              </div>
              <div className="text-foreground">{formatPlantName(topIdent)}</div>
              <div className="text-muted-foreground">
                {t('plantAdvisor.identify.fields.confidence')}:{' '}
                {topIdent.score != null ? `${Math.round(topIdent.score * 100)}%` : '—'}
                {identBucket && ` (${confidenceLabel(identBucket)})`}
              </div>
              {sortedAlternatives.length > 0 && isIdentify && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-foreground">{t('plantAdvisor.identify.alternatives')}:</div>
                  <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                    {sortedAlternatives.slice(0, 3).map((a) => (
                      <li key={a.id}>
                        {formatPlantName(a)}
                        {a.score != null ? ` — ${Math.round(a.score * 100)}%` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Diagnosis candidates */}
          {showDiagnosisContext && !!confirmedIdent && diagnoses.length > 0 && (
            <section className="p-3 border-t border-border/50 space-y-1">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
                {t('plantAdvisor.chat.sections.diagnosisCandidates')}
              </div>
              <ul className="space-y-1">
                {diagnoses.slice(0, 4).map((d) => (
                  <li key={d.id} className="text-muted-foreground">
                    <span className="text-foreground">{d.name || '—'}</span>
                    {d.score != null ? ` · ${Math.round(d.score * 100)}%` : ''}
                    {d.plant_relevance && (
                      <Badge variant="outline" className="ml-1.5 text-[10px] py-0">
                        {relevanceLabel(d.plant_relevance)}
                      </Badge>
                    )}
                    {d.plant_relevance_reason && (
                      <div className="italic text-[11px] text-muted-foreground/80 pl-1">
                        {d.plant_relevance_reason}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Diagnosis empty state: plant confirmed but no diagnosis run yet */}
          {noDiagnosesYet && (
            <section className="p-3 border-t border-border/50 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-primary" />
              <span className="text-muted-foreground">
                {t('plantAdvisor.chat.emptyStates.diagnoseNotRunYet')}
              </span>
            </section>
          )}

          {/* AI interpretation — diagnose cases only */}
          {showDiagnosisContext && interpretation?.interpretation && (
            <section className="p-3 border-t border-border/50 space-y-1">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
                {t('plantAdvisor.chat.sections.aiInterpretation')}
              </div>
              {interpretation.summary && (
                <div className="text-muted-foreground">{interpretation.summary}</div>
              )}
              {interpretation.interpretation.bestCandidates?.[0] && (
                <div className="text-muted-foreground">
                  <span className="text-foreground">
                    {t('plantAdvisor.chat.sections.bestCandidate')}:
                  </span>{' '}
                  {interpretation.interpretation.bestCandidates[0].name}
                </div>
              )}
              {(interpretation.interpretation.unlikelyCandidates?.length ?? 0) > 0 && (
                <div className="text-muted-foreground">
                  <span className="text-foreground">
                    {t('plantAdvisor.chat.sections.unlikely')}:
                  </span>{' '}
                  {interpretation.interpretation.unlikelyCandidates
                    .map((u) => u.name)
                    .filter(Boolean)
                    .join(', ')}
                </div>
              )}
              {(interpretation.interpretation.needsMoreEvidence?.length ?? 0) > 0 && (
                <div className="text-muted-foreground">
                  <span className="text-foreground">
                    {t('plantAdvisor.chat.sections.missingEvidence')}:
                  </span>
                  <ul className="list-disc pl-4">
                    {interpretation.interpretation.needsMoreEvidence.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Diagnose case without confirmed plant */}
          {showDiagnosisContext && !confirmedIdent && (
            <section className="p-3 border-t border-border/50 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-primary" />
              <span className="text-muted-foreground">
                {t('plantAdvisor.chat.banners.diagnoseNeedsPlantConfirm')}
              </span>
            </section>
          )}

          {/* Recommended next photos — identify cases with weak result */}
          {showRecommendedPhotos && (
            <section className="p-3 border-t border-border/50 space-y-1">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                {t('plantAdvisor.chat.sections.nextPhotos')}
              </div>
              <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                {[
                  'leafUpper', 'leafUnder', 'stemBark',
                  'flower', 'fruit', 'wholePlant', 'damagedPart',
                ].map((k) => (
                  <li key={k}>{t(`plantAdvisor.chat.photoRoles.${k}`)}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Recommended symptom photos — diagnose cases with weak/missing evidence */}
          {showSymptomPhotos && (
            <section className="p-3 border-t border-border/50 space-y-1">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                {t('plantAdvisor.chat.sections.symptomPhotos')}
              </div>
              <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                {[
                  'wholePlantCondition',
                  'affectedLeafUpper',
                  'affectedLeafUnder',
                  'stemCaneLesions',
                  'fruitFlowerDamage',
                  'healthyVsAffected',
                  'symptomStages',
                ].map((k) => (
                  <li key={k}>{t(`plantAdvisor.chat.symptomPhotoRoles.${k}`)}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Safety note (diagnose paths only) */}
          {isDiagnose && (
            <section className="p-3 border-t border-border/50 flex items-start gap-2">
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
              <span className="text-muted-foreground">
                {t('plantAdvisor.chat.disclaimers.noChemicalGuidance')}
              </span>
            </section>
          )}

          {/* No-image-inspection disclaimer */}
          <section className="p-3 border-t border-border/50 italic text-muted-foreground">
            {t('plantAdvisor.chat.disclaimers.noImageInspection')}
          </section>
        </div>

        {messagesLoading && !hasPersistedHistory && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('plantAdvisor.chat.loading', { defaultValue: 'Loading conversation…' })}
            </div>
          </div>
        )}
        {!messagesLoading && displayMessages.map((m, i) => {
          const items = m.role === 'assistant' ? toSourceItems(m.sourcesUsed) : [];
          const msgId = m.id ?? `local-${i}`;
          return (
            <div key={msgId} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[80%] space-y-2">
                {m.researchTrace && <ResearchTrace trace={m.researchTrace} />}
                <div className={`rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border'}`}>
                  {m.role === 'user' ? m.content : <MarkdownContent content={m.content} />}
                </div>
                {m.isResearch && (
                  <div className="text-[10px] text-muted-foreground">
                    {t('plantAdvisor.chat.research.byline')}
                  </div>
                )}
                {items.length > 0 && (
                  <SourceAttribution
                    sources={items}
                    messageId={msgId}
                    context="project"
                    onExtract={(sels, q) =>
                      runExtract(
                        { kind: 'plant_case', caseId: plantCase.id, lang: advisorLang, goal },
                        msgId,
                        sels,
                        q?.trim() ? q : defaultSourceFocus,
                      )
                    }
                    isExtracting={isExtracting && extractingMessageId === msgId}
                    onCrawl={(sel, instructions) =>
                      runCrawl(
                        { kind: 'plant_case', caseId: plantCase.id, lang: advisorLang, goal },
                        msgId,
                        sel,
                        instructions?.trim() ? instructions : defaultSourceFocus,
                      )
                    }
                    isCrawling={isCrawling && crawlingMessageId === msgId}
                    crawlingUrl={crawlingMessageId === msgId ? null : undefined}
                  />
                )}
              </div>
            </div>
          );
        })}

        {researching && (
          <div className="flex justify-start">
            <div className="max-w-[80%] space-y-2">
              {liveTrace && <ResearchTrace trace={liveTrace} isLive />}
              <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('plantAdvisor.chat.research.running')}
              </div>
            </div>
          </div>
        )}

        {pending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('plantAdvisor.chat.thinking')}
            </div>
          </div>
        )}

      </div>

      {visibleSuggestions.length > 0 && (
        <div className="border-t border-border px-3 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t('plantAdvisor.chat.suggestedFollowUps')}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
            {visibleSuggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                disabled={pending}
                title={q}
                className="text-xs px-2 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted disabled:opacity-50 whitespace-nowrap flex-shrink-0 max-w-[240px] truncate"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}


      <div className="border-t border-border p-3">
        {isImproveGrowth && (
          <div className="text-[11px] text-muted-foreground mb-2">
            {t(
              hasGrowthGrounding
                ? 'plantAdvisor.chat.helper.improve_growth_with_grounding'
                : 'plantAdvisor.chat.helper.improve_growth_no_grounding',
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t(
              isImproveGrowth ? 'plantAdvisor.chat.inputPh_improve_growth' : 'plantAdvisor.chat.inputPh',
            )}
            rows={2}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <Button onClick={() => send()} disabled={!input.trim() || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
