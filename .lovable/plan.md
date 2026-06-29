## Plant Advisor — Phase 1

A new top-level section in the app for managing plant cases (identification, diagnosis, growth, income goals). Phase 1 is scaffolding only — no external plant APIs, no AI image analysis.

### 1. Database (single migration)

Create two private tables with RLS scoped to `auth.uid() = user_id`.

```sql
-- plant_cases
CREATE TABLE public.plant_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  notebook_id uuid REFERENCES public.notebooks(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready_for_identification','identified','diagnosed','treated','archived')),
  user_goal text
    CHECK (user_goal IS NULL OR user_goal IN ('identify','diagnose','improve_growth','increase_income')),
  location_text text,
  crop_context text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- plant_case_images
CREATE TABLE public.plant_case_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  storage_path text NOT NULL,
  image_role text NOT NULL DEFAULT 'auto'
    CHECK (image_role IN ('auto','whole_plant','leaf','flower','fruit','bark','stem','root','other')),
  original_filename text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

GRANTs to `authenticated`/`service_role`, RLS enabled, owner-only policies on both, plus `updated_at` trigger on `plant_cases`.

### 2. Storage

Private bucket `plant-case-images` via `supabase--storage_create_bucket`. Path format `plant-cases/{userId}/{caseId}/{imageId}-{safeFilename}`. Storage RLS policies restrict object access to owner (path prefix matches `auth.uid()`). UI uses signed URLs for previews.

### 3. Navigation & routing

- Add `plant-advisor` to `ActiveView` union in `src/contexts/AppContext.tsx`.
- Add sidebar entry in `AppSidebar.tsx` with `Sprout` icon, after Notebooks.
- Add `i18n` keys `sidebar.plantAdvisor`.
- Render `<PlantAdvisorView />` in `src/pages/Index.tsx` when view is `plant-advisor`.

### 4. New components (`src/components/plant-advisor/`)

- `PlantAdvisorView.tsx` — view router (dashboard | new case | case detail).
- `PlantAdvisorDashboard.tsx` — header, "New Plant Scan" CTA, 4 goal cards, recent cases grid, empty state.
- `PlantCaseForm.tsx` — title, goal select, optional location/crop/notes, embedded `PlantImageUploader`.
- `PlantImageUploader.tsx` — multi-file picker, previews, per-image role select, delete, 10 MB limit, mime check.
- `PlantCaseCard.tsx` — card for recent list, thumbnail + meta.
- `PlantCaseDetail.tsx` — case data, images grid with role editor, delete, "Ask about this plant case" button.
- `PlantCaseChatPanel.tsx` — reuses existing chat UI shell; injects a system note that image identification is not yet available and only notes/context can be discussed.

### 5. Hooks (`src/hooks/`)

- `usePlantCases.ts` — list/create/update/delete via supabase client + react-query.
- `usePlantCaseImages.ts` — list/upload/delete; computes signed URLs for previews.

### 6. Chat integration

Reuse existing chat shell. Phase 1: a lightweight in-component chat using the existing `ChatInput` / `ChatMessage` components, persisted in local state for the session (no DB chat row required this phase). The first assistant message clearly states the limitation. Plant case metadata + image roles are appended as a context block to outbound prompts so the backend can use them, but no plant-specific prompt engineering yet.

### 7. i18n

Add keys in `en.json` and `sr.json`:
- `plantAdvisor.title`, `.subtitle`, `.newScan`, `.recentCases`, `.empty`, `.askAbout`, `.uploadImages`
- `plantAdvisor.goals.{identify,diagnose,improveGrowth,increaseIncome}`
- `plantAdvisor.roles.{auto,whole_plant,leaf,flower,fruit,bark,stem,root,other}`

### 8. Out of scope (Phase 1)

No Pl@ntNet/Perenual/Trefle/Kindwise calls. No image AI. No treatment generation. No vector ingestion of plant images.

### Acceptance

Create case → upload images → assign roles → save → reopen → delete → open chat (with disclaimer). RLS verified. Build/lint/typecheck pass.
