import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Columns2, MessageSquare, Sparkles, ScanEye, Telescope } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { DiagnosisCandidateView } from '@/lib/plantDiagnosisCandidates';
import type { VisualSupport } from '@/lib/plantVisualVerification';

interface Props {
  candidates: DiagnosisCandidateView[];
  /** Visual second opinion support for the confirmed diagnosis, if a run exists. */
  visualSupport: VisualSupport | null;
  confirming: boolean;
  onConfirm: (diagnosisId: string) => void;
  onAskChat: (candidateName: string) => void;
  /** Increment to expand + briefly highlight this area. */
  focusToken?: number;
}

function pct(score: number | null): string {
  return score == null ? '—' : `${Math.round(score * 100)}%`;
}

export function PlantDiagnosisCandidatesReview({
  candidates,
  visualSupport,
  confirming,
  onConfirm,
  onAskChat,
  focusToken = 0,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(false);
  const [compareId, setCompareId] = React.useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = React.useState<DiagnosisCandidateView | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!focusToken) return;
    setOpen(true);
    setHighlight(true);
    const raf = window.requestAnimationFrame(() =>
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    const timer = window.setTimeout(() => setHighlight(false), 2200);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [focusToken]);

  if (candidates.length === 0) return null;

  const confirmed = candidates.find((c) => c.isConfirmed) ?? null;
  const confidenceLabel = (v: DiagnosisCandidateView['confidence']) =>
    t(`plantAdvisor.diagnose.confidenceBucket.${v}`);
  const relevanceLabel = (v: DiagnosisCandidateView['relevance']) =>
    t(`plantAdvisor.dashboard.relevance.${v}`);
  const visualLabel = visualSupport
    ? t(`plantAdvisor.diagnose.candidatesReview.visual.${visualSupport}`)
    : t('plantAdvisor.diagnose.candidatesReview.visual.none');

  return (
    <div
      ref={rootRef}
      className={cn(
        'rounded-lg border border-border/60 p-3 transition-colors',
        highlight ? 'border-primary bg-primary/5' : 'bg-background/40',
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2 flex-wrap">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2 text-xs">
              <ChevronDown
                className={cn('h-3.5 w-3.5 mr-1.5 transition-transform', open && 'rotate-180')}
              />
              {t('plantAdvisor.diagnose.candidatesReview.title')}
            </Button>
          </CollapsibleTrigger>
          <span className="text-[10px] text-muted-foreground">
            {t('plantAdvisor.dashboard.diag.candidatesAvailable', { count: candidates.length })}
          </span>
        </div>

        <CollapsibleContent className="pt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {t('plantAdvisor.diagnose.candidatesReview.helper')}
          </p>

          {candidates.map((c) => (
            <div
              key={c.id}
              className={cn(
                'rounded-md border px-3 py-2.5 space-y-2',
                c.isConfirmed ? 'border-primary/40 bg-primary/5' : 'border-border/60',
              )}
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  {c.description && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {c.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant={c.isConfirmed ? 'default' : 'outline'} className="text-[10px]">
                    {c.isConfirmed ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        {t('plantAdvisor.diagnose.candidatesReview.confirmedProblem')}
                      </>
                    ) : (
                      t('plantAdvisor.diagnose.candidatesReview.candidate')
                    )}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {t('plantAdvisor.diagnose.candidatesReview.confidence')}:{' '}
                    {confidenceLabel(c.confidence)} · {pct(c.score)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {t('plantAdvisor.diagnose.candidatesReview.relevance')}:{' '}
                    {relevanceLabel(c.relevance)}
                  </Badge>
                </div>
              </div>

              {(c.isTriagePreferred || c.isVisualMentioned || c.isResearchMentioned) && (
                <div className="flex flex-wrap gap-1.5">
                  {c.isTriagePreferred && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      <Sparkles className="h-3 w-3" />
                      {t('plantAdvisor.diagnose.candidatesReview.triagePreferred')}
                    </span>
                  )}
                  {c.isVisualMentioned && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      <ScanEye className="h-3 w-3" />
                      {t('plantAdvisor.diagnose.candidatesReview.visualMentioned')}
                    </span>
                  )}
                  {c.isResearchMentioned && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      <Telescope className="h-3 w-3" />
                      {t('plantAdvisor.diagnose.candidatesReview.researchMentioned')}
                    </span>
                  )}
                </div>
              )}

              {c.whyBullets.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('plantAdvisor.diagnose.candidatesReview.whyFit')}
                  </div>
                  <ul className="list-disc pl-4 text-[11px] text-foreground/90">
                    {c.whyBullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {c.missingEvidence.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('plantAdvisor.diagnose.candidatesReview.missingEvidence')}
                  </div>
                  <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
                    {c.missingEvidence.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {!c.isConfirmed && confirmed && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setCompareId(compareId === c.id ? null : c.id)}
                  >
                    <Columns2 className="h-3.5 w-3.5 mr-1.5" />
                    {t('plantAdvisor.diagnose.candidatesReview.compare')}
                  </Button>
                )}
                {c.canConfirm ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={confirming}
                    onClick={() => setPendingConfirm(c)}
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    {t('plantAdvisor.diagnose.candidatesReview.confirmCandidate')}
                  </Button>
                ) : (
                  c.isConfirmed && (
                    <span className="text-[10px] text-muted-foreground">
                      {t('plantAdvisor.diagnose.candidatesReview.alreadyConfirmed')}
                    </span>
                  )
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onAskChat(c.name)}
                >
                  <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                  {t('plantAdvisor.diagnose.candidatesReview.askChat')}
                </Button>
              </div>

              {compareId === c.id && confirmed && (
                <div className="grid gap-2 sm:grid-cols-2 rounded-md border border-border/60 bg-muted/20 p-2">
                  {[confirmed, c].map((side, idx) => (
                    <div key={side.id} className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {idx === 0
                          ? t('plantAdvisor.diagnose.candidatesReview.confirmedProblem')
                          : t('plantAdvisor.diagnose.candidatesReview.candidate')}
                      </div>
                      <div className="text-xs font-medium">{side.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {t('plantAdvisor.diagnose.candidatesReview.confidence')}:{' '}
                        {confidenceLabel(side.confidence)} · {pct(side.score)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t('plantAdvisor.diagnose.candidatesReview.relevance')}:{' '}
                        {relevanceLabel(side.relevance)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t('plantAdvisor.diagnose.candidatesReview.visualCheck')}:{' '}
                        {idx === 0
                          ? visualLabel
                          : side.isVisualMentioned
                            ? t('plantAdvisor.diagnose.candidatesReview.visualMentioned')
                            : t('plantAdvisor.diagnose.candidatesReview.visual.none')}
                      </div>
                      {side.isResearchMentioned && (
                        <div className="text-[11px] text-muted-foreground">
                          {t('plantAdvisor.diagnose.candidatesReview.researchMentioned')}
                        </div>
                      )}
                      {side.whyBullets.length > 0 && (
                        <ul className="list-disc pl-4 text-[11px] text-foreground/90">
                          {side.whyBullets.slice(0, 2).map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      )}
                      {side.missingEvidence.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          {t('plantAdvisor.diagnose.candidatesReview.missingEvidence')}:{' '}
                          {side.missingEvidence.join('; ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <p className="text-[10px] text-muted-foreground">
            {t('plantAdvisor.diagnose.notTreatmentAdvice')}
          </p>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog
        open={!!pendingConfirm}
        onOpenChange={(o) => {
          if (!o) setPendingConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('plantAdvisor.diagnose.candidatesReview.confirmDialogTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('plantAdvisor.diagnose.candidatesReview.confirmDialogBody', {
                name: pendingConfirm?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConfirm) onConfirm(pendingConfirm.id);
                setPendingConfirm(null);
              }}
            >
              {t('plantAdvisor.diagnose.candidatesReview.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
