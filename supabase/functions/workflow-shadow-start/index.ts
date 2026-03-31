// @ts-nocheck
/**
 * workflow-shadow-start
 *
 * Non-production/shadow endpoint for manually triggering document workflow runs
 * through the durable workflow engine. This does NOT replace the production
 * process-document path. It is intended for development, testing, and shadow
 * validation only.
 *
 * Usage:
 *   POST /functions/v1/workflow-shadow-start
 *   Body: {
 *     "definition_key": "document_processing_v1",
 *     "document_id": "uuid",
 *     "user_id": "uuid",          // optional, resolved from auth token if omitted
 *     "idempotency_key": "string", // optional
 *     "shadow_reason": "string"    // optional, for audit trail
 *   }
 *
 * Safety:
 *   - This function is explicitly shadow/dev-only
 *   - It writes a shadow_start marker into workflow metadata
 *   - It does NOT modify documents table or production processing status
 *   - Production uploads continue using process-document exclusively
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  ServiceError,
  startWorkflowRunMaterialization,
} from "../workflow-start/materialization-service.ts";
import type { StartWorkflowRunRequest } from "../workflow-start/contracts.ts";

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

interface ShadowStartRequestBody {
  definition_key?: string;
  document_id?: string;
  user_id?: string | null;
  idempotency_key?: string | null;
  shadow_reason?: string;
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

    let body: ShadowStartRequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonResponse({ error: "Request body must be a JSON object" }, 400);
    }

    const definitionKey = typeof body.definition_key === "string"
      ? body.definition_key.trim()
      : "document_processing_v1";

    if (!definitionKey) {
      return jsonResponse({ error: "definition_key is required" }, 400);
    }

    // Resolve user from auth token if not provided
    let userId: string | null = null;
    if (typeof body.user_id === "string") {
      userId = body.user_id;
    } else {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id ?? null;
      }
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Build input payload with shadow metadata
    const inputPayload: Record<string, unknown> = {
      shadow_mode: true,
      shadow_reason: body.shadow_reason ?? "manual_shadow_start",
      shadow_started_at: new Date().toISOString(),
    };

    if (body.document_id) {
      inputPayload.document_id = body.document_id;

      // Fetch document metadata for the workflow context (read-only, no mutations)
      const { data: doc } = await serviceClient
        .from("documents")
        .select("id, file_name, file_type, mime_type, file_size, storage_path, project_id, user_id")
        .eq("id", body.document_id)
        .maybeSingle();

      if (doc) {
        inputPayload.document = {
          id: doc.id,
          file_name: doc.file_name,
          file_type: doc.file_type,
          mime_type: doc.mime_type,
          file_size: doc.file_size,
          storage_path: doc.storage_path,
          project_id: doc.project_id,
          user_id: doc.user_id,
        };
      }
    }

    const request: StartWorkflowRunRequest = {
      definition_key: definitionKey,
      input_payload: inputPayload,
      user_id: userId,
      trigger_entity_type: body.document_id ? "document" : null,
      trigger_entity_id: body.document_id ?? null,
      idempotency_key: body.idempotency_key ?? null,
      create_initial_context_snapshot: true,
    };

    const result = await startWorkflowRunMaterialization(
      serviceClient,
      request,
      userId
    );

    return jsonResponse({
      ...result,
      shadow_mode: true,
      message: `Shadow workflow run created. ${result.message}`,
    }, 200);
  } catch (error) {
    if (error instanceof ServiceError) {
      return jsonResponse({ error: error.message, shadow_mode: true }, error.status);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("workflow-shadow-start error:", message);
    return jsonResponse({ error: message, shadow_mode: true }, 500);
  }
});
