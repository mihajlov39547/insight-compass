import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: 'signin' | 'register';
}

export function AuthDialog({ open, onOpenChange, initialMode = 'signin' }: AuthDialogProps) {
  const [mode, setMode] = useState<'signin' | 'register'>(initialMode);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setIdentifier('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setErrors({});
  };

  const switchMode = (newMode: 'signin' | 'register') => {
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
        toast.error("Failed to sign in with Google");
      }
    } catch {
      toast.error("Failed to sign in with Google");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!identifier.trim()) newErrors.identifier = 'Email or username is required';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    if (Object.keys(newErrors).length) return;

    setLoading(true);
    try {
      let loginEmail = identifier.trim();
      if (!loginEmail.includes('@')) {
        const { data, error } = await supabase.rpc('get_email_by_username', { lookup_username: loginEmail });
        if (error || !data) { toast.error('Invalid username or password'); setLoading(false); return; }
        loginEmail = data as string;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) { toast.error('Invalid credentials. Please try again.'); return; }
      toast.success('Signed in successfully!');
      handleOpenChange(false);
    } catch { toast.error('Sign in failed.'); } finally { setLoading(false); }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = 'Invalid email address';
    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 6) newErrors.password = 'Password must be at least 6 characters';
    if (password !== confirmPassword) newErrors.confirm = 'Passwords do not match';
    setErrors(newErrors);
    if (Object.keys(newErrors).length) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) { toast.error(error.message); return; }
      if (data.user) { toast.success('Account created successfully!'); handleOpenChange(false); }
    } catch { toast.error('Registration failed.'); } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{mode === 'signin' ? 'Sign in' : 'Create an account'}</DialogTitle>
        </DialogHeader>

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="auth-id">Email or username</Label>
              <Input id="auth-id" type="text" placeholder="you@example.com or username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
              {errors.identifier && <p className="text-sm text-destructive">{errors.identifier}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="auth-pw">Password</Label>
                <button type="button" className="text-xs text-muted-foreground hover:text-primary transition-colors" onClick={() => toast.info('Password reset will be available soon.')}>Reset password</button>
              </div>
              <Input id="auth-pw" type="password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Sign in
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              Don't have an account?{' '}
              <button type="button" className="text-primary hover:underline font-medium" onClick={() => switchMode('register')}>Register instead</button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="reg-email">Email</Label>
              <Input id="reg-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-pw">Password</Label>
              <Input id="reg-pw" type="password" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-confirm">Repeat password</Label>
              <Input id="reg-confirm" type="password" placeholder="Repeat your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              {errors.confirm && <p className="text-sm text-destructive">{errors.confirm}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create account
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              Already have an account?{' '}
              <button type="button" className="text-primary hover:underline font-medium" onClick={() => switchMode('signin')}>Sign in instead</button>
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
