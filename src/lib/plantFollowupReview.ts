export const FOLLOWUP_OUTCOMES = ['improved', 'unchanged', 'worse', 'resolved', 'unknown'] as const;
export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number];
export const FOLLOWUP_AREAS = ['identification', 'diagnosis', 'growth', 'income', 'general'] as const;
export type FollowupArea = (typeof FOLLOWUP_AREAS)[number];

export type FollowupAction =
  | 'compare_candidates'
  | 'rerun_visual_check'
  | 'rerun_diagnosis'
  | 'ask_chat'
  | 'none';

export interface FollowupReview {
  latestOutcome: FollowupOutcome | null;
  hasFollowups: boolean;
  needsReevaluation: boolean;
  /** i18n reason keys under plantAdvisor.followups.reasons */
  reasons: string[];
  suggestedAction: FollowupAction;
}

export interface FollowupLike {
  outcome_status: FollowupOutcome;
  related_area: FollowupArea;
  note: string | null;
  title: string | null;
}

const SYMPTOM_RE = /symptom|spot|lesion|wilt|yellow|rot|pest|mold|mould|simptom|pega|mrlj|vene|žut|zut|trul|štetoč|stetoc|buđ|budj/i;

/** Pure, deterministic review of the latest follow-up. Never triggers providers. */
export function computeFollowupReview(input: {
  goal: string;
  followups: FollowupLike[]; // newest first
  hasAlternativeCandidates: boolean;
  lowIdentConfidence: boolean;
}): FollowupReview {
  const latest = input.followups[0];
  if (!latest) {
    return { latestOutcome: null, hasFollowups: false, needsReevaluation: false, reasons: [], suggestedAction: 'none' };
  }
  const outcome = latest.outcome_status;
  const base = { latestOutcome: outcome, hasFollowups: true };
  if (outcome === 'resolved') return { ...base, needsReevaluation: false, reasons: ['resolved'], suggestedAction: 'none' };
  if (outcome === 'improved') return { ...base, needsReevaluation: false, reasons: ['improved'], suggestedAction: 'none' };
  if (outcome === 'unchanged' || outcome === 'unknown') {
    return { ...base, needsReevaluation: false, reasons: ['unchanged'], suggestedAction: 'ask_chat' };
  }
  // worse
  const text = `${latest.title ?? ''} ${latest.note ?? ''}`;
  if (input.goal === 'diagnose') {
    return {
      ...base,
      needsReevaluation: true,
      reasons: ['worseDiagnose'],
      suggestedAction: input.hasAlternativeCandidates ? 'compare_candidates' : 'rerun_diagnosis',
    };
  }
  if (input.goal === 'identify') {
    return {
      ...base,
      needsReevaluation: true,
      reasons: [input.lowIdentConfidence ? 'worseIdentifyUncertain' : 'worseIdentify'],
      suggestedAction: input.lowIdentConfidence ? 'rerun_visual_check' : 'ask_chat',
    };
  }
  if (input.goal === 'increase_income') {
    const symptoms = SYMPTOM_RE.test(text) || latest.related_area === 'diagnosis';
    return {
      ...base,
      needsReevaluation: true,
      reasons: [symptoms ? 'worseIncomeSymptoms' : 'worseIncome'],
      suggestedAction: 'ask_chat',
    };
  }
  return { ...base, needsReevaluation: true, reasons: ['worseGrowth'], suggestedAction: 'ask_chat' };
}
