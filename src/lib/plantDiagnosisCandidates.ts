/**
 * Structured, comparable view of the diagnosis candidates for a Diagnose case.
 *
 * It only reorganises data that already exists (provider rows, AI triage,
 * visual second opinion, photo quality, problem research) so the user can
 * compare candidates and deliberately confirm one. It never changes the
 * confirmed diagnosis and never derives treatment or chemical guidance.
 */
import type { PlantDiagnosis, PlantDiagnosisInterpretationData } from '@/hooks/usePlantDiagnoses';
import type { VisualVerification } from '@/lib/plantVisualVerification';

export type CandidateConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type CandidateRelevance = 'high' | 'medium' | 'low' | 'unknown';

export interface DiagnosisCandidateView {
  id: string;
  name: string;
  description: string | null;
  problemType: string;
  provider: string;
  score: number | null;
  confidence: CandidateConfidence;
  relevance: CandidateRelevance;
  isConfirmed: boolean;
  isTriagePreferred: boolean;
  isVisualMentioned: boolean;
  isResearchMentioned: boolean;
  /** Max 2 short bullets, no treatment advice. */
  whyBullets: string[];
  /** Max 2 short bullets describing evidence that is still missing. */
  missingEvidence: string[];
  canConfirm: boolean;
}

function norm(v: string | null | undefined): string {
  return (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Loose but conservative name match used for badges only. */
function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Only claims a research mention when a distinctive token really appears. */
function researchMentions(name: string, researchText: string): boolean {
  if (!researchText) return false;
  const haystack = norm(researchText);
  if (!haystack) return false;
  const tokens = norm(name)
    .split(' ')
    .filter((w) => w.length >= 5);
  if (tokens.length === 0) return false;
  return tokens.some((tk) => haystack.includes(tk));
}

export function candidateConfidence(score: number | null | undefined): CandidateConfidence {
  if (typeof score !== 'number') return 'unknown';
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

const RELEVANCE_RANK: Record<string, number> = { high: 0, medium: 1, unknown: 2, low: 3 };

export interface BuildCandidatesInput {
  diagnoses: PlantDiagnosis[];
  interpretation: PlantDiagnosisInterpretationData | null;
  /** Only pass verification computed in "diagnose" mode. */
  visualVerification: VisualVerification | null;
  /** Localized labels of photos that are still missing. */
  missingPhotoLabels: string[];
  /** Plain text taken from the stored problem research answer, if any. */
  problemResearchText: string;
  /** False when the user may not edit this case. */
  canEdit: boolean;
}

export function buildDiagnosisCandidateViews({
  diagnoses,
  interpretation,
  visualVerification,
  missingPhotoLabels,
  problemResearchText,
  canEdit,
}: BuildCandidatesInput): DiagnosisCandidateView[] {
  const triagePreferred = interpretation?.bestCandidates?.[0]?.name ?? null;
  const visualNames = (visualVerification?.visualProblemCandidates ?? []).map((c) => c.name);
  const visualSuggestions = visualVerification?.nextPhotoSuggestions ?? [];
  const needsMore = interpretation?.needsMoreEvidence ?? [];

  const views: DiagnosisCandidateView[] = diagnoses.map((d) => {
    const name = d.name || '—';
    const triageEntry =
      interpretation?.bestCandidates?.find((c) => namesMatch(c.name, name)) ?? null;
    const unlikelyEntry =
      interpretation?.unlikelyCandidates?.find((c) => namesMatch(c.name, name)) ?? null;
    const visualEntry =
      visualVerification?.visualProblemCandidates?.find((c) => namesMatch(c.name, name)) ?? null;

    const why = [
      triageEntry?.reason,
      d.plant_relevance_reason,
      visualEntry?.reason,
      unlikelyEntry?.reason,
      d.description && d.description !== name ? d.description : null,
    ]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .filter((s, i, a) => a.indexOf(s) === i)
      .slice(0, 2);

    const missing = [
      ...(triageEntry?.whatToCheckVisually ?? []),
      ...visualSuggestions,
      ...missingPhotoLabels,
      ...needsMore,
    ]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .filter((s, i, a) => a.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
      .slice(0, 2);

    return {
      id: d.id,
      name,
      description: d.description && d.description !== name ? d.description : null,
      problemType: d.problem_type || 'unknown',
      provider: d.provider,
      score: d.score ?? null,
      confidence: candidateConfidence(d.score),
      relevance: (d.plant_relevance ?? 'unknown') as CandidateRelevance,
      isConfirmed: !!d.is_confirmed,
      isTriagePreferred: !!triagePreferred && namesMatch(triagePreferred, name),
      isVisualMentioned: visualNames.some((v) => namesMatch(v, name)),
      isResearchMentioned: researchMentions(name, problemResearchText),
      whyBullets: why,
      missingEvidence: missing,
      canConfirm: canEdit && !d.is_confirmed,
    };
  });

  return views.sort((a, b) => {
    if (a.isConfirmed !== b.isConfirmed) return a.isConfirmed ? -1 : 1;
    if (a.isTriagePreferred !== b.isTriagePreferred) return a.isTriagePreferred ? -1 : 1;
    if (a.isVisualMentioned !== b.isVisualMentioned) return a.isVisualMentioned ? -1 : 1;
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sa !== sb) return sb - sa;
    const ra = RELEVANCE_RANK[a.relevance] ?? 2;
    const rb = RELEVANCE_RANK[b.relevance] ?? 2;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}
