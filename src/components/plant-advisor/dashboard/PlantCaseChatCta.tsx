import React from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlantCaseDashboardData } from '@/hooks/usePlantCaseDashboard';

interface Props {
  data: PlantCaseDashboardData;
  onOpenChat: () => void;
}

/** Prominent bottom CTA that explains exactly which context the chat will use. */
export function PlantCaseChatCta({ data, onOpenChat }: Props) {
  const { t } = useTranslation();

  const ctx: string[] = [];
  if (data.hasConfirmedIdent) ctx.push(t('plantAdvisor.dashboard.cta.ctxPlant'));
  if (data.hasConfirmedDiag) ctx.push(t('plantAdvisor.dashboard.cta.ctxDiagnosis'));
  if (data.profile) ctx.push(t('plantAdvisor.dashboard.cta.ctxProfile'));
  if (data.interpretation) ctx.push(t('plantAdvisor.dashboard.cta.ctxInterpretation'));
  if (data.grounding) ctx.push(t('plantAdvisor.dashboard.cta.ctxGrowth'));
  if (data.primaryResearch) ctx.push(t('plantAdvisor.dashboard.cta.ctxResearch'));

  const ready = !!data.primaryResearch;

  return (
    <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 via-card to-card p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-semibold">
          {ready ? t('plantAdvisor.dashboard.cta.ready') : t('plantAdvisor.dashboard.cta.partial')}
        </div>
        <p className="text-xs text-muted-foreground">
          {ctx.length > 0
            ? t('plantAdvisor.dashboard.cta.willUse', { list: ctx.join(', ') })
            : t('plantAdvisor.dashboard.cta.noContext')}
        </p>
      </div>
      <Button onClick={onOpenChat} className="flex-shrink-0">
        <MessageSquare className="h-4 w-4 mr-1.5" />
        {ready ? t('plantAdvisor.askAbout') : t('plantAdvisor.dashboard.cta.askAnyway')}
      </Button>
    </div>
  );
}
