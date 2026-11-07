// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// True when the request carries the project's service-role key (internal
// edge-function calls). Never true for browser callers.
export function isServiceRoleCaller(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return false;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return bearer === serviceKey;
}

// True for internal callers: service-role key, or the scheduled-job token
// stored in a service-role-only table.
export async function isInternalCaller(req: Request): Promise<boolean> {
  if (isServiceRoleCaller(req)) return true;
  const token = (req.headers.get("x-internal-job-token") || "").trim();
  if (!token || token.length < 32) return false;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data } = await admin
    .from("internal_job_tokens").select("token").eq("name", "workflow_cron").maybeSingle();
  return !!data?.token && data.token === token;
}
