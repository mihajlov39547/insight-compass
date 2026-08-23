import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlantCaseDashboardData } from '@/hooks/usePlantCaseDashboard';

type StepState = 'complete' | 'warning' | 'missing' | 'optional';

interface Step {
  key: string;
  label: string;
  state: StepState;
  hint?: string;
}

const DOT: Record<StepState, string> = {
  complete: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  missing: 'bg-muted text-muted-foreground border-border',
  optional: 'bg-muted text-muted-foreground border-border',
};

/** Horizontal progress indicator replacing the old "Step 1 / Step 2" banners. */
export function PlantCaseProgressTimeline({ data }: { data: PlantCaseDashboardData }) {
  const { t } = useTranslation();

  const steps: Step[] = [
    {
      key: 'images',
      label: t('plantAdvisor.dashboard.timeline.images'),
      state: data.hasImages ? 'complete' : 'missing',
    },
    {
      key: 'identified',
      label: t('plantAdvisor.dashboard.timeline.identified'),
      state: data.hasConfirmedIdent
        ? data.lowIdentConfidence
          ? 'warning'
          : 'complete'
        : 'missing',
    },
    {
      key: 'profile',
      label: t('plantAdvisor.dashboard.timeline.profile'),
      state: data.hasAnyPlantProfile
        ? data.permapeopleApproximate
          ? 'warning'
          : 'complete'
        : 'missing',
    },
  ];

  // Advisory-only visual second opinion (never blocks chat).
  const visualStep = (key: string, labelKey: string): Step => ({
    key,
    label: t(labelKey),
    state: data.visualOpinionSaysNotPlant
      ? 'warning'
      : data.hasVisualOpinion
        ? 'complete'
        : 'optional',
  });

  if (data.goal === 'diagnose') {
    steps.push({
      key: 'diagnosed',
      label: t('plantAdvisor.dashboard.timeline.diagnosed'),
      state: data.hasConfirmedDiag
        ? data.lowDiagConfidence || data.unknownRelevance
          ? 'warning'
          : 'complete'
        : 'missing',
    });
    steps.push(visualStep('visualProblemCheck', 'plantAdvisor.dashboard.timeline.visualProblemCheck'));
    steps.push({
      key: 'problemResearch',
      label: t('plantAdvisor.dashboard.timeline.problemResearch'),
      state: data.hasProblemResearch ? 'complete' : 'missing',
    });
  } else if (data.goal === 'improve_growth') {
    steps.push({
      key: 'growth',
      label: t('plantAdvisor.dashboard.timeline.growth'),
      state: data.hasGrowthGuidance ? 'complete' : 'missing',
    });
  } else if (data.goal === 'increase_income') {
    steps.push({
      key: 'incomeResearch',
      label: t('plantAdvisor.dashboard.timeline.incomeResearch'),
      state: data.hasIncomeResearch ? 'complete' : 'missing',
    });
  } else {
    steps.push(visualStep('visualCheck', 'plantAdvisor.dashboard.timeline.visualCheck'));
    steps.push({
      key: 'plantResearch',
      label: t('plantAdvisor.dashboard.timeline.plantResearch'),
      state: data.hasPlantResearch ? 'complete' : 'missing',
    });
  }

  steps.push({
    key: 'chat',
    label: t('plantAdvisor.dashboard.timeline.chat'),
    state: data.isChatReady ? 'complete' : 'missing',
  });

  return (
    <nav
      aria-label={t('plantAdvisor.dashboard.timeline.aria')}
      className="rounded-xl border border-border/60 bg-card/60 p-3 overflow-x-auto"
    >
      <ol className="flex items-center gap-1 min-w-max sm:min-w-0">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1">
            <div className="flex items-center gap-2 rounded-lg px-2 py-1">
              <span
                className={cn(
                  'h-5 w-5 rounded-full border flex items-center justify-center flex-shrink-0',
                  DOT[s.state],
                )}
              >
                {s.state === 'complete' ? (
                  <Check className="h-3 w-3" />
                ) : s.state === 'warning' ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <Circle className="h-2 w-2" />
                )}
              </span>
              <span
                className={cn(
                  'text-xs whitespace-nowrap',
                  s.state === 'missing' ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && <span className="h-px w-4 sm:w-6 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  );
}
