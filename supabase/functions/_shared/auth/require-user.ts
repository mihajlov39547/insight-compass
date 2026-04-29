// Shared helper: validate the caller's Supabase JWT and return the authenticated user.
// Returns either { user } on success or a { response } that the caller should return.
//
// Usage:
//   const auth = await requireUser(req, corsHeaders);
//   if ('response' in auth) return auth.response;
//   const userId = auth.user.id;

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export interface AuthSuccess {
  user: { id: string; email?: string | null };
}
export interface AuthFailure {
  response: Response;
}

export async function requireUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AuthSuccess | AuthFailure> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return {
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    return {
      response: new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
      return {
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }),
      };
    }
    return { user: { id: data.user.id, email: data.user.email } };
  } catch {
    return {
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }
}
