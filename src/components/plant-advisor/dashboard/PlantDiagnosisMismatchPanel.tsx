import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DiagnosisMismatch } from '@/lib/plantDiagnosisMismatch';

interface Props {
  mismatch: DiagnosisMismatch;
  onAddPhotos: () => void;
  onReviewCandidates: () => void;
  onRunProblemResearch: () => void;
  onAskChat: () => void;
}

/** Compact amber review panel for Diagnose cases with conflicting evidence. */
export function PlantDiagnosisMismatchPanel({
  mismatch,
  onAddPhotos,
  onReviewCandidates,
  onRunProblemResearch,
  onAskChat,
}: Props) {
  const { t } = useTranslation();
  if (!mismatch.hasMismatch) return null;

  const action = mismatch.suggestedReviewAction;
  const handler =
    action === 'add_photos'
      ? onAddPhotos
      : action === 'review_candidates'
        ? onReviewCandidates
        : action === 'run_problem_research'
          ? onRunProblemResearch
          : action === 'ask_chat'
            ? onAskChat
            : null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {t('plantAdvisor.diagnosisMismatch.title')}
        </p>
        <p className="text-xs text-amber-900/90 dark:text-amber-200/90">
          {t(
            mismatch.severity === 'warning'
              ? 'plantAdvisor.diagnosisMismatch.conflictLead'
              : 'plantAdvisor.diagnosisMismatch.inconclusiveLead',
          )}
        </p>
        <ul className="space-y-0.5">
          {mismatch.reasons.map((r) => (
            <li key={r} className="text-xs text-amber-900/90 dark:text-amber-200/90">
              • {t(`plantAdvisor.diagnosisMismatch.reasons.${r}`)}
            </li>
          ))}
        </ul>
        {handler && (
          <Button variant="outline" size="sm" className="h-7 mt-1 text-xs" onClick={handler}>
            {t(`plantAdvisor.diagnosisMismatch.cta.${action}`)}
          </Button>
        )}
      </div>
    </div>
  );
}
