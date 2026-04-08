Task: Design and implement a new Resources page/dashboard.

Goal
Create a Resources page that becomes the central place to view and manage all user-accessible resources, not just current uploaded documents. It must work well today for document-based resources and be designed cleanly so future resource types can be added without redesigning the page.

Current product need
Today, Resources should show:
- all uploaded documents
- all Project resources
- all Notebook resources
- resources uploaded by the current user
- resources uploaded by collaborators that the current user is allowed to access

Current resource examples:
- PDF
- DOC / DOCX
- XLS / XLSX / CSV
- JPG / JPEG / PNG
- PPTX
- TXT / MD / RTF
- EML / MSG
- XML / JSON / LOG
- any currently supported document/resource item in Projects or Notebooks

Future requirement
The design must be extensible so later we can support additional resource types such as:
- YouTube videos
- podcasts
- MP3 / WAV / audio uploads
- MP4 / MOV / video uploads
- cloud-linked resources from third-party services
- social/media links and external URLs
- future online or synced resource sources

Examples of future source families:
- user-uploaded local files
- cloud drives
- web links
- media platforms
- social platforms
- other connected online services

Important product direction
The Resources page should not be designed as “documents only.”
It should be designed as a generalized resource system with current document support as the first active implementation.

What I want
Please implement a Resources page/dashboard for current resource types and structure it so future resource types can be added with minimal rework.

Part A — Product model and architecture
Please define a generalized resource model that works for both present and future needs.

Requirements:
1. Introduce a clear conceptual distinction between:
- resource
- resource type
- resource source
- resource owner/uploader
- resource visibility/access
- resource container/context (Project, Notebook, standalone/personal)
- resource processing/readiness state

2. Support current realities:
- uploaded documents
- resources attached to Projects
- resources attached to Notebooks
- shared/collaborator-visible resources

3. Support future extensibility:
- uploaded file resources
- linked online resources
- synced external resources
- media resources
- structured resources with previews/metadata/transcripts/etc.

Please choose and document a model that will not paint the app into a “documents only” corner.

Part B — Resources page UX
Create a Resources page/dashboard.

Core page goals:
- show all resources accessible to the user
- unify personal + shared/collaborator resources
- allow filtering by type, source, owner, workspace, status, and readiness
- make current document-heavy usage feel great
- remain visually ready for future resource types

Please include these sections/capabilities:

1. Page header
- title: Resources
- summary counts
- search input
- upload/add resource entry point
- optional future-ready “Connect source” or “Add link” placeholder if appropriate

2. Resource list/grid
Show all accessible resources with good metadata.

For each resource card/row, show as appropriate:
- title / filename
- resource type
- source type (uploaded, linked, synced, etc.)
- file format or media/provider badge
- workspace/container association:
  - personal
  - project name
  - notebook name
- owner/uploader
- last updated
- size if applicable
- status/readiness
- document/resource subtype
- whether shared or personal
- quick actions

3. Filters
At minimum:
- All
- My resources
- Shared with me
- Projects
- Notebooks
- Personal
- Ready
- Processing
- Failed

And typed/source filters such as:
- Documents
- Images
- Spreadsheets
- Presentations
- Text-like
- Email
- Media
- Links
- Uploaded
- Linked
- Synced

Even if some future categories are empty today, the architecture should be able to support them.

4. Search
Search across:
- title/file name
- type
- workspace/container
- owner/uploader
- maybe status/source where practical

5. Sorting
Examples:
- newest
- oldest
- name
- last updated
- type
- status

6. Empty states
Need thoughtful empty states for:
- no resources at all
- no matches after filtering
- no shared resources yet
- no resources of future type categories yet

Part C — Current functionality for today
For the first implementation, populate Resources primarily from existing document/resource tables and access rules.

Today it should include:
- all documents the user owns
- all documents in Projects/Notebooks the user can access through ownership or sharing/collaboration
- resources uploaded by collaborators that the user has permission to see
- document processing/readiness state when applicable

Please use current sharing/RBAC/access logic so Resources respects the same permissions as the rest of the app.

Important:
The page should show accessible resources across:
- private/personal scope
- shared Projects
- shared Notebooks

Part D — Future-ready data model / API shape
Please create or propose a backend shape that works now and later.

Preferred direction:
A normalized resource view/model that can represent both current documents and future external/media/link resources.

One acceptable pattern:
- keep existing document tables intact for now
- add a resource projection layer (view/RPC/service)
- map documents into a generalized resource result shape
- later add more source adapters into the same result shape

