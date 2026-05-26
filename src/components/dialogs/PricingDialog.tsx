import React, { useState, useCallback, useEffect } from 'react';
import { Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Plan } from '@/types/app';
import { planIcons } from '@/lib/planConfig';
import { useTranslation } from 'react-i18next';
import { ContactSalesDialog } from './ContactSalesDialog';
import { useAuth } from '@/contexts/useAuth';
import { normalizePlan } from '@/types/app';
import { PayPalSubscriptionButton } from '@/components/payments/PayPalSubscriptionButton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useUserSubscription } from '@/hooks/useUserSubscription';
import { fetchEdgeFunction } from '@/lib/edge/invokeWithAuth';

interface PricingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: Plan;
  onSelectPlan: (plan: Plan) => void;
}

interface PlanCard {
  id: Plan;
  planKey: string;
  price: string;
  periodLabel: string;
  subtitle: string;
  icon: any;
  features: string[];
  paypalPlanId: string | null;
  popular: boolean;
  ctaType: 'current' | 'paypal' | 'contact' | 'downgrade' | 'signup';
}

// Plan IDs are fetched from the backend at runtime (env-aware).
let _cachedPlans: Record<string, { planId: string; planKey: string }> | null = null;

async function fetchPayPalPlans(): Promise<Record<string, { planId: string; planKey: string }>> {
  if (_cachedPlans) return _cachedPlans;
  const { data, error } = await supabase.functions.invoke('paypal-config');
  if (error || !data?.plans) {
    console.warn('Failed to fetch PayPal plans, using empty map');
    return {};
  }
  _cachedPlans = data.plans;
  return data.plans;
}

const PLAN_ORDER: Plan[] = ['free', 'basic', 'premium', 'enterprise'];

const PLAN_FEATURE_COUNTS: Record<Plan, number> = {
  free: 7,
  basic: 8,
  premium: 8,
  enterprise: 6,
};

function getPlanFeatures(planId: Plan, t: (k: string) => string): string[] {
  const count = PLAN_FEATURE_COUNTS[planId];
  return Array.from({ length: count }, (_, i) => t(`pricingDialog.plans.${planId}.features.${i}`));
}

function getPlanPrice(planId: Plan, t: (k: string) => string): { price: string; period: string } {
  switch (planId) {
    case 'free': return { price: '$0', period: t('pricingDialog.periods.forever') };
    case 'basic': return { price: '$9', period: t('pricingDialog.periods.perMonth') };
    case 'premium': return { price: '$19', period: t('pricingDialog.periods.perMonth') };
    case 'enterprise': return { price: 'Custom', period: t('pricingDialog.periods.contactUs') };
  }
}

function getCtaType(cardPlan: Plan, currentPlan: Plan, isLoggedIn: boolean, paypalPlans: Record<string, { planId: string; planKey: string }>, hasActivePaidSub: boolean): PlanCard['ctaType'] {
  if (!isLoggedIn) {
    if (cardPlan === 'enterprise') return 'contact';
    return 'signup';
  }
  if (cardPlan === currentPlan) return 'current';
  if (cardPlan === 'enterprise') return 'contact';
  const currentIdx = PLAN_ORDER.indexOf(currentPlan);
  const cardIdx = PLAN_ORDER.indexOf(cardPlan);
  if (cardIdx < currentIdx) return 'downgrade';
  // Block new subscriptions if user already has an active paid one
  if (hasActivePaidSub && paypalPlans[cardPlan]) return 'downgrade';
  if (paypalPlans[cardPlan]) return 'paypal';
  return 'current'; // free → free
}

