import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  HelpCircle,
  RefreshCw,
  ScanEye,
  ShieldQuestion,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { fetchEdgeFunction } from '@/lib/edge/invokeWithAuth';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePlantVisualOpinion,
  useRunPlantVisualOpinion,
  type VisualOpinionMode,
} from '@/hooks/usePlantVisualOpinion';
import {
  getVisualVerification,
  type ConfidenceLabel,
  type VisualCandidateView,
  type VisualSupport,
} from '@/lib/plantVisualVerification';

interface Props {
  caseId: string;
  mode: VisualOpinionMode;
  hasImages: boolean;
  hasConfirmedIdentification: boolean;
  /** Confirmed plant (identify) or confirmed diagnosis (diagnose) name, for verification. */
  confirmedName?: string | null;
  /** Confirmed scientific name, used to compare visual candidates. */
  confirmedScientificName?: string | null;
  /** Pl@ntNet confidence bucket of the confirmed/top identification. */
  identBucket?: ConfidenceLabel | null;
  /** Raw Pl@ntNet score (0..1) of the confirmed/top identification, shown unchanged. */
  identScore?: number | null;
}

const ERROR_KEY: Record<string, string> = {
  missing_serpapi_key: 'plantAdvisor.visualOpinion.errors.config',
  no_usable_image: 'plantAdvisor.visualOpinion.errors.noImage',
  image_download_failed: 'plantAdvisor.visualOpinion.errors.noImage',
  no_public_image_url: 'plantAdvisor.visualOpinion.errors.noImage',
  no_confirmed_identification: 'plantAdvisor.visualOpinion.errors.needsConfirmed',
  monthly_limit_reached: 'plantAdvisor.visualOpinion.errors.limit',
  provider_error: 'plantAdvisor.visualOpinion.errors.provider',
  provider_status_not_success: 'plantAdvisor.visualOpinion.errors.provider',
  provider_unreachable: 'plantAdvisor.visualOpinion.errors.network',
  empty_answer: 'plantAdvisor.visualOpinion.errors.empty',
};

const SUPPORT_ICON: Record<VisualSupport, React.ReactNode> = {
  supports: <CheckCircle2 className="h-4 w-4" />,
  conflicts: <AlertTriangle className="h-4 w-4" />,
  inconclusive: <ShieldQuestion className="h-4 w-4" />,
  not_plant: <AlertTriangle className="h-4 w-4" />,
};

const SUPPORT_TONE: Record<VisualSupport, string> = {
  supports: 'border-emerald-500/40 bg-emerald-500/10',
  conflicts: 'border-amber-500/40 bg-amber-500/10',
  inconclusive: 'border-border bg-muted/30',
  not_plant: 'border-amber-500/40 bg-amber-500/10',
};

