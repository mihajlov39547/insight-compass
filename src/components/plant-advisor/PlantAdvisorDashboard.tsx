import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sprout, ScanSearch, Leaf, Stethoscope, TrendingUp, Wallet, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlantCases, useDeletePlantCase, type PlantCase } from '@/hooks/usePlantCases';
import { PlantCaseCard } from './PlantCaseCard';
import { toast } from 'sonner';

interface Props {
  onNewScan: () => void;
  onOpenCase: (c: PlantCase) => void;
}

const GOAL_ICONS = {
  identify: Leaf,
  diagnose: Stethoscope,
  improve_growth: TrendingUp,
  increase_income: Wallet,
} as const;

export function PlantAdvisorDashboard({ onNewScan, onOpenCase }: Props) {
  const { t } = useTranslation();
  const { data: cases = [], isLoading } = usePlantCases();
  const del = useDeletePlantCase();

  const goalCards = (Object.keys(GOAL_ICONS) as Array<keyof typeof GOAL_ICONS>).map((g) => ({
    key: g,
    Icon: GOAL_ICONS[g],
  }));

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sprout className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t('plantAdvisor.title')}</h1>
              <p className="text-muted-foreground text-sm mt-1 max-w-xl">{t('plantAdvisor.subtitle')}</p>
            </div>
          </div>
          <Button onClick={onNewScan}>
            <ScanSearch className="h-4 w-4 mr-1.5" />
            {t('plantAdvisor.newScan')}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {goalCards.map(({ key, Icon }) => (
            <div key={key} className="rounded-lg border border-border bg-card p-4">
              <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-2">
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-sm font-medium">{t(`plantAdvisor.goals.${key}`)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t(`plantAdvisor.goalDescriptions.${key}`)}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('plantAdvisor.recentCases')}</h2>
          </div>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading…')}</div>
          ) : cases.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <Sprout className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <div className="text-sm font-medium">{t('plantAdvisor.empty')}</div>
              <div className="text-xs text-muted-foreground mt-1">{t('plantAdvisor.emptyHint')}</div>
              <Button className="mt-4" onClick={onNewScan}>
                <ScanSearch className="h-4 w-4 mr-1.5" />
                {t('plantAdvisor.newScan')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cases.map((c) => (
                <PlantCaseCard
                  key={c.id}
                  plantCase={c}
                  onOpen={() => onOpenCase(c)}
                  onDelete={async () => {
                    if (!confirm(t('plantAdvisor.confirmDelete'))) return;
                    try {
                      await del.mutateAsync(c.id);
                      toast.success(t('plantAdvisor.deletedToast'));
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
