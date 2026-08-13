import { useMemo } from 'react';
import { usePlantIdentifications, confidenceBucket } from '@/hooks/usePlantIdentifications';
import { usePlantDiagnoses, usePlantDiagnosisInterpretations } from '@/hooks/usePlantDiagnoses';
import { usePlantSpeciesProfile } from '@/hooks/usePlantSpeciesProfile';
import { usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import { usePlantCaseChatMessages } from '@/hooks/usePlantCaseChatMessages';
import { usePlantCaseGrounding } from '@/hooks/usePlantCaseGrounding';
import type { PlantCase } from '@/hooks/usePlantCases';

export type ResearchKind = 'research' | 'income_research' | 'problem_research';

export interface ResearchArtifactSummary {
  kind: ResearchKind;
  messageId: string;
  updatedAt: string;
  sourceCount: number;
  previewBullets: string[];
}

/** Pull up to 3 short preview bullets out of a long markdown research answer. */
export function deriveResearchPreview(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/).map((l) => l.trim());
  const bullets = lines
    .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''))
    .map((l) => l.replace(/[*_`#>[\]]/g, '').trim())
    .filter((l) => l.length > 20);
  if (bullets.length > 0) return bullets.slice(0, 3).map(truncate);
  const paras = lines.filter((l) => l.length > 40 && !l.startsWith('#'));
  return paras.slice(0, 2).map((p) => truncate(p.replace(/[*_`#>[\]]/g, '')));
}

function truncate(s: string, max = 180): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function bucketOf(score: number | null | undefined): 'high' | 'medium' | 'low' {
  const v = score ?? 0;
  if (v >= 0.7) return 'high';
  if (v >= 0.4) return 'medium';
  return 'low';
}

/**
 * Read-only aggregation of every Plant Case dashboard artifact, used by the
 * hero, key facts grid, progress timeline and chat CTA. It never mutates data.
 */
export function usePlantCaseDashboard(plantCase: PlantCase) {
  const caseId = plantCase.id;
  const { data: images = [] } = usePlantCaseImages(caseId);
  const { data: identifications = [] } = usePlantIdentifications(caseId);
  const { data: diagnoses = [] } = usePlantDiagnoses(caseId);
  const { data: interpretationRow } = usePlantDiagnosisInterpretations(caseId);
  const { data: profile } = usePlantSpeciesProfile(caseId);
  const { data: messages = [] } = usePlantCaseChatMessages(caseId);
  const grounding = usePlantCaseGrounding(caseId);

  const confirmedIdent = identifications.find((i) => i.is_confirmed) || null;
  const topIdent = confirmedIdent || identifications[0] || null;
  const identBucket = confidenceBucket(topIdent?.score ?? null);
  const confirmedDiag = diagnoses.find((d) => d.is_confirmed) || null;
  const topDiag = confirmedDiag || diagnoses[0] || null;
  const diagBucket = topDiag ? bucketOf(topDiag.score) : null;
  const relevance = topDiag?.plant_relevance ?? 'unknown';
  const interpretation = interpretationRow?.interpretation ?? null;

  const research = useMemo(() => {
    const byKind: Partial<Record<ResearchKind, ResearchArtifactSummary>> = {};
    for (const m of messages) {
      if (m.role !== 'assistant' || m.metadata?.superseded) continue;
      const meta = m.metadata as Record<string, unknown> | undefined;
      const kind = (m.metadata?.kind ?? meta?.researchType) as ResearchKind | undefined;
      if (kind !== 'research' && kind !== 'income_research' && kind !== 'problem_research') continue;
      byKind[kind] = {
        kind,
        messageId: m.id,
        updatedAt: m.updated_at || m.created_at,
        sourceCount: Array.isArray(m.metadata?.sourcesUsed) ? m.metadata!.sourcesUsed!.length : 0,
        previewBullets: deriveResearchPreview(m.content),
      };
    }
    return byKind;
  }, [messages]);

  const goal = plantCase.user_goal ?? 'identify';
  const primaryResearch: ResearchArtifactSummary | null =
    goal === 'diagnose'
      ? research.problem_research ?? null
      : goal === 'increase_income'
        ? research.income_research ?? null
        : research.research ?? null;

  const whatToCheckNext: string[] = useMemo(() => {
    const fromCandidates = (interpretation?.bestCandidates ?? [])
      .flatMap((c) => c.whatToCheckVisually ?? [])
      .filter(Boolean);
    const list = fromCandidates.length > 0 ? fromCandidates : interpretation?.needsMoreEvidence ?? [];
    return list.slice(0, 4);
  }, [interpretation]);

  return {
    caseId,
    goal,
    images,
    identifications,
    confirmedIdent,
    topIdent,
    identBucket,
    identScore: topIdent?.score ?? null,
    alternativesCount: Math.max(0, identifications.length - 1),
    diagnoses,
    confirmedDiag,
    topDiag,
    diagBucket,
    relevance,
    interpretation,
    profile: profile ?? null,
    grounding: grounding.data ?? null,
    research,
    primaryResearch,
    whatToCheckNext,
    hasImages: images.length > 0,
    hasConfirmedIdent: !!confirmedIdent,
    hasConfirmedDiag: !!confirmedDiag,
    lowIdentConfidence: identBucket === 'low',
    lowDiagConfidence: diagBucket === 'low',
    unknownRelevance: !!topDiag && relevance === 'unknown',
  };
}

export type PlantCaseDashboardData = ReturnType<typeof usePlantCaseDashboard>;
