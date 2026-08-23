import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Camera, Eye, RefreshCw, ScanEye } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  usePlantVisualOpinion,
  useRunPlantVisualOpinion,
  visualOpinionConflicts,
  type VisualOpinionMode,
} from '@/hooks/usePlantVisualOpinion';

interface Props {
  caseId: string;
  mode: VisualOpinionMode;
  hasImages: boolean;
  hasConfirmedIdentification: boolean;
  /** Confirmed plant (identify) or confirmed diagnosis (diagnose) name, for conflict hints. */
  confirmedName?: string | null;
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

export function PlantVisualOpinionSection({
  caseId,
  mode,
  hasImages,
  hasConfirmedIdentification,
  confirmedName,
}: Props) {
  const { t } = useTranslation();
  const query = usePlantVisualOpinion(caseId, mode);
  const run = useRunPlantVisualOpinion();

  const row = query.data ?? null;
  const s = row?.structured_result ?? {};
  const notPlant = !!(s.saysNotPlant || s.safetyFlags?.notAPlantImage);
  const conflict = visualOpinionConflicts(row, confirmedName ?? null);
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

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 text-xs text-muted-foreground">
          {t('plantAdvisor.visualOpinion.helper')}
        </div>
        <Button size="sm" variant="outline" onClick={() => execute(!!row)} disabled={run.isPending || blocked || !hasImages}>
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
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.visualOpinion.notRun')}
        </div>
      )}
      {run.isPending && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.visualOpinion.loading')}</div>
      )}

      {row && notPlant && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">{t('plantAdvisor.visualOpinion.notPlantTitle')}</div>
            <div className="text-muted-foreground mt-0.5">
              {t('plantAdvisor.visualOpinion.notPlantHint')}
            </div>
          </div>
        </div>
      )}

      {row && !notPlant && conflict && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            {mode === 'identify'
              ? t('plantAdvisor.visualOpinion.conflictIdentify')
              : t('plantAdvisor.visualOpinion.conflictDiagnose')}
            <div className="text-muted-foreground mt-0.5">
              {t('plantAdvisor.visualOpinion.conflictHint')}
            </div>
          </div>
        </div>
      )}

      {row && !notPlant && (
        <div className="space-y-3">
          {row.opinion_summary && (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed flex gap-2">
              <Eye className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
              <span>{row.opinion_summary}</span>
            </div>
          )}

          {(s.visibleSymptoms?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                {t('plantAdvisor.visualOpinion.symptoms')}
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">
                {s.visibleSymptoms!.slice(0, 5).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {(s.possiblePlantNames?.length ?? 0) > 0 && mode === 'identify' && (
            <div className="text-xs">
              <span className="text-muted-foreground">
                {t('plantAdvisor.visualOpinion.mentioned')}:{' '}
              </span>
              {s.possiblePlantNames!.slice(0, 4).join(', ')}
            </div>
          )}

          {(s.possibleProblemNames?.length ?? 0) > 0 && mode === 'diagnose' && (
            <div className="text-xs">
              <span className="text-muted-foreground">
                {t('plantAdvisor.visualOpinion.mentioned')}:{' '}
              </span>
              {s.possibleProblemNames!.slice(0, 4).join(', ')}
            </div>
          )}

          {(s.missingPhotoSuggestions?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                {t('plantAdvisor.visualOpinion.missingPhotos')}
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">
                {s.missingPhotoSuggestions!.slice(0, 4).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {s.markdown && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {t('plantAdvisor.visualOpinion.showDetails')}
              </summary>
              <div className="mt-2 whitespace-pre-wrap leading-relaxed">{s.markdown}</div>
            </details>
          )}

          <div className="text-[11px] text-muted-foreground">
            {t('plantAdvisor.visualOpinion.disclaimer')}
          </div>
        </div>
      )}
    </div>
  );
}
