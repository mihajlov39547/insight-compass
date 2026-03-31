// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  ServiceError,
  startWorkflowRunMaterialization,
} from "./materialization-service.ts";
import type {
  StartWorkflowRunRequest,
  StartWorkflowRunResponse,
} from "./contracts.ts";

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

function normalizeRequest(payload: unknown): StartWorkflowRunRequest {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ServiceError("Request body must be a JSON object", 400);
  }

  const raw = payload as Record<string, unknown>;

  const definitionKey = typeof raw.definition_key === "string" ? raw.definition_key.trim() : "";
  if (!definitionKey) {
    throw new ServiceError("definition_key is required", 400);
  }

  return {
    definition_key: definitionKey,
    input_payload: (raw.input_payload ?? {}) as StartWorkflowRunRequest["input_payload"],
    user_id:
      typeof raw.user_id === "string"
        ? raw.user_id
        : raw.user_id === null
          ? null
          : undefined,
    trigger_entity_type:
      typeof raw.trigger_entity_type === "string"
        ? raw.trigger_entity_type
        : raw.trigger_entity_type === null
          ? null
          : undefined,
    trigger_entity_id:
      typeof raw.trigger_entity_id === "string"
        ? raw.trigger_entity_id
        : raw.trigger_entity_id === null
          ? null
          : undefined,
    idempotency_key:
      typeof raw.idempotency_key === "string"
        ? raw.idempotency_key
        : raw.idempotency_key === null
          ? null
          : undefined,
    create_initial_context_snapshot:
      typeof raw.create_initial_context_snapshot === "boolean"
        ? raw.create_initial_context_snapshot
        : undefined,
  };
}

async function resolveAuthenticatedUserId(
  supabaseUrl: string,
  anonKey: string,
  authorizationHeader: string
): Promise<string | null> {
  const token = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return null;
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();

  if (error || !user) {
    // Return null instead of throwing — allows server-to-server calls
    // (e.g. service role key) where user_id is provided in the request body.
    return null;
  }

  return user.id;
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse(
        { error: "Supabase environment variables are not configured" },
        500
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ServiceError("Invalid JSON payload", 400);
    }

    const request = normalizeRequest(body);

    const authorizationHeader = req.headers.get("authorization") ?? "";
    const authUserId = await resolveAuthenticatedUserId(
      supabaseUrl,
      anonKey,
      authorizationHeader
    );

    const effectiveUserId = request.user_id ?? authUserId ?? null;

    if (request.user_id && authUserId && request.user_id !== authUserId) {
      throw new ServiceError(
        "user_id must match authenticated user when auth token is provided",
        403
      );
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const result: StartWorkflowRunResponse = await startWorkflowRunMaterialization(
      serviceClient,
      request,
      effectiveUserId
    );

    return jsonResponse(result, 200);
  } catch (error) {
    if (error instanceof ServiceError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("workflow-start error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
