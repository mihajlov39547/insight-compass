/**
 * Client-side view of the Visual Second Opinion verification layer.
 *
 * The provider function stores derived verification fields on
 * `plant_case_visual_opinions.structured_result`. Older rows were saved before
 * that layer existed, so this module reads stored fields when present and
 * otherwise derives a conservative fallback from the legacy fields.
 *
 * It never changes provider data: the Pl@ntNet score stays untouched and the
 * confirmed identification / diagnosis is never overwritten.
 */
import type { VisualOpinionRow, VisualOpinionMode } from '@/hooks/usePlantVisualOpinion';

export type VisualSupport = 'supports' | 'conflicts' | 'inconclusive' | 'not_plant';
export type ConfidenceAdjustment = 'increase' | 'unchanged' | 'decrease';
export type ConfidenceLabel = 'high' | 'medium' | 'low' | 'uncertain';
export type SupportLevel = 'strong' | 'moderate' | 'weak';

export interface VisualCandidateView {
  name: string;
  scientificName?: string | null;
  commonName?: string | null;
  reason?: string | null;
  supportLevel: SupportLevel;
  matchesConfirmedPlant: boolean;
}

export interface VisualProblemCandidateView {
  name: string;
  reason?: string | null;
  supportLevel: SupportLevel;
  matchesConfirmedDiagnosis: boolean;
}

export interface VisualVerification {
  visualSupport: VisualSupport;
  confidenceAdjustment: ConfidenceAdjustment;
  overallConfidenceLabel: ConfidenceLabel;
  primaryVisualCandidate: VisualCandidateView | null;
  visualCandidates: VisualCandidateView[];
  visualProblemCandidates: VisualProblemCandidateView[];
  invalidCandidatesRemoved: string[];
  verificationSummary: string | null;
  nextPhotoSuggestions: string[];
  displayBullets: string[];
  rawMarkdown: string | null;
}

const BUCKETS: ConfidenceLabel[] = ['uncertain', 'low', 'medium', 'high'];

/** Internal, documented rule: the derived label can move one bucket only. */
export function shiftConfidenceBucket(
  base: ConfidenceLabel,
  adjustment: ConfidenceAdjustment,
): ConfidenceLabel {
  const i = Math.max(0, BUCKETS.indexOf(base));
  if (adjustment === 'increase') return BUCKETS[Math.min(BUCKETS.length - 1, i + 1)];
  if (adjustment === 'decrease') return BUCKETS[Math.max(0, i - 1)];
  return BUCKETS[i];
}

const BAD_CANDIDATE_WORD = new Set([
  'produce', 'provide', 'provides', 'show', 'shows', 'appear', 'appears', 'are', 'is', 'was',
  'plants', 'plant', 'photos', 'photo', 'care', 'growing', 'leaves', 'pods', 'seeds', 'flowers',
]);

function isCleanBinomial(value: string | null | undefined): boolean {
  if (!value) return false;
  const m = value.trim().match(/^([A-Z][a-z]{3,})\s+([a-z-]{4,})$/);
  if (!m) return false;
  if (BAD_CANDIDATE_WORD.has(m[2])) return false;
  if (/(ing|ed|ly)$/.test(m[2])) return false;
  return true;
}

function genus(name: string | null | undefined): string | null {
  const g = name?.trim().split(/\s+/)[0];
  return g ? g.toLowerCase() : null;
}
function species(name: string | null | undefined): string | null {
  const parts = name?.trim().split(/\s+/) ?? [];
  return parts[1] ? parts[1].toLowerCase() : null;
}

/**
 * Reads the stored verification layer, falling back to a derivation from legacy
 * fields so pre-existing rows still render the new structured UI.
 */
