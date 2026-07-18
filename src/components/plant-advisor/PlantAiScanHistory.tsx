import React from 'react';
import { useTranslation } from 'react-i18next';
import { Leaf, Stethoscope, CheckCircle2, AlertCircle, Clock, SearchX, History } from 'lucide-react';
import { usePlantAiScanEvents, type PlantAiScanEvent } from '@/hooks/usePlantAiScanEvents';
import { currentMonthKey } from '@/config/plantIdentificationLimits';

function StatusIcon({ status }: { status: PlantAiScanEvent['status'] }) {
  if (status === 'provider_success') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === 'provider_error') return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'empty_results') return <SearchX className="h-3.5 w-3.5 text-amber-600" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PlantAiScanHistory({ limit = 10 }: { limit?: number }) {
  const { t } = useTranslation();
  const monthKey = currentMonthKey();
  const { data: events = [], isLoading } = usePlantAiScanEvents({ limit, monthKey });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t('plantAdvisor.scanHistory.title')}</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {t('plantAdvisor.scanHistory.subtitle', { count: events.length })}
        </span>
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">{t('common.loading', 'Loading…')}</div>
      ) : events.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.scanHistory.empty')}</div>
      ) : (
        <div className="divide-y divide-border">
          {events.map((e) => {
            const TypeIcon = e.scan_type === 'diagnose' ? Stethoscope : Leaf;
            return (
              <div key={e.id} className="flex items-center gap-3 py-2 text-xs">
                <TypeIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {t(`plantAdvisor.scanHistory.type.${e.scan_type}`)}
                  </div>
                  <div className="text-muted-foreground truncate">{formatWhen(e.created_at)}</div>
                </div>
                <div className="inline-flex items-center gap-1 shrink-0">
                  <StatusIcon status={e.status} />
                  <span className="text-muted-foreground">
                    {t(`plantAdvisor.scanHistory.status.${e.status}`)}
                  </span>
                </div>
                {e.usage_used != null && e.usage_limit != null && (
                  <div className="text-muted-foreground shrink-0 tabular-nums">
                    {e.usage_used}/{e.usage_limit}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