export function PricingDialog({ open, onOpenChange, currentPlan: currentPlanProp, onSelectPlan }: PricingDialogProps) {
  const { t } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [contactSalesOpen, setContactSalesOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [paypalPlans, setPaypalPlans] = useState<Record<string, { planId: string; planKey: string }>>({});
  const { data: subscription } = useUserSubscription();

  useEffect(() => {
    if (open) {
      fetchPayPalPlans().then(setPaypalPlans);
    }
  }, [open]);

  const isLoggedIn = !!user;
  const currentPlan = normalizePlan(profile?.plan);

  const handlePayPalApprove = useCallback(async (subscriptionID: string, paypalPlanId: string, planKey: string) => {
    setProcessing(true);
    console.info('[PayPal] onApprove triggered', { subscriptionID, paypalPlanId, planKey });
    try {
      const res = await fetchEdgeFunction('paypal-subscription-approved', {
        method: 'POST',
        body: JSON.stringify({ subscriptionID, paypalPlanId, planKey }),
      });
      console.info('[PayPal] Edge Function response', { url: res.url, status: res.status });
      const result = await res.json();
      console.info('[PayPal] Edge Function body', result);
      if (!res.ok) {
        toast.error(result.error || 'Subscription processing failed');
        return;
      }

      // Derive friendly plan name
      const friendlyPlan = planKey.includes('premium') ? 'Premium' : planKey.includes('basic') ? 'Basic' : planKey;

      toast.success(`🎉 Subscription activated!`, {
        description: `You're now on the ${friendlyPlan} plan. Subscription ID: ${subscriptionID}`,
        duration: 8000,
      });

      // Refresh profile and subscription data
      qc.invalidateQueries({ queryKey: ['user-subscription'] });

      // Re-fetch profile to update plan across the entire UI (header, sidebar, etc.)
      await refreshProfile();

      // Update local AppContext plan state
      const newPlan = planKey.includes('premium') ? 'premium' : planKey.includes('basic') ? 'basic' : 'free';
      onSelectPlan(newPlan as Plan);

      // Close dialog after brief delay
      setTimeout(() => onOpenChange(false), 1500);
    } catch (err) {
      console.error('[PayPal] approval error:', err);
      toast.error('Failed to process subscription. Please try again.');
    } finally {
      setProcessing(false);
    }
  }, [qc, onSelectPlan, onOpenChange, refreshProfile]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-center pb-4">
            <DialogTitle className="text-2xl font-bold">
              {t('pricingDialog.title')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('pricingDialog.subtitle')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLAN_ORDER.map((planId) => {
              const Icon = planIcons[planId];
              const features = getPlanFeatures(planId, t);
              const subtitle = t(`pricingDialog.plans.${planId}.description`);
              const { price, period } = getPlanPrice(planId, t);
              const isPopular = planId === 'premium';
              const isCurrentPlan = isLoggedIn && currentPlan === planId;
              const hasActivePaidSub = !!subscription && (subscription.status === 'active' || subscription.status === 'pending') && (subscription.plan_key === 'basic_monthly' || subscription.plan_key === 'premium_monthly');
              const ctaType = getCtaType(planId, currentPlan, isLoggedIn, paypalPlans, hasActivePaidSub);
              const paypal = paypalPlans[planId];

              return (
                <div
                  key={planId}
                  className={cn(
                    'relative flex flex-col rounded-xl border p-5 transition-all',
                    isPopular
                      ? 'border-primary shadow-lg ring-1 ring-primary/20'
                      : 'border-border hover:border-primary/50',
                    isCurrentPlan && 'bg-primary/5'
                  )}
                >
                  {isPopular && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                      {t('pricingDialog.mostPopular')}
                    </Badge>
                  )}

                  <div className="mb-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg">
                      {t(`pricingDialog.plans.${planId}.name`)}
                    </h3>
                    <p className="text-sm text-muted-foreground">{subtitle}</p>
                  </div>

                  <div className="mb-4">
                    <span className="text-3xl font-bold">{price}</span>
                    <span className="text-muted-foreground text-sm ml-1">
                      /{period}
                    </span>
                  </div>

                  <ul className="space-y-2.5 mb-6 flex-1">
                    {features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA area */}
                  <div className="mt-auto">
                    {ctaType === 'current' && (
                      <Button variant="outline" className="w-full" disabled>
                        {t('pricingDialog.currentPlan')}
                      </Button>
                    )}
                    {ctaType === 'paypal' && paypal && (
                      <PayPalSubscriptionButton
                        planId={paypal.planId}
                        planKey={paypal.planKey}
                        onApprove={handlePayPalApprove}
                        disabled={processing}
                      />
                    )}
                    {ctaType === 'contact' && (
                      <Button
                        variant={isPopular ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => setContactSalesOpen(true)}
                      >
                        {t('pricingDialog.ctas.contactSales')}
                      </Button>
                    )}
                    {ctaType === 'downgrade' && (
                      <Button variant="outline" className="w-full text-xs" disabled>
                        {hasActivePaidSub && planId !== currentPlan
                          ? t('pricingDialog.ctas.cancelFirst')
                          : t('pricingDialog.ctas.contactDowngrade')}
                      </Button>
                    )}
                    {ctaType === 'signup' && (
                      <Button
                        variant={isPopular ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => {
                          onOpenChange(false);
                        }}
                      >
                        {planId === 'free' ? t('pricingDialog.ctas.signupFree') : t('pricingDialog.ctas.signupSubscribe')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {processing && (
            <div className="text-center text-sm text-muted-foreground mt-4">
              {t('pricingDialog.processing')}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ContactSalesDialog open={contactSalesOpen} onOpenChange={setContactSalesOpen} />
    </>
  );
}
