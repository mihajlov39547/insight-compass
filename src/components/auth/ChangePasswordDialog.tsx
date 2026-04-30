import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}

export function ChangePasswordDialog({ open, onOpenChange, email }: ChangePasswordDialogProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setCurrent(''); setNext(''); setConfirm(''); setErrors({});
  };

  const handleOpen = (v: boolean) => {
    onOpenChange(v);
    if (!v) reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!current) newErrors.current = t('auth.errors.passwordRequired');
    if (!next) newErrors.next = t('auth.errors.passwordRequired');
    else if (next.length < 6) newErrors.next = t('auth.errors.passwordTooShort');
    if (next !== confirm) newErrors.confirm = t('auth.errors.passwordsDontMatch');
    if (current && next && current === next) newErrors.next = t('profileSettings.password.sameAsOld');
    setErrors(newErrors);
    if (Object.keys(newErrors).length) return;

    if (!email) {
      toast.error(t('auth.errors.signInFailed'));
      return;
    }

    setLoading(true);
    try {
      // Re-verify current password
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (verifyErr) {
        setErrors({ current: t('profileSettings.password.wrongCurrent') });
        setLoading(false);
        return;
      }

      const { error: updateErr } = await supabase.auth.updateUser({ password: next });
      if (updateErr) {
        const msg = (updateErr.message || '').toLowerCase();
        if (msg.includes('pwned') || msg.includes('weak')) {
          setErrors({ next: t('profileSettings.password.weakPassword') });
        } else {
          toast.error(t('profileSettings.password.updateFailed'));
        }
        return;
      }
      toast.success(t('profileSettings.password.updatedToast'));
      handleOpen(false);
    } catch {
      toast.error(t('profileSettings.password.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('profileSettings.password.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('profileSettings.password.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cp-current">{t('profileSettings.password.current')}</Label>
            <Input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            {errors.current && <p className="text-sm text-destructive">{errors.current}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-new">{t('profileSettings.password.new')}</Label>
            <Input id="cp-new" type="password" autoComplete="new-password" placeholder={t('auth.passwordHintPlaceholder')} value={next} onChange={(e) => setNext(e.target.value)} />
            {errors.next && <p className="text-sm text-destructive">{errors.next}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-confirm">{t('profileSettings.password.confirm')}</Label>
            <Input id="cp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {errors.confirm && <p className="text-sm text-destructive">{errors.confirm}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpen(false)} disabled={loading}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('profileSettings.password.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
