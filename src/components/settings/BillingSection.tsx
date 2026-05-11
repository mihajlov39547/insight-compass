import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/useAuth';
import { useUserSubscription } from '@/hooks/useUserSubscription';
import { normalizePlan, type Plan } from '@/types/app';
import { CreditCard, ExternalLink, XCircle } from 'lucide-react';
import { planLabels } from '@/lib/planConfig';
import { fetchEdgeFunction } from '@/lib/edge/invokeWithAuth';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { PricingDialog } from '@/components/dialogs/PricingDialog';

export function BillingSection() {
  const { profile, refreshProfile } = useAuth();
  const { data: subscription, isLoading } = useUserSubscription();
  const [showPricing, setShowPricing] = useState(false);
  const currentPlan = normalizePlan(profile?.plan);
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  const periodEndDate = subscription?.current_period_end
    ? new Date(subscription.current_period_end)
    : null;
  const periodEndInFuture = !!periodEndDate && periodEndDate > new Date();

  const isCancelledWithAccess =
    !!subscription?.cancel_at_period_end &&
    (subscription?.status === 'cancelled' || subscription?.status === 'active') &&
    periodEndInFuture;

  const isPaidPlan =
    subscription?.plan_key === 'basic_monthly' ||
    subscription?.plan_key === 'premium_monthly';

  const canCancel =
    !!subscription?.paypal_subscription_id &&
    (subscription?.status === 'active' || subscription?.status === 'pending') &&
    !subscription?.cancel_at_period_end &&
    isPaidPlan;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetchEdgeFunction('paypal-cancel-subscription', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'User requested cancellation from Rsrcher billing page',
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || 'Cancellation failed');
        return;
      }
      const periodEnd = result.currentPeriodEnd
        ? new Date(result.currentPeriodEnd).toLocaleDateString()
        : null;
      toast.success(
        periodEnd
          ? `Subscription cancelled. You'll keep access until ${periodEnd}.`
          : 'Subscription cancelled successfully.'
      );
      qc.invalidateQueries({ queryKey: ['user-subscription'] });
      await refreshProfile();
    } catch (err) {
      console.error('[Cancel] error:', err);
      toast.error('Failed to cancel subscription. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

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
              variant={isCancelledWithAccess ? 'outline' : statusLabel === 'active' ? 'default' : 'secondary'}
              className={isCancelledWithAccess ? 'text-amber-500 border-amber-500' : 'capitalize'}
            >
              {isCancelledWithAccess ? 'Cancels at period end' : statusLabel}
            </Badge>
          </div>

          {isCancelledWithAccess && periodEndDate && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Access until</span>
              <span className="text-sm font-medium text-amber-500">
                {periodEndDate.toLocaleDateString()}
              </span>
            </div>
          )}

          {isPaidPlan && periodEndDate && !isCancelledWithAccess && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Next billing date</span>
              <span className="text-sm font-medium">
                {periodEndDate.toLocaleDateString()}
              </span>
            </div>
          )}

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

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setShowPricing(true)} className="w-full sm:w-auto">
            <CreditCard className="h-4 w-4 mr-2" />
            {currentPlan === 'free' ? 'Upgrade Plan' : 'Update Plan'}
          </Button>

          {canCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto" disabled={cancelling}>
                  <XCircle className="h-4 w-4 mr-2" />
                  {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your PayPal subscription will be cancelled. You will not be billed again.
                    Your access may remain active until the end of the current billing period,
                    depending on your billing status.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleCancel}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Cancel subscription
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {hasPayPalSub && (
          <div className="text-sm text-muted-foreground mt-3 space-y-1">
            <p>
              To manage your subscription, you can also use your{' '}
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
        { label: 'Docs per project/notebook', value: '50' },
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
