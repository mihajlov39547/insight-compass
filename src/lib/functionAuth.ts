import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_PUBLISHABLE_KEY } from '@/config/env';

/** Signed-in user's access token for calling protected backend functions. */
export async function getUserAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? SUPABASE_PUBLISHABLE_KEY;
}
