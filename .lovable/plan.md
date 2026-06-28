# Model Family + Thinking Level

Replace the flat model picker with a structured **Model family + Intelligence (thinking level)** preference, backed by a single shared catalog and a resolver that the frontend and backend both consume.

## 1. Shared catalog — `src/config/modelCatalog.ts`

Single source of truth. Re-export from `modelOptions.ts` for back-compat so nothing else breaks.

```ts
type PlanTier = "free" | "basic" | "premium" | "enterprise";
type ModelFamily = "auto" | "gemini" | "gpt" | "gemma";
type ThinkingLevel = "low" | "medium" | "high";

interface ModelCatalogEntry {
  id: string;                       // raw provider id, e.g. "openai/gpt-5.5"
  provider: "lovable_gateway" | "google_direct";
  family: Exclude<ModelFamily, "auto">;
  label: string;
  planTiers: PlanTier[];
  supportedThinkingLevels: ThinkingLevel[];
  defaultThinkingLevel: ThinkingLevel;
  nativeThinking: boolean;
  costTier: "low" | "medium" | "high" | "premium";
  fallbackIds: string[];
}
```

Includes every currently exposed model (gemini 2.5 family + 3.5-flash, all gpt-5.x, gemma-4, gemini-3.1). Plan availability mirrors current `planLimits.ts` so nothing widens or narrows by accident.

Per-family tier mapping used by the resolver:

| Family | low | medium | high |
|---|---|---|---|
| gemini | `google/gemini-2.5-flash-lite` | `google/gemini-2.5-flash` | `google/gemini-2.5-pro` |
| gpt | `openai/gpt-5-mini` | `openai/gpt-5.4-mini` (or `gpt-5-mini` for non-premium) | `openai/gpt-5.5-pro` (downgrades to `gpt-5.5` / `gpt-5` based on plan) |
| gemma | `gemma-4` (only) | `gemma-4` | `gemma-4` — selector disabled |
| auto | existing fast route | existing balanced router | existing pro route |

## 2. Resolver — `src/lib/modelPreferenceResolver.ts`

Pure function shared by client and edge function (mirrored into `supabase/functions/_shared/ai/modelPreferenceResolver.ts` since edge can't import from `src/`).

Inputs: `{ family, thinkingLevel }`, `plan`, optional routing context (prompt/context size — only used when `family === "auto"`).
Outputs: `{ resolvedModelId, resolvedProvider, appliedThinkingLevel, nativeThinking, fallbackIds, reason }`.

Rules:
- `family === "auto"` → defer to existing `resolveModelDecision` in `task-model-config.ts`, with thinking level biasing the tier (low→flash-lite, medium→flash, high→pro).
- Explicit family → pick the tier model. If gated by plan, downgrade within family; if no in-family option, fall back to auto (`reason: "plan_downgraded"`).
- Gemma → always medium, `appliedThinkingLevel: "medium"`, `nativeThinking: false`.

## 3. User settings

Add columns via migration to `user_settings`:
- `preferred_model_family text default 'auto'`
- `preferred_thinking_level text default 'medium'`

Keep `preferred_model` for back-compat. On first read, if new fields are null but `preferred_model` is set, infer family from the id prefix and infer level from the catalog entry; persist on next save. `useUserSettings.ts` exposes new fields and the migration helper.

## 4. Frontend picker

Refactor the model menu in `src/components/chat/ChatInput.tsx` (currently a flat `Select`) into a `DropdownMenu` with two submenus:

- **Intelligence** → Instant / Medium / High (radio).
- **Model family** → Auto / Gemini / GPT / Gemma (radio).

Trigger label shows `<Level> · <Resolved model name>`, e.g. `Medium · GPT-5.4-mini`. A muted line under the trigger shows `Resolved model: …` via the resolver.

Plan-gated options remain visible but `disabled` with a "Premium" / "Basic+" badge. When Gemma is selected, the Intelligence submenu items are disabled (medium pre-selected) with hint text.

Both Project Chat and Notebook Chat use the same `ChatInput`, so this is one change.

## 5. Request payload

`useAIChat.ts` and `useNotebookChat.ts` send:

```ts
modelPreference: { family, thinkingLevel }
model: resolvedModelId   // kept for back-compat; backend prefers modelPreference
```

## 6. Backend

In `supabase/functions/chat/index.ts` (and `notebook-scope-check` if it routes models):

- Accept optional `modelPreference`. When present, run the shared resolver server-side (re-enforces plan from `profiles.plan`). Ignore client-sent `model` when `modelPreference` is provided.
- Existing fallback chain (`failover.ts`) is untouched — `resolvedModelId` is the new entry point.
- Gemini direct (`gemini31-provider.ts`) and Gemma (`gemma4-provider.ts`): map `appliedThinkingLevel` to their thinking-budget config (low=small, medium=default, high=large). Lovable Gateway GPT calls: pass `reasoning_effort` when the model supports it; otherwise rely on tier choice.
- Persist into message `metadata`: `requestedFamily, requestedThinkingLevel, resolvedModelId, finalModelId, fallbackUsed, appliedThinkingLevel, nativeThinking, decisionReason`.

The existing `CHAT_MODEL_ALLOWLIST` is replaced with "id must exist in shared catalog AND be allowed for plan."

## 7. i18n

Add keys under `chat.modelPicker.*`: intelligence/instant/medium/high, family/auto/gemini/gpt/gemma, resolvedModel, gemmaSingleLevelHint, premiumOnly, basicOrAbove. EN + SR.

## 8. Tests

`src/test/modelPreferenceResolver.test.ts`:
- Each family × level resolves to expected id on Premium.
- Free plan + GPT/high → downgrades within plan or auto, reason `plan_downgraded`.
- Basic plan + GPT-5.4 → downgrades to `gpt-5-mini`.
- Gemma always medium.
- Auto + level still calls existing router and respects level bias.
- Legacy `preferred_model` migration helper produces correct family/level.

## 9. Deploy & QA

Deploy `chat` edge function. Manual QA matrix from the spec (Free/Basic/Premium × Auto/Gemini/GPT/Gemma × Instant/Medium/High), verify message metadata, verify fallback by forcing one provider error.

## Out of scope

- No new "advanced raw model" picker (per recommendation).
- No thought-summary UI.
- Image/audio model selection unchanged.

## Files touched

- New: `src/config/modelCatalog.ts`, `src/lib/modelPreferenceResolver.ts`, `supabase/functions/_shared/ai/modelPreferenceResolver.ts`, `src/test/modelPreferenceResolver.test.ts`, migration for `user_settings`.
- Edit: `src/config/modelOptions.ts` (re-export), `src/lib/planLimits.ts` (read from catalog), `src/hooks/useUserSettings.ts`, `src/components/chat/ChatInput.tsx`, `src/hooks/useAIChat.ts`, `src/hooks/useNotebookChat.ts`, `supabase/functions/chat/index.ts`, `supabase/functions/_shared/ai/task-model-config.ts`, `supabase/functions/_shared/ai/gemini31-provider.ts`, `supabase/functions/_shared/ai/gemma4-provider.ts`, `src/i18n/locales/{en,sr}.json`.