export function getVisualVerification(
  row: VisualOpinionRow | null | undefined,
  opts: {
    mode: VisualOpinionMode;
    confirmedScientificName?: string | null;
    confirmedDiagnosisName?: string | null;
    identBucket?: ConfidenceLabel | null;
  },
): VisualVerification | null {
  if (!row) return null;
  const s = (row.structured_result ?? {}) as Record<string, any>;
  const notPlant = !!(s.saysNotPlant || s.safetyFlags?.notAPlantImage);
  const baseBucket: ConfidenceLabel = opts.identBucket ?? 'uncertain';

  const storedCandidates: VisualCandidateView[] = Array.isArray(s.visualCandidates)
    ? s.visualCandidates.filter((c: any) => c && typeof c.name === 'string')
    : [];

  let candidates = storedCandidates;
  if (candidates.length === 0 && !notPlant) {
    const names: string[] = Array.isArray(s.possiblePlantNames) ? s.possiblePlantNames : [];
    candidates = names
      .filter(isCleanBinomial)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 4)
      .map((name, i) => ({
        name,
        scientificName: name,
        commonName: null,
        reason: null,
        supportLevel: (i === 0 ? 'moderate' : 'weak') as SupportLevel,
        matchesConfirmedPlant:
          !!opts.confirmedScientificName &&
          genus(name) === genus(opts.confirmedScientificName) &&
          species(name) === species(opts.confirmedScientificName),
      }));
  }

  const matching = candidates.find((c) => c.matchesConfirmedPlant) ?? null;
  const primary =
    (s.primaryVisualCandidate as VisualCandidateView | null) ?? matching ?? candidates[0] ?? null;

  let visualSupport = s.visualSupport as VisualSupport | undefined;
  let adjustment = s.confidenceAdjustment as ConfidenceAdjustment | undefined;

  if (!visualSupport) {
    if (notPlant) visualSupport = 'not_plant';
    else if (opts.mode === 'identify') {
      if (!opts.confirmedScientificName || candidates.length === 0) visualSupport = 'inconclusive';
      else if (matching) visualSupport = 'supports';
      else if (genus(primary?.scientificName) === genus(opts.confirmedScientificName))
        visualSupport = 'inconclusive';
      else visualSupport = 'conflicts';
    } else {
      const diag = (opts.confirmedDiagnosisName ?? '').toLowerCase();
      const problems: string[] = Array.isArray(s.possibleProblemNames) ? s.possibleProblemNames : [];
      const tokens = diag.split(/[\s(),-]+/).filter((w) => w.length > 3);
      if (tokens.length > 0 && problems.some((p) => tokens.some((tk) => p.includes(tk) || tk.includes(p))))
        visualSupport = 'supports';
      else if (problems.length > 0 && tokens.length > 0) visualSupport = 'conflicts';
      else visualSupport = 'inconclusive';
    }
  }
  if (!adjustment) {
    adjustment =
      visualSupport === 'supports'
        ? 'increase'
        : visualSupport === 'conflicts' || visualSupport === 'not_plant'
          ? 'decrease'
          : 'unchanged';
  }

  const overall: ConfidenceLabel =
    (s.overallConfidenceLabel as ConfidenceLabel | undefined) ??
    (visualSupport === 'not_plant' ? 'uncertain' : shiftConfidenceBucket(baseBucket, adjustment));

  const problemCandidates: VisualProblemCandidateView[] = Array.isArray(s.visualProblemCandidates)
    ? s.visualProblemCandidates
    : (Array.isArray(s.possibleProblemNames) ? s.possibleProblemNames : []).slice(0, 4).map(
        (name: string, i: number) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          reason: null,
          supportLevel: (i === 0 ? 'moderate' : 'weak') as SupportLevel,
          matchesConfirmedDiagnosis:
            !!opts.confirmedDiagnosisName &&
            opts.confirmedDiagnosisName.toLowerCase().includes(name.toLowerCase()),
        }),
      );

  const nextPhotos: string[] = (
    Array.isArray(s.nextPhotoSuggestions) && s.nextPhotoSuggestions.length > 0
      ? s.nextPhotoSuggestions
      : Array.isArray(s.missingPhotoSuggestions)
        ? s.missingPhotoSuggestions
        : []
  ).slice(0, 3);

  const bullets: string[] = (
    Array.isArray(s.displayBullets) && s.displayBullets.length > 0
      ? s.displayBullets
      : Array.isArray(s.bullets)
        ? s.bullets
        : []
  ).slice(0, 3);

  return {
    visualSupport,
    confidenceAdjustment: adjustment,
    overallConfidenceLabel: overall,
    primaryVisualCandidate: primary,
    visualCandidates: candidates,
    visualProblemCandidates: problemCandidates,
    invalidCandidatesRemoved: Array.isArray(s.invalidCandidatesRemoved)
      ? s.invalidCandidatesRemoved
      : [],
    verificationSummary:
      (typeof s.verificationSummary === 'string' && s.verificationSummary) ||
      row.opinion_summary ||
      null,
    nextPhotoSuggestions: nextPhotos,
    displayBullets: bullets,
    rawMarkdown: typeof s.markdown === 'string' ? s.markdown : null,
  };
}
