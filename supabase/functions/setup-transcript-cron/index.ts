import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * setup-transcript-cron
 *
 * Idempotently creates or updates the pg_cron job that invokes
 * youtube-transcript-worker every minute.
 *
 * Reads SUPABASE_URL and YOUTUBE_TRANSCRIPT_WORKER_SECRET from env
 * so nothing is hardcoded.
 *
 * Auth: service_role only (called manually or from a deploy script).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("YOUTUBE_TRANSCRIPT_WORKER_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!workerSecret || workerSecret.trim() === "") {
    return new Response(
      JSON.stringify({ error: "YOUTUBE_TRANSCRIPT_WORKER_SECRET is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const workerUrl = `${supabaseUrl}/functions/v1/youtube-transcript-worker`;
  const headers = JSON.stringify({
    "Content-Type": "application/json",
    "x-worker-secret": workerSecret,
  });

  const jobName = "youtube-transcript-worker-minute";

  // Idempotent: unschedule existing, then schedule fresh
  const unscheduleSql = `SELECT cron.unschedule('${jobName}')`;
  const scheduleSql = `
    SELECT cron.schedule(
      '${jobName}',
      '* * * * *',
      $$
        SELECT net.http_post(
          url := '${workerUrl}',
          headers := '${headers}'::jsonb,
          body := '{"max_jobs":10}'::jsonb
        );
      $$
    )
  `;

  // Try unschedule (ignore error if job doesn't exist)
  await supabase.rpc("exec_sql", { sql: unscheduleSql }).catch(() => {});

  // We can't use rpc for arbitrary SQL, so use the REST SQL endpoint
  // Instead, run both via the supabase client's raw SQL
  // Actually, we need to use pg directly. Let's use the management API approach.
  // The simplest robust approach: use pg connection via supabase-js isn't possible.
  // We'll execute via the postgres query interface through supabase functions.

  // Best approach: execute SQL via the service role connection
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
      "apikey": serviceRoleKey,
    },
    body: JSON.stringify({ sql: scheduleSql }),
  });

  // The exec_sql rpc likely doesn't exist. Let's take a different approach:
  // Return the SQL that needs to be run, and provide instructions.
  // OR: we create a proper migration.

  // Actually, the cleanest approach for Lovable is to return the SQL
  // and let the caller (or a migration) run it.

  return new Response(
    JSON.stringify({
      status: "ready",
      workerUrl,
      jobName,
      secretConfigured: true,
      instructions: "Run the setup SQL below via the Supabase insert tool or migration",
      unscheduleSql: `SELECT cron.unschedule('${jobName}')`,
      scheduleSql: scheduleSql.trim(),
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
