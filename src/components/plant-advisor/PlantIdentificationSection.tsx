import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Leaf, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  confidenceBucket,
  prepareWebpTempImages,
  useConfirmPlantIdentification,
  useIdentifyPlant,
  usePlantIdentifications,
  type PlantIdentification,
} from '@/hooks/usePlantIdentifications';
import { usePlantIdentificationUsage } from '@/hooks/usePlantIdentificationUsage';
import type { PlantCaseImage } from '@/hooks/usePlantCaseImages';
import { useAuth } from '@/contexts/useAuth';
import { isConvertibleForIdentification, isWebpMime } from '@/lib/plantImageConversion';
import { usePlantAdvisorSettings, toPlantnetApiLang } from '@/hooks/usePlantAdvisorSettings';

interface Props {
  caseId: string;
  images: PlantCaseImage[];
}



function formatConfidence(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${Math.round(score * 100)}%`;
}

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'api_key_missing':
      return 'plantAdvisor.identify.errors.apiKeyMissing';
    case 'no_compatible_images':
      return 'plantAdvisor.identify.errors.noCompatible';
    case 'image_download_failed':
      return 'plantAdvisor.identify.errors.downloadFailed';
    case 'quota_exhausted':
      return 'plantAdvisor.identify.errors.quotaExhausted';
    case 'auth_failed':
      return 'plantAdvisor.identify.errors.authFailed';
    case 'bad_request':
      return 'plantAdvisor.identify.errors.badRequest';
    case 'empty_results':
      return 'plantAdvisor.identify.errors.empty';
    case 'identification_limit_reached':
      return 'plantAdvisor.identify.errors.limitReached';
    default:
      return 'plantAdvisor.identify.errors.generic';
  }
}

export function PlantIdentificationSection({ caseId, images }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: identifications = [], isLoading } = usePlantIdentifications(caseId);
  const identify = useIdentifyPlant();
  const confirm = useConfirmPlantIdentification();
  const usage = usePlantIdentificationUsage();
  const settings = usePlantAdvisorSettings();
  const [preparing, setPreparing] = useState(false);

  // Anything identifiable: JPEG/PNG go straight through; WebP is converted client-side.
  const identifiable = images.filter((i) => isConvertibleForIdentification(i.mime_type));
  const webps = images.filter((i) => isWebpMime(i.mime_type));
  const hasImages = images.length > 0;
  const hasIdentifiable = identifiable.length > 0;
  const hasWebp = webps.length > 0;
  const overFive = identifiable.length > 5;

  const run = async () => {
    try {
      let tempImages: Awaited<ReturnType<typeof prepareWebpTempImages>> = [];
      if (hasWebp && user?.id) {
        setPreparing(true);
        try {
          tempImages = await prepareWebpTempImages({
            userId: user.id,
            caseId,
            images: webps,
          });
        } catch (err) {
          console.warn('[plant-identify] webp conversion failed', err);
          toast.error(t('plantAdvisor.identify.errors.webpConvertFailed'));
          return;
        } finally {
          setPreparing(false);
        }
      }

      const res = await identify.mutateAsync({
        plantCaseId: caseId,
        tempImages: tempImages.length > 0 ? tempImages : undefined,
        project: settings.identificationProject || 'k-southeastern-europe',
        lang: toPlantnetApiLang(settings.identificationLanguage),
      });
      if (res.error) {
        toast.error(t(errorKey(res.error)));
      } else {
        toast.success(t('plantAdvisor.identify.doneToast'));
      }
    } catch (e: any) {
      toast.error(t(errorKey(e?.code)));
    }
  };

  const doConfirm = async (identificationId: string) => {
    try {
      await confirm.mutateAsync({ plantCaseId: caseId, identificationId });
      toast.success(t('plantAdvisor.identify.confirmedToast'));
    } catch {
      toast.error(t('plantAdvisor.identify.errors.confirmFailed'));
    }
  };

  const confirmed = identifications.find((i) => i.is_confirmed) || null;
  const top = confirmed || identifications[0];
  const alts = identifications.filter((i) => i.id !== top?.id).slice(0, 4);
  const bucket = confidenceBucket(top?.score ?? null);
  const hasConfirmed = !!confirmed;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{t('plantAdvisor.identify.sectionTitle')}</div>
          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Badge variant="outline" className="text-[10px]">{t('plantAdvisor.identify.providerBadge')}</Badge>
            {!usage.loading && (
              <span>
                {t('plantAdvisor.identify.usedThisMonth', {
                  used: usage.used,
                  limit: usage.limit,
                })}
              </span>
            )}
            {top?.remaining_identification_requests != null && (
              <span>
                · {t('plantAdvisor.identify.remaining', { n: top.remaining_identification_requests })}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          onClick={run}
          disabled={
            !hasImages ||
            !hasIdentifiable ||
            identify.isPending ||
            preparing ||
            usage.isLimitReached
          }
        >
          {preparing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              {t('plantAdvisor.identify.preparing')}
            </>
          ) : identify.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              {t('plantAdvisor.identify.running')}
            </>
          ) : identifications.length > 0 ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t('plantAdvisor.identify.runAgain')}
            </>
          ) : (
            <>
              <Leaf className="h-4 w-4 mr-1.5" />
              {t('plantAdvisor.identify.identify')}
            </>
          )}
        </Button>
      </div>

      {usage.isLimitReached && (
        <div className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1.5">
          {t('plantAdvisor.identify.limitReachedWarning')}
        </div>
      )}
      {hasImages && !hasIdentifiable && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {t('plantAdvisor.identify.noCompatibleWarning')}
        </div>
      )}
      {hasWebp && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.identify.webpNote')}
        </div>
      )}
      {overFive && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.identify.usingBestFive')}
        </div>
      )}
      {hasConfirmed && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.identify.confirmedNote')}
        </div>
      )}

      {isLoading && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.identify.loading')}</div>
      )}

      {top && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-medium">
              {top.common_name || top.scientific_name_without_author || top.scientific_name || '—'}
            </div>
            <div className="flex items-center gap-1.5">
              {top.is_confirmed && (
                <Badge variant="default" className="text-[10px]">
                  <Check className="h-3 w-3 mr-1" />
                  {t('plantAdvisor.identify.confirmed')}
                </Badge>
              )}
              <Badge
                variant={bucket === 'high' ? 'default' : bucket === 'medium' ? 'secondary' : 'outline'}
                className="text-[10px]"
              >
                {bucket ? t(`plantAdvisor.identify.confidence.${bucket}`) : t('plantAdvisor.identify.confidence.unknown')}
                {' · '}{formatConfidence(top.score)}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Field label={t('plantAdvisor.identify.fields.scientific')} value={top.scientific_name_without_author || top.scientific_name} />
            <Field label={t('plantAdvisor.identify.fields.common')} value={top.common_name} />
            <Field label={t('plantAdvisor.identify.fields.family')} value={top.family} />
            <Field label={t('plantAdvisor.identify.fields.genus')} value={top.genus} />
          </div>
          <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
            <span>
              {t('plantAdvisor.identify.projectUsed')}:{' '}
              {t(`plantAdvisor.settings.project.${
                settings.identificationProject === 'k-southeastern-europe'
                  ? 'southeasternEurope'
                  : settings.identificationProject === 'k-world-flora'
                  ? 'worldFlora'
                  : 'all'
              }`)}
            </span>
            <span>
              {t('plantAdvisor.identify.languageUsed')}:{' '}
              {t(`plantAdvisor.settings.lang.${settings.identificationLanguage}`)}
            </span>
          {bucket === 'low' && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {t('plantAdvisor.identify.uncertain')}
            </div>
          )}
          {!top.is_confirmed && (
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => doConfirm(top.id)}
                disabled={confirm.isPending}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                {t('plantAdvisor.identify.confirmThis')}
              </Button>
            </div>
          )}
        </div>
      )}

      {alts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            {t('plantAdvisor.identify.alternatives')}
          </div>
          <ul className="space-y-1">
            {alts.map((a: PlantIdentification) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 text-xs rounded-md border border-border/60 px-2 py-1.5"
              >
                <span className="truncate min-w-0 flex-1">
                  <span className="font-medium">
                    {a.common_name || a.scientific_name_without_author || a.scientific_name || '—'}
                  </span>
                  {a.scientific_name_without_author && a.common_name && (
                    <span className="text-muted-foreground italic ml-1.5">
                      {a.scientific_name_without_author}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground flex-shrink-0">{formatConfidence(a.score)}</span>
                {a.is_confirmed ? (
                  <Badge variant="default" className="text-[10px] flex-shrink-0">
                    <Check className="h-3 w-3 mr-1" />
                    {t('plantAdvisor.identify.confirmed')}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] flex-shrink-0"
                    onClick={() => doConfirm(a.id)}
                    disabled={confirm.isPending}
                  >
                    {t('plantAdvisor.identify.useThisInstead')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="truncate">{value || '—'}</div>
    </div>
  );
}