export function PlantVisualOpinionSection({
  caseId,
  mode,
  hasImages,
  hasConfirmedIdentification,
  confirmedName,
  confirmedScientificName,
  identBucket,
  identScore,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = usePlantVisualOpinion(caseId, mode);
  const run = useRunPlantVisualOpinion();
  const [ignored, setIgnored] = useState<string[]>([]);
  const [compared, setCompared] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const row = query.data ?? null;
  const verification = getVisualVerification(row, {
    mode,
    confirmedScientificName:
      mode === 'identify' ? confirmedScientificName ?? confirmedName ?? null : confirmedScientificName ?? null,
    confirmedDiagnosisName: mode === 'diagnose' ? confirmedName ?? null : null,
    identBucket: identBucket ?? null,
  });
  const blocked = mode === 'diagnose' && !hasConfirmedIdentification;

  const execute = async (force: boolean) => {
    try {
      await run.mutateAsync({ caseId, mode, force });
      toast.success(t('plantAdvisor.visualOpinion.doneToast'));
    } catch (e: any) {
      const code = e?.code || e?.message;
      const key = code && ERROR_KEY[code];
      toast.error(key ? t(key) : t('plantAdvisor.visualOpinion.errors.generic'));
    }
  };

  /** Adds a non-confirmed visual candidate (server-validated) so the user can compare it later. */
  const useAsAlternative = async (candidate: VisualCandidateView) => {
    if (!row) return;
    setSaving(candidate.name);
    try {
      const res = await fetchEdgeFunction('/functions/v1/plant-add-visual-candidate', {
        method: 'POST',
        body: JSON.stringify({
          caseId,
          visualOpinionId: row.id,
          name: candidate.name,
          scientificName: candidate.scientificName ?? null,
          commonName: candidate.commonName ?? null,
          supportLevel: candidate.supportLevel,
          reason: candidate.reason ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('add_failed');
      await qc.invalidateQueries({ queryKey: ['plant-identifications', caseId] });
      setAdded((p) => (p.includes(candidate.name) ? p : [...p, candidate.name]));
      if (data?.duplicate) {
        toast.info(t('plantAdvisor.visualOpinion.candidates.duplicateToast'));
      } else {
        toast.success(t('plantAdvisor.visualOpinion.candidates.addedToast'));
      }
    } catch {
      toast.error(t('plantAdvisor.visualOpinion.candidates.addFailed'));
    } finally {
      setSaving(null);
    }
  };


  const statusKey = verification ? `plantAdvisor.visualOpinion.support.${verification.visualSupport}` : null;
  const badgeKey = verification ? `plantAdvisor.visualOpinion.badge.${verification.visualSupport}` : null;
  const candidates = (verification?.visualCandidates ?? []).filter((c) => !ignored.includes(c.name));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 text-xs text-muted-foreground">
          {t('plantAdvisor.visualOpinion.helper')}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => execute(!!row)}
          disabled={run.isPending || blocked || !hasImages}
        >
          {row ? (
            <RefreshCw className={`h-4 w-4 mr-1.5 ${run.isPending ? 'animate-spin' : ''}`} />
          ) : (
            <ScanEye className="h-4 w-4 mr-1.5" />
          )}
          {row
            ? t(`plantAdvisor.visualOpinion.${mode}.refresh`)
            : t(`plantAdvisor.visualOpinion.${mode}.run`)}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px]">
          {t('plantAdvisor.visualOpinion.providerLabel')}
        </Badge>
        {row && (
          <span className="text-[11px] text-muted-foreground">
            {t('plantAdvisor.visualOpinion.fetchedAt', {
              date: format(new Date(row.fetched_at), 'PP'),
            })}
          </span>
        )}
      </div>

      {blocked && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.visualOpinion.errors.needsConfirmed')}
        </div>
      )}
      {!blocked && !hasImages && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.visualOpinion.errors.noImage')}
        </div>
      )}
      {!blocked && hasImages && !row && !run.isPending && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.visualOpinion.notRun')}</div>
      )}
      {run.isPending && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.visualOpinion.loading')}</div>
      )}

      {verification && (
        <div className="space-y-4">
          {/* 1. Verification result */}
          <div className={`rounded-lg border px-3 py-2.5 text-xs space-y-2 ${SUPPORT_TONE[verification.visualSupport]}`}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0">{SUPPORT_ICON[verification.visualSupport]}</span>
              <div className="min-w-0 space-y-1">
                <div className="font-medium">{t(`${statusKey}.${mode}`)}</div>
                {verification.verificationSummary && (
                  <div className="text-muted-foreground">{verification.verificationSummary}</div>
                )}
              </div>
              <Badge variant="outline" className="ml-auto text-[10px] flex-shrink-0">
                {t(badgeKey!)}
              </Badge>
            </div>

            <div className="grid gap-1 pt-1 sm:grid-cols-2">
              {confirmedName && (
                <div className="text-[11px]">
                  <span className="text-muted-foreground">
                    {mode === 'identify'
                      ? t('plantAdvisor.visualOpinion.result.confirmedPlant')
                      : t('plantAdvisor.visualOpinion.result.confirmedDiagnosis')}
                    :{' '}
                  </span>
                  {confirmedName}
                </div>
              )}
              {verification.primaryVisualCandidate && mode === 'identify' && (
                <div className="text-[11px]">
                  <span className="text-muted-foreground">
                    {t('plantAdvisor.visualOpinion.result.visualCandidate')}:{' '}
                  </span>
                  {verification.primaryVisualCandidate.scientificName ||
                    verification.primaryVisualCandidate.name}
                </div>
              )}
              {identScore != null && (
                <div className="text-[11px]">
                  <span className="text-muted-foreground">
                    {t('plantAdvisor.visualOpinion.result.plantnetConfidence')}:{' '}
                  </span>
                  {Math.round(identScore * 100)}%
                </div>
              )}
              <div className="text-[11px]">
                <span className="text-muted-foreground">
                  {t('plantAdvisor.visualOpinion.result.overallConfidence')}:{' '}
                </span>
                {t(`plantAdvisor.visualOpinion.confidence.${verification.overallConfidenceLabel}`)}
                {verification.confidenceAdjustment !== 'unchanged' && (
                  <>
                    {' · '}
                    {t(`plantAdvisor.visualOpinion.adjustment.${verification.confidenceAdjustment}`)}
                  </>
                )}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t('plantAdvisor.visualOpinion.result.scoreUnchanged')}
            </div>
          </div>

          {/* 2. Visual candidates */}
          {mode === 'identify' && candidates.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('plantAdvisor.visualOpinion.candidates.title')}
              </div>
              {candidates.map((c) => (
                <div key={c.name} className="rounded-md border border-border bg-card/60 p-2.5 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">
                        {c.scientificName || c.name}
                        {c.commonName ? ` · ${c.commonName}` : ''}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Badge variant="outline" className="text-[10px]">
                          {t(`plantAdvisor.visualOpinion.candidates.support.${c.supportLevel}`)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {c.matchesConfirmedPlant
                            ? t('plantAdvisor.visualOpinion.candidates.matches')
                            : t('plantAdvisor.visualOpinion.candidates.alternative')}
                        </span>
                      </div>
                    </div>
                  </div>
                  {compared === c.name && (
                    <div className="rounded-sm bg-muted/40 px-2 py-1.5 text-[11px] space-y-0.5">
                      <div>
                        <span className="text-muted-foreground">
                          {t('plantAdvisor.visualOpinion.result.confirmedPlant')}:{' '}
                        </span>
                        {confirmedScientificName || confirmedName || '—'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          {t('plantAdvisor.visualOpinion.result.visualCandidate')}:{' '}
                        </span>
                        {c.scientificName || c.name}
                      </div>
                      {c.reason && <div className="text-muted-foreground">{c.reason}</div>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setCompared(compared === c.name ? null : c.name)}
                    >
                      {t('plantAdvisor.visualOpinion.candidates.compare')}
                    </Button>
                    {!c.matchesConfirmedPlant && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        disabled={saving === c.name || added.includes(c.name)}
                        onClick={() => useAsAlternative(c)}
                      >
                        {added.includes(c.name)
                          ? t('plantAdvisor.visualOpinion.candidates.alreadyAdded')
                          : t('plantAdvisor.visualOpinion.candidates.useAlternative')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] text-muted-foreground"
                      onClick={() => setIgnored((p) => [...p, c.name])}
                    >
                      {t('plantAdvisor.visualOpinion.candidates.ignore')}
                    </Button>
                  </div>
                </div>
              ))}
              <div className="text-[10px] text-muted-foreground">
                {t('plantAdvisor.visualOpinion.candidates.hint')}
              </div>
            </div>
          )}

          {mode === 'diagnose' && verification.visualProblemCandidates.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('plantAdvisor.visualOpinion.problemCandidates.title')}
              </div>
              <ul className="space-y-1">
                {verification.visualProblemCandidates.slice(0, 4).map((p) => (
                  <li key={p.name} className="flex items-center gap-2 text-xs">
                    <span className="truncate">{p.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {t(`plantAdvisor.visualOpinion.candidates.support.${p.supportLevel}`)}
                    </Badge>
                    {p.matchesConfirmedDiagnosis && (
                      <span className="text-[10px] text-muted-foreground">
                        {t('plantAdvisor.visualOpinion.problemCandidates.matches')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 3. Why it supports / conflicts */}
          {verification.displayBullets.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                {t('plantAdvisor.visualOpinion.why')}
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">
                {verification.displayBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 4. What to photograph next */}
          {verification.nextPhotoSuggestions.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                {t('plantAdvisor.visualOpinion.missingPhotos')}
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">
                {verification.nextPhotoSuggestions.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Advanced: raw scrubbed provider text (debug only) */}
          {verification.rawMarkdown && (
            <div className="text-xs">
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:underline flex items-center gap-1.5"
                onClick={() => setShowRaw((v) => !v)}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                {t('plantAdvisor.visualOpinion.advancedText')}
              </button>
              {showRaw && (
                <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {verification.rawMarkdown}
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-muted-foreground">
            {t('plantAdvisor.visualOpinion.disclaimer')}
          </div>
        </div>
      )}
    </div>
  );
}
