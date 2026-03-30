// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type {
  JsonObject,
  JsonValue,
  StartWorkflowRunRequest,
  StartWorkflowRunResponse,
  WorkflowActivityRecord,
  WorkflowDefinitionRecord,
  WorkflowDefinitionVersionRecord,
} from "./contracts.ts";

class ServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toObject(value: JsonValue | null | undefined): JsonObject {
  return isJsonObject(value ?? undefined) ? (value as JsonObject) : {};
}

function resolveInitialContext(defaultContext: JsonValue, inputPayload: JsonValue): JsonObject {
  const baseContext = toObject(defaultContext);

  // Phase 2 lock: deterministic shallow merge, input keys override defaults.
  if (isJsonObject(inputPayload)) {
    return {
      ...baseContext,
      ...inputPayload,
    };
  }

  return baseContext;
}

async function resolveStartableDefinitionAndVersion(
  supabase: SupabaseClient,
  definitionKey: string
): Promise<{
  definition: WorkflowDefinitionRecord;
  version: WorkflowDefinitionVersionRecord;
  activities: WorkflowActivityRecord[];
}> {
  const { data: definition, error: definitionError } = await supabase
    .from("workflow_definitions")
    .select("id, key, status")
    .eq("key", definitionKey)
    .maybeSingle();

  if (definitionError) {
    throw new ServiceError(`Failed to resolve definition: ${definitionError.message}`, 500);
  }

  if (!definition) {
    throw new ServiceError(`Workflow definition not found for key: ${definitionKey}`, 404);
  }

  if (definition.status !== "active") {
    throw new ServiceError(
      `Workflow definition is not startable. Expected status active, got ${definition.status}`,
      409
    );
  }

  const { data: versions, error: versionError } = await supabase
    .from("workflow_definition_versions")
    .select("id, workflow_definition_id, version, is_current, default_context")
    .eq("workflow_definition_id", definition.id)
    .eq("is_current", true)
    .limit(2);

  if (versionError) {
    throw new ServiceError(`Failed to resolve current version: ${versionError.message}`, 500);
  }

  if (!versions || versions.length === 0) {
    throw new ServiceError(`No current workflow version found for definition key: ${definitionKey}`, 409);
  }

  if (versions.length > 1) {
    throw new ServiceError(
      `Multiple current versions found for definition key: ${definitionKey}. Refusing ambiguous start.`,
      409
    );
  }

  const version = versions[0] as WorkflowDefinitionVersionRecord;

  const { data: activities, error: activityError } = await supabase
    .from("workflow_activities")
    .select(
      "id, key, name, handler_key, is_entry, is_terminal, is_optional, retry_max_attempts, retry_backoff_seconds, retry_backoff_multiplier, execution_priority"
    )
    .eq("version_id", version.id)
    .order("created_at", { ascending: true });

  if (activityError) {
    throw new ServiceError(`Failed to load workflow activities: ${activityError.message}`, 500);
  }

  if (!activities || activities.length === 0) {
    throw new ServiceError(
      `Workflow version ${version.id} has no activities and is not startable`,
      409
    );
  }

  const hasEntryActivity = activities.some((activity) => activity.is_entry === true);
  if (!hasEntryActivity) {
    throw new ServiceError(
      `Workflow version ${version.id} has no entry activities and is not startable`,
      409
    );
  }

  return {
    definition: definition as WorkflowDefinitionRecord,
    version,
    activities: activities as WorkflowActivityRecord[],
  };
}

