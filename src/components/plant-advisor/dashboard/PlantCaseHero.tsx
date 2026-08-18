import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getPlantCaseGoalTheme } from '@/lib/plantCaseGoalTheme';
import type { PlantCase } from '@/hooks/usePlantCases';
import type { PlantCaseDashboardData } from '@/hooks/usePlantCaseDashboard';

interface Props {
  plantCase: PlantCase;
  data: PlantCaseDashboardData;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenChat: () => void;
}

function Chip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning' | 'good';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        tone === 'warning'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          : tone === 'good'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-border bg-muted/50 text-foreground/80',
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate max-w-[14rem]">{value}</span>
    </span>
  );
}

export function PlantCaseHero({ plantCase, data, onBack, onEdit, onDelete, onOpenChat }: Props) {
  const { t } = useTranslation();
  const [showAllNotes, setShowAllNotes] = useState(false);

  const goalLabel = plantCase.user_goal ? t(`plantAdvisor.goals.${plantCase.user_goal}`) : null;
  const theme = getPlantCaseGoalTheme(plantCase.user_goal);
  const GoalIcon = theme.icon;
  const subtitleParts = [plantCase.location_text, plantCase.crop_context].filter(Boolean);
  const notes = plantCase.notes?.trim() || '';
  const notesLong = notes.length > 130;
  const notesPreview = notesLong && !showAllNotes ? `${notes.slice(0, 130).trimEnd()}…` : notes;

  const identName =
    data.confirmedIdent?.common_name ||
    data.confirmedIdent?.scientific_name_without_author ||
    data.confirmedIdent?.scientific_name ||
    null;
  const pct = (s: number | null | undefined) => (s == null ? '—' : `${Math.round(s * 100)}%`);

  return (
    <header
      className={cn(
        'rounded-2xl border border-border/60 border-l-4 bg-gradient-to-br p-5 space-y-4 shadow-sm',
        theme.accentClass,
        theme.heroBgClass,
      )}
    >
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('common.back', 'Back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0', theme.iconBgClass)}>
          <GoalIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold truncate">{plantCase.title}</h1>
          {subtitleParts.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {subtitleParts.join(' · ')}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {goalLabel && (
              <Badge variant="outline" className={cn('text-xs', theme.badgeClass)}>
                {goalLabel}
              </Badge>
            )}
            <Badge variant="secondary">{t(`plantAdvisor.statuses.${plantCase.status}`)}</Badge>
            <span className="text-xs text-muted-foreground">
              {format(new Date(plantCase.created_at), 'PP')}
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 flex-shrink-0">
          <Button onClick={onOpenChat} size="sm">
            <MessageSquare className="h-4 w-4 mr-1.5" />
            {t('plantAdvisor.askAbout')}
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {t('common.edit', 'Edit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip
          label={t('plantAdvisor.dashboard.chips.plant')}
          value={identName || t('plantAdvisor.dashboard.notConfirmed')}
          tone={identName ? (data.lowIdentConfidence ? 'warning' : 'good') : 'neutral'}
        />
        {identName && (
          <Chip
            label={t('plantAdvisor.dashboard.chips.plantConfidence')}
            value={`${data.identBucket ? t(`plantAdvisor.identify.confidence.${data.identBucket}`) : '—'} · ${pct(data.identScore)}`}
            tone={data.lowIdentConfidence ? 'warning' : 'good'}
          />
        )}
        {data.goal === 'diagnose' && (
          <>
            <Chip
              label={t('plantAdvisor.dashboard.chips.problem')}
              value={data.confirmedDiag?.name || t('plantAdvisor.dashboard.notConfirmed')}
              tone={data.confirmedDiag ? (data.lowDiagConfidence ? 'warning' : 'good') : 'neutral'}
            />
            {data.confirmedDiag && (
              <>
                <Chip
                  label={t('plantAdvisor.dashboard.chips.diagnosisConfidence')}
                  value={`${data.diagBucket ? t(`plantAdvisor.identify.confidence.${data.diagBucket}`) : '—'} · ${pct(data.confirmedDiag.score)}`}
                  tone={data.lowDiagConfidence ? 'warning' : 'good'}
                />
                <Chip
                  label={t('plantAdvisor.dashboard.chips.relevance')}
                  value={t(`plantAdvisor.dashboard.relevance.${data.relevance}`)}
                  tone={data.unknownRelevance ? 'warning' : 'good'}
                />
              </>
            )}
          </>
        )}
        <Chip
          label={t('plantAdvisor.dashboard.chips.research')}
          value={
            data.primaryResearch
              ? t('plantAdvisor.dashboard.researchReady')
              : t('plantAdvisor.dashboard.researchNotRun')
          }
          tone={data.primaryResearch ? 'good' : 'neutral'}
        />
      </div>

      {notes && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {notesPreview}
          {notesLong && (
            <button
              type="button"
              className="ml-1.5 text-xs text-primary hover:underline"
              onClick={() => setShowAllNotes((v) => !v)}
            >
              {showAllNotes
                ? t('plantAdvisor.dashboard.showLess')
                : t('plantAdvisor.dashboard.showMore')}
            </button>
          )}
        </p>
      )}
    </header>
  );
}
