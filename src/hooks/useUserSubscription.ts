import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface UserSubscription {
  id: string;
  user_id: string;
  plan_key: string;
  paypal_subscription_id: string | null;
  paypal_plan_id: string | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export function useUserSubscription() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['user-subscription', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as UserSubscription | null;
    },
    enabled: !!user,
  });
}

/** Returns the effective plan key: free, basic_monthly, premium_monthly, enterprise */
export function useEffectivePlanKey(): string {
  const { data: sub } = useUserSubscription();
  if (!sub) return 'free';
  if (sub.status === 'active' || sub.status === 'pending') return sub.plan_key;
  return 'free';
}
