// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  recoverStaleActivityRuns,
  type RecoverStaleActivityRunsRequest,
} from "../workflow-worker/stale-recovery-service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeMaintenanceRequest(
  payload: unknown
): RecoverStaleActivityRunsRequest {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {};
  }

  const raw = payload as Record<string, unknown>;

  return {
    max_records:
      typeof raw.max_records === "number" ? raw.max_records : undefined,
    stale_before_seconds:
      typeof raw.stale_before_seconds === "number"
        ? raw.stale_before_seconds
        : undefined,
    dry_run: typeof raw.dry_run === "boolean" ? raw.dry_run : false,
    actor: typeof raw.actor === "string" ? raw.actor : "maintenance",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { error: "Supabase environment variables are not configured" },
        500
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const request = normalizeMaintenanceRequest(body);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const response = await recoverStaleActivityRuns(supabase, request);
    return jsonResponse(response, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("workflow-maintenance error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
