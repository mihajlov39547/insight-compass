// Shared helper to call Edge Functions with the current user's session JWT.
// Use this for any function that requires authentication. Falls back to the
// publishable anon key if there is no session, which will (intentionally) fail
// the server-side `requireUser` check with a 401.

import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_PUBLISHABLE_KEY, getFunctionUrl } from '@/config/env';

async function getAuthHeader(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) return `Bearer ${token}`;
  } catch {
    // ignore — fall through to anon key
  }
  return `Bearer ${SUPABASE_PUBLISHABLE_KEY}`;
}

/**
 * Build an Authorization header value backed by the current user's session.
 * Use this when calling edge functions via raw `fetch`.
 */
export async function authHeader(): Promise<string> {
  return await getAuthHeader();
}

/**
 * Build the standard headers object used for edge function fetch calls
 * (Authorization + apikey + Content-Type).
 */
export async function authedFetchHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    Authorization: await getAuthHeader(),
    apikey: SUPABASE_PUBLISHABLE_KEY,
    ...(extra ?? {}),
  };
}

/**
 * Convenience wrapper: POST to an edge function with the user's session JWT.
 * Pass the function path (e.g. '/functions/v1/chat') OR a full URL.
 */
export async function fetchEdgeFunction(
  pathOrUrl: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : getFunctionUrl(pathOrUrl);
  return fetch(url, {
    ...init,
    headers: await authedFetchHeaders(init.headers),
  });
}
