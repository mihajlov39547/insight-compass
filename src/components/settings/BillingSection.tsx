import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/useAuth';
import { useUserSubscription } from '@/hooks/useUserSubscription';
import { normalizePlan } from '@/types/app';
import { useApp } from '@/contexts/useApp';
import { CreditCard, ExternalLink } from 'lucide-react';
import { planLabels } from '@/lib/planConfig';

export function BillingSection() {
  const { profile } = useAuth();
  const { data: subscription, isLoading } = useUserSubscription();
  const { setShowPricing } = useApp();
  const currentPlan = normalizePlan(profile?.plan);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading billing info…</div>;
  }

  const statusLabel = subscription?.status ?? 'free';
  const hasPayPalSub = !!subscription?.paypal_subscription_id;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Subscription</h3>

        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Current Plan</span>
            <Badge variant="secondary" className="capitalize">
              {planLabels[currentPlan] ?? currentPlan}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge
              variant={statusLabel === 'active' ? 'default' : 'secondary'}
              className="capitalize"
            >
              {statusLabel}
            </Badge>
          </div>

          {subscription?.plan_key && subscription.plan_key !== 'free' && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Billing</span>
              <span className="text-sm">Monthly</span>
            </div>
          )}

          {hasPayPalSub && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">PayPal Subscription</span>
              <span className="text-sm font-mono text-xs">
                {subscription!.paypal_subscription_id}
              </span>
            </div>
          )}
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Manage Subscription</h3>

        <Button onClick={() => setShowPricing(true)} className="w-full sm:w-auto">
          <CreditCard className="h-4 w-4 mr-2" />
          {currentPlan === 'free' ? 'Upgrade Plan' : 'Change Plan'}
        </Button>

        {hasPayPalSub && (
          <div className="text-sm text-muted-foreground mt-3 space-y-1">
            <p>
              To cancel or manage your subscription, please use your{' '}
              <a
                href="https://www.paypal.com/myaccount/autopay/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
              >
                PayPal automatic payments settings
                <ExternalLink className="h-3 w-3" />
              </a>{' '}
              or contact support.
            </p>
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Plan Limits</h3>
        <PlanLimitsDisplay plan={currentPlan} />
      </section>
    </div>
  );
}

function PlanLimitsDisplay({ plan }: { plan: string }) {
  const limits = getLimitsForDisplay(plan);

  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      {limits.map((item, idx) => (
        <div key={idx} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{item.label}</span>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function getLimitsForDisplay(plan: string) {
  switch (plan) {
    case 'basic':
      return [
        { label: 'Projects', value: '10' },
        { label: 'Notebooks', value: '10' },
        { label: 'Chats per project', value: '5' },
        { label: 'Docs per project/notebook', value: '10' },
        { label: 'Project sharing', value: 'Up to 3 members' },
        { label: 'Notebook sharing', value: 'Not included' },
      ];
    case 'premium':
      return [
        { label: 'Projects', value: 'Unlimited' },
        { label: 'Notebooks', value: 'Unlimited' },
        { label: 'Chats per project', value: 'Unlimited' },
        { label: 'Docs per project/notebook', value: '500' },
        { label: 'Project sharing', value: 'Unlimited' },
        { label: 'Notebook sharing', value: 'Unlimited' },
      ];
    case 'enterprise':
      return [
        { label: 'Projects', value: 'Unlimited' },
        { label: 'Notebooks', value: 'Unlimited' },
        { label: 'Chats per project', value: 'Unlimited' },
        { label: 'Documents', value: 'Unlimited' },
        { label: 'Sharing', value: 'Unlimited' },
      ];
    default:
      return [
        { label: 'Projects', value: '3' },
        { label: 'Notebooks', value: '3' },
        { label: 'Chats per project', value: '1' },
        { label: 'Docs per project/notebook', value: '5' },
        { label: 'Project sharing', value: 'Not available' },
        { label: 'Notebook sharing', value: 'Not available' },
      ];
  }
}
