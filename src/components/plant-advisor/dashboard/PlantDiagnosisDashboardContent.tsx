import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ChevronDown, Info, RefreshCw, Sparkles, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  usePlantDiagnoses,
  useDiagnoseDisease,
  useConfirmPlantDiagnosis,
  usePlantDiagnosisInterpretations,
  type PlantDiagnosis,
} from '@/hooks/usePlantDiagnoses';
import { prepareWebpTempImages } from '@/hooks/usePlantIdentifications';
import type { PlantCaseImage } from '@/hooks/usePlantCaseImages';
import { useAuth } from '@/contexts/useAuth';
import { isConvertibleForIdentification, isWebpMime } from '@/lib/plantImageConversion';
import { usePlantAdvisorSettings, toPlantnetApiLang } from '@/hooks/usePlantAdvisorSettings';
import { usePlantAiScanUsage } from '@/hooks/usePlantIdentificationUsage';

interface Props {
  caseId: string;
  images: PlantCaseImage[];
  hasConfirmedIdentification: boolean;
  /** Whether a problem_research artifact already exists for this case. */
  problemResearchReady?: boolean;
  /** Short bullets to show under "what to check next". */
  whatToCheckNext?: string[];
}

const RELEVANCE_ORDER: Record<string, number> = { high: 0, medium: 1, unknown: 2, low: 3 };

function fmtPct(s: number | null | undefined): string {
  return s == null ? '—' : `${Math.round(s * 100)}%`;
}

function bucketOf(s: number | null | undefined): 'high' | 'medium' | 'low' {
  if (typeof s !== 'number') return 'low';
  if (s >= 0.7) return 'high';
  if (s >= 0.4) return 'medium';
  return 'low';
}

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'api_key_missing':
      return 'plantAdvisor.diagnose.errors.apiKeyMissing';
    case 'no_compatible_images':
      return 'plantAdvisor.diagnose.errors.noCompatible';
    case 'image_download_failed':
      return 'plantAdvisor.diagnose.errors.downloadFailed';
    case 'quota_exhausted':
      return 'plantAdvisor.diagnose.errors.quotaExhausted';
    case 'auth_failed':
      return 'plantAdvisor.diagnose.errors.authFailed';
    case 'bad_request':
      return 'plantAdvisor.diagnose.errors.badRequest';
    case 'empty_results':
      return 'plantAdvisor.diagnose.errors.empty';
    case 'plant_not_confirmed':
      return 'plantAdvisor.diagnose.errors.plantNotConfirmed';
    case 'invalid_case_goal':
      return 'plantAdvisor.diagnose.errors.invalidCaseGoal';
    case 'plant_ai_scan_limit_reached':
      return 'plantAdvisor.diagnose.errors.limitReached';
    default:
      return 'plantAdvisor.diagnose.errors.generic';
  }
}

function firstSentences(text: string, max = 2): string {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return parts.slice(0, max).join(' ');
}