async function findIdempotentRun(
  supabase: SupabaseClient,
  definitionId: string,
  userId: string,
  idempotencyKey: string
): Promise<StartWorkflowRunResponse | null> {
  const { data: existingRun, error } = await supabase
    .from("workflow_runs")
    .select("id, workflow_definition_id, version_id, status, metadata")
    .eq("workflow_definition_id", definitionId)
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new ServiceError(`Failed to check idempotency: ${error.message}`, 500);
  }

  if (!existingRun) {
    return null;
  }

  const materialization =
    typeof existingRun.metadata === "object" &&
    existingRun.metadata !== null &&
    !Array.isArray(existingRun.metadata)
      ? (existingRun.metadata as Record<string, unknown>).materialization
      : undefined;

  let createdActivityRunCount = 0;
  let queuedEntryActivityCount = 0;

  if (
    typeof materialization === "object" &&
    materialization !== null &&
    !Array.isArray(materialization)
  ) {
    createdActivityRunCount = Number(
      (materialization as Record<string, unknown>).created_activity_run_count ?? 0
    );
    queuedEntryActivityCount = Number(
      (materialization as Record<string, unknown>).queued_entry_activity_count ?? 0
    );
  } else {
    const [{ count: totalCount, error: totalCountError }, { count: queuedCount, error: queuedCountError }] =
      await Promise.all([
        supabase
          .from("activity_runs")
          .select("id", { count: "exact", head: true })
          .eq("workflow_run_id", existingRun.id),
        supabase
          .from("activity_runs")
          .select("id", { count: "exact", head: true })
          .eq("workflow_run_id", existingRun.id)
          .eq("status", "queued"),
      ]);

    if (totalCountError || queuedCountError) {
      throw new ServiceError("Failed to inspect idempotent workflow run activity counts", 500);
    }

    createdActivityRunCount = totalCount ?? 0;
    queuedEntryActivityCount = queuedCount ?? 0;
  }

  return {
    workflow_run_id: existingRun.id,
    workflow_definition_id: existingRun.workflow_definition_id,
    version_id: existingRun.version_id,
    status: existingRun.status,
    created_activity_run_count: createdActivityRunCount,
    queued_entry_activity_count: queuedEntryActivityCount,
    idempotent_reuse: true,
    message: "Reused existing workflow run for idempotency key",
  };
}

