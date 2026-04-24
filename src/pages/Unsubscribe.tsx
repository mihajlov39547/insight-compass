import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { MailX, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

type Status = 'loading' | 'valid' | 'already' | 'invalid' | 'success' | 'error';

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    fetch(`${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, {
      headers: { apikey: anonKey },
    })
      .then(r => r.json())
      .then(data => {
        if (data.valid === false && data.reason === 'already_unsubscribed') setStatus('already');
        else if (data.valid) setStatus('valid');
        else setStatus('invalid');
      })
      .catch(() => setStatus('error'));
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const { data } = await supabase.functions.invoke('handle-email-unsubscribe', { body: { token } });
      if (data?.success) setStatus('success');
      else if (data?.reason === 'already_unsubscribed') setStatus('already');
      else setStatus('error');
    } catch {
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {status === 'loading' && (
          <>
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Verifying…</p>
          </>
        )}

        {status === 'valid' && (
          <>
            <MailX className="h-12 w-12 mx-auto text-accent" />
            <h1 className="text-xl font-semibold text-foreground">Unsubscribe</h1>
            <p className="text-muted-foreground">Are you sure you want to unsubscribe from Researcher emails?</p>
            <Button onClick={handleConfirm} disabled={submitting} className="bg-accent hover:bg-accent/90 text-accent-foreground">
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</> : 'Confirm Unsubscribe'}
            </Button>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500" />
            <h1 className="text-xl font-semibold text-foreground">Unsubscribed</h1>
            <p className="text-muted-foreground">You have been successfully unsubscribed and will no longer receive emails.</p>
          </>
        )}

        {status === 'already' && (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Already Unsubscribed</h1>
            <p className="text-muted-foreground">This email address has already been unsubscribed.</p>
          </>
        )}

        {status === 'invalid' && (
          <>
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h1 className="text-xl font-semibold text-foreground">Invalid Link</h1>
            <p className="text-muted-foreground">This unsubscribe link is invalid or has expired.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
            <p className="text-muted-foreground">We couldn't process your request. Please try again later.</p>
          </>
        )}
      </div>
    </div>
  );
}
