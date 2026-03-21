import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToRegister: () => void;
}

export function SignInDialog({ open, onOpenChange, onSwitchToRegister }: SignInDialogProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!identifier.trim()) newErrors.identifier = 'Email or username is required';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      let email = identifier.trim();

      // If it doesn't look like an email, treat it as a username
      if (!email.includes('@')) {
        const { data, error } = await supabase.rpc('get_email_by_username', {
          lookup_username: email,
        });
        if (error || !data) {
          toast.error('Invalid username or password');
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
        toast.error('Invalid credentials. Please try again.');
        return;
      }

      toast.success('Signed in successfully!');
      onOpenChange(false);
      resetForm();
    } catch (err) {
      toast.error('Sign in failed. Please try again.');
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
          <DialogTitle className="text-xl">Sign in</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="signin-id">Email or username</Label>
            <Input
              id="signin-id"
              type="text"
              placeholder="you@example.com or username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
            />
            {errors.identifier && <p className="text-sm text-destructive">{errors.identifier}</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="signin-password">Password</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
                onClick={() => toast.info('Password reset will be available soon.')}
              >
                Reset password
              </button>
            </div>
            <Input
              id="signin-password"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Sign in
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Don't have an account?{' '}
            <button
              type="button"
              className="text-primary hover:underline font-medium"
              onClick={() => { onOpenChange(false); resetForm(); onSwitchToRegister(); }}
            >
              Register
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