export async function startWorkflowRunMaterialization(
  supabase: SupabaseClient,
  request: StartWorkflowRunRequest,
  userId: string | null
): Promise<StartWorkflowRunResponse> {
  const definitionKey = request.definition_key.trim();
  const inputPayload = request.input_payload ?? {};

  const { definition, version, activities } = await resolveStartableDefinitionAndVersion(
    supabase,
    definitionKey
  );

  const idempotencyKey = request.idempotency_key?.trim() || null;
  if (idempotencyKey && !userId) {
    throw new ServiceError("idempotency_key requires user_id for scoped idempotency", 400);
  }

  if (idempotencyKey && userId) {
    const reused = await findIdempotentRun(supabase, definition.id, userId, idempotencyKey);
    if (reused) {
      return reused;
    }
  }

  const nowIso = new Date().toISOString();
  const initialContext = resolveInitialContext(version.default_context, inputPayload);

  const queuedEntryActivities = activities.filter((activity) => activity.is_entry);

  let createdWorkflowRunId: string | null = null;

  try {
    const { data: workflowRun, error: workflowRunError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_definition_id: definition.id,
        version_id: version.id,
        user_id: userId,
        trigger_entity_type: request.trigger_entity_type ?? null,
        trigger_entity_id: request.trigger_entity_id ?? null,
        idempotency_key: idempotencyKey,
        input_payload: inputPayload,
        context: initialContext,
        status: "running",
        started_at: nowIso,
        metadata: {
          materialization: {
            source: "edge_function:workflow-start",
            created_at: nowIso,
            definition_key: definition.key,
            version_id: version.id,
            created_activity_run_count: activities.length,
            queued_entry_activity_count: queuedEntryActivities.length,
          },
        },
      })
      .select("id, workflow_definition_id, version_id, status")
      .single();

    if (workflowRunError || !workflowRun) {
      throw new ServiceError(
        `Failed to create workflow run: ${workflowRunError?.message ?? "unknown error"}`,
        500
      );
    }

    createdWorkflowRunId = workflowRun.id;

    const activityRows = activities.map((activity) => ({
      workflow_run_id: workflowRun.id,
      version_id: version.id,
      activity_id: activity.id,
      activity_key: activity.key,
      activity_name: activity.name,
      handler_key: activity.handler_key,
      status: activity.is_entry ? "queued" : "pending",
      max_attempts: activity.retry_max_attempts,
      retry_backoff_seconds: activity.retry_backoff_seconds,
      retry_backoff_multiplier: activity.retry_backoff_multiplier,
      is_terminal: activity.is_terminal,
      is_optional: activity.is_optional,
      execution_priority: activity.execution_priority,
      scheduled_at: activity.is_entry ? nowIso : null,
      metadata: {
        materialization_source: "workflow_start",
        is_entry: activity.is_entry,
      },
    }));

    const { data: insertedActivityRuns, error: activityInsertError } = await supabase
      .from("activity_runs")
      .insert(activityRows)
      .select("id, activity_id, activity_key, status");

    if (activityInsertError || !insertedActivityRuns) {
      throw new ServiceError(
        `Failed to create activity runs: ${activityInsertError?.message ?? "unknown error"}`,
        500
      );
    }

    if (insertedActivityRuns.length !== activities.length) {
      throw new ServiceError(
        `Activity run materialization mismatch: expected ${activities.length}, created ${insertedActivityRuns.length}`,
        500
      );
    }

    const entryByActivityId = new Map(
      queuedEntryActivities.map((activity) => [activity.id, activity.key])
    );

    const createdEvents: Array<Record<string, unknown>> = [
      {
        workflow_run_id: workflowRun.id,
        event_type: "workflow_created",
        actor: "orchestrator",
        details: {
          definition_key: definition.key,
          version_id: version.id,
          trigger_entity_type: request.trigger_entity_type ?? null,
          trigger_entity_id: request.trigger_entity_id ?? null,
          source: "workflow_materialization",
        },
      },
      {
        workflow_run_id: workflowRun.id,
        event_type: "workflow_started",
        actor: "orchestrator",
        details: {
          definition_key: definition.key,
          version_id: version.id,
          source: "workflow_materialization",
          queued_entry_activity_count: queuedEntryActivities.length,
        },
      },
    ];

    for (const activityRun of insertedActivityRuns) {
      if (activityRun.status !== "queued") {
        continue;
      }

      createdEvents.push({
        workflow_run_id: workflowRun.id,
        activity_run_id: activityRun.id,
        event_type: "activity_queued",
        actor: "orchestrator",
        details: {
          source: "initial_materialization",
          activity_id: activityRun.activity_id,
          activity_key: entryByActivityId.get(activityRun.activity_id) ?? activityRun.activity_key,
        },
      });
    }

    const { error: eventsError } = await supabase.from("workflow_events").insert(createdEvents);
    if (eventsError) {
      throw new ServiceError(`Failed to write initial workflow events: ${eventsError.message}`, 500);
    }

    if (request.create_initial_context_snapshot !== false) {
      const { error: snapshotError } = await supabase
        .from("workflow_context_snapshots")
        .insert({
          workflow_run_id: workflowRun.id,
          activity_run_id: null,
          snapshot_context: initialContext,
          reason: "initial_materialization",
        });

      if (snapshotError) {
        throw new ServiceError(
          `Failed to write initial workflow context snapshot: ${snapshotError.message}`,
          500
        );
      }
    }

    return {
      workflow_run_id: workflowRun.id,
      workflow_definition_id: workflowRun.workflow_definition_id,
      version_id: workflowRun.version_id,
      status: workflowRun.status,
      created_activity_run_count: insertedActivityRuns.length,
      queued_entry_activity_count: queuedEntryActivities.length,
      idempotent_reuse: false,
      message: "Workflow run created and materialized",
    };
  } catch (error) {
    // Equivalent atomicity safety: if any step fails after creating workflow_run,
    // delete the run so cascades remove partial activity/event/snapshot rows.
    if (createdWorkflowRunId) {
      await supabase.from("workflow_runs").delete().eq("id", createdWorkflowRunId);
    }

    throw error;
  }
}

export { ServiceError };
