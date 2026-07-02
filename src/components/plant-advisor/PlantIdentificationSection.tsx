import React from 'react';
import { useTranslation } from 'react-i18next';
import { Leaf, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  confidenceBucket,
  useIdentifyPlant,
  usePlantIdentifications,
  type PlantIdentification,
} from '@/hooks/usePlantIdentifications';
import type { PlantCaseImage } from '@/hooks/usePlantCaseImages';

interface Props {
  caseId: string;
  images: PlantCaseImage[];
}

const COMPATIBLE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

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
    default:
      return 'plantAdvisor.identify.errors.generic';
  }
}

export function PlantIdentificationSection({ caseId, images }: Props) {
  const { t } = useTranslation();
  const { data: identifications = [], isLoading } = usePlantIdentifications(caseId);
  const identify = useIdentifyPlant();

  const compatible = images.filter((i) =>
    COMPATIBLE_MIMES.has((i.mime_type || '').toLowerCase()),
  );
  const hasImages = images.length > 0;
  const hasCompatible = compatible.length > 0;
  const overFive = compatible.length > 5;

  const run = async () => {
    try {
      const res = await identify.mutateAsync({ plantCaseId: caseId });
      if (res.error) {
        toast.error(t(errorKey(res.error)));
      } else {
        toast.success(t('plantAdvisor.identify.doneToast'));
      }
    } catch (e: any) {
      toast.error(t(errorKey(e?.code)));
    }
  };

  const top = identifications[0];
  const alts = identifications.slice(1, 5);
  const bucket = confidenceBucket(top?.score ?? null);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{t('plantAdvisor.identify.sectionTitle')}</div>
          <div className="text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] mr-1">{t('plantAdvisor.identify.providerBadge')}</Badge>
            {top?.remaining_identification_requests != null && (
              <span>
                {t('plantAdvisor.identify.remaining', { n: top.remaining_identification_requests })}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          onClick={run}
          disabled={!hasImages || !hasCompatible || identify.isPending}
        >
          {identify.isPending ? (
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

      {hasImages && !hasCompatible && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {t('plantAdvisor.identify.noCompatibleWarning')}
        </div>
      )}
      {overFive && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.identify.usingBestFive')}
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
            <Badge
              variant={bucket === 'high' ? 'default' : bucket === 'medium' ? 'secondary' : 'outline'}
              className="text-[10px]"
            >
              {bucket ? t(`plantAdvisor.identify.confidence.${bucket}`) : t('plantAdvisor.identify.confidence.unknown')}
              {' · '}{formatConfidence(top.score)}
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Field label={t('plantAdvisor.identify.fields.scientific')} value={top.scientific_name_without_author || top.scientific_name} />
            <Field label={t('plantAdvisor.identify.fields.common')} value={top.common_name} />
            <Field label={t('plantAdvisor.identify.fields.family')} value={top.family} />
            <Field label={t('plantAdvisor.identify.fields.genus')} value={top.genus} />
          </div>
          {bucket === 'low' && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {t('plantAdvisor.identify.uncertain')}
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
                className="flex items-center justify-between text-xs rounded-md border border-border/60 px-2 py-1.5"
              >
                <span className="truncate">
                  <span className="font-medium">
                    {a.common_name || a.scientific_name_without_author || a.scientific_name || '—'}
                  </span>
                  {a.scientific_name_without_author && a.common_name && (
                    <span className="text-muted-foreground italic ml-1.5">
                      {a.scientific_name_without_author}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground ml-2 flex-shrink-0">{formatConfidence(a.score)}</span>
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
