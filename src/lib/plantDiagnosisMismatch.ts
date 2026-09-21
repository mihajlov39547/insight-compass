/**
 * Derives a read-only "diagnosis needs review" signal for Diagnose Problem cases.
 *
 * It never changes the confirmed diagnosis and never produces treatment or
 * chemical advice — it only explains why the available evidence does not agree.
 */
import type { VisualSupport } from '@/lib/plantVisualVerification';

export type DiagnosisMismatchReasonKey =
  | 'lowConfidence'
  | 'unknownRelevance'
  | 'lowRelevance'
  | 'triageDiffers'
  | 'visualConflicts'
  | 'visualInconclusive'
  | 'visualNotPlant'
  | 'noProblemResearch';

export type DiagnosisReviewAction =
  | 'review_candidates'
  | 'add_photos'
  | 'run_problem_research'
  | 'ask_chat'
  | 'none';

export interface DiagnosisMismatch {
  hasMismatch: boolean;
  severity: 'warning' | 'review';
  reasons: DiagnosisMismatchReasonKey[];
  confirmedDiagnosisName: string | null;
  visualSupport: VisualSupport | null;
  suggestedReviewAction: DiagnosisReviewAction;
}

function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function computeDiagnosisMismatch(args: {
  goal: string | null | undefined;
  confirmedDiagnosisName: string | null;
  lowDiagnosisConfidence: boolean;
  relevance: string | null | undefined;
  triagePreferredName: string | null | undefined;
  visualSupport: VisualSupport | null | undefined;
  hasAlternativeCandidates: boolean;
  hasProblemResearch: boolean;
  photoQualityGood: boolean;
  isChatReady: boolean;
}): DiagnosisMismatch {
  const empty: DiagnosisMismatch = {
    hasMismatch: false,
    severity: 'review',
    reasons: [],
    confirmedDiagnosisName: args.confirmedDiagnosisName,
    visualSupport: args.visualSupport ?? null,
    suggestedReviewAction: 'none',
  };
  if (args.goal !== 'diagnose' || !args.confirmedDiagnosisName) return empty;

  const reasons: DiagnosisMismatchReasonKey[] = [];
  const visualSupport = args.visualSupport ?? null;

  if (args.lowDiagnosisConfidence) reasons.push('lowConfidence');
  if (args.relevance === 'unknown' || !args.relevance) reasons.push('unknownRelevance');
  else if (args.relevance === 'low') reasons.push('lowRelevance');

  const triage = normalize(args.triagePreferredName);
  const confirmed = normalize(args.confirmedDiagnosisName);
  const triageDiffers =
    !!triage && !!confirmed && triage !== confirmed && !triage.includes(confirmed) && !confirmed.includes(triage);
  if (triageDiffers) reasons.push('triageDiffers');

  if (visualSupport === 'conflicts') reasons.push('visualConflicts');
  else if (visualSupport === 'inconclusive') reasons.push('visualInconclusive');
  else if (visualSupport === 'not_plant') reasons.push('visualNotPlant');

  const hasMismatch = reasons.length > 0;
  // Missing problem research is a context gap, not a mismatch on its own.
  if (hasMismatch && !args.hasProblemResearch) reasons.push('noProblemResearch');

  if (!hasMismatch) return { ...empty, visualSupport };

  const severity: 'warning' | 'review' =
    visualSupport === 'conflicts' || visualSupport === 'not_plant' ? 'warning' : 'review';

  let suggestedReviewAction: DiagnosisReviewAction;
  if (visualSupport === 'inconclusive' || visualSupport === 'not_plant' || !args.photoQualityGood) {
    suggestedReviewAction = 'add_photos';
  } else if (args.hasAlternativeCandidates) {
    suggestedReviewAction = 'review_candidates';
  } else if (!args.hasProblemResearch) {
    suggestedReviewAction = 'run_problem_research';
  } else {
    suggestedReviewAction = args.isChatReady ? 'ask_chat' : 'none';
  }

  return {
    hasMismatch: true,
    severity,
    reasons: reasons.slice(0, 3),
    confirmedDiagnosisName: args.confirmedDiagnosisName,
    visualSupport,
    suggestedReviewAction,
  };
}
