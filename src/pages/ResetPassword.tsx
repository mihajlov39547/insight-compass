import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Step = 'request' | 'verify' | 'done';

export default function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialEmail = (searchParams.get('email') || '').toLowerCase();
  const initialStep: Step = initialEmail ? 'verify' : 'request';

  const [step, setStep] = useState<Step>(initialStep);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const requestCode = async (targetEmail: string): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke('password-reset-request', {
      body: { email: targetEmail },
    });
    if (error || (data as { error?: string } | null)?.error) {
      toast.error(t('auth.reset.sendFailed'));
      return false;
    }
    return true;
  };

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = t('auth.errors.emailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = t('auth.errors.invalidEmail');
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      const ok = await requestCode(email.trim().toLowerCase());
      if (ok) {
        toast.success(t('auth.reset.codeSentToast'));
        setEmail(email.trim().toLowerCase());
        setCode('');
        setStep('verify');
      }
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    try {
      const ok = await requestCode(email);
      if (ok) { setCode(''); toast.success(t('auth.reset.codeSentToast')); }
    } finally { setResending(false); }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (code.length !== 5) next.code = t('auth.reset.codeRequired');
    if (!newPassword) next.password = t('auth.errors.passwordRequired');
    else if (newPassword.length < 6) next.password = t('auth.errors.passwordTooShort');
    if (newPassword !== confirmPassword) next.confirm = t('auth.errors.passwordsDontMatch');
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('password-reset-verify', {
        body: { email, code, newPassword },
      });
      const errCode = (data as { error?: string; attemptsLeft?: number } | null)?.error;
      if (error || errCode) {
        if (errCode === 'invalid_code') {
          const left = (data as { attemptsLeft?: number }).attemptsLeft ?? 0;
          setErrors({ code: t('auth.reset.wrongCode', { count: left }) });
          setCode('');
        } else if (errCode === 'expired') {
          toast.error(t('auth.reset.expired'));
          setStep('request');
        } else if (errCode === 'too_many_attempts') {
          toast.error(t('auth.reset.tooManyAttempts'));
          setStep('request');
        } else if (errCode === 'no_pending') {
          toast.error(t('auth.reset.noPending'));
          setStep('request');
        } else if (errCode === 'weak_password') {
          setErrors({ password: t('profileSettings.password.weakPassword') });
        } else {
          toast.error(t('auth.reset.verifyFailed'));
        }
        return;
      }
      toast.success(t('auth.reset.successToast'));
      setStep('done');
    } catch {
      toast.error(t('auth.reset.verifyFailed'));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> {t('auth.reset.backHome')}
        </button>

        <Card>
          <CardHeader>
            <CardTitle>{t('auth.reset.title')}</CardTitle>
            <CardDescription>
              {step === 'request' && t('auth.reset.requestDescription')}
              {step === 'verify' && t('auth.reset.verifyDescription', { email })}
              {step === 'done' && t('auth.reset.doneDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'request' && (
              <form onSubmit={handleRequest} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rp-email">{t('auth.email')}</Label>
                  <Input id="rp-email" type="email" autoComplete="email" placeholder={t('auth.emailPlaceholder')}
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                  {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t('auth.reset.sendCode')}
                </Button>
              </form>
            )}

            {step === 'verify' && (
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label className="sr-only">{t('auth.otp.label')}</Label>
                  <div className="flex justify-center">
                    <InputOTP maxLength={5} value={code} onChange={setCode} autoFocus>
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {errors.code && <p className="text-sm text-destructive text-center">{errors.code}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rp-new">{t('profileSettings.password.new')}</Label>
                  <Input id="rp-new" type="password" autoComplete="new-password" placeholder={t('auth.passwordHintPlaceholder')}
                    value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rp-confirm">{t('profileSettings.password.confirm')}</Label>
                  <Input id="rp-confirm" type="password" autoComplete="new-password"
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  {errors.confirm && <p className="text-sm text-destructive">{errors.confirm}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={loading || code.length !== 5}>
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t('auth.reset.submit')}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setStep('request')}>
                    <ArrowLeft className="h-3.5 w-3.5" /> {t('auth.reset.useDifferentEmail')}
                  </button>
                  <button type="button" className="text-primary hover:underline font-medium disabled:opacity-50"
                    onClick={handleResend} disabled={resending}>
                    {resending ? t('auth.otp.resending') : t('auth.otp.resend')}
                  </button>
                </div>
              </form>
            )}

            {step === 'done' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('auth.reset.doneBody')}</p>
                <Button className="w-full" onClick={() => navigate('/')}>{t('auth.reset.goSignIn')}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
