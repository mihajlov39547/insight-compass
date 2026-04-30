import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToRegister: () => void;
}

export function SignInDialog({ open, onOpenChange, onSwitchToRegister }: SignInDialogProps) {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!identifier.trim()) newErrors.identifier = t('auth.errors.identifierRequired');
    if (!password) newErrors.password = t('auth.errors.passwordRequired');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      let email = identifier.trim();

      if (!email.includes('@')) {
        const { data, error } = await supabase.rpc('get_email_by_username', {
          lookup_username: email,
        });
        if (error || !data) {
          toast.error(t('auth.errors.invalidUsernameOrPassword'));
          setLoading(false);
          return;
        }
        email = data as string;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(t('auth.errors.invalidCredentials'));
        return;
      }

      toast.success(t('auth.toasts.signedIn'));
      onOpenChange(false);
      resetForm();
    } catch (err) {
      toast.error(t('auth.errors.signInFailedRetry'));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setIdentifier('');
    setPassword('');
    setErrors({});
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{t('auth.signInTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="signin-id">{t('auth.emailOrUsername')}</Label>
            <Input
              id="signin-id"
              type="text"
              placeholder={t('auth.emailOrUsernamePlaceholder')}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
            />
            {errors.identifier && <p className="text-sm text-destructive">{errors.identifier}</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="signin-password">{t('auth.password')}</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
                onClick={() => {
                  const id = identifier.trim();
                  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
                  onOpenChange(false);
                  const url = isEmail ? `/reset-password?email=${encodeURIComponent(id.toLowerCase())}` : '/reset-password';
                  window.location.assign(url);
                }}
              >
                {t('auth.resetPassword')}
              </button>
            </div>
            <Input
              id="signin-password"
              type="password"
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('auth.signIn')}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            {t('auth.noAccount')}{' '}
            <button
              type="button"
              className="text-primary hover:underline font-medium"
              onClick={() => { onOpenChange(false); resetForm(); onSwitchToRegister(); }}
            >
              {t('auth.register')}
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
