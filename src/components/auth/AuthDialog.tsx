import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { toast } from 'sonner';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: 'signin' | 'register';
}

type Mode = 'signin' | 'register' | 'otp';

export function AuthDialog({ open, onOpenChange, initialMode = 'signin' }: AuthDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingPassword, setPendingPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setIdentifier('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setOtp('');
    setPendingEmail('');
    setPendingPassword('');
    setErrors({});
  };

  const switchMode = (newMode: Mode) => {
    resetForm();
    setMode(newMode);
  };

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v);
    if (!v) { resetForm(); setMode(initialMode); }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (error) {
        toast.error(t('auth.googleFailed'));
      }
    } catch {
      toast.error(t('auth.googleFailed'));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!identifier.trim()) newErrors.identifier = t('auth.errors.identifierRequired');
    if (!password) newErrors.password = t('auth.errors.passwordRequired');
    setErrors(newErrors);
    if (Object.keys(newErrors).length) return;

    setLoading(true);
    try {
      let loginEmail = identifier.trim();
      if (!loginEmail.includes('@')) {
        const { data, error } = await supabase.rpc('get_email_by_username', { lookup_username: loginEmail });
        if (error || !data) { toast.error(t('auth.errors.invalidUsernameOrPassword')); setLoading(false); return; }
        loginEmail = data as string;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) { toast.error(t('auth.errors.invalidCredentials')); return; }
      toast.success(t('auth.toasts.signedIn'));
      handleOpenChange(false);
    } catch { toast.error(t('auth.errors.signInFailed')); } finally { setLoading(false); }
  };

  const sendOtp = async (targetEmail: string, targetPassword: string): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke('register-otp-start', {
      body: { email: targetEmail, password: targetPassword },
    });
    if (error || (data && (data as { error?: string }).error)) {
      const code = (data as { error?: string } | null)?.error;
      if (code === 'email_taken') toast.error(t('auth.otp.emailTaken'));
      else toast.error(t('auth.otp.sendFailed'));
      return false;
    }
    return true;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!email.trim()) newErrors.email = t('auth.errors.emailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = t('auth.errors.invalidEmail');
    if (!password) newErrors.password = t('auth.errors.passwordRequired');
    else if (password.length < 6) newErrors.password = t('auth.errors.passwordTooShort');
    if (password !== confirmPassword) newErrors.confirm = t('auth.errors.passwordsDontMatch');
    setErrors(newErrors);
    if (Object.keys(newErrors).length) return;

    setLoading(true);
    try {
      const ok = await sendOtp(email.trim().toLowerCase(), password);
      if (!ok) return;
      setPendingEmail(email.trim().toLowerCase());
      setPendingPassword(password);
      setOtp('');
      setMode('otp');
    } catch { toast.error(t('auth.errors.registrationFailed')); } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (!pendingEmail || !pendingPassword) return;
    setResending(true);
    try {
      const ok = await sendOtp(pendingEmail, pendingPassword);
      if (ok) { setOtp(''); toast.success(t('auth.otp.resentToast')); }
    } finally { setResending(false); }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (otp.length !== 5) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('register-otp-verify', {
        body: { email: pendingEmail, code: otp },
      });
      const errCode = (data as { error?: string; attemptsLeft?: number } | null)?.error;
      if (error || errCode) {
        if (errCode === 'invalid_code') {
          const left = (data as { attemptsLeft?: number }).attemptsLeft ?? 0;
          toast.error(t('auth.otp.wrongCode', { count: left }));
        } else if (errCode === 'expired') {
          toast.error(t('auth.otp.expired'));
          switchMode('register');
        } else if (errCode === 'too_many_attempts') {
          toast.error(t('auth.otp.tooManyAttempts'));
          switchMode('register');
        } else if (errCode === 'no_pending') {
          toast.error(t('auth.otp.noPending'));
          switchMode('register');
        } else if (errCode === 'email_taken') {
          toast.error(t('auth.otp.emailTaken'));
          switchMode('signin');
        } else {
          toast.error(t('auth.otp.verifyFailed'));
        }
        setOtp('');
        return;
      }
      // Success — auto sign-in for a smooth experience
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: pendingEmail,
        password: pendingPassword,
      });
      if (signInErr) {
        toast.success(t('auth.otp.successToast'));
        switchMode('signin');
      } else {
        toast.success(t('auth.toasts.accountCreated'));
        handleOpenChange(false);
      }
    } catch { toast.error(t('auth.otp.verifyFailed')); } finally { setLoading(false); }
  };

  const renderTitle = () => {
    if (mode === 'signin') return t('auth.signInTitle');
    if (mode === 'register') return t('auth.registerTitle');
    return t('auth.otp.title');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{renderTitle()}</DialogTitle>
          {mode === 'otp' && (
            <DialogDescription>
              {t('auth.otp.description', { email: pendingEmail })}
            </DialogDescription>
          )}
        </DialogHeader>

        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="auth-id">{t('auth.emailOrUsername')}</Label>
              <Input id="auth-id" type="text" placeholder={t('auth.emailOrUsernamePlaceholder')} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
              {errors.identifier && <p className="text-sm text-destructive">{errors.identifier}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="auth-pw">{t('auth.password')}</Label>
                <button type="button" className="text-xs text-muted-foreground hover:text-primary transition-colors" onClick={() => toast.info(t('auth.resetPasswordSoon'))}>{t('auth.resetPassword')}</button>
              </div>
              <Input id="auth-pw" type="password" placeholder={t('auth.passwordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t('auth.signIn')}
            </Button>
            <div className="relative my-2">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">{t('auth.or')}</span>
            </div>
            <Button type="button" variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn} disabled={isGoogleLoading}>
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {isGoogleLoading ? t('auth.signingIn') : t('auth.signInWithGoogle')}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              {t('auth.noAccount')}{' '}
              <button type="button" className="text-primary hover:underline font-medium" onClick={() => switchMode('register')}>{t('auth.registerInstead')}</button>
            </p>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="reg-email">{t('auth.email')}</Label>
              <Input id="reg-email" type="email" placeholder={t('auth.emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-pw">{t('auth.password')}</Label>
              <Input id="reg-pw" type="password" placeholder={t('auth.passwordHintPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-confirm">{t('auth.repeatPassword')}</Label>
              <Input id="reg-confirm" type="password" placeholder={t('auth.repeatPasswordPlaceholder')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              {errors.confirm && <p className="text-sm text-destructive">{errors.confirm}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t('auth.createAccount')}
            </Button>
            <div className="relative my-2">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">{t('auth.or')}</span>
            </div>
            <Button type="button" variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn} disabled={isGoogleLoading}>
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {isGoogleLoading ? t('auth.signingIn') : t('auth.signInWithGoogle')}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              {t('auth.haveAccount')}{' '}
              <button type="button" className="text-primary hover:underline font-medium" onClick={() => switchMode('signin')}>{t('auth.signInInstead')}</button>
            </p>
          </form>
        )}

        {mode === 'otp' && (
          <form onSubmit={handleVerify} className="space-y-5 mt-2">
            <div className="space-y-2">
              <Label className="sr-only">{t('auth.otp.label')}</Label>
              <div className="flex justify-center">
                <InputOTP maxLength={5} value={otp} onChange={setOtp} autoFocus>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading || otp.length !== 5}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t('auth.otp.verify')}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => switchMode('register')}>
                <ArrowLeft className="h-3.5 w-3.5" /> {t('auth.otp.back')}
              </button>
              <button type="button" className="text-primary hover:underline font-medium disabled:opacity-50" onClick={handleResend} disabled={resending}>
                {resending ? t('auth.otp.resending') : t('auth.otp.resend')}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