For example, define something like:
{
  id,
  resourceKind,
  resourceType,
  sourceType,
  provider,
  title,
  mimeType,
  extension,
  sizeBytes,
  ownerUserId,
  ownerDisplayName,
  containerType,
  containerId,
  containerName,
  sharedScope,
  uploadedAt,
  updatedAt,
  processingStatus,
  readiness,
  previewStatus,
  metadata,
  permissions
}

This is only an example — choose a clean version that fits the codebase.

Part E — Backend implementation
Please implement whatever backend/query layer is needed so the Resources page can load a single, coherent dataset.

Acceptable approaches:
1. SQL view
2. RPC
3. backend aggregation query
4. service-layer projection

Preferred for current phase:
- a unified query/RPC for “all resources visible to current user”
- permission-aware
- efficient enough for dashboard usage
- returns current document/resource fields plus future-ready placeholders

Please include:
- ownership
- shared access
- project/notebook association
- status/readiness
- uploader/owner attribution
- resource type/source grouping

Please do not build this page by making the frontend manually join many unrelated queries if a cleaner backend projection is practical.

Part F — Resource typing and source classification
Please define two separate axes:
1. resource type
   Examples:
   - document
   - image
   - spreadsheet
   - presentation
   - email
   - text
   - audio
   - video
   - link
   - dataset
   - other

2. source type
   Examples:
   - uploaded
   - linked
   - synced
   - generated
   - imported

And optionally:
3. provider/source provider
   Examples:
   - local_upload
   - google_drive
   - youtube
   - dropbox
   - notion
   - internal
   - email_import
   - unknown

This separation matters. A YouTube video and an uploaded MP4 are both video resources, but not the same source type/provider.

Part G — Permissions and collaboration
The Resources page must respect current RBAC and sharing behavior.

Requirements:
- user sees only resources they are allowed to access
- collaborator-uploaded resources appear if the user has access through shared Project/Notebook
- actions shown on each resource must match the user’s permissions
- page should distinguish personal vs shared resources

Please reuse the current shared access model rather than inventing a separate one.

Part H — Status and readiness
Current document processing already has statuses/readiness. Surface that on Resources cleanly.

For current document resources, show:
- processing status
- readiness
- failed/processing/ready states
- useful badges like:
  - Ready
  - Processing
  - Failed
  - Partially ready

For future resource types, design the UI and data shape so status can evolve, for example:
- linked
- syncing
- transcript ready
- indexed
- preview ready
- failed

Do not hardcode Resources to document-only statuses.

Part I — UI details
Please make the Resources page visually useful today and scalable later.

Suggested card/table fields:
- icon/thumbnail based on resource type
- name/title
- owner/uploader
- workspace association
- type badge
- source/provider badge
- status badge
- updated time
- quick actions menu

Suggested views:
- default table/list view for dense management
- optional grid/cards if already easy
- responsive behavior for narrower layouts

Quick actions may include, depending on permissions and current product:
- open
- view in project/notebook
- rename
- delete
- download
- retry processing
- copy link
- show details

Part J — Suggested phased implementation
Please implement in a future-safe but practical way.

Phase 1
- Resources page for current accessible document resources
- unified backend projection
- filters/search/sort
- permission-aware actions
- personal/shared/project/notebook grouping
- readiness/status badges

Phase 2 readiness hooks
- source type/provider architecture
- placeholders or extensibility points for linked/synced/media resources
- code structure ready for future adapters

Do not overbuild future integrations now, but do not design the page in a way that blocks them.

Part K — Concrete deliverables
Please provide and implement:
1. page design and route
2. backend query/RPC/view/service for accessible resources
3. frontend page with filters/search/sort
4. reusable resource type/source/status mapping utilities
5. permission-aware resource actions
6. support for current document/project/notebook resources
7. future-ready resource model notes
8. migration/query changes if needed
9. examples of how future resource types would plug in

Part L — Acceptance criteria
This is complete only when:
1. Resources page exists and is usable
2. User can see all current accessible resources in one place
3. Shared collaborator-uploaded resources appear when permitted
4. Resources are clearly labeled by type/source/container/status
5. Filters/search/sort work
6. UI is not document-only in structure
7. Backend projection is future-ready for later online/media resource types
8. Permissions match existing access model
9. Page works for both personal and shared Project/Notebook resources

Part M — Important constraints
- Do not break existing document/project/notebook flows
- Reuse current RBAC/access logic
- Avoid frontend-only stitching if a backend projection is cleaner
- Keep today’s implementation practical
- Design for extensibility without overengineering
- Make sure collaborator-visible resources are included where allowed

Please return:
1. proposed resource model
2. backend implementation plan
3. UI structure
4. exact files/queries changed
5. any migrations/RPCs/views added
6. notes on future extensibility
7. validation checklist