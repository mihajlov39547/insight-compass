import React, { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from 'react-i18next';

interface DeleteWithConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  intro: React.ReactNode;
  items?: string[];
  irreversibleNote?: string;
  /** Localized text shown next to the confirmation checkbox */
  confirmCheckboxLabel?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
}

/**
 * Reusable destructive-action dialog.
 * - Lists what will be permanently removed (cascading deletes).
 * - Requires the user to tick a checkbox before the confirm button enables.
 */
export function DeleteWithConfirmDialog({
  open,
  onOpenChange,
  title,
  intro,
  items,
  irreversibleNote,
  confirmCheckboxLabel,
  confirmLabel,
  cancelLabel,
  onConfirm,
  isPending,
}: DeleteWithConfirmDialogProps) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset checkbox each time the dialog re-opens.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  const checkboxLabel = confirmCheckboxLabel ?? t('common.deleteConfirmCheckbox', {
    defaultValue: 'I understand this action is permanent and cannot be undone.',
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div>{intro}</div>
              {items && items.length > 0 && (
                <ul className="list-disc pl-5 space-y-1">
                  {items.map((item, idx) => (<li key={idx}>{item}</li>))}
                </ul>
              )}
              {irreversibleNote && (
                <div className="font-medium text-foreground pt-1">{irreversibleNote}</div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 cursor-pointer">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
            className="mt-0.5"
          />
          <span className="text-xs text-foreground leading-relaxed">{checkboxLabel}</span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!acknowledged || isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!acknowledged || isPending) return;
              onConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
