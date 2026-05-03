import React, { useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
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

const PAYPAL_PLANS: Record<string, { planId: string; planKey: string }> = {
  basic: { planId: 'P-94V224809Y744903GNH3YJ5I', planKey: 'basic_monthly' },
  premium: { planId: 'P-914500751X525453BNH3YLOA', planKey: 'premium_monthly' },
};

const PLAN_ORDER: Plan[] = ['free', 'basic', 'premium', 'enterprise'];

function getPlanFeatures(planId: Plan): string[] {
  switch (planId) {
    case 'free':
      return [
        'Up to 3 projects and 3 notebooks',
        '1 chat per project',
        '5 document uploads per project/notebook',
        'Basic retrieval',
        'No sharing — private only',
        'Basic support',
        'Request features and improvements',
      ];
    case 'basic':
      return [
        'Everything in Free',
        'Up to 10 projects and 10 notebooks',
        'Up to 5 chats per project',
        '10 document uploads per project/notebook',
        'Faster retrieval',
        'Project sharing — up to 3 members',
        'Notebook sharing not included',
        'Email support',
      ];
    case 'premium':
      return [
        'Everything in Basic',
        'Unlimited projects and notebooks',
        '500 document uploads per project/notebook',
        'Advanced retrieval',
        'Access to latest models',
        'Unlimited project sharing',
        'Unlimited notebook sharing',
        'Priority support — Teams coming soon',
      ];
    case 'enterprise':
      return [
        'Everything in Premium',
        'Unlimited documents',
        'Team management',
        'SSO & security features',
        'Custom integrations',
        'Dedicated support',
      ];
  }
}

function getPlanSubtitle(planId: Plan): string {
  switch (planId) {
    case 'free': return 'Perfect for getting started';
    case 'basic': return 'For individuals and small teams';
    case 'premium': return 'For growing teams';
    case 'enterprise': return 'For large organizations';
  }
}

function getPlanPrice(planId: Plan): { price: string; period: string } {
  switch (planId) {
    case 'free': return { price: '$0', period: 'forever' };
    case 'basic': return { price: '$9', period: 'per month' };
    case 'premium': return { price: '$19', period: 'per month' };
    case 'enterprise': return { price: 'Custom', period: 'contact us' };
  }
}

function getCtaType(cardPlan: Plan, currentPlan: Plan, isLoggedIn: boolean): PlanCard['ctaType'] {
  if (!isLoggedIn) {
    if (cardPlan === 'enterprise') return 'contact';
    return 'signup';
  }
  if (cardPlan === currentPlan) return 'current';
  if (cardPlan === 'enterprise') return 'contact';
  const currentIdx = PLAN_ORDER.indexOf(currentPlan);
  const cardIdx = PLAN_ORDER.indexOf(cardPlan);
  if (cardIdx < currentIdx) return 'downgrade';
  if (PAYPAL_PLANS[cardPlan]) return 'paypal';
  return 'current'; // free → free
}

export function PricingDialog({ open, onOpenChange, currentPlan: currentPlanProp, onSelectPlan }: PricingDialogProps) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [contactSalesOpen, setContactSalesOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const { data: subscription } = useUserSubscription();

  const isLoggedIn = !!user;
  const currentPlan = normalizePlan(profile?.plan);

  const handlePayPalApprove = useCallback(async (subscriptionID: string, paypalPlanId: string, planKey: string) => {
    setProcessing(true);
    try {
      const res = await fetchEdgeFunction('paypal-subscription-approved', {
        method: 'POST',
        body: JSON.stringify({ subscriptionID, paypalPlanId, planKey }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || 'Subscription processing failed');
        return;
      }
      toast.success('Subscription activated! Welcome to your new plan.');
      qc.invalidateQueries({ queryKey: ['user-subscription'] });
      // Refresh profile
      qc.invalidateQueries({ queryKey: ['profile'] });
      // Force profile refetch
      window.location.reload();
    } catch (err) {
      console.error('PayPal approval error:', err);
      toast.error('Failed to process subscription. Please try again.');
    } finally {
      setProcessing(false);
    }
  }, [qc]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-center pb-4">
            <DialogTitle className="text-2xl font-bold">
              {t('pricingDialog.title')}
            </DialogTitle>
            <p className="text-muted-foreground">
              {t('pricingDialog.subtitle')}
            </p>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLAN_ORDER.map((planId) => {
              const Icon = planIcons[planId];
              const features = getPlanFeatures(planId);
              const subtitle = getPlanSubtitle(planId);
              const { price, period } = getPlanPrice(planId);
              const isPopular = planId === 'premium';
              const isCurrentPlan = isLoggedIn && currentPlan === planId;
              const ctaType = getCtaType(planId, currentPlan, isLoggedIn);
              const paypal = PAYPAL_PLANS[planId];

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
                      Most Popular
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
                      <Button variant="outline" className="w-full" disabled>
                        Contact support to downgrade
                      </Button>
                    )}
                    {ctaType === 'signup' && (
                      <Button
                        variant={isPopular ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => {
                          onOpenChange(false);
                          // Trigger login dialog — handled by parent
                        }}
                      >
                        {planId === 'free' ? 'Sign Up Free' : 'Sign Up to Subscribe'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {processing && (
            <div className="text-center text-sm text-muted-foreground mt-4">
              Processing your subscription…
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ContactSalesDialog open={contactSalesOpen} onOpenChange={setContactSalesOpen} />
    </>
  );
}
