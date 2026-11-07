// @ts-nocheck
// True when the request carries the project's service-role key (internal
// edge-function calls and scheduled jobs). Never true for browser callers.
export function isServiceRoleCaller(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return false;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return bearer === serviceKey;
}
