// @ts-nocheck
// Plant Case Research quota + persistence gate.
//
// Plant Case Research is limited to ONE run per user per calendar day, across
// all plant cases. Quota enforcement lives here (service role) so the browser
// cannot bypass it: `plant_case_research_runs` is not writable by authenticated
// clients, and the pinned research message is written by this function only.
//
// Actions:
//   { action: "reserve",  caseId }                     -> { runId, runDate }
//   { action: "complete", runId, caseId, content, metadata } -> { message }
//   { action: "fail",     runId, reason? }             -> { ok: true }
//
// A run starts as `status = 'started'`, becomes `completed` on a saved answer,
// and `failed` when research or persistence fails. The daily unique index only
// covers non-failed runs, so a failed attempt does NOT consume the daily quota.
//
// `runDate` is the *browser-local* calendar day supplied by the client on
// purpose: the product meaning of the limit is "one run per user per local day".
// It is validated to be within +/- 1 day of the server's UTC date so it cannot
// be used to mint extra runs.
//
// The Tavily research call itself still streams from the client via
// `tavily-research` (deep research can run for minutes, longer than an edge
// function invocation should hold open, and the live trace UI depends on the
// stream). Without a `started` run reserved here, no research answer can be
// persisted, so the daily limit remains server-enforced.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/auth/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Runs stuck in `started` for longer than this are treated as failed. */
const STALE_RUN_MINUTES = 20;
const MAX_CONTENT_LENGTH = 200_000;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Accept only a local day within +/-1 day of the server's UTC day. */
function resolveRunDate(input: unknown): string {
  const serverDay = new Date().toISOString().slice(0, 10);
  if (!isIsoDate(input)) return serverDay;
  const requested = Date.parse(`${input}T00:00:00Z`);
  const server = Date.parse(`${serverDay}T00:00:00Z`);
  if (Number.isNaN(requested)) return serverDay;
  return Math.abs(requested - server) <= 24 * 60 * 60 * 1000 ? input : serverDay;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);

  const auth = await requireUser(req, corsHeaders);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Server misconfigured" }, 500);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";

  // Which Plant Advisor research flow this run belongs to. All types share one
  // daily quota; the type decides the required case goal and the pinned message
  // kind, plus whether a confirmed diagnosis is also required.
  const RESEARCH_TYPES = {
    plant_research: { goal: "identify", messageKind: "research", needsDiagnosis: false },
    income_research: {
      goal: "increase_income",
      messageKind: "income_research",
      needsDiagnosis: false,
    },
    problem_research: {
      goal: "diagnose",
      messageKind: "problem_research",
      needsDiagnosis: true,
    },
  } as const;
  type ResearchTypeKey = keyof typeof RESEARCH_TYPES;
  const researchType: ResearchTypeKey =
    body.researchType === "income_research"
      ? "income_research"
      : body.researchType === "problem_research"
        ? "problem_research"
        : "plant_research";
  const researchConfig = RESEARCH_TYPES[researchType];

  // -------------------------------------------------------------------------
  // reserve
  // -------------------------------------------------------------------------
  if (action === "reserve") {
    const caseId = typeof body.caseId === "string" ? body.caseId : "";
    if (!caseId) return json({ error: "caseId is required" }, 400);
    const runDate = resolveRunDate(body.runDate);

    const { data: plantCase, error: caseErr } = await admin
      .from("plant_cases")
      .select("id, user_id, user_goal")
      .eq("id", caseId)
      .maybeSingle();
    if (caseErr) return json({ error: caseErr.message }, 500);
    if (!plantCase || plantCase.user_id !== userId) return json({ error: "case_not_found" }, 404);
    if (plantCase.user_goal !== researchConfig.goal) {
      return json({ error: "research_not_available" }, 400);
    }

    const { data: confirmed, error: identErr } = await admin
      .from("plant_identifications")
      .select("id")
      .eq("case_id", caseId)
      .eq("is_confirmed", true)
      .limit(1);
    if (identErr) return json({ error: identErr.message }, 500);
    if (!confirmed || confirmed.length === 0) return json({ error: "needs_confirmed_plant" }, 409);

    // Problem research is grounded in the CONFIRMED diagnosis only.
    if (researchConfig.needsDiagnosis) {
      const { data: confirmedDiag, error: diagErr } = await admin
        .from("plant_diagnoses")
        .select("id")
        .eq("case_id", caseId)
        .eq("is_confirmed", true)
        .limit(1);
      if (diagErr) return json({ error: diagErr.message }, 500);
      if (!confirmedDiag || confirmedDiag.length === 0) {
        return json({ error: "needs_confirmed_diagnosis" }, 409);
      }
    }


    // Release runs abandoned mid-flight (browser closed, network drop).
    const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
    await admin
      .from("plant_case_research_runs")
      .update({ status: "failed", metadata: { failure: "stale" } })
      .eq("user_id", userId)
      .eq("status", "started")
      .lt("created_at", staleBefore);

    const { data: run, error: insertErr } = await admin
      .from("plant_case_research_runs")
      .insert({
        user_id: userId,
        case_id: caseId,
        run_date: runDate,
        status: "started",
        metadata: { researchType },
      })
      .select("id, run_date, status")
      .single();

    if (insertErr) {
      // Unique index on (user_id, run_date) WHERE status <> 'failed'
      if (insertErr.code === "23505") return json({ error: "quota_exhausted" }, 429);
      return json({ error: insertErr.message }, 500);
    }
    return json({ runId: run.id, runDate: run.run_date });
  }


  // -------------------------------------------------------------------------
  // complete — persist (or replace) the pinned research message
  // -------------------------------------------------------------------------
  if (action === "complete") {
    const runId = typeof body.runId === "string" ? body.runId : "";
    const caseId = typeof body.caseId === "string" ? body.caseId : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const metadata =
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : {};
    if (!runId || !caseId) return json({ error: "runId and caseId are required" }, 400);
    if (!content) return json({ error: "content is required" }, 400);
    if (content.length > MAX_CONTENT_LENGTH) return json({ error: "content too large" }, 400);

    const { data: run, error: runErr } = await admin
      .from("plant_case_research_runs")
      .select("id, user_id, case_id, status")
      .eq("id", runId)
      .maybeSingle();
    if (runErr) return json({ error: runErr.message }, 500);
    if (!run || run.user_id !== userId || run.case_id !== caseId) {
      return json({ error: "run_not_found" }, 404);
    }
    if (run.status !== "started") return json({ error: "run_not_open" }, 409);

    const messageKind = researchConfig.messageKind;
    const safeMetadata = { ...metadata, kind: messageKind, researchType };

    // Replace the existing pinned research answer of the SAME kind for this
    // case rather than appending a second one.
    const { data: existing, error: existingErr } = await admin
      .from("plant_case_chat_messages")
      .select("id")
      .eq("case_id", caseId)
      .eq("user_id", userId)
      .eq("role", "assistant")
      .eq("metadata->>kind", messageKind)
      .order("created_at", { ascending: false });
    if (existingErr) return json({ error: existingErr.message }, 500);


    let message: unknown = null;
    const keepId = existing?.[0]?.id ?? null;

    if (keepId) {
      const { data, error } = await admin
        .from("plant_case_chat_messages")
        .update({ content, metadata: safeMetadata })
        .eq("id", keepId)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 500);
      message = data;
      const staleIds = (existing ?? []).slice(1).map((r) => r.id);
      if (staleIds.length > 0) {
        await admin.from("plant_case_chat_messages").delete().in("id", staleIds);
      }
    } else {
      const { data, error } = await admin
        .from("plant_case_chat_messages")
        .insert({
          user_id: userId,
          case_id: caseId,
          role: "assistant",
          content,
          metadata: safeMetadata,
        })
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 500);
      message = data;
    }

    await admin
      .from("plant_case_research_runs")
      .update({ status: "completed" })
      .eq("id", runId)
      .eq("user_id", userId);

    return json({ message });
  }

  // -------------------------------------------------------------------------
  // fail — release the daily slot so the user can retry today
  // -------------------------------------------------------------------------
  if (action === "fail") {
    const runId = typeof body.runId === "string" ? body.runId : "";
    if (!runId) return json({ error: "runId is required" }, 400);
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

    const { error } = await admin
      .from("plant_case_research_runs")
      .update({ status: "failed", metadata: reason ? { failure: reason } : {} })
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("status", "started");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
