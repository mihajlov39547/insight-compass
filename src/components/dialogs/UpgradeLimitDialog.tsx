import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useApp } from '@/contexts/useApp';

interface UpgradeLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limitType: string;
  currentLimit: number | null;
  recommendedPlan: string;
}

export function UpgradeLimitDialog({
  open,
  onOpenChange,
  limitType,
  currentLimit,
  recommendedPlan,
}: UpgradeLimitDialogProps) {
  const { setShowPricing } = useApp();

  const handleUpgrade = () => {
    onOpenChange(false);
    setShowPricing(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Plan Limit Reached</DialogTitle>
          <DialogDescription>
            You've reached the maximum of{' '}
            {currentLimit !== null ? currentLimit : '∞'} {limitType} on your
            current plan. Upgrade to {recommendedPlan} to increase your limit.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpgrade}>View Plans</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
