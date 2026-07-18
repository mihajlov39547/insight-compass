import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sprout,
  ScanSearch,
  Leaf,
  Stethoscope,
  TrendingUp,
  Wallet,
  FolderOpen,
  Cloud,
  HardDrive,
  AlertCircle,
  MoreHorizontal,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePlantCases, useDeletePlantCase, type PlantCase } from '@/hooks/usePlantCases';
import { usePlantAdvisorUsage } from '@/hooks/usePlantAdvisorLimits';
import { PlantCaseCard } from './PlantCaseCard';
import { PlantAdvisorSettingsDialog } from './PlantAdvisorSettingsDialog';
import { PlantAiScanHistory } from './PlantAiScanHistory';
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
  const usage = usePlantAdvisorUsage();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const goalCards = (Object.keys(GOAL_ICONS) as Array<keyof typeof GOAL_ICONS>).map((g) => ({
    key: g,
    Icon: GOAL_ICONS[g],
  }));

  const atCaseLimit = usage.caseCount >= usage.limits.maxPlantCases;
  const casesPct = Math.min(100, (usage.caseCount / Math.max(1, usage.limits.maxPlantCases)) * 100);
  const imagesPct = Math.min(100, (usage.totalImages / Math.max(1, usage.limits.maxTotalImages)) * 100);

  const driveStatus =
    usage.driveConfigured === true
      ? { icon: Cloud, label: t('plantAdvisor.storage.googleDrive'), tone: 'text-emerald-600' }
      : usage.driveConfigured === false
      ? { icon: AlertCircle, label: t('plantAdvisor.storage.notConfigured'), tone: 'text-amber-600' }
      : { icon: HardDrive, label: t('plantAdvisor.storage.checking', 'Checking…'), tone: 'text-muted-foreground' };

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
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-end gap-1">
              <Button onClick={onNewScan} disabled={atCaseLimit}>
                <ScanSearch className="h-4 w-4 mr-1.5" />
                {t('plantAdvisor.newScan')}
              </Button>
              {atCaseLimit && (
                <span className="text-[11px] text-amber-600">{t('plantAdvisor.limits.caseReached')}</span>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('plantAdvisor.settings.menuAria')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  {t('plantAdvisor.settings.menuItem')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <PlantAdvisorSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

        {/* Usage card */}
        <div className="rounded-lg border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              {t('plantAdvisor.usage.cases')}
            </div>
            <div className="text-sm font-medium mt-1">
              {usage.caseCount} / {usage.limits.maxPlantCases}
            </div>
            <Progress value={casesPct} className="h-1.5 mt-2" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              {t('plantAdvisor.usage.images')}
            </div>
            <div className="text-sm font-medium mt-1">
              {usage.totalImages} / {usage.limits.maxTotalImages}
            </div>
            <Progress value={imagesPct} className="h-1.5 mt-2" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              {t('plantAdvisor.usage.storageProvider')}
            </div>
            <div className={`text-sm font-medium mt-1 inline-flex items-center gap-1.5 ${driveStatus.tone}`}>
              <driveStatus.icon className="h-3.5 w-3.5" />
              {driveStatus.label}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {t('plantAdvisor.usage.planLabel', { plan: usage.plan })}
            </div>
          </div>
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
              <Button className="mt-4" onClick={onNewScan} disabled={atCaseLimit}>
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
