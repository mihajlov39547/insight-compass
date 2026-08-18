import { Bug, Coins, Leaf, Sprout, type LucideIcon } from 'lucide-react';

export type PlantCaseGoal = 'identify' | 'diagnose' | 'improve_growth' | 'increase_income';

/** Fixed goal colors so users recognise a Plant Case type before reading the label. */
export const PLANT_CASE_GOAL_THEME = {
  identify: {
    primary: '#2563EB',
    soft: '#DBEAFE',
    text: '#1D4ED8',
    border: '#93C5FD',
    iconBgClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    badgeClass:
      'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    accentClass: 'border-l-blue-500',
    heroBgClass: 'from-blue-500/10 via-card to-card',
    icon: Leaf as LucideIcon,
  },
  diagnose: {
    primary: '#F59E0B',
    soft: '#FEF3C7',
    text: '#B45309',
    border: '#FCD34D',
    iconBgClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    badgeClass:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    accentClass: 'border-l-amber-500',
    heroBgClass: 'from-amber-500/10 via-card to-card',
    icon: Bug as LucideIcon,
  },
  improve_growth: {
    primary: '#16A34A',
    soft: '#DCFCE7',
    text: '#15803D',
    border: '#86EFAC',
    iconBgClass: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
    badgeClass:
      'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800',
    accentClass: 'border-l-green-500',
    heroBgClass: 'from-green-500/10 via-card to-card',
    icon: Sprout as LucideIcon,
  },
  increase_income: {
    primary: '#7C3AED',
    soft: '#EDE9FE',
    text: '#6D28D9',
    border: '#C4B5FD',
    iconBgClass: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    badgeClass:
      'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800',
    accentClass: 'border-l-violet-500',
    heroBgClass: 'from-violet-500/10 via-card to-card',
    icon: Coins as LucideIcon,
  },
} as const;

export function getPlantCaseGoalTheme(goal?: string | null) {
  return (
    PLANT_CASE_GOAL_THEME[(goal as PlantCaseGoal) || 'identify'] ?? PLANT_CASE_GOAL_THEME.identify
  );
}
