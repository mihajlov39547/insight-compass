import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldCheck, LogIn } from 'lucide-react';

interface AuthorizationDetails {
  client?: { name?: string | null; redirect_uri?: string | null; client_uri?: string | null } | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  [key: string]: unknown;
}

// The @supabase/supabase-js OAuth server namespace is beta. Wrap the three
// methods we use with a local typed shape so TypeScript accepts them.
type OAuthClient = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthClient }).oauth;

function humanScope(scope: string): string {
  switch (scope) {
    case 'openid':
      return 'Verify your identity';
    case 'email':
      return 'Share your email address';
    case 'profile':
      return 'Share your basic profile';
    default:
      return `Additional permission requested: ${scope}`;
  }
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id') ?? '';

  const [session, setSession] = useState<{ email?: string | null } | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const consentUrl = useMemo(
    () => window.location.pathname + window.location.search,
    [],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!active) return;
      setSession(sess.session ? { email: sess.session.user.email } : null);
      setSessionChecked(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ? { email: s.user.email } : null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionChecked || !session) return;
    if (!authorizationId) {
      setError('Missing authorization_id');
      return;
    }
    let active = true;
    (async () => {
      const { data, error: e } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (e) return setError(e.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [sessionChecked, session, authorizationId]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    const { data, error: e } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError('No redirect returned by the authorization server.');
      return;
    }
    window.location.href = target;
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    const { error: se } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    setLoginBusy(false);
    if (se) setLoginError(se.message);
  };

  const signInWithGoogle = async () => {
    setLoginBusy(true);
    setLoginError(null);
    const result = await lovable.auth.signInWithOAuth('google', {
      // Return to this consent URL after Google sign-in.
      redirect_uri: window.location.origin + consentUrl,
    });
    if (result.error) {
      setLoginBusy(false);
      setLoginError(String(result.error));
      return;
    }
    // If not redirected, session was set — the auth state listener will pick it up.
    setLoginBusy(false);
  };

  // --- render ---
  if (!authorizationId) {
    return (
      <Shell title="Invalid authorization request">
        <p className="text-sm text-muted-foreground">
          This page was opened without an authorization request. Return to the client app and try connecting again.
        </p>
      </Shell>
    );
  }

  if (!sessionChecked) {
    return (
      <Shell title="Loading…">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session
        </div>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell title="Sign in to continue">
        <p className="text-sm text-muted-foreground mb-4">
          Sign in to approve the connection request.
        </p>
        <form onSubmit={signInWithPassword} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oauth-consent-email">Email</Label>
            <Input
              id="oauth-consent-email"
              type="email"
              autoComplete="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oauth-consent-password">Password</Label>
            <Input
              id="oauth-consent-password"
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
          </div>
          {loginError && (
            <div className="text-sm text-destructive">{loginError}</div>
          )}
          <Button type="submit" disabled={loginBusy} className="w-full">
            {loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
            Sign in
          </Button>
        </form>
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <Button variant="outline" className="w-full" onClick={signInWithGoogle} disabled={loginBusy}>
          Continue with Google
        </Button>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell title="Could not load this authorization request">
        <p className="text-sm text-destructive">{error}</p>
      </Shell>
    );
  }

  if (!details) {
    return (
      <Shell title="Loading…">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading authorization request
        </div>
      </Shell>
    );
  }

  const clientName = details.client?.name ?? 'an app';
  const scopes = (details.scope ?? 'openid email profile')
    .split(/\s+/)
    .filter(Boolean);

  return (
    <Shell title={`Connect ${clientName} to Researcher`}>
      <p className="text-sm text-muted-foreground mb-4">
        This lets <span className="font-medium text-foreground">{clientName}</span> use Researcher as you
        {session.email ? <> (<span className="font-mono">{session.email}</span>)</> : null}.
      </p>

      <div className="rounded-md border border-border bg-muted/30 p-3 mb-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Requested permissions</div>
        <ul className="space-y-1 text-sm">
          {scopes.map((s) => (
            <li key={s} className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <span>{humanScope(s)}</span>
            </li>
          ))}
          <li className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <span>Call Researcher's enabled MCP tools while you are signed in.</span>
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        This does not bypass Researcher's permissions or backend policies. You can revoke this connection at any time.
      </p>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
          Cancel
        </Button>
        <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve'}
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold mb-3">{title}</h1>
        {children}
      </div>
    </main>
  );
}
