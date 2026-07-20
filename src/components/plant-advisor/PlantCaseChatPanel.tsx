import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MessageSquare, Send, Loader2, AlertTriangle, Info, Camera, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import { usePlantIdentifications, confidenceBucket } from '@/hooks/usePlantIdentifications';
import { usePlantDiagnoses, usePlantDiagnosisInterpretations } from '@/hooks/usePlantDiagnoses';
import type { PlantCase, PlantCaseGoal } from '@/hooks/usePlantCases';

interface Props {
  plantCase: PlantCase;
  onBack: () => void;
}

interface Msg { role: 'user' | 'assistant'; content: string }

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
  const { t, i18n } = useTranslation();
  const { data: images = [] } = usePlantCaseImages(plantCase.id);
  const { data: idents = [] } = usePlantIdentifications(plantCase.id);
  const { data: diagnoses = [] } = usePlantDiagnoses(plantCase.id);
  const { data: interpretation } = usePlantDiagnosisInterpretations(plantCase.id);

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

  const introContent = useMemo(
    () => t(cfg.introKey, { title: plantCase.title }),
    [t, cfg.introKey, plantCase.title],
  );

  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => ([
    { role: 'assistant', content: introContent },
  ]));

  const quickQuestions = useMemo<string[]>(() => {
    const q = (k: string) => t(`plantAdvisor.chat.qq.${k}`);
    if (isIdentify) {
      return [
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
        q('diagnoseMostLikely'),
        q('diagnoseWhyUncertain'),
        q('diagnoseSymptomsToCheck'),
        q('unlikelyCandidates'),
        q('diagnoseCouldBePest'),
        q('extraPhotos'),
        q('diagnoseWhatToAvoid'),
      ];
    }
    return [
      q('identifyPhotosToImprove'),
      q('diagnoseWhatToAvoid'),
    ];
  }, [t, isIdentify, isDiagnose, confirmedIdent, confirmedDiag, diagnoses.length]);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || pending) return;
    setInput('');
    const nextMsgs: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMsgs);
    setPending(true);
    try {
      const langCode = (i18n.language || 'en').toLowerCase().startsWith('sr') ? 'sr' : 'en';
      const { data, error } = await supabase.functions.invoke('plant-case-chat', {
        body: {
          caseId: plantCase.id,
          lang: langCode,
          messages: nextMsgs.map((m) => ({ role: m.role, content: m.content })),
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
      setMessages([...nextMsgs, { role: 'assistant', content: reply }]);
    } catch (e) {
      const msg = (e as Error).message;
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
    (diagnoses.length === 0 || diagBucket === 'low' || needsMoreEvidence);

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

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border'}`}>
              {m.role === 'user' ? m.content : <MarkdownContent content={m.content} />}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('plantAdvisor.chat.thinking')}
            </div>
          </div>
        )}
      </div>

      {quickQuestions.length > 0 && (
        <div className="border-t border-border px-3 pt-2 flex flex-wrap gap-1.5">
          {quickQuestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              disabled={pending}
              className="text-xs px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('plantAdvisor.chat.inputPh')}
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
