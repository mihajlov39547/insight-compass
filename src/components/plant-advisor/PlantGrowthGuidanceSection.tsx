import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sprout, RefreshCw, ExternalLink, AlertTriangle, Loader2, Droplets, Sun, Mountain, Scissors, Thermometer, Gauge, Apple } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  usePlantCaseGrounding,
  useGatherGrowthGuidance,
  type CareCategory,
  type GroundingSource,
} from '@/hooks/usePlantCaseGrounding';

interface Props {
  caseId: string;
  hasConfirmedIdentification: boolean;
}

const CARE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  watering: Droplets,
  sunlight: Sun,
  soil: Mountain,
  pruning: Scissors,
  hardinessClimate: Thermometer,
  growthRateMaintenance: Gauge,
  fruitingHarvest: Apple,
};

const CARE_ORDER = [
  'watering',
  'sunlight',
  'soil',
  'pruning',
  'hardinessClimate',
  'growthRateMaintenance',
  'fruitingHarvest',
] as const;

const ERROR_I18N: Record<string, string> = {
  wrong_goal: 'plantAdvisor.growth.errors.wrong_goal',
  no_plant_reference: 'plantAdvisor.growth.errors.no_plant_reference',
  case_not_found: 'plantAdvisor.growth.errors.case_not_found',
  unauthorized: 'plantAdvisor.growth.errors.unauthorized',
  persist_failed: 'plantAdvisor.growth.errors.persist_failed',
  internal_error: 'plantAdvisor.growth.errors.internal_error',
};

function CareCard({ category, data }: { category: string; data: CareCategory | null }) {
  const { t } = useTranslation();
  const Icon = CARE_ICONS[category] ?? Sprout;
  if (!data) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/50 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Icon className="h-4 w-4" />
          {t(`plantAdvisor.growth.categories.${category}`)}
        </div>
        <div className="text-xs text-muted-foreground italic">
          {t('plantAdvisor.growth.emptyCategory')}
        </div>
      </div>
    );
  }
  // Dedupe provider chips so we don't render "web · web · web".
  const uniqueProviders = Array.from(new Set(data.sources.map((s) => s.provider)));
  const webCount = data.sources.filter((s) => s.provider === 'web').length;
  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="h-4 w-4 text-primary" />
          {t(`plantAdvisor.growth.categories.${category}`)}
        </div>
        <Badge variant="outline" className="text-[10px]">
          {t(`plantAdvisor.growth.confidence.${data.confidence}`)}
        </Badge>
      </div>
      <div className="text-xs whitespace-pre-wrap text-muted-foreground">{data.summary}</div>
      {uniqueProviders.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {uniqueProviders.map((p) => (
            <Badge key={p} variant="secondary" className="text-[10px] capitalize">
              {p === 'web' && webCount > 1 ? `${p} · ${webCount}` : p}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlantGrowthGuidanceSection({ caseId, hasConfirmedIdentification }: Props) {
  const { t } = useTranslation();
  const { data: grounding, isLoading } = usePlantCaseGrounding(caseId);
  const gather = useGatherGrowthGuidance();

  const run = async (force = false) => {
    try {
      const res = await gather.mutateAsync({ caseId, force });
      if (res.cached) toast.success(t('plantAdvisor.growth.toasts.cached'));
      else toast.success(t('plantAdvisor.growth.toasts.gathered'));
    } catch (e) {
      const code = (e as any).code || (e as Error).message;
      const key = ERROR_I18N[code] || 'plantAdvisor.growth.errors.generic';
      toast.error(t(key));
    }
  };

  const providers = new Set(grounding?.sources?.map((s) => s.provider) ?? []);
  const care = grounding?.normalized_summary?.normalizedCare ?? {};
  const plant = grounding?.normalized_summary?.plant;
  const limitations = grounding?.normalized_summary?.limitations ?? [];
  const lowConfidence = !!plant?.confidenceWarning;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Sprout className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">{t('plantAdvisor.growth.title')}</h3>
            {grounding && (
              <Badge variant="outline" className="text-[10px]">
                {t(`plantAdvisor.growth.status.${grounding.status}`)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{t('plantAdvisor.growth.helper')}</p>
        </div>
      </div>

      {!hasConfirmedIdentification && (
        <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
          {t('plantAdvisor.growth.requireConfirmation')}
        </div>
      )}

      {hasConfirmedIdentification && !grounding && (
        <Button onClick={() => run(false)} disabled={gather.isPending || isLoading} size="sm">
          {gather.isPending ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Sprout className="h-4 w-4 mr-1.5" />
          )}
          {t('plantAdvisor.growth.gather')}
        </Button>
      )}

      {grounding && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="text-muted-foreground">
              {t('plantAdvisor.growth.matched')}:{' '}
              <span className="text-foreground">
                {[grounding.primary_common_name, grounding.primary_scientific_name].filter(Boolean).join(' — ') || '—'}
              </span>
              {' · '}
              {t('plantAdvisor.growth.fetchedAt', {
                date: format(new Date(grounding.fetched_at), 'PP'),
              })}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(true)}
              disabled={gather.isPending}
            >
              {gather.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t('plantAdvisor.growth.refresh')}
            </Button>
          </div>

          {/* Provider chips */}
          <div className="flex flex-wrap gap-1.5">
            {['trefle', 'perenual', 'web'].map((p) => (
              <Badge
                key={p}
                variant={providers.has(p as any) ? 'default' : 'outline'}
                className="text-[10px] capitalize"
              >
                {p}
              </Badge>
            ))}
          </div>

          {grounding.status === 'partial' && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{t('plantAdvisor.growth.partialNote')}</span>
            </div>
          )}

          {lowConfidence && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{t('plantAdvisor.growth.lowConfidenceWarning')}</span>
            </div>
          )}

          {/* Care cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {CARE_ORDER.map((cat) => (
              <CareCard key={cat} category={cat} data={care[cat] ?? null} />
            ))}
          </div>

          {/* Sources list */}
          {grounding.sources.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('plantAdvisor.growth.sources')}
              </div>
              <ul className="space-y-1 text-xs">
                {grounding.sources.map((s: GroundingSource, i) => (
                  <li key={i} className="flex items-start gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] capitalize flex-shrink-0">
                      {s.provider}
                    </Badge>
                    {s.sourceType && s.sourceType !== 'other' && (
                      <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                        {t(`plantAdvisor.growth.sourceType.${s.sourceType}`)}
                      </Badge>
                    )}
                    {s.authorityScore && (
                      <Badge
                        variant={s.authorityScore === 'high' ? 'default' : 'outline'}
                        className="text-[10px] flex-shrink-0"
                      >
                        {t(`plantAdvisor.growth.authority.${s.authorityScore}`)}
                      </Badge>
                    )}
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 break-all"
                      >
                        {s.title}
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    ) : (
                      <span className="text-foreground">{s.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {limitations.length > 0 && (
            <div className="rounded-md border border-border bg-background p-2.5 text-xs text-muted-foreground">
              <div className="font-medium text-foreground mb-1">
                {t('plantAdvisor.growth.limitations')}
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] italic text-muted-foreground">
            {t('plantAdvisor.growth.disclaimer')}
          </p>
        </>
      )}
    </div>
  );
}
