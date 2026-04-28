import React from 'react';
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

interface PricingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: Plan;
  onSelectPlan: (plan: Plan) => void;
}

const planConfig: Array<{
  id: Plan;
  price: string;
  periodKey: 'forever' | 'perMonth' | 'contactUs';
  icon: any;
  featureCount: number;
  ctaKey: 'getStarted' | 'contactSales';
  popular: boolean;
}> = [
  { id: 'free', price: '$0', periodKey: 'forever', icon: planIcons.free, featureCount: 6, ctaKey: 'getStarted', popular: false },
  { id: 'basic', price: '$9', periodKey: 'perMonth', icon: planIcons.basic, featureCount: 6, ctaKey: 'getStarted', popular: false },
  { id: 'premium', price: '$19', periodKey: 'perMonth', icon: planIcons.premium, featureCount: 6, ctaKey: 'getStarted', popular: true },
  { id: 'enterprise', price: 'Custom', periodKey: 'contactUs', icon: planIcons.enterprise, featureCount: 6, ctaKey: 'contactSales', popular: false },
];

export function PricingDialog({ open, onOpenChange, currentPlan, onSelectPlan }: PricingDialogProps) {
  const { t } = useTranslation();
  const handleSelectPlan = (planId: Plan) => {
    onSelectPlan(planId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-center pb-4">
          <DialogTitle className="text-2xl font-bold">{t('pricingDialog.title')}</DialogTitle>
          <p className="text-muted-foreground">
            {t('pricingDialog.subtitle')}
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {planConfig.map((plan) => {
            const isCurrentPlan = currentPlan === plan.id;
            const Icon = plan.icon;
            const features = Array.from({ length: plan.featureCount }, (_, i) =>
              t(`pricingDialog.plans.${plan.id}.features.${i}`)
            );

            return (
              <div
                key={plan.id}
                className={cn(
                  'relative flex flex-col rounded-xl border p-5 transition-all',
                  plan.popular 
                    ? 'border-primary shadow-lg ring-1 ring-primary/20' 
                    : 'border-border hover:border-primary/50',
                  isCurrentPlan && 'bg-primary/5'
                )}
              >
                {plan.popular && (
                  <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                    {t('pricingDialog.mostPopular')}
                  </Badge>
                )}

                <div className="mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg">{t(`pricingDialog.plans.${plan.id}.name`)}</h3>
                  <p className="text-sm text-muted-foreground">{t(`pricingDialog.plans.${plan.id}.description`)}</p>
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground text-sm ml-1">/{t(`pricingDialog.periods.${plan.periodKey}`)}</span>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  variant={plan.popular ? 'default' : 'outline'}
                  className="w-full"
                  disabled={isCurrentPlan}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {isCurrentPlan ? t('pricingDialog.currentPlan') : t(`pricingDialog.ctas.${plan.ctaKey}`)}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
