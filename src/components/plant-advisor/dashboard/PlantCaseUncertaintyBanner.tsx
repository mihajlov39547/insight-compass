import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { PlantCaseDashboardData } from '@/hooks/usePlantCaseDashboard';

/**
 * One consolidated uncertainty panel replacing the repeated amber boxes that
 * used to live inside the identification / diagnosis / research cards.
 */
export function PlantCaseUncertaintyBanner({ data }: { data: PlantCaseDashboardData }) {
  const { t } = useTranslation();

  const reasons: string[] = [];
  if (data.topIdent && data.lowIdentConfidence) {
    reasons.push(
      t('plantAdvisor.dashboard.uncertainty.lowIdent', {
        percent: Math.round((data.identScore ?? 0) * 100),
      }),
    );
  }
  if (data.topDiag && data.lowDiagConfidence) {
    reasons.push(
      t('plantAdvisor.dashboard.uncertainty.lowDiagnosis', {
        percent: Math.round((data.topDiag.score ?? 0) * 100),
      }),
    );
  }
  if (data.unknownRelevance) {
    reasons.push(t('plantAdvisor.dashboard.uncertainty.unknownRelevance'));
  }

  if (reasons.length === 0) return null;

  const both = data.lowIdentConfidence && data.lowDiagConfidence;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {both
            ? t('plantAdvisor.dashboard.uncertainty.headlineBoth')
            : t('plantAdvisor.dashboard.uncertainty.headline')}
        </p>
        <ul className="space-y-0.5">
          {reasons.map((r, i) => (
            <li key={i} className="text-xs text-amber-900/90 dark:text-amber-200/90">
              • {r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
