// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { runWorkerLoop } from "./worker-loop.ts";
import type { WorkerRequest, WorkerResponse } from "./contracts.ts";

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

function normalizeWorkerRequest(payload: unknown): WorkerRequest {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {};
  }

  const raw = payload as Record<string, unknown>;

  return {
    max_activities_to_process:
      typeof raw.max_activities_to_process === "number"
        ? raw.max_activities_to_process
        : undefined,
    lease_seconds:
      typeof raw.lease_seconds === "number" ? raw.lease_seconds : undefined,
    handler_keys: Array.isArray(raw.handler_keys)
      ? (raw.handler_keys as string[])
      : undefined,
    debug: typeof raw.debug === "boolean" ? raw.debug : false,
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

    const request = normalizeWorkerRequest(body);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const response: WorkerResponse = await runWorkerLoop(
      supabase,
      request.max_activities_to_process,
      request.lease_seconds,
      request.handler_keys,
      request.debug
    );

    return jsonResponse(response, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("workflow-worker error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
