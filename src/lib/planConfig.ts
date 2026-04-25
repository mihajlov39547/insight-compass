import { Sparkles, Zap, Crown, Building2 } from 'lucide-react';
import type { Plan } from '@/types/app';

export const planIcons: Record<Plan, typeof Sparkles> = {
  free: Sparkles,
  basic: Zap,
  premium: Crown,
  enterprise: Building2,
};

export const planLabels: Record<Plan, string> = {
  free: 'Free',
  basic: 'Basic',
  premium: 'Premium',
  enterprise: 'Enterprise',
};
