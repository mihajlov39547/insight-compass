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
import { Plan } from '@/data/mockData';
import { planIcons } from '@/lib/planConfig';

interface PricingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: Plan;
  onSelectPlan: (plan: Plan) => void;
}

const plans = [
  {
    id: 'free' as Plan,
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for getting started',
    icon: planIcons.free,
    features: [
      'Up to 3 projects',
      '10 document uploads',
      'Basic RAG chat',
      'Community support',
    ],
    cta: 'Get Started',
    popular: false,
  },
  {
    id: 'basic' as Plan,
    name: 'Basic',
    price: '$19',
    period: 'per month',
    description: 'For individuals and small teams',
    icon: planIcons.basic,
    features: [
      'Up to 10 projects',
      '100 document uploads',
      'Faster retrieval',
      'Project sharing (3 members)',
      'Email support',
    ],
    cta: 'Get Started',
    popular: false,
  },
  {
    id: 'premium' as Plan,
    name: 'Premium',
    price: '$49',
    period: 'per month',
    description: 'For growing teams',
    icon: planIcons.premium,
    features: [
      'Unlimited projects',
      '500 document uploads',
      'Advanced retrieval',
      'Priority models',
      'Project sharing (10 members)',
      'Priority support',
    ],
    cta: 'Get Started',
    popular: true,
  },
  {
    id: 'enterprise' as Plan,
    name: 'Enterprise',
    price: 'Custom',
    period: 'contact us',
    description: 'For large organizations',
    icon: Building2,
    features: [
      'Everything in Premium',
      'Unlimited documents',
      'Team management',
      'SSO & security features',
      'Custom integrations',
      'Dedicated support',
    ],
    cta: 'Contact Sales',
    popular: false,
  },
];

export function PricingDialog({ open, onOpenChange, currentPlan, onSelectPlan }: PricingDialogProps) {
  const handleSelectPlan = (planId: Plan) => {
    onSelectPlan(planId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-center pb-4">
          <DialogTitle className="text-2xl font-bold">Choose Your Plan</DialogTitle>
          <p className="text-muted-foreground">
            Select the perfect plan for your needs. Upgrade or downgrade anytime.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrentPlan = currentPlan === plan.id;
            const Icon = plan.icon;

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
                    Most Popular
                  </Badge>
                )}

                <div className="mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground text-sm ml-1">/{plan.period}</span>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((feature, idx) => (
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
                  {isCurrentPlan ? 'Current Plan' : plan.cta}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