/** Compact, dashboard-specific diagnosis panel. Details live in nested collapsibles. */
export function PlantDiagnosisDashboardContent({
  caseId,
  images,
  hasConfirmedIdentification,
  problemResearchReady = false,
  whatToCheckNext = [],
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: diagnoses = [], isLoading } = usePlantDiagnoses(caseId);
  const { data: dbInterpretation } = usePlantDiagnosisInterpretations(caseId);
  const diagnose = useDiagnoseDisease();
  const confirmMut = useConfirmPlantDiagnosis();
  const settings = usePlantAdvisorSettings();
  const usage = usePlantAiScanUsage();

  const [preparing, setPreparing] = useState(false);
  const [confirmedOpen, setConfirmedOpen] = useState(true);
  const [triageOpen, setTriageOpen] = useState(false);
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [allCandidates, setAllCandidates] = useState(false);
  const [unlikelyOpen, setUnlikelyOpen] = useState(false);

  const identifiable = images.filter((i) => isConvertibleForIdentification(i.mime_type));
  const webps = images.filter((i) => isWebpMime(i.mime_type));

  const run = async () => {
    try {
      let tempImages: Awaited<ReturnType<typeof prepareWebpTempImages>> = [];
      if (webps.length > 0 && user?.id) {
        setPreparing(true);
        try {
          tempImages = await prepareWebpTempImages({ userId: user.id, caseId, images: webps });
        } catch (err) {
          console.warn('[plant-disease] webp conversion failed', err);
          toast.error(t('plantAdvisor.diagnose.errors.webpConvertFailed'));
          return;
        } finally {
          setPreparing(false);
        }
      }
      const res = await diagnose.mutateAsync({
        plantCaseId: caseId,
        tempImages: tempImages.length > 0 ? tempImages : undefined,
        lang: toPlantnetApiLang(settings.identificationLanguage),
      });
      if (res.error) toast.error(t(errorKey(res.error)));
      else toast.success(t('plantAdvisor.diagnose.doneToast'));
    } catch (e: unknown) {
      toast.error(t(errorKey((e as { code?: string })?.code)));
    }
  };

  const doConfirm = async (diagnosisId: string) => {
    try {
      await confirmMut.mutateAsync({ plantCaseId: caseId, diagnosisId });
      toast.success(t('plantAdvisor.diagnose.confirmedToast'));
    } catch {
      toast.error(t('plantAdvisor.diagnose.errors.confirmFailed'));
    }
  };

  const relevanceOf = (d: PlantDiagnosis): string => d.plant_relevance ?? 'unknown';
  const sorted = [...diagnoses].sort((a, b) => {
    if (a.is_confirmed !== b.is_confirmed) return a.is_confirmed ? -1 : 1;
    const ra = RELEVANCE_ORDER[relevanceOf(a)] ?? 2;
    const rb = RELEVANCE_ORDER[relevanceOf(b)] ?? 2;
    if (ra !== rb) return ra - rb;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  const top = sorted.find((d) => d.is_confirmed) || sorted[0] || null;
  const alts = sorted.filter((d) => d.id !== top?.id);
  const shownAlts = allCandidates ? alts : alts.slice(0, 2);

  const interpretation = dbInterpretation?.interpretation ?? null;
  const triageConfidence = interpretation?.overallConfidence || 'low';
  const triageSummary = interpretation?.summary ? firstSentences(interpretation.summary, 2) : null;
  const checks = whatToCheckNext.slice(0, 3);

  const problemTypeLabel = (pt: string | null | undefined) =>
    pt === 'pest'
      ? t('plantAdvisor.diagnose.problemType.pest')
      : pt === 'disease'
        ? t('plantAdvisor.diagnose.problemType.disease')
        : t('plantAdvisor.diagnose.problemType.unknown');
  const relevanceLabel = (r: string) =>
    t(`plantAdvisor.dashboard.relevance.${r === 'high' || r === 'medium' || r === 'low' ? r : 'unknown'}`);
  const confidenceLabel = (b: string) => t(`plantAdvisor.diagnose.confidenceBucket.${b}`);

  const topBucket = top ? bucketOf(top.score) : 'low';
  const lowConfidence = !!top && topBucket === 'low';
  const unknownFit = !!top && relevanceOf(top) === 'unknown';

  return (
    <div className="space-y-3">
      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={run}
          disabled={
            images.length === 0 ||
            identifiable.length === 0 ||
            !hasConfirmedIdentification ||
            diagnose.isPending ||
            preparing ||
            usage.isLimitReached
          }
        >
          {preparing || diagnose.isPending ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : diagnoses.length > 0 ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          ) : (
            <Stethoscope className="h-3.5 w-3.5 mr-1.5" />
          )}
          {diagnoses.length > 0
            ? t('plantAdvisor.diagnose.runAgain')
            : t('plantAdvisor.diagnose.diagnose')}
        </Button>
        {alts.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setCandidatesOpen((o) => !o)}>
            {t('plantAdvisor.dashboard.diag.showCandidates')}
          </Button>
        )}
        {interpretation && (
          <Button size="sm" variant="outline" onClick={() => setTriageOpen((o) => !o)}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            {t('plantAdvisor.dashboard.diag.viewFullTriage')}
          </Button>
        )}
        {!usage.loading && (
          <span className="text-[11px] text-muted-foreground">
            {t('plantAdvisor.scans.usedThisMonth', { used: usage.used, limit: usage.limit })}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.diagnose.loading')}</div>
      )}
      {images.length === 0 && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.diagnose.uploadFirst')}</div>
      )}

      {/* Compact confirmed summary */}
      {top && (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{top.name || '—'}</div>
              {top.description && top.description !== top.name && (
                <div className="text-xs text-muted-foreground line-clamp-2">{top.description}</div>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {top.is_confirmed && (
                <Badge className="text-[10px]">
                  <Check className="h-3 w-3 mr-1" />
                  {t('plantAdvisor.diagnose.confirmedDiagnosis')}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {problemTypeLabel(top.problem_type)}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {relevanceLabel(relevanceOf(top))}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {confidenceLabel(topBucket)} · {fmtPct(top.score)}
              </Badge>
            </div>
          </div>

          {(lowConfidence || unknownFit) && (
            <div className="flex flex-wrap gap-1.5">
              {lowConfidence && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  {t('plantAdvisor.dashboard.diag.chipLowConfidence')}
                </span>
              )}
              {unknownFit && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  {t('plantAdvisor.dashboard.diag.chipUnknownFit')}
                </span>
              )}
            </div>
          )}

          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            {t('plantAdvisor.diagnose.notTreatmentAdvice')}
            <span className="mx-1">·</span>
            {t('plantAdvisor.diagnose.provider')}: {top.provider}
          </div>

          {!top.is_confirmed && (
            <Button size="sm" variant="outline" onClick={() => doConfirm(top.id)} disabled={confirmMut.isPending}>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              {t('plantAdvisor.diagnose.confirmThis')}
            </Button>
          )}

          {/* Confirmed diagnosis details (open by default) */}
          <Collapsible open={confirmedOpen} onOpenChange={setConfirmedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2 text-xs text-muted-foreground">
                <ChevronDown className={`h-3.5 w-3.5 mr-1.5 transition-transform ${confirmedOpen ? 'rotate-180' : ''}`} />
                {t('plantAdvisor.dashboard.diag.confirmedDetails')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 space-y-1 text-[11px]">
              <div>
                <span className="text-muted-foreground">{t('plantAdvisor.diagnose.affectedOrgans')}:</span>{' '}
                {(top.affected_organs || []).join(', ') || '—'}
              </div>
              {top.plant_relevance_reason && (
                <div className="text-muted-foreground italic">{top.plant_relevance_reason}</div>
              )}
              {top.plant_scientific_name && (
                <div>
                  <span className="text-muted-foreground">{t('plantAdvisor.diagnose.contextLabel')}:</span>{' '}
                  {top.plant_common_name && top.plant_common_name !== top.plant_scientific_name
                    ? `${top.plant_common_name} / ${top.plant_scientific_name}`
                    : top.plant_scientific_name}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* AI triage compact */}
      {interpretation && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">{t('plantAdvisor.dashboard.diag.aiTriage')}</span>
            <Badge variant="secondary" className="text-[10px]">
              {confidenceLabel(triageConfidence)}
            </Badge>
          </div>
          {triageSummary && <p className="text-xs text-foreground/90 line-clamp-2">{triageSummary}</p>}

          {checks.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('plantAdvisor.dashboard.facts.checkNext')}
              </div>
              <ul className="space-y-0.5 pt-0.5">
                {checks.map((c, i) => (
                  <li key={i} className="text-[11px] text-foreground/85 flex gap-1.5">
                    <span className="text-muted-foreground">•</span>
                    <span className="min-w-0">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Collapsible open={triageOpen} onOpenChange={setTriageOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2 text-xs text-muted-foreground">
                <ChevronDown className={`h-3.5 w-3.5 mr-1.5 transition-transform ${triageOpen ? 'rotate-180' : ''}`} />
                {t('plantAdvisor.dashboard.diag.triageDetails')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 space-y-2">
              {interpretation.summary && (
                <p className="text-xs whitespace-pre-wrap text-foreground/90">{interpretation.summary}</p>
              )}
              {interpretation.bestCandidates && interpretation.bestCandidates.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('plantAdvisor.diagnose.bestCandidatesTitle')}
                  </div>
                  {interpretation.bestCandidates.map((c, i) => (
                    <div key={i} className="rounded border border-border/60 bg-background/60 p-2 space-y-0.5">
                      <div className="text-[11px] font-medium">
                        #{c.providerRank} · {c.name}
                      </div>
                      {c.reason && <div className="text-[11px] text-muted-foreground">{c.reason}</div>}
                      {c.whatToCheckVisually && c.whatToCheckVisually.length > 0 && (
                        <ul className="list-disc pl-4 text-[11px]">
                          {c.whatToCheckVisually.map((v, j) => (
                            <li key={j}>{v}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {interpretation.needsMoreEvidence && interpretation.needsMoreEvidence.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('plantAdvisor.diagnose.needsMoreEvidence')}
                  </div>
                  <ul className="list-disc pl-4 text-[11px]">
                    {interpretation.needsMoreEvidence.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              {interpretation.unlikelyCandidates && interpretation.unlikelyCandidates.length > 0 && (
                <Collapsible open={unlikelyOpen} onOpenChange={setUnlikelyOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2 text-[11px] text-muted-foreground">
                      <ChevronDown className={`h-3.5 w-3.5 mr-1 transition-transform ${unlikelyOpen ? 'rotate-180' : ''}`} />
                      {t('plantAdvisor.diagnose.unlikelyCandidatesTitle')} ({interpretation.unlikelyCandidates.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="space-y-0.5 pt-1">
                      {interpretation.unlikelyCandidates.map((c, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground">
                          <span className="font-medium">
                            #{c.providerRank} · {c.name}
                          </span>
                          {c.reason ? ` — ${c.reason}` : ''}
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
              {interpretation.safetyNote && (
                <div className="text-[10px] text-amber-700 dark:text-amber-300">{interpretation.safetyNote}</div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Provider candidates, collapsed by default */}
      {alts.length > 0 && (
        <Collapsible open={candidatesOpen} onOpenChange={setCandidatesOpen}>
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2 text-xs text-muted-foreground">
                <ChevronDown className={`h-3.5 w-3.5 mr-1.5 transition-transform ${candidatesOpen ? 'rotate-180' : ''}`} />
                {t('plantAdvisor.dashboard.diag.providerCandidates')}
              </Button>
            </CollapsibleTrigger>
            <span className="text-[10px] text-muted-foreground">
              {t('plantAdvisor.dashboard.diag.candidatesAvailable', { count: diagnoses.length })}
            </span>
          </div>
          <CollapsibleContent className="pt-2 space-y-1.5">
            {shownAlts.map((a) => (
              <div key={a.id} className="rounded-md border border-border/60 px-2 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs font-medium truncate min-w-0">{a.name || '—'}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {problemTypeLabel(a.problem_type)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {relevanceLabel(relevanceOf(a))}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {fmtPct(a.score)}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => doConfirm(a.id)}
                      disabled={confirmMut.isPending}
                    >
                      {t('plantAdvisor.diagnose.useThis')}
                    </Button>
                  </div>
                </div>
                {a.description && a.description !== a.name && (
                  <div className="text-[11px] text-muted-foreground line-clamp-2">{a.description}</div>
                )}
              </div>
            ))}
            {!allCandidates && alts.length > 2 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 -ml-2 text-xs text-muted-foreground"
                onClick={() => setAllCandidates(true)}
              >
                {t('plantAdvisor.dashboard.diag.showAllCandidates')}
              </Button>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Next step pointer instead of the old disabled treatment button */}
      {top && (
        <div className="text-[11px] text-muted-foreground">
          {problemResearchReady
            ? t('plantAdvisor.dashboard.diag.researchReady')
            : t('plantAdvisor.dashboard.diag.researchMissing')}
          {lowConfidence && ` ${t('plantAdvisor.dashboard.diag.considerAlternative')}`}
        </div>
      )}
    </div>
  );
}
