import { Bug, Coins, Sparkles, Sprout, type LucideIcon } from 'lucide-react';

export type PlantCaseGoal = 'identify' | 'diagnose' | 'improve_growth' | 'increase_income';

/** Fixed goal colors so users recognise a Plant Case type before reading the label. */
export const PLANT_CASE_GOAL_THEME = {
  identify: {
    primary: '#2563EB',
    soft: '#DBEAFE',
    text: '#1D4ED8',
    border: '#93C5FD',
    iconBgClass: 'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-800',
    badgeClass:
      'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
    accentClass: 'border-l-blue-500',
    hoverClass: 'hover:border-blue-300 dark:hover:border-blue-800',
    tintClass: 'bg-blue-50/60 dark:bg-blue-950/20',
    heroBgClass: 'from-blue-500/15 via-card to-card',
    icon: Sparkles as LucideIcon,
  },
  diagnose: {
    primary: '#F59E0B',
    soft: '#FEF3C7',
    text: '#B45309',
    border: '#FCD34D',
    iconBgClass:
      'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800',
    badgeClass:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    accentClass: 'border-l-amber-500',
    hoverClass: 'hover:border-amber-300 dark:hover:border-amber-800',
    tintClass: 'bg-amber-50/60 dark:bg-amber-950/20',
    heroBgClass: 'from-amber-500/15 via-card to-card',
    icon: Bug as LucideIcon,
  },
  improve_growth: {
    primary: '#16A34A',
    soft: '#DCFCE7',
    text: '#15803D',
    border: '#86EFAC',
    iconBgClass:
      'bg-green-100 text-green-700 ring-green-200 dark:bg-green-950/50 dark:text-green-300 dark:ring-green-800',
    badgeClass:
      'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800',
    accentClass: 'border-l-green-500',
    hoverClass: 'hover:border-green-300 dark:hover:border-green-800',
    tintClass: 'bg-green-50/60 dark:bg-green-950/20',
    heroBgClass: 'from-green-500/15 via-card to-card',
    icon: Sprout as LucideIcon,
  },
  increase_income: {
    primary: '#7C3AED',
    soft: '#EDE9FE',
    text: '#6D28D9',
    border: '#C4B5FD',
    iconBgClass:
      'bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-800',
    badgeClass:
      'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800',
    accentClass: 'border-l-violet-500',
    hoverClass: 'hover:border-violet-300 dark:hover:border-violet-800',
    tintClass: 'bg-violet-50/60 dark:bg-violet-950/20',
    heroBgClass: 'from-violet-500/15 via-card to-card',
    icon: Coins as LucideIcon,
  },
} as const;

/** Tolerates legacy/alternate goal spellings so cards never silently fall back to blue. */
export function normalizePlantCaseGoal(goal?: string | null): PlantCaseGoal {
  switch ((goal || '').trim().toLowerCase()) {
    case 'identify':
    case 'identify_plant':
    case 'identification':
      return 'identify';
    case 'diagnose':
    case 'diagnose_problem':
    case 'disease':
    case 'diagnosis':
      return 'diagnose';
    case 'improve_growth':
    case 'growth':
    case 'improve-growth':
      return 'improve_growth';
    case 'increase_income':
    case 'income':
    case 'increase-income':
      return 'increase_income';
    default:
      return 'identify';
  }
}

export function getPlantCaseGoalTheme(goal?: string | null) {
  return PLANT_CASE_GOAL_THEME[normalizePlantCaseGoal(goal)];
}
