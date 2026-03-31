// @ts-nocheck
/**
 * workflow-maintenance
 *
 * Cron-triggered maintenance worker for stale lease recovery.
 * This is a self-contained edge function that scans for stale
 * claimed/running activities with expired leases and recovers them.
 *
 * Simplified inline implementation to avoid cross-function import issues
 * with the edge function bundler.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

interface MaintenanceRequest {
  max_records?: number;
  stale_before_seconds?: number;
  dry_run?: boolean;
  actor?: string;
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
      return jsonResponse({ error: "Supabase environment variables are not configured" }, 500);
    }

    let body: MaintenanceRequest = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const maxRecords = clampInt(body.max_records, 1, 500, 50);
    const staleBeforeSeconds = clampInt(body.stale_before_seconds, 0, 86400, 0);
    const dryRun = body.dry_run === true;
    const actor = (typeof body.actor === "string" ? body.actor.trim() : "") || "maintenance-cron";

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const staleCutoffIso = new Date(Date.now() - staleBeforeSeconds * 1000).toISOString();

    // Find stale activities with expired leases
    const { data: staleRows, error: staleError } = await supabase
      .from("activity_runs")
      .select(
        "id, workflow_run_id, activity_key, status, attempt_count, max_attempts, retry_backoff_seconds, retry_backoff_multiplier, is_optional, claimed_by, claimed_at, started_at, lease_expires_at"
      )
      .in("status", ["claimed", "running"])
      .not("lease_expires_at", "is", null)
      .lte("lease_expires_at", staleCutoffIso)
      .order("lease_expires_at", { ascending: true })
      .limit(maxRecords);

    if (staleError) {
      return jsonResponse({ error: `Failed to query stale activities: ${staleError.message}` }, 500);
    }

    const stale = staleRows ?? [];
    if (stale.length === 0) {
      return jsonResponse({
        scanned_count: 0,
        stale_found_count: 0,
        recovered_count: 0,
        failed_count: 0,
        dry_run: dryRun,
        message: "No stale activities found",
      });
    }

    if (dryRun) {
      return jsonResponse({
        scanned_count: stale.length,
        stale_found_count: stale.length,
        recovered_count: 0,
        failed_count: 0,
        dry_run: true,
        stale_activities: stale.map(s => ({
          id: s.id,
          activity_key: s.activity_key,
          status: s.status,
          attempt_count: s.attempt_count,
          max_attempts: s.max_attempts,
          lease_expires_at: s.lease_expires_at,
        })),
        message: `Dry run: found ${stale.length} stale activities`,
      });
    }

    let recoveredCount = 0;
    let failedCount = 0;
    const touchedWorkflowIds = new Set<string>();
    const touchedActivityIds: string[] = [];

    for (const row of stale) {
      const hasRetryBudget = row.attempt_count < row.max_attempts;
      const nowIso = new Date().toISOString();

      if (row.status === "claimed" && hasRetryBudget) {
        // Recover stale claimed → queued (re-attempt)
        const { data: updated, error: updateErr } = await supabase
          .from("activity_runs")
          .update({
            status: "queued",
            claimed_by: null,
            claimed_at: null,
            lease_expires_at: null,
            started_at: null,
            scheduled_at: nowIso,
            error_message: "Recovered stale claimed activity after lease expiry",
            error_details: {
              recovery_action: "recover_to_queued",
              previous_status: row.status,
              previous_claimed_by: row.claimed_by,
              actor,
              source: "maintenance_cron",
            },
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .eq("status", "claimed")
          .select("id");

        if (!updateErr && updated && updated.length > 0) {
          recoveredCount++;
          touchedActivityIds.push(row.id);
          touchedWorkflowIds.add(row.workflow_run_id);

          // Log recovery event
          await supabase.from("workflow_events").insert({
            workflow_run_id: row.workflow_run_id,
            activity_run_id: row.id,
            event_type: "activity_retrying",
            actor,
            details: {
              recovery_action: "recover_to_queued",
              previous_status: "claimed",
              source: "maintenance_cron",
            },
          });
        }
      } else if (row.status === "running" && hasRetryBudget) {
        // Recover stale running → waiting_retry
        const backoffSeconds = row.retry_backoff_seconds * Math.pow(row.retry_backoff_multiplier, row.attempt_count - 1);
        const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

        const { data: updated, error: updateErr } = await supabase
          .from("activity_runs")
          .update({
            status: "waiting_retry",
            claimed_by: null,
            claimed_at: null,
            lease_expires_at: null,
            next_retry_at: nextRetryAt,
            error_message: "Recovered stale running activity after lease expiry",
            error_details: {
              recovery_action: "recover_to_waiting_retry",
              previous_status: row.status,
              actor,
              source: "maintenance_cron",
            },
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .eq("status", "running")
          .select("id");

        if (!updateErr && updated && updated.length > 0) {
          recoveredCount++;
          touchedActivityIds.push(row.id);
          touchedWorkflowIds.add(row.workflow_run_id);

          await supabase.from("workflow_events").insert({
            workflow_run_id: row.workflow_run_id,
            activity_run_id: row.id,
            event_type: "activity_retrying",
            actor,
            details: {
              recovery_action: "recover_to_waiting_retry",
              previous_status: "running",
              next_retry_at: nextRetryAt,
              source: "maintenance_cron",
            },
          });
        }
      } else {
        // No retry budget → fail terminal
        const { error: updateErr } = await supabase
          .from("activity_runs")
          .update({
            status: "failed",
            claimed_by: null,
            claimed_at: null,
            lease_expires_at: null,
            finished_at: nowIso,
            error_message: "Stale activity exceeded retry budget",
            error_details: {
              recovery_action: "fail_terminal",
              previous_status: row.status,
              attempt_count: row.attempt_count,
              max_attempts: row.max_attempts,
              actor,
              source: "maintenance_cron",
            },
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .in("status", ["claimed", "running"]);

        if (!updateErr) {
          failedCount++;
          touchedActivityIds.push(row.id);
          touchedWorkflowIds.add(row.workflow_run_id);

          await supabase.from("workflow_events").insert({
            workflow_run_id: row.workflow_run_id,
            activity_run_id: row.id,
            event_type: "activity_failed",
            actor,
            details: {
              recovery_action: "fail_terminal",
              reason: "retry_budget_exhausted_stale",
              source: "maintenance_cron",
            },
          });
        }
      }
    }

    const message = `Recovery complete: ${recoveredCount} recovered, ${failedCount} failed terminal, ${stale.length} scanned`;
    console.log(`[maintenance] ${message}`);

    return jsonResponse({
      scanned_count: stale.length,
      stale_found_count: stale.length,
      recovered_count: recoveredCount,
      failed_count: failedCount,
      workflow_run_ids_touched: Array.from(touchedWorkflowIds),
      activity_run_ids_touched: touchedActivityIds,
      dry_run: false,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("workflow-maintenance error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
