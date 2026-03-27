Built and maintained by Atlas (AI assistant) for MicroGRID Energy / EDGE.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MicroGRID — solar project management system for MicroGRID Energy / EDGE. Tracks ~938 active residential solar installation projects through a 7-stage pipeline (evaluation → survey → design → permit → install → inspection → complete). Built for PMs (project managers) who each own a set of projects. Migrated from NetSuite (which is potentially permanently unavailable as of March 2026).

## Commands

```bash
npm run dev        # Dev server on :3000
npm run build      # Production build (Next.js)
npm run lint       # ESLint (Next.js + TypeScript presets)
npm test           # Run all tests (Vitest, single run)
npm run test:watch # Run tests in watch mode
npm start          # Start production server
```

Auto-deploys to Vercel on push to `main`.

## Testing

**Vitest** + React Testing Library with jsdom. Config in `vitest.config.ts`, global setup in `vitest.setup.ts` (Supabase mock, localStorage mock).

Tests are in `__tests__/` organized by category:
- `lib/` — pure utility functions (`daysAgo`, `fmt$`, `fmtDate`, `cn`), CSV export, `useCurrentUser` hook
- `logic/` — SLA classification, funding eligibility, task stuck detection, filter composition, BOM calculations, cycleDays fallback
- `pages/` — page-level logic for command (morning dashboard with action items + project table), pipeline (sort/filter), queue (priority), funding, schedule, service, admin
- `auth/` — OAuth callback (exchange, provisioning, error redirect), middleware (route protection, cookie error handling)

The Supabase client is globally mocked in `vitest.setup.ts`. Tests focus on business logic extracted from pages rather than rendering full page components. When adding new features, add corresponding tests for the logic.

## Tech Stack

- **Next.js 16** (App Router, `"use client"` pages — no RSC data fetching)
- **React 19** + TypeScript (strict)
- **Tailwind CSS v4** (PostCSS plugin, not config-based)
- **Supabase** — PostgreSQL, Auth (Google OAuth, External — primary domains `@gomicrogridenergy.com` and `@energydevelopmentgroup.com`, legacy `@trismartsolar.com` logins still work), Realtime subscriptions
- **No state management library** — pure `useState`/`useEffect`/`useCallback` + Supabase realtime channels

## Architecture

### Routing & Pages

All pages are in `app/*/page.tsx` as client components (`"use client"`). Each page fetches its own data via the Supabase browser client on mount and subscribes to realtime changes. Root `/` redirects to `/command`.

Key pages: `/command` (morning dashboard — personal stats, action items, pipeline snapshot, sortable project table), `/queue` (PM-filtered task-based worklist with collapsible sections), `/pipeline` (visual Kanban pipeline — smart column headers with stats/blocked/stuck counts, task-enriched cards with next task + stuck badges + funding badges, compact/detailed toggle, collapsible columns, per-column blocked/stuck filters, URL-persistent smart filters, mobile accordion layout), `/analytics` (6 tabs: Leadership, Pipeline Health, By PM, Funding, Cycle Times, Dealers), `/audit` (task compliance), `/audit-trail` (admin-only change log with sortable columns, filters, pagination at 50/page, and ProjectPanel integration), `/schedule` (crew calendar), `/service`, `/funding` (M1/M2/M3 milestones with sortable columns, powered by `funding_dashboard` Postgres view), `/inventory` (3-tab inventory hub: Project Materials, Purchase Orders, Warehouse — with filters, sorting, pagination, and PO status advancement), `/change-orders` (HCO/change order queue with 6-step workflow), `/documents` (file browser hub + `/documents/missing` missing docs report), `/reports` (AI-powered natural language query interface), `/legacy` (read-only lookup of 14,705 In Service legacy TriSMART projects), `/batch` (SLD batch design — upload or manually enter multiple project redesigns, configure target equipment, process string calculations and panel-fit estimates in bulk, download results), `/crew` (mobile-optimized daily crew view — shows scheduled jobs for the current week grouped by date, with job type badges, status dots, customer/address/equipment details, Google Maps links, and call/email buttons; uses `useSupabaseQuery` for projects/crews and realtime subscriptions), `/dashboard` (PM performance dashboard — shows the logged-in PM's portfolio metrics: active/blocked/critical counts, portfolio value, upcoming schedule, SLA health, and task breakdown; uses `useSupabaseQuery` for projects/tasks/crews), `/planset` (Duracell SLD planset generator — hardcoded reference design for PROJ-29857 with full equipment specs, string configurations, and SVG-rendered single-line diagram sheets), `/redesign` (system redesign calculator — enter existing and target system specs, calculates string sizing, voltage/current compatibility, panel-fit estimates per roof face, and generates downloadable DXF single-line diagrams), `/mobile/leadership` (mobile-first leadership dashboard — role-gated to Manager+, shows active projects, portfolio value, installs/M2/M3 funded this month, blocked count, pipeline stage distribution bar chart, PM performance table, avg sale-to-install and aging stats; auto-refreshes every 5 minutes), `/mobile/field` (mobile-first field operator view — shows today's scheduled jobs sorted by status, with job type badges, status progression buttons (Start Job / Mark Complete), one-tap call/navigate/notes actions, project search, project detail modal with customer info and note submission, auto-completes corresponding MicroGRID tasks when jobs are marked complete; realtime subscription on schedule table), `/mobile/scan` (mobile barcode scanner — camera-based barcode scanning via BarcodeDetector API with manual fallback, looks up warehouse stock items, supports checkout-to-project and check-in flows), `/vendors` (vendor/supplier directory — searchable table with category and equipment type filters, expandable inline edit, active/inactive toggle, summary cards by category; delete is super-admin-only), `/work-orders` (field work tracking — create, assign, and complete work orders with type-specific checklists, status flow draft/assigned/in_progress/complete/cancelled, crew assignment, customer signature collection, time tracking, and realtime updates; expandable row detail with checklist progress bar, notes, and ProjectPanel integration), `/admin`, `/help` (topic-based knowledge base — 55 topics across 12 categories with search, sidebar navigation, accordion layout, "What's New" section, deep linking via URL hash, and related topic cross-references).

### API Layer

Centralized data access functions live in `lib/api/`:

- `lib/api/projects.ts` — `loadProjects`, `loadProjectFunding`, `updateProject`, `loadUsers`, `loadProjectAdders`, `addProjectAdder`, `deleteProjectAdder`, `loadProjectById`, `loadProjectsByIds`, `searchProjects`
- `lib/api/notes.ts` — `loadProjectNotes`, `loadTaskNotes`, `addNote`, `deleteNote`, `createMentionNotification`
- `lib/api/tasks.ts` — `upsertTaskState`, `loadTaskStates`, `loadTaskHistory`, `insertTaskHistory`
- `lib/api/schedules.ts` — `loadScheduleByDateRange` (supports multi-day jobs via `.or()` filter on `end_date`)
- `lib/api/change-orders.ts` — `loadChangeOrders`
- `lib/api/crews.ts` — `loadCrewsByIds`, `loadActiveCrews`
- `lib/api/documents.ts` — `loadProjectFiles`, `searchProjectFiles`, `searchAllProjectFiles`, `loadAllProjectFiles`, `loadDocumentRequirements`, `loadProjectDocuments`, `updateDocumentStatus`
- `lib/api/equipment.ts` — `loadEquipment`, `searchEquipment`, `loadAllEquipment`, `EQUIPMENT_CATEGORIES`
- `lib/api/inventory.ts` — `loadProjectMaterials`, `addProjectMaterial`, `updateProjectMaterial`, `deleteProjectMaterial`, `autoGenerateMaterials`, `loadWarehouseStock`, `loadAllProjectMaterials`, `generatePONumber`, `loadPurchaseOrders`, `loadPurchaseOrder`, `createPurchaseOrder`, `updatePurchaseOrderStatus`, `updatePurchaseOrder`, `loadPOLineItems`, `addWarehouseStock`, `updateWarehouseStock`, `deleteWarehouseStock`, `checkoutFromWarehouse`, `checkinToWarehouse`, `adjustWarehouseStock`, `loadWarehouseTransactions`, `getLowStockItems`. Constants: `MATERIAL_STATUSES`, `MATERIAL_SOURCES`, `MATERIAL_CATEGORIES`, `PO_STATUSES`, `PO_STATUS_COLORS`. Types: `ProjectMaterial`, `WarehouseStock`, `WarehouseTransaction`
- `lib/api/vendors.ts` — `loadVendors`, `searchVendors`, `loadVendor`, `addVendor`, `updateVendor`, `deleteVendor`. Constants: `VENDOR_CATEGORIES`, `EQUIPMENT_TYPE_OPTIONS`. Type: `Vendor`, `VendorCategory`
- `lib/api/work-orders.ts` — `loadWorkOrders`, `loadWorkOrder`, `createWorkOrder`, `updateWorkOrder`, `updateWorkOrderStatus`, `addChecklistItem`, `toggleChecklistItem`, `deleteChecklistItem`, `createWorkOrderFromProject`, `loadProjectWorkOrders`, `generateWONumber`, `getValidTransitions`. Constants: `WO_CHECKLIST_TEMPLATES` (5 type templates). Types: `WorkOrder`, `WOChecklistItem`, `WorkOrderFilters`
- `lib/api/index.ts` — barrel export for all of the above

Pages should import from `@/lib/api` instead of querying Supabase directly. The API layer handles error logging, type casting, and consistent return shapes.

### db() Helper

`lib/db.ts` provides a clean escape hatch for Supabase write operations on untyped tables. Use `db()` instead of `(supabase as any)` for writes. Import: `import { db } from '@/lib/db'`.

### Data Layer

- `lib/supabase/client.ts` — browser Supabase client (used by all pages)
- `lib/supabase/server.ts` — server Supabase client (used by middleware)
- Realtime: `supabase.channel().on('postgres_changes', ...)` pattern in each page

### Shared Code

- `lib/utils.ts` — `cn()` (clsx+twMerge), `fmt$()`, `fmtDate()`, `daysAgo()`, `escapeIlike()` (sanitizes user input for Supabase `.ilike()` queries), `STAGE_LABELS`, `STAGE_ORDER`, `SLA_THRESHOLDS`, `STAGE_TASKS` (task definitions per stage)
- `lib/tasks.ts` — single source of truth for task definitions, statuses, reasons, and cascade helper. Exports: `TASKS`, `TASK_STATUSES`, `STATUS_STYLE`, `PENDING_REASONS`, `REVISION_REASONS`, `ALL_TASKS_MAP`, `ALL_TASKS_FLAT`, `TASK_TO_STAGE`, `TASK_DATE_FIELDS` (11 task→project date mappings), `getSameStageDownstream()` (BFS for revision cascade), `AHJ_REQUIRED_TASKS` (AHJ-conditional task requirements), `isTaskRequired()` (checks if a task is required given an AHJ). Includes cycle detection at module load.
- `lib/classify.ts` — extracted Command Center classification logic. Exports: `classify()` (projects → sections, used for compatibility), `cycleDays()`, `getSLA()`, `getStuckTasks()`. Types: `Section`, `Classified`, `TaskEntry`, `StuckTask`. The Command Center was redesigned from a 10-section urgency view to a morning dashboard with action items and sortable project table, but `classify()` is still available for other consumers.
- `lib/hooks/` — reusable hook infrastructure (see [Hook Infrastructure](#hook-infrastructure) section below)
- `lib/export-utils.ts` — CSV export with field picker (50+ fields, grouped)
- `types/database.ts` — full TypeScript types for all Supabase tables
- `components/Nav.tsx` — two-tier navigation bar. 6 primary links always visible (Command, Queue, Pipeline, Schedule, Funding, Analytics) + "More" dropdown for secondary pages (Service, Change Orders, Documents, Atlas, Redesign, Legacy). Audit Trail link in More dropdown for admins. Right-side slot for page controls.
- `components/project/ProjectPanel.tsx` — large modal (overview/tasks/notes/files/BOM/materials tabs) used across multiple pages
- `components/project/FilesTab.tsx` — extracted Files tab component for ProjectPanel (Google Drive link or "no folder" state)
- `components/help/` — Help Center component architecture:
  - `HelpSearch.tsx` — debounced search input (200ms) filtering topics by title, description, and keywords
  - `HelpSidebar.tsx` — sticky sidebar with category list (topic counts), "What's New" section, mobile-responsive collapsible variant
  - `HelpCategory.tsx` — renders a category heading with its list of HelpTopic accordions
  - `HelpTopic.tsx` — expandable accordion for a single topic (title, description, rich content component, "Try it" link, related topics)
  - `topics/index.ts` — exports `CATEGORIES` (12 categories), `WHATS_NEW` array, and `HelpTopicData` type definition
  - `topics/all-topics.ts` — barrel import aggregating all 61 topics from 12 category files
  - `topics/*.tsx` — 12 category files (`getting-started`, `daily-workflow`, `project-management`, `notes-communication`, `financial`, `inventory`, `schedule`, `change-orders`, `analytics`, `administration`, `system-features`, `design-tools`), each exporting an array of `HelpTopicData` with React component content
- `components/BulkActionBar.tsx` — bulk operations toolbar (see [Bulk Operations](#bulk-operations) section below)
- `components/Pagination.tsx` — reusable pagination control (see [Pagination](#pagination) section below)
- `components/admin/` — 21 admin section components (see [File Consolidation](#file-consolidation-complete) section)
- `components/FeedbackButton.tsx` — floating feedback button rendered on every page (bottom-right corner). Submits to `feedback` table with type, message, user info, and current page. Insert allowed for all authenticated users via permissive RLS policy.
- `components/SessionTracker.tsx` — automatic session tracking component. Logs user sessions to `user_sessions` table with login time, current page, and 60-second heartbeat for duration. Auth fallback handles edge cases where session is not yet available.

### Error Boundaries

- `app/error.tsx` — page-level error boundary. Dark-themed with "Try Again" button to reset. Catches runtime errors within page components.
- `app/global-error.tsx` — root-level error boundary. Catches errors in the layout itself. Dark-themed with reload button.
- `components/ErrorBoundary.tsx` — reusable error boundary component. Can be wrapped around any component tree. Includes a "Report Issue" button that triggers the FeedbackButton for bug reporting.

All error screens are styled consistently with the dark theme (`bg-gray-950`, green accents).

### Hook Infrastructure

Reusable hooks in `lib/hooks/` (barrel-exported from `lib/hooks/index.ts`):

**`useSupabaseQuery<T>(table, options)`** — Generic data-fetching hook for any typed Supabase table. Features:
- **LRU cache** with 50-entry max and 5-minute TTL, shared across hook instances. Evicts least-recently-used entries when capacity is reached. Scale-ready to 5K projects.
- **Request deduplication** — identical in-flight queries reuse the same promise
- **Stale-while-revalidate** — returns cached data immediately while refetching in background
- **Pagination** — pass `page: 1` to enable; returns `totalCount`, `hasMore`, `nextPage`, `prevPage`, `setPage`, `currentPage`
- **Realtime** — pass `subscribe: true` to auto-invalidate cache and refetch on postgres_changes. Optional `realtimeFilter` narrows the subscription to matching rows only (PostgREST syntax, e.g., `'pm_id=eq.abc123'`), reducing unnecessary refetches when only a subset of the table is relevant.
- **Typed filters** — supports `eq`, `neq`, `in`, `not_in`, `ilike`, `is` (null), `isNot` (null), `gt`, `lt`, `gte`, `lte`. Shorthand: `{ pm_id: 'abc' }` is equivalent to `{ pm_id: { eq: 'abc' } }`
- **`.or()` expressions** — pass `or: 'name.ilike.%test%,id.ilike.%test%'` for compound search
- `clearQueryCache()` — exported function to invalidate all cached data (used after bulk mutations)
- **Known limitations**: no join support (use `lib/api/` for joins), no views (only typed tables), single filter per field

```typescript
// Example: paginated audit logs with filters and sorting
const { data, loading, totalCount, hasMore, nextPage, prevPage, currentPage } =
  useSupabaseQuery('audit_log', {
    page: 1,
    pageSize: 50,
    filters: { field: 'stage', changed_at: { gte: '2026-03-01' } },
    order: { column: 'changed_at', ascending: false },
  })
```

**`useRealtimeSubscription(table, options)`** — Standalone realtime hook. Manages channel lifecycle, debounces callbacks (default 300ms), cleans up on unmount. Used internally by `useSupabaseQuery` when `subscribe: true`, but can also be used independently.

**`useEdgeSync()`** — Fire-and-forget EDGE webhook triggers used by ProjectPanel automation chain. Returns: `notifyInstallComplete`, `notifyPTOReceived`, `notifyStageChanged`, `notifyFundingMilestone`, `notifyInService`, `send`. All calls are async but non-blocking — failures are logged to `edge_sync_log`, never thrown.

**`useServerFilter<T>(data, options)`** — Filter/search state management that produces query parameters for `useSupabaseQuery`. Features:
- Auto-extracts dropdown options from loaded data (single field or id|label pairs)
- Builds Supabase-compatible filter objects and `.or()` search expressions
- Provides `searchProps` to spread on input elements
- `resetFilters()` to clear all state

### Bulk Operations

`components/BulkActionBar.tsx` provides multi-project update capability. Used on Pipeline and Queue pages.

**Components exported:**
- `BulkActionBar` — floating bottom toolbar that appears when projects are selected. Shows count, action buttons, confirmation dialog, and progress overlay.
- `useBulkSelect(allProjects)` — selection state hook. Returns `selectMode`, `selectedIds`, `selectedProjects`, `toggleSelect`, `selectAll`, `deselectAll`, `exitSelectMode`.
- `SelectCheckbox` — checkbox component rendered on each project card in select mode.
- `getAllowedDispositions(current)` — disposition transition rules (mirrors InfoTab logic).

**Available bulk actions:** Reassign PM, Set/Clear Blocker, Change Disposition, Set Follow-up Date. Each action:
- Logs every field change to `audit_log`
- Shows confirmation dialog before executing
- Displays progress bar during execution
- Collects and reports failures
- Calls `clearQueryCache()` after completion to refresh all queries

Disposition changes enforce the same transition rules as single-project edits (Sale -> Loyalty -> Cancelled, no skipping). Actions are configurable via the `actions` prop.

### Pagination

`components/Pagination.tsx` — minimal prev/next pagination control showing "page / totalPages". Used on pages where full data view is not needed:
- **Service** — 100 per page
- **Audit** (`/audit`) — 200 per page
- **Audit Trail** (`/audit-trail`) — 50 per page

**NOT used on** Pipeline, Command, Queue, or Funding pages — these require full data in memory for client-side classification, grouping, or filtering.

### Audit Trail Page

Standalone page at `/audit-trail` (admin-only, guarded by `useCurrentUser().isAdmin`). Displays `audit_log` records in a sortable table with:
- **Filters**: project ID search (ilike), field name dropdown, changed-by user dropdown, date range (Today/7 Days/30 Days/All)
- **Sortable columns**: Timestamp, Project, Field, Changed By (click to toggle asc/desc)
- **Pagination**: 50 records per page via `useSupabaseQuery` with `page: 1`
- **ProjectPanel integration**: clicking a project ID opens the full project modal
- **Deletion highlighting**: rows with `field = 'project_deleted'` render with red background
- Uses `useSupabaseQuery('audit_log', ...)` for server-side filtering/sorting/pagination

### Key Database Tables

- **projects** — PK is `id` TEXT (format `PROJ-XXXXX`). `stage` field is the pipeline position. `blocker` non-null = blocked.
- **task_state** — composite key `(project_id, task_id)`. Statuses: Complete, Pending Resolution, Revision Required, In Progress, Scheduled, Ready To Start, Not Ready. Includes `reason` field, `notes` (per-task notes text), and `follow_up_date`. RLS is open to all authenticated users (`USING true`, `WITH CHECK true`).
- **notes** — per-project timestamped notes. Can optionally include `task_id` to associate a note with a specific task (per-task notes).
- **schedule** — crew assignments with `job_type` (survey/install/inspection/service). Supports multi-day jobs via `end_date` column (nullable DATE). When `end_date` is set, the job spans from `date` to `end_date` inclusive and appears in every day column it covers on the calendar.
- **project_funding** — M1/M2/M3 milestone amounts, dates, CB credits
- **stage_history** — audit trail of stage transitions
- **change_orders** — HCO/change order records. Fields: `project_id`, `title`, `type`, `reason`, `origin`, `priority`, `status` (Open/In Progress/Waiting On Signature/Complete/Cancelled), `assigned_to`, `created_by`, `notes` (chronological timestamped text). 6-step workflow booleans: `design_request_submitted`, `design_in_progress`, `design_pending_approval`, `design_approved`, `design_complete`, `design_signed`. Original/new design values: `original_panel_count`/`new_panel_count`, `original_system_size`/`new_system_size`, etc.
- **feedback** — user-submitted feedback. Fields: `type` (Bug/Feature Request/Improvement/Question), `message`, `status` (New/Reviewing/In Progress/Addressed/Won't Fix), `user_name`, `user_email`, `page`, `admin_notes`. Delete policy uses `auth_is_super_admin()` SECURITY DEFINER function.
- **user_sessions** — login/session tracking. Fields: `user_id`, `user_name`, `user_email`, `logged_in_at`, `last_active_at`, `page`. Updated via 60-second heartbeat from `SessionTracker` component. Duration computed client-side.
- **audit_log** — change audit trail. Records all project field changes with `project_id`, `field`, `old_value`, `new_value`, `changed_by`, `changed_by_id`, `changed_at`. Also logs project deletions (`field = 'project_deleted'`) before cascade.
- **edge_sync_log** — MicroGRID-EDGE webhook event log. Fields: `id` (UUID PK), `project_id` (TEXT), `event_type` (TEXT), `direction` (`'outbound'` or `'inbound'`), `payload` (JSONB), `status` (`sent`/`delivered`/`failed`), `response_code` (INTEGER), `error_message` (TEXT), `created_at` (TIMESTAMPTZ). Indexes on project_id, event_type, created_at DESC. RLS: SELECT/INSERT for authenticated users. Migration: `supabase/028-edge-sync.sql`.
- **equipment** — equipment catalog with 2,517 items. Fields: `id` (UUID PK), `category` (panel/inverter/battery/optimizer), `manufacturer`, `model`, `wattage` (NUMERIC), `description`, `active` (BOOLEAN). Used for autocomplete in project Info tab equipment fields. Admin management via EquipmentManager.
- **project_materials** — per-project material list. Fields: `id` (UUID PK), `project_id` (TEXT), `equipment_id` (UUID FK → equipment), `name`, `category` (module/inverter/battery/optimizer/racking/electrical/other), `quantity`, `unit` (each/ft/box/roll), `source` (dropship/warehouse/tbd), `vendor`, `status` (needed/ordered/shipped/delivered/installed), `po_number`, `expected_date`, `delivered_date`, `notes`, `created_at`, `updated_at`. RLS open to all authenticated users. Migration: `supabase/025-inventory.sql`.
- **warehouse_stock** — BOS warehouse stock levels. Fields: `id` (UUID PK), `equipment_id` (UUID FK → equipment), `name`, `category`, `quantity_on_hand`, `reorder_point`, `unit`, `location` (shelf/bin or crew truck name — e.g., "Truck 1", "Truck 2", "Main Warehouse"), `barcode` (TEXT, indexed — scannable barcode/QR value for mobile lookup), `last_counted_at`, `updated_at`. RLS: SELECT/INSERT/UPDATE for authenticated users. Migration: `supabase/025-inventory.sql`, barcode column added in `supabase/033-warehouse-barcode.sql`.
- **warehouse_transactions** — warehouse check-out/check-in/adjustment audit trail. Fields: `id` (UUID PK), `stock_id` (UUID FK → warehouse_stock), `project_id` (TEXT, nullable), `transaction_type` (checkout/checkin/adjustment/recount), `quantity` (INTEGER), `notes`, `performed_by`, `created_at`. RLS: SELECT/INSERT for authenticated users. Migration: `supabase/027-warehouse-transactions.sql`. Indexes on stock_id, project_id, transaction_type.
- **purchase_orders** — purchase order tracking. Fields: `id` (UUID PK), `po_number` (TEXT UNIQUE, format `PO-YYYYMMDD-NNN`), `vendor`, `project_id` (optional TEXT), `status` (draft/submitted/confirmed/shipped/delivered/cancelled), `total_amount`, `notes`, `created_by`, `created_at`, `updated_at`, `submitted_at`, `confirmed_at`, `shipped_at`, `delivered_at`, `tracking_number`, `expected_delivery`. RLS: SELECT/INSERT/UPDATE for authenticated users. Migration: `supabase/026-purchase-orders.sql`.
- **po_line_items** — line items for purchase orders. Fields: `id` (UUID PK), `po_id` (UUID FK → purchase_orders ON DELETE CASCADE), `material_id` (UUID FK → project_materials), `equipment_id` (UUID FK → equipment), `name`, `quantity`, `unit_price`, `total_price`, `notes`. RLS: SELECT/INSERT/UPDATE/DELETE for authenticated users. Migration: `supabase/026-purchase-orders.sql`.
- **vendors** — supplier/contractor directory. Fields: `id` (UUID PK), `name` (TEXT NOT NULL), `contact_name`, `contact_email`, `contact_phone`, `website`, `address`, `city`, `state`, `zip`, `category` (manufacturer/distributor/subcontractor/other), `equipment_types` (TEXT[] — modules/inverters/batteries/racking/electrical/other), `lead_time_days` (INTEGER), `payment_terms` (TEXT), `notes`, `active` (BOOLEAN DEFAULT true), `created_at`. Trigram index on name, index on category and active. RLS: SELECT/INSERT/UPDATE for all authenticated users, DELETE for super_admin only. Migration: `supabase/029-vendors.sql`.
- **work_orders** — field work order tracking. Fields: `id` (UUID PK), `project_id` (TEXT), `wo_number` (TEXT UNIQUE, format `WO-YYYYMMDD-NNN`), `type` (install/service/inspection/repair/survey), `status` (draft/assigned/in_progress/complete/cancelled), `assigned_crew`, `assigned_to`, `scheduled_date`, `started_at`, `completed_at`, `priority` (low/normal/high/urgent), `description`, `special_instructions`, `customer_signature` (BOOLEAN), `customer_signed_at`, `materials_used` (JSONB), `time_on_site_minutes`, `notes`, `created_by`, `created_at`, `updated_at`. Indexes on project_id, status, scheduled_date, assigned_crew. RLS: SELECT/INSERT/UPDATE for authenticated users. Migration: `supabase/030-work-orders.sql`.
- **wo_checklist_items** — per-work-order checklist items. Fields: `id` (UUID PK), `work_order_id` (UUID FK -> work_orders ON DELETE CASCADE), `description`, `completed` (BOOLEAN), `completed_by`, `completed_at`, `sort_order`, `notes`, `photo_url`. RLS: SELECT/INSERT/UPDATE/DELETE for authenticated users. Migration: `supabase/030-work-orders.sql`.
- **ahjs**, **utilities** — reference data for permit authorities and utility companies
- **project_adders** — project adders/extras (e.g., EV charger, critter guard, ground mount). Fields: `id`, `project_id`, `name`, `price`, `quantity`, `created_at`. RLS open to all authenticated users. Migration: `supabase/013-adders.sql`. Contains 4,185 records imported from NetSuite.

### Data Inventory

As of March 2026: 938 active projects, 14,705 legacy In Service projects (imported from TriSMART/NetSuite), ~330K total notes (53K original project/task notes + 127,207 NetSuite action comments imported as task-level notes with [NS] prefix + 150,633 legacy BluChat notes for 8,299 legacy projects), 67K+ task history entries, 4,185 adders, 922 service cases, 12,054 funding records (937 active + ~11,117 legacy M2/M3), 4,500+ files in Google Drive across 937 project folders. NetSuite is potentially permanently unavailable.

### SLA System

SLA thresholds are centralized in `lib/utils.ts` (`SLA_THRESHOLDS`). The Command Center was redesigned as a "Morning Dashboard" with personal stats (active projects, portfolio value, installs this month, today's schedule), action items (follow-ups due, blocked projects, stuck tasks), a pipeline snapshot bar chart, and a sortable project table. The page auto-selects the logged-in user's PM filter on load. The old 10-section urgency classification (`classify()` in `lib/classify.ts`) is retained for compatibility but no longer drives the primary Command Center layout.

**SLA thresholds are currently paused** — all values are set to 999 in `SLA_THRESHOLDS` (original values preserved in comments). This means all projects will appear as "On Track" for SLA purposes until thresholds are re-enabled. The 12 SLA-related tests are skipped (`it.skip`) in the test suite. **Note:** Re-enable thresholds once stage_dates are reset for the active backlog so SLA tracking is meaningful.

### Task System

Each pipeline stage has defined tasks in `STAGE_TASKS` (lib/utils.ts). Tasks have prerequisite chains and are tracked in the `task_state` table. "Stuck" tasks (Pending Resolution or Revision Required) surface as badges throughout the UI with their `reason` field.

Tasks support **per-task notes** (stored in the `notes` table with a `task_id` foreign key, timestamped with author) and **per-task follow-up dates** (stored on `task_state.follow_up_date`). Follow-up dates surface in the Queue page's "Follow-ups Today" section.

**AHJ-conditional requirements**: WP1 and WPI 2&8 are normally optional but become required for projects in Corpus Christi and Texas City. This is controlled by `AHJ_REQUIRED_TASKS` in `lib/tasks.ts` and checked via the `isTaskRequired()` helper.

### Automation Engine

When task statuses change in ProjectPanel, a chain of automations fires:

1. **Auto-populate project dates** — 11 task-to-date mappings (e.g., "Site Survey Complete" sets `survey_date`, "Install Complete" sets `install_complete_date`, "PTO Received" sets `pto_date`). Dates are cleared on revision cascade.
2. **Auto-advance stage** — when the last required task in a stage is marked Complete, the project automatically advances to the next pipeline stage and logs to `stage_history`.
3. **Auto-detect blockers** — when a task enters Pending Resolution, the project `blocker` field is auto-set to the task reason (prefixed with a pause icon). Auto-clears when the stuck task is resolved (only if no other tasks remain stuck).
4. **Funding milestone triggers** — "Install Complete" task completion sets M2 to Eligible; "PTO Received" sets M3 to Eligible. Creates funding records if they don't exist.
5. **Task duration tracking** — `started_date` auto-set when a task moves to In Progress; duration calculated on completion.
6. **Revision cascade** — setting a task to Revision Required resets all downstream tasks (within the same stage) to Not Ready, with confirmation dialog. Also clears corresponding auto-populated dates.
7. **Auto-set In Service disposition** — completing the In Service task sets `disposition = 'In Service'`.
8. **Auto-set dependent tasks to Ready To Start** — when a task is marked Complete, all tasks whose prerequisites are now fully met are automatically set to "Ready To Start". This works across stage boundaries.

### Adders UI

The project panel Info tab includes an Adders section. In view mode it displays a read-only list of adders with name, quantity, and price. In edit mode, users can add new adders (name/price/quantity) and delete existing ones. Data is stored in the `project_adders` table.

### Equipment Catalog

The `equipment` table stores 2,517 equipment items (panels, inverters, batteries, optimizers) with manufacturer, model, wattage/capacity, and category. Used for:

- **Autocomplete dropdowns** in the project Info tab's Equipment section — module, inverter, battery, and optimizer fields use typeahead search against the equipment catalog
- **Auto-calculate system kW** — when module model and panel count are both set, `system_kw` is automatically calculated from the equipment's wattage and the panel count
- **EquipmentManager** in Admin portal (`components/admin/EquipmentManager.tsx`) — full add, view, edit, delete with search, filter by category, add/edit/delete
- **Migration 024** (`supabase/024-equipment.sql`) — `equipment` table with fields: `id` (UUID PK), `category` (panel/inverter/battery/optimizer), `manufacturer`, `model`, `wattage` (NUMERIC), `description`, `active` (BOOLEAN DEFAULT true), `created_at`
- **Import scripts**: `scripts/import-equipment.ts` (parses equipment data), `scripts/upload-equipment.ts` (uploads to Supabase in batches)
- 9 UI improvements applied: debounced autocomplete, dropdown positioning, click-outside dismiss, selected item display, clear button, keyboard navigation

### Inventory Management

Two-phase inventory system for tracking project materials and purchase orders.

**Phase 1 — Project Materials & Warehouse Stock** (migration 025):
- `project_materials` table tracks what each project needs: equipment items with category, quantity, source (dropship/warehouse/tbd), vendor, and status (needed → ordered → shipped → delivered → installed)
- `warehouse_stock` table for BOS items with quantity-on-hand, reorder points, and bin locations (Phase 3 — UI placeholder only)
- **MaterialsTab** (`components/project/MaterialsTab.tsx`) — new tab in ProjectPanel showing per-project material list with:
  - **Auto-generate** from project equipment fields (module, inverter, battery, optimizer) with dedup
  - **Add Item** form for manual material entry (name, category, qty, unit, source, vendor)
  - **Status cycling** — click a status badge to advance: needed → ordered → shipped → delivered → installed
  - **Expandable detail rows** — inline editing for vendor, PO number, expected/delivered dates, notes
  - **Status summary bar** showing counts per status
  - **PO creation** — select materials via checkboxes, enter vendor, creates a purchase order with line items linked to materials

**Phase 2 — Purchase Orders** (migration 026):
- `purchase_orders` table with lifecycle timestamps (submitted_at, confirmed_at, shipped_at, delivered_at) and tracking number
- `po_line_items` table with FK links to both `project_materials` and `equipment`
- PO numbers auto-generated as `PO-YYYYMMDD-NNN`
- Creating a PO auto-sets linked materials to `ordered` status with the PO number
- Delivering a PO auto-sets all linked materials to `delivered` with today's date

**Phase 3 — Warehouse Transactions** (migration 027):
- `warehouse_transactions` table tracks every stock movement with type, quantity, project reference, performer, and timestamp
- **Check out** — pull stock for a project: decrements `quantity_on_hand`, creates a transaction record, and auto-creates a `project_material` entry (source=warehouse, status=delivered)
- **Check in** — return stock to warehouse: increments `quantity_on_hand` and creates a transaction record
- **Adjustment** — physical count correction: sets `quantity_on_hand` to new value, records the delta as an adjustment transaction, and updates `last_counted_at`
- **Low stock alerts** — items where `quantity_on_hand <= reorder_point` are highlighted with amber warnings; alert banner on the Inventory page links to the Warehouse tab
- **Transaction history** — per-item history log with type badges (checkout=red, checkin=green, adjustment=blue), project links, performer, and timestamps

**Inventory Page** (`/inventory`) — 3-tab hub on primary nav:
1. **Project Materials** — cross-project view of all materials with filters (status, category, source), search (project, item, vendor), sortable columns, pagination (50/page), and summary cards (needed/ordered/shipped/delivered counts)
2. **Purchase Orders** — PO list with filters (status, search), expandable detail with status timeline, line items table, status advancement buttons (draft → submitted → confirmed → shipped → delivered), cancel button, and confirmation dialogs. When a PO is delivered, all linked materials auto-update.
3. **Warehouse** — full warehouse stock management with search, category filter, location filter (supports crew truck locations like "Truck 1", "Truck 2" alongside warehouse bins), low stock alerts, and per-item actions (check out, check in, adjust, view history, delete). Modals for each action with project search autocomplete for checkouts. Each stock item supports a `barcode` field for mobile scanning. `WarehouseTab` component at `components/inventory/WarehouseTab.tsx`.

**Barcode Scanning** (`/mobile/scan`) — mobile-optimized page for warehouse barcode scanning. Uses the browser BarcodeDetector API (Chrome/Edge on Android) for live camera scanning, with a manual text input fallback. Scans look up `warehouse_stock.barcode` via `lookupByBarcode()`. Once an item is found, shows item details (name, category, on-hand quantity, location, barcode) and offers Checkout (to a project, with project search) or Check In actions. Accessible from `/mobile/field`. Supports EAN-13, EAN-8, QR Code, Code 128, Code 39, UPC-A, and UPC-E barcode formats.

**Label Printing** — barcode values can be printed as labels and affixed to warehouse bins or items. Any barcode/QR format supported by the BarcodeDetector API can be used. Assign the printed barcode value to `warehouse_stock.barcode` via the Warehouse tab edit form.

### File References in Notes

File references in project notes are rendered as clickable blue links. Clicking a filename opens a Google Drive search for that filename within the project's Drive folder. Inline images (base64/data URIs) are excluded from link detection.

### Equipment and Crew History

Equipment specifications and crew assignments imported from NetSuite are stored as historical notes on their respective projects, preserving the original data as timestamped records.

### Service Page

The service page (`/service`) displays 922 imported service cases from NetSuite. Column names in the database use `issue`, `type`, `created`, `date` (not `issue_type`, `description`, `created_at`). The page queries `service_calls` and displays status, project, issue, type, and dates.

### Google Drive Integration

New projects auto-create a folder structure in the MicroGRID Projects shared Google Drive via a Google Apps Script webhook. The script creates 16 subfolders (01 Proposal through 20 Cases). The Drive folder URL is saved to the `project_folders` table and accessible from the Files tab in ProjectPanel.

### Queue Page (My Worklist)

The Queue page (`/queue`) is a PM's daily worklist with smart filters, clickable stat cards, inline actions, funding badges, sortable sections, and last activity indicators. Redesigned from basic task-based sections to a full-featured "My Worklist" layout.

**Smart Filters Toolbar:**
- **Stage chips** — toggle-able pill buttons for each pipeline stage (evaluation through inspection), highlighted green when active
- **Financier dropdown** — filter by financing company (populated from loaded projects)
- **AHJ dropdown** — filter by authority having jurisdiction
- **Blocked Only toggle** — red pill button to show only blocked projects
- **Days range chips** — `<7d`, `7-30d`, `30-90d`, `90+d` time-in-stage filters (blue when active)
- **Clear All** button appears when any filter is active
- Filters apply to all sections including Loyalty; combine freely with search and PM filter

**Clickable Stat Cards:**
- **Total** — project count (green border when no filters active, click to clear all filters)
- **Blocked** — blocked count (red text when > 0, click to toggle Blocked Only filter)
- **Follow-ups** — follow-up count (amber text when > 0, click to scroll to and expand Follow-ups section)
- **Portfolio** — combined contract value (display only)

**Collapsible Sections** (all start collapsed except Follow-ups Today):

1. **Follow-ups Today** — projects with task-level or project-level `follow_up_date` that is today or overdue. Amber-themed with calendar icon. Shows task name and "Today" or "Xd overdue".
2. **Dynamic sections from DB** (`queue_sections` table) — default: City Permit Ready, City Permit Submitted, Utility Permit Submitted, Utility Inspection Ready, Utility Inspection Submitted. Admin-configurable via Admin portal.
3. **Blocked** — projects with a non-null `blocker`. Red-themed.
4. **Active** — everything not in a special section and not complete.
5. **Loyalty** — purple-themed, separated from all other sections.
6. **Complete** — projects in the `complete` stage. Gray-themed.

**Sortable Sections:**
Each section has a sort toggle button (cycle: Days > Value > Name). Projects sort by days in stage (descending), contract value (descending), or name (ascending).

**Queue Card Features:**
- **Priority dot** — colored dot (green/yellow/amber/red) based on SLA status, red if blocked
- **Funding badge** — inline `M1: Funded`, `M2: Sub`, `M3: Eligible` etc. with color coding (green=eligible, blue=submitted, emerald=funded, red=rejected). Shows the most advanced non-null milestone.
- **Last activity indicator** — "Stale Xd" in amber if > 5 days since stage_date, otherwise "Xd ago" in gray
- **Stuck task badges** — red (Pending Resolution) or amber (Revision Required) with task name and reason
- **Next task** — shown when no blocker and no stuck tasks
- **Configurable card fields** — gear icon opens field picker (name, city, address, financier, contract, system kW, AHJ, PM, stage, sale date). Saved to user preferences.
- **SLA days** — days in current stage (right side), color-coded by status
- **Cycle days** — total days since sale (smaller, below SLA days)

**Inline Quick Actions** (appear on hover, right side of card):
- **Calendar icon** — set project-level follow-up date via inline date picker (expands below card)
- **Message icon** — quick note submission inline (expands below card with text input)
- **X button on blocker** — clear blocker directly from the card (with confirmation dialog, logs to audit_log)

**Other features:**
- PM filter uses `pm_id` (user UUID) stored in localStorage as `mg_pm`. PM dropdown populated from distinct PMs on loaded projects.
- Sales role filtering — sales users only see projects where they are the consultant or advisor.
- Bulk select mode with Select/Exit Select toggle and per-section Select All buttons.
- Search matches name, ID, city, and address across all sections including Loyalty.
- Funding data loaded from `project_funding` table and mapped per project.

**Performance optimizations:**
- **PM-scoped realtime** — when a PM filter is active, the projects realtime subscription uses `realtimeFilter: 'pm_id=eq.<uuid>'` so only changes to that PM's projects trigger refetches.
- **Selective task loading** — only queue-relevant task IDs are fetched (section tasks + follow-up dates), not all task_state rows.

### Disposition Workflow

Disposition transitions are constrained: Sale -> Loyalty -> Cancelled. You cannot skip from Sale directly to Cancelled. The allowed transitions per current state are defined in `InfoTab.tsx`:

- **Sale** (or null): can move to Sale or Loyalty
- **Loyalty**: can move to Sale, Loyalty, or Cancelled
- **In Service**: can move to Sale or In Service
- **Cancelled**: can move to Loyalty or Cancelled

### PM Dropdown

The PM field in the project Info tab is a dropdown populated from the `users` table (queried with `.eq('active', true).order('name')`). Selecting a PM sets both `pm` (display name) and `pm_id` (user UUID) on the project.

### Predecessor Chain (Updated)

Key predecessor changes from session 13:
- **Stamps Required** — has no prerequisites (was previously dependent on `eng_approval`), remains optional
- **Check Point 1** — requires `eng_approval`, `city_permit`, `util_permit`, AND `ntp`. Now **required** (was optional).
- **Schedule Installation** — requires `checkpoint1` (was previously `om_review`)

### Supabase Configuration

- `pgrst.db_max_rows` = 50000 (increased to support task_state queries)
- All project queries use `.limit(2000)`
- All task_state queries use `.limit(50000)`
- `task_state` RLS is open to all authenticated users (`USING true`, `WITH CHECK true`)

### New Database Tables (Migration 013)

Added in `supabase/013-adders.sql`:
- `project_adders` table — `id` (UUID PK), `project_id` (TEXT FK → projects), `name` (TEXT), `price` (NUMERIC), `quantity` (INTEGER DEFAULT 1), `created_at` (TIMESTAMPTZ). RLS open to all authenticated users for SELECT, INSERT, UPDATE, DELETE.

### New Database Fields (Migration 012)

Added in `supabase/012-new-fields.sql`:
- `projects.follow_up_date` — DATE, PM follow-up queue date
- `projects.reinspection_fee` — NUMERIC, re-inspection fee amount
- `task_state.notes` — TEXT, per-task notes
- `task_state.follow_up_date` — DATE (added via Supabase dashboard, not in migration file)
- `notes.task_id` — associates a note with a specific task for per-task notes
- Dropped `not_eligible` defaults from `project_funding.m1_status`, `m2_status`, `m3_status`

### Funding Page Updates

- Funding statuses simplified to three values: Submitted (`Sub`), Funded (`Fun`), Rejected (`Rej`)
- Column headers are sortable (click to sort by any column)
- Text visibility improved for dark theme

### Permit Fee Fields

The Info tab now includes `permit_fee` and `reinspection_fee` fields in the Permitting section, both displayed as currency.

## Style Conventions

- Dark theme: `bg-gray-900` (page), `bg-gray-800` (cards), green accent (`#1D9E75` / `text-green-400`)
- Status colors: green = on track, amber = at risk, red = critical/blocked, blue = in progress
- Font: Inter (Google Fonts)
- Use `cn()` from `lib/utils.ts` for conditional Tailwind classes
- Icon library: `lucide-react`
- Date formatting: `fmtDate()` and `daysAgo()` helpers in `lib/utils.ts` (native Date API, returns `'—'` for null)

## Critical Notes

### TypeScript Pattern

`types/database.ts` covers core tables (`projects`, `task_state`, `notes`, `crews`, `schedule`, `stage_history`, `project_folders`) plus types added during refactoring: `ServiceCall`, `HOA`, `MentionNotification`, `ProjectAdder`, `ProjectBom`. The `Schedule` interface was expanded with 11 new fields plus `end_date` for multi-day job support. Several tables used in the app — `project_funding`, `service_calls`, `ahjs`, `utilities`, `users`, `sla_thresholds` — are **not** in the generated types but are accessed through the `lib/api/` layer or `db()` helper which handle casting internally.

**Type safety improved**: `as any` casts reduced from ~198 to 3 across the codebase (82 removed in Session 17 via full type safety pass — 19 files updated, 16 new interfaces added). Remaining 3 casts are in test mocks and Supabase RPC calls where typing is impractical. New code should use the API layer (`@/lib/api`) or `db()` helper rather than adding new `as any` casts.

### Role-Based Access

The `users` table has a `role` column with values: `super_admin`, `admin`, `finance`, `manager`, `user`. The `useCurrentUser()` hook returns `role`, `isAdmin`, `isSuperAdmin`, `isFinance`, `isManager` convenience booleans. RLS policies use `auth_is_admin()` and `auth_is_super_admin()` Postgres functions that check the `role` column. When adding admin-gated features, check `isAdmin` or `isSuperAdmin` from the hook on the client side; the database enforces the same via RLS.

**Permission model**: All authenticated users can create and edit projects (not just admins). Project deletion is super-admin-only. **Cancel/Reactivate disposition changes are gated to Admin+ users** (enforced in InfoTab and BulkActionBar). Admin portal access requires `admin` or `super_admin` role. Feedback submission uses a `SECURITY DEFINER` function to allow all users to insert regardless of RLS policies. The Permission Matrix in the Admin portal reflects actual RLS enforcement: View (all), Edit (all), Create (all), Delete (super_admin), Cancel/Reactivate (admin+), Funding Edit (finance+), Admin Portal (admin+).

### Crews Table Quirk

The `active` column on `crews` is stored as a **string** (`'TRUE'`/`'FALSE'`), not a boolean. The schedule page filters with `.eq('active', 'TRUE')` (uppercase only), while the admin page defensively checks both cases (`c.active === 'TRUE' || c.active === 'true'`). When querying crews, always filter on the string `'TRUE'`, and be aware that mixed-case values may exist in the data.

### Disposition Filtering

The `disposition` field has these states: `null`/`'Sale'` (active), `'Loyalty'`, `'In Service'`, `'Cancelled'`. Filtering across pages:

- **Command** (`/command`): excludes `In Service`, `Loyalty`, and `Cancelled` from pipeline. Loyalty and In Service shown as separate sections at the bottom.
- **Pipeline** (`/pipeline`): excludes `In Service`, `Loyalty`, and `Cancelled`
- **Analytics** (`/analytics`): excludes `In Service`, `Loyalty`, and `Cancelled` at query level
- **Funding** (`/funding`): excludes `In Service`, `Loyalty`, and `Cancelled` at query level
- **Audit** (`/audit`): excludes `Cancelled` and `In Service`. Loyalty projects **do** appear.
- **Queue** (`/queue`): excludes `In Service` and `Cancelled` — Loyalty projects **do** appear because PMs still actively manage them

`Cancelled` is always excluded from active views. When adding new views or filters, decide deliberately which dispositions to include. The Queue/Audit behavior (showing Loyalty) is intentional, not a bug.

### Filter Pattern

When combining search with dropdown filters, do **not** early-return the search match result. This was a recurring bug where search text would bypass other active filters. The correct pattern:

```typescript
// WRONG — search overrides other filters
if (search.trim()) {
  return name.includes(q) || id.includes(q)
}

// RIGHT — search narrows, other filters still apply
if (search.trim()) {
  if (!name.includes(q) && !id.includes(q)) return false
}
return true
```

### Search Input Sanitization

All Supabase `.ilike()` queries must use `escapeIlike()` from `lib/utils.ts` to sanitize user input. This escapes `%`, `_`, and `\` characters that have special meaning in PostgreSQL `ILIKE` patterns. Applied platform-wide across all pages with search functionality.

### cycleDays Helper

`daysAgo()` returns `0` for null/undefined input (never returns null). Use `||` (not `??`) when falling back between date fields, since `??` only coalesces null/undefined and `0` is a valid number that won't trigger it:

```typescript
// WRONG — ?? never falls through because daysAgo always returns a number
daysAgo(p.sale_date) ?? daysAgo(p.stage_date)

// RIGHT — || falls through when daysAgo returns 0
daysAgo(p.sale_date) || daysAgo(p.stage_date)
```

### Scale Optimization (Migration 016)

Added in `supabase/016-scale-optimization.sql`:

- **Database indexes** — `task_state` (project_id, status, project+status composite, follow_up_date), `projects` (pm_id, stage+disposition, blocker, stage_date), `project_funding` (m2_status), trigram index on `projects.name` for ILIKE performance
- **Helper functions** — `days_ago(date)`, `cycle_days(sale_date, stage_date)`, `sla_status(stage, stage_date)` (uses `sla_thresholds` table)
- **`funding_dashboard` view** — joins `projects` and `project_funding` with disposition filter (excludes In Service, Loyalty, Cancelled). Used by the Funding page to eliminate client-side join.
- **Page-level query optimization**:
  - Pipeline uses client-side filtering (PM, financier, AHJ multi-select, utility multi-select, blocked toggle, days range chips, search). All filters persist in URL params. Loads all task_state rows for task-enriched cards (next task, stuck badges, funding badges). Supports compact/detailed view toggle (localStorage-persisted), collapsible columns (localStorage-persisted), per-column blocked/stuck filters, and mobile accordion layout. Bulk operations include Advance Stage (same-stage constraint).
  - Queue loads only queue-relevant task_state rows (8 specific task IDs + non-null follow_up_date)
  - Command loads only stuck/complete task_state rows (Pending Resolution, Revision Required, Complete)
  - Audit loads only non-Complete task_state rows
- **LRU cache** — `useSupabaseQuery` cache uses LRU eviction (50 entries max, 5-min hard TTL, 30-sec stale threshold). Evicts least-recently-used entries when capacity is reached. Scale-ready to 5K projects without memory pressure.
- **Incremental task map** — Queue page maintains a `taskMapRef` that is patched in-place by a dedicated realtime channel (`queue-taskmap-incremental`) instead of re-fetching all task_state rows on every change. Only the affected project/task entry is updated.
- **Realtime filtering** — `useSupabaseQuery` accepts `realtimeFilter` (PostgREST syntax) to narrow realtime subscriptions to matching rows. Queue uses this to scope project subscriptions to the active PM, reducing unnecessary cache invalidation and refetch traffic.

### SubHub Webhook

API endpoint at `/api/webhooks/subhub` (route: `app/api/webhooks/subhub/route.ts`). Receives POST from SubHub when a contract is signed. Creates the project, initial task states, stage history, funding record, Google Drive folder, and adders in MicroGRID.

- **Disabled by default** — requires `SUBHUB_WEBHOOK_ENABLED=true` in environment variables
- **Authentication** — optional `SUBHUB_WEBHOOK_SECRET` verified via `Authorization` or `X-Webhook-Secret` header
- **Requires `SUPABASE_SECRET_KEY`** — uses service role key for database writes (no anon key fallback). Will return 500 if not configured.
- **Idempotency** — checks for existing project by ID before creating to prevent duplicates
- **GET endpoint** — health check returning enabled/disabled status

### EDGE Integration (MicroGRID ↔ EDGE Portal)

Bidirectional webhook integration between MicroGRID and EDGE Portal for project data and funding event synchronization.

**Outbound (MicroGRID → EDGE):**
- `lib/api/edge-sync.ts` — `sendToEdge()`, `syncProjectToEdge()`, `syncFundingToEdge()`
- HMAC-SHA256 signed payloads sent to `EDGE_WEBHOOK_URL/api/webhooks/nova`
- Events: `project.created`, `project.stage_changed`, `project.install_complete`, `project.pto_received`, `project.in_service`, `funding.milestone_updated`
- Integration points: ProjectPanel automation chain (task status changes, stage advances), SubHub webhook (project creation)
- Fire-and-forget via `useEdgeSync` hook — never blocks UI
- All events logged to `edge_sync_log` table

**Inbound (EDGE → MicroGRID):**
- API endpoint at `/api/webhooks/edge` (route: `app/api/webhooks/edge/route.ts`)
- Receives funding status updates: `funding.m2_funded`, `funding.m3_funded`, `funding.rejected`, `funding.status_update`
- HMAC-SHA256 signature verification via `X-Webhook-Signature` header
- Updates `project_funding` table and logs to `audit_log`
- GET endpoint for health check

**Admin panel:**
- `components/admin/EdgeIntegrationManager.tsx` — connection status, recent sync log, manual project sync

**Environment variables:**
```
NEXT_PUBLIC_EDGE_WEBHOOK_URL=https://edge-portal-blush.vercel.app
EDGE_WEBHOOK_SECRET=shared-secret-between-nova-and-edge
```

**Migration:** `supabase/028-edge-sync.sql` — `edge_sync_log` table with project_id, event_type, direction, payload (JSONB), status, response_code, error_message indexes.

### Atlas (AI Reports)

Natural language query interface at `/reports` (page: `app/reports/page.tsx`, API: `app/api/reports/chat/route.ts`). Branded as "Atlas" in the UI. Users type questions about project data in plain English, and Claude generates a Supabase query plan, executes it, and returns results in a sortable table.

- **Access**: Manager+ role required (`isManager` check from `useCurrentUser`)
- **AI model**: Claude Sonnet (`claude-sonnet-4-6`) for fast query generation
- **Rate limiting**: session-based — 25 requests/day per user tracked via `user_sessions` table (persistent across Vercel instances, not in-memory). 10 requests/minute burst limit.
- **Allowed tables**: projects, project_funding, task_state, notes, schedule, service_calls, change_orders
- **Max results**: 500 rows per query
- **Features**: sortable results table, CSV export, follow-up suggestions, conversation history, clickable project IDs (opens ProjectPanel), starter prompts
- **Client-side filters**: `daysAgo_gt` and `daysAgo_lt` for date-relative queries (e.g., "projects stuck more than 30 days")
- **Security**: query plan validated before execution; only whitelisted tables/ops allowed; `SUPABASE_SECRET_KEY` (service role key) used for read-only database queries
- **Requires**: `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY` environment variables; returns 503 if not configured

### Analytics Page Tabs

The Analytics page (`/analytics`) has 6 sub-tabs:

1. **Leadership** — period-selectable metrics: sales, installs, M2/M3 funded counts and values, portfolio overview, 90-day forecast, monthly install trend (6-month bar chart), active by financier
2. **Pipeline Health** — stage distribution bar chart, 90-day forecast breakdown, SLA health (critical/at risk/on track counts), blocked/aging counts
3. **By PM** — table of PM performance: active project count, blocked count, portfolio value, installs in period
4. **Funding** — funding overview metrics (total outstanding, M2/M3 funded counts and percentages, avg days install-to-M2 and PTO-to-M3), funded amount by financier, nonfunded code frequency
5. **Cycle Times** — avg days per stage, median sale-to-install and sale-to-PTO, cycle time buckets (0-60/61-90/91-120/120+ days), top 10 longest active projects, blocked count by stage
6. **Dealers** — projects by dealer (count, value, avg kW), projects by consultant, projects by advisor

### Admin-Configurable Features (Migrations 017-021)

Five database tables allow admins to configure system behavior without code changes:

1. **Financiers** (`financiers`, migration 017) — Reference table for financing companies. Admin management in Admin portal, autocomplete in project Info tab. Seeded with 10 financiers (Cash, EDGE, Mosaic, Sungage, GoodLeap, Dividend, Sunrun, Tesla, Sunnova, Loanpal).
2. **Task Reasons** (`task_reasons`, migration 018) — Pending Resolution and Revision Required reasons stored in DB per task. Replaces hardcoded `PENDING_REASONS` and `REVISION_REASONS`. Active/inactive toggle and sort order.
3. **Notification Rules** (`notification_rules`, migration 019) — DB-driven rules that fire when a task reaches a specific status+reason combination. Replaces hardcoded Permit Drop Off auto-note. Admin can create rules: task + status + reason -> action (note/notify role).
4. **Queue Sections** (`queue_sections`, migration 020) — Queue page sections are DB-driven instead of hardcoded. Admin can add/reorder/disable sections. Each section maps a task_id + match_status to a labeled collapsible section.
5. **User Preferences** (`user_preferences`, migration 021) — Per-user settings: homepage, default PM filter, collapsed sections state, queue card display fields, CSV export presets. RLS scoped to own row only.

**Note:** Migrations 017-021 have been applied to production Supabase. All admin-configurable tables are live.

### SQL Migrations

All in `supabase/`:
- `008-pm-id-migration.sql` — PM ID field on projects
- `009-audit-log.sql` — audit_log table
- `010-roles.sql` — user roles
- `011-rls-roles.sql` — RLS with role-based policies
- `012-new-fields.sql` — follow_up_date, reinspection_fee, task notes, funding defaults
- `013-adders.sql` — project_adders table
- `014-hoa.sql` — HOA reference table
- `015-mentions.sql` — mention_notifications table
- `016-scale-optimization.sql` — DB indexes, helper functions, funding_dashboard view
- `017-financiers.sql` — Financier reference table
- `018-configurable-reasons.sql` — Task reasons in DB (pending/revision per task)
- `019-notification-rules.sql` — DB-driven notification rules
- `020-queue-config.sql` — DB-driven queue sections
- `021-user-preferences.sql` — Per-user UI preferences
- `022-legacy-projects.sql` — Legacy projects and legacy notes tables (retroactive — tables were created directly in production Supabase, migration file added for documentation). `legacy_projects` stores 14,705 In Service TriSMART projects; `legacy_notes` stores 150,633 BluChat messages for 8,299 legacy projects.
- `023-document-management.sql` — Document management tables: `project_files` (Drive file inventory), `document_requirements` (admin-configurable required docs per stage), `project_documents` (per-project document status tracking)
- `024-equipment.sql` — Equipment catalog table (2,517 items: panels, inverters, batteries, optimizers)
- `025-inventory.sql` — Inventory Phase 1: `project_materials` table (per-project material lists with status tracking) and `warehouse_stock` table (BOS warehouse stock levels with reorder points). Indexes on project_id, status, equipment_id, category.
- `026-purchase-orders.sql` — Inventory Phase 2: `purchase_orders` table (PO tracking with lifecycle timestamps) and `po_line_items` table (line items linked to materials and equipment). Indexes on status, vendor, project_id, po_id.
- `027-warehouse-transactions.sql` — Inventory Phase 3: `warehouse_transactions` table for check-out/check-in/adjustment audit trail with FK to warehouse_stock. Indexes on stock_id, project_id, transaction_type. RLS: SELECT/INSERT for authenticated users.
- `028-edge-sync.sql` — EDGE sync log table (`edge_sync_log`) for MicroGRID-EDGE bidirectional webhook integration. Tracks all outbound and inbound webhook events with payload, status, and response code. Indexes on project_id, event_type, created_at DESC. RLS: SELECT/INSERT for authenticated users.
- `029-vendors.sql` — Vendor management table with category, equipment types array, lead time, payment terms. Trigram/category/active indexes. RLS: read/write for authenticated, delete for super_admin.
- `030-work-orders.sql` — Work order system: `work_orders` table (field work tracking with status lifecycle, crew assignment, customer signature, time tracking) and `wo_checklist_items` table (per-WO checklist with completion tracking). Indexes on project_id, status, scheduled_date, assigned_crew, work_order_id.
- `031-email-onboarding.sql` — Email onboarding table (`email_onboarding`) for 30-day training series tracking with user enrollment, current day, pause/resume, completion status
- `032-schedule-end-date.sql` — Adds `end_date` DATE column to `schedule` table for multi-day job support
- `033-warehouse-barcode.sql` — Adds `barcode` TEXT column to `warehouse_stock` for barcode/QR scanning. Indexed for fast lookup by `lookupByBarcode()` on the `/mobile/scan` page.
- `seed-document-requirements.sql` — Seeds 23 document requirements across all 7 pipeline stages

### Legacy Projects

The `legacy_projects` table stores 14,705 In Service projects imported from TriSMART/NetSuite. The `legacy_notes` table stores 150,633 BluChat messages for 8,299 of those projects. These are historical records not actively managed in the pipeline.

- **Table**: `legacy_projects` (~45 fields) — `id` (TEXT PK, format `PROJ-XXXXX`), `name`, `address`, `city`, `state`, `zip`, `stage`, `disposition`, `pm`, `financier`, `system_kw`, `panel_count`, `panel_type`, `inverter_type`, `contract_amount`, `sale_date`, `install_complete_date`, `pto_date`, `msp_bus_rating`, plus M2/M3 funding fields and more
- **Table**: `legacy_notes` — `id` (UUID PK), `project_id` (TEXT FK), `author` (TEXT), `message` (TEXT), `created_at` (TIMESTAMPTZ). 150,633 records for 8,299 projects.
- **Page**: `/legacy` — read-only lookup with search (name/phone/email/address/city/ID), sortable columns, detail panel with sections (Customer, System, Financial, Dates, Permit, Funding, Notes). New notes can be added by any team member.
- **Import scripts**: `scripts/import-legacy-projects.ts` (parses NetSuite JSON export), `scripts/upload-legacy-projects.ts` (uploads to Supabase in batches, filters to In Service only), `scripts/upload-legacy-notes.ts` (uploads BluChat messages). 500 records skipped (null names).
- **Import utilities**: `lib/legacy-import-utils.ts` — 8 extracted pure functions for field mapping, date parsing, and data transformation.
- **Funding merge**: 12,054 funding records (M2/M3 amounts and dates) merged into legacy_projects from project_funding data.
- RLS: read-only for all authenticated users (both tables).

### Construction Banner

The construction banner (`SHOW_BANNER`) is disabled (`false`). The banner component no longer renders.

### Security

**Headers** — `next.config.ts` includes security headers applied to all routes:
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME type sniffing
- `Referrer-Policy: origin-when-cross-origin` — limits referrer information
- `X-XSS-Protection: 1; mode=block` — enables XSS filtering
- `Strict-Transport-Security: max-age=63072000` — HSTS enforcement

**Auth** — Email domain whitelist enforced on sign-in: only `@gomicrogridenergy.com`, `@energydevelopmentgroup.com`, and `@trismartsolar.com` domains are allowed. Unauthorized domains are redirected to login with an error message.

**Webhook** — SubHub webhook secret comparison uses timing-safe comparison (`timingSafeEqual`) to prevent timing attacks.

**Data masking** — AHJ credentials (login usernames/passwords) are masked in the UI and only visible on explicit reveal.

**Error sanitization** — API error responses do not expose internal details; stack traces and Supabase error messages are logged server-side only.

### E2E Tests

Playwright is installed for end-to-end testing. Three smoke test specs live in `e2e/`:
- Basic navigation and page load verification
- Run with `npx playwright test`

### Import / Sync Scripts

All in `scripts/`:
- `import-legacy-projects.ts` — parses NetSuite JSON export into legacy project records
- `upload-legacy-projects.ts` — uploads parsed legacy projects to Supabase in batches
- `upload-legacy-notes.ts` — uploads 150K BluChat messages to `legacy_notes` table
- `import-action-comments.ts` — parses NetSuite stage CSV exports into task-level note records
- `upload-action-comments.ts` — uploads 127K action comments to `notes` table with `[NS]` prefix and `task_id`
- `sync-drive-files.py` — Python script to scan Google Drive shared drive and export file metadata as JSON
- `upload-drive-files.ts` — uploads Drive file metadata JSON to `project_files` table
- `import-equipment.ts` — parses equipment data for catalog import
- `upload-equipment.ts` — uploads equipment catalog to `equipment` table in batches

### File Consolidation (Complete)

All three planned consolidation targets from Session 15 have been completed in Session 16:

**Admin page** — `app/admin/page.tsx` split into 21 components in `components/admin/`:
- `shared.tsx` — shared styles, types, and utility components (SectionShell, ModalShell, etc.)
- `UsersManager.tsx`, `CrewsManager.tsx`, `AHJManager.tsx`, `UtilityManager.tsx`, `HOAManager.tsx`
- `FinancierManager.tsx`, `ReasonsManager.tsx`, `NotificationRulesManager.tsx`, `QueueConfigManager.tsx`
- `SLAManager.tsx`, `FeedbackManager.tsx`, `AuditTrailManager.tsx`, `PermissionMatrix.tsx`, `VendorManager.tsx`
- `EmailManager.tsx`, `CRMInfo.tsx`, `ReleaseNotes.tsx`

**ProjectPanel** — `components/project/FilesTab.tsx` extracted as standalone component.

**Command Center** — `lib/classify.ts` extracted from `app/command/page.tsx`. Contains `classify()`, `cycleDays()`, `getSLA()`, `getStuckTasks()` with full TypeScript types. The Command Center page itself was later redesigned from a 10-section urgency view to a morning dashboard with personal stats, action items, pipeline snapshot, and sortable project table.

### Code Quality

**Current rating: 9.5/10** (up from 9/10 after Session 16). Session 17 improvements (~63 commits): three comprehensive audits fixed 100+ total issues across security, performance, and scale (40 + 39 + 30 issues across dozens of files). Type safety: 82 `as any` casts removed (down from ~43 to 3 remaining). Cache upgraded to LRU eviction (50 entries max) with 5-min TTL for scale readiness to 5K projects. Auth gates added to batch, planset, crew, vendors, and inventory pages. Dead `loyalty` column dropped, permission matrix updated to reflect actual RLS, Cancel/Reactivate gated to Admin+, legacy projects page and import pipeline (14,705 projects + 150K notes), API layer expanded (6 new functions, 4 pages migrated), document management system (3 tables, file browser, missing docs report, Admin management), 127K NetSuite action comments imported, nav redesigned to two-tier, pipeline utility filter + multi-select AHJ/Utility, construction banner removed, security headers added, equipment catalog (2,517 items with autocomplete and auto-kW calculation), Atlas AI Reports (Manager+, 25/day session-based rate limiting), inventory management (3 phases: materials, POs, warehouse), vendor management (CRUD + admin portal), mobile views (leadership dashboard + field operator), EDGE bidirectional webhook integration, help page overhaul (55 topics across 12 categories), email domain whitelist on auth. **677 tests total (665 passed, 12 skipped)** (SLA tests remain skipped while thresholds are paused). **E2E tests:** Playwright installed with 20+ E2E test specs in `e2e/`. Remaining debt: 3 `as any` casts in test mocks.

## Known Bugs

- **SLA thresholds paused** — all set to 999. Backlog projects are too old for meaningful SLA tracking. Re-enable once stage_dates are reset for active backlog.
- RLS policies are enforced but still evolving. `auth_is_admin()` and `auth_is_super_admin()` Postgres functions gate write access based on the `role` column. Some tables may still have permissive policies that need tightening.
- The `active` field on `crews` is a string instead of a boolean, leading to defensive dual-case checking throughout the codebase.
- `useSupabaseQuery` only supports typed tables from `types/database.ts` — cannot query views (e.g., `funding_dashboard`) or untyped tables directly. Use `lib/api/` or `db()` for those.
- **SubHub webhook requires service role key** — `SUPABASE_SECRET_KEY` must be set in environment variables. Without it, the webhook returns 500 on POST requests.

## @Mention System

Notes support @mentions for tagging team members. Type `@` in any note input to trigger an autocomplete dropdown of active users (filtered to `@gomicrogridenergy.com` emails). Select a name to insert the mention. Mentions render as **green highlighted names** (`text-green-400`) in note text. When a user is mentioned, a notification is created in the `mention_notifications` table. The **notification bell** in the nav bar polls every 30 seconds for new notifications. Clicking a mention notification navigates to `/pipeline?open=PROJ-ID&tab=notes`, opening the project panel directly on the Notes tab. Migration: `supabase/015-mentions.sql`.

### Note Deletion

Notes can be deleted via a hover X button that appears on each note. A confirmation dialog prevents accidental deletion. The `deleteNote` function is passed from `ProjectPanel` to `NotesTab`.

### mention_notifications Table

- **mention_notifications** — notification records for @mentions. Fields: `id`, `mentioned_user_id`, `mentioned_by`, `project_id`, `message`, `read`, `created_at`. Migration: `supabase/015-mentions.sql`. RLS scoped so users can only read their own notifications. Read state is tracked client-side in localStorage (`mg_notif_read`) and server-side via the `read` column.

### Notification Bell

`NotificationBell` component in the nav bar shows unread count badge. Polls every 30s via `useNotifications` hook. Shows blocked projects, recent task revisions/pending resolutions, and @mention notifications. Clicking a mention notification opens `/pipeline?open=PROJ-ID&tab=notes`; clicking other notifications navigates to `/queue?search=PROJ-ID`.

## HOA Manager

The Admin portal includes an HOA Manager for managing 421 HOA records stored in the `hoas` table. HOA data is referenced in the project Info tab with autocomplete lookup. The Info tab shows HOA contact details (name, phone, email, website, notes) when matched. Admin portal supports full add, view, edit, delete on HOA records.

### hoas Table

- **hoas** — HOA reference data. Fields: `id`, `name`, `phone`, `website`, `contact_name`, `contact_email`, `notes`. 421 records. Used for autocomplete in project Info tab.

## Vendor Management

Vendor/supplier directory accessible from the nav bar "More" dropdown and the Admin portal.

### Vendors Page (`/vendors`)

Standalone page at `/vendors`. Displays all vendors in a searchable, filterable table with:
- **Summary cards** — counts by category (manufacturer, distributor, subcontractor, other)
- **Filters** — search (name, contact, city, email), category dropdown, equipment type dropdown
- **Inline editing** — click a row to expand an edit panel below the table with all vendor fields
- **Equipment types** — multi-select toggles for modules, inverters, batteries, racking, electrical, other
- **Active toggle** — click the green dot to activate/deactivate a vendor
- **Delete** — super-admin only, with confirmation dialog
- **Add Vendor** — form at the top of the page with all fields

### VendorManager (Admin)

Admin portal section (`components/admin/VendorManager.tsx`) provides the same add, edit, delete functionality in a modal-based interface with search, category filter, and table view. Uses shared admin components (`Input`, `Textarea`, `Modal`, `SaveBtn`, `SearchBar`).

### API Layer

`lib/api/vendors.ts` exports: `loadVendors(activeOnly?)`, `searchVendors(query)`, `loadVendor(id)`, `addVendor(vendor)`, `updateVendor(id, updates)`, `deleteVendor(id)`. Constants: `VENDOR_CATEGORIES` (manufacturer/distributor/subcontractor/other), `EQUIPMENT_TYPE_OPTIONS` (modules/inverters/batteries/racking/electrical/other). Uses `db()` helper and `escapeIlike()` for search.

## Work Orders

The `/work-orders` page provides field work tracking and completion. Work orders are linked to projects and follow a status lifecycle: draft -> assigned -> in_progress -> complete (or cancelled at any non-terminal stage).

### Work Order Types and Checklist Templates

Five work order types, each with a default checklist template defined in `WO_CHECKLIST_TEMPLATES`:
- **Install** (9 items) — equipment delivery, roof prep, panels, wiring, inverter, battery, system test, cleanup, customer walkthrough
- **Inspection** (5 items) — permit verification, visual inspection, electrical test, photos, submit results
- **Service** (4 items) — diagnose, repair/maintain, test, customer sign-off
- **Survey** (4 items) — roof measurement, electrical panel, photos, shade analysis, customer questions
- **Repair** (6 items) — diagnose, identify parts, repair, test, cleanup, customer sign-off

When creating a work order, users can use the default template, add custom items, or combine both. Checklist items can be added, toggled, and deleted after creation.

### Status Flow

Status transitions are enforced by `getValidTransitions()`:
- **Draft** -> Assigned, Cancelled
- **Assigned** -> In Progress, Cancelled
- **In Progress** -> Complete, Cancelled
- **Complete** / **Cancelled** -> (terminal, no further transitions)

`started_at` is auto-set when moving to In Progress. `completed_at` is auto-set when moving to Complete.

### Page Features

- **Summary cards** — Open, In Progress, Completed Today, Total counts
- **Filter bar** — text search (WO#, project, crew, person), status dropdown, type dropdown
- **Expandable rows** — click a work order to expand inline detail with checklist, notes, time tracking, customer signature, and status action buttons
- **Create modal** — project ID, type, priority, crew, scheduled date, assigned person, description, special instructions, checklist customization
- **Realtime** — subscribes to `work_orders` table changes via `useRealtimeSubscription`
- **ProjectPanel integration** — click a project name to open the full project modal

### WO Number Format

Auto-generated as `WO-YYYYMMDD-NNN` (e.g., `WO-20260326-001`). Sequential per day, zero-padded to 3 digits. Generated by `generateWONumber()` which queries the highest existing number for the current date.

### Convenience Functions

- `createWorkOrderFromProject(projectId, type, project, options?)` — creates a work order pre-filled with project details and location
- `loadProjectWorkOrders(projectId)` — loads all work orders for a given project (limit 50, newest first)

## Permit Drop Off Notification

When the City Permit task is set to "Pending Resolution" with reason "Permit Drop Off/Pickup", a system note is auto-created on the project: `[Scheduling Alert] City permit requires drop-off/pickup. Please schedule a service call.` A toast notification confirms the scheduling team was notified.

## ProjectPanel Deep Linking

`ProjectPanel` accepts an `initialTab` prop (`'tasks' | 'notes' | 'info' | 'bom' | 'files'`) to open on a specific tab. The Pipeline page supports URL params `?open=PROJ-ID&tab=notes` for deep linking directly to a project's tab (used by notification bell for @mention navigation).

## Address Search

Pipeline, Queue, and Funding pages all include address in their search filter. Search matches against project name, ID, city, and address simultaneously.

## PM Dropdown Filtering

The PM dropdown in the project Info tab and the @mention autocomplete both filter users to `@gomicrogridenergy.com` email domain using `.like('email', '%@gomicrogridenergy.com')`.

## Follow-up Date Location

Follow-up dates exist only on tasks (`task_state.follow_up_date`) and at the project level (`projects.follow_up_date`). The follow-up date field was removed from the project Info tab — it is managed through task notes panels and surfaces in the Queue page's "Follow-ups Today" section.

## Loyalty Queue Section

On the Queue page, Loyalty projects are separated into their own collapsible section (purple-themed) and excluded from all other queue sections. Smart filters (stage, financier, AHJ, blocked, days range) apply to Loyalty projects as well. This ensures Loyalty projects are visible and filterable but do not clutter the active workflow sections.

## Document Management

Three database tables power the document management system (migration `023-document-management.sql`):

- **`project_files`** — file inventory synced from Google Drive. Fields: `project_id`, `folder_name`, `file_name`, `file_id` (Drive ID), `file_url`, `mime_type`, `file_size`, `synced_at`. Unique on `(project_id, file_id)`. Trigram index on `file_name` for search.
- **`document_requirements`** — admin-configurable required documents per stage. Fields: `stage`, `task_id`, `document_type`, `folder_name`, `filename_pattern`, `required`, `description`, `sort_order`, `active`. 23 requirements seeded across all 7 stages (e.g., "Signed Contract" in Evaluation, "Permit Application" in Permitting). Admin-only write access.
- **`project_documents`** — tracks present/missing/pending/verified status per project per requirement. Fields: `project_id`, `requirement_id`, `file_id`, `status` (present/missing/pending/verified), `verified_by`, `verified_at`, `notes`.

**Pages:**
- `/documents` — file browser hub. Search across all project files, paginated at 50/page, with file type icons and size formatting.
- `/documents/missing` — missing documents report. Shows projects with incomplete required documents, filterable by stage.

**Components:**
- `components/project/FilesTab.tsx` — includes a `DocumentChecklist` showing required documents for the project's current stage with present/missing status indicators.
- `components/admin/DocumentRequirementsManager.tsx` — Admin management for document requirements (add/edit/delete/reorder/toggle active).

**API:** `lib/api/documents.ts` — `loadAllProjectFiles`, `searchAllProjectFiles`, `loadProjectFiles`, `loadDocumentRequirements`, `loadProjectDocuments`, `upsertProjectDocument`.

**Scripts:**
- `scripts/sync-drive-files.py` — Python script to scan Google Drive and export file metadata as JSON for upload.
- `scripts/upload-drive-files.ts` — TypeScript script to upload Drive file metadata to `project_files` table.

## NetSuite Action Comments

127,207 NetSuite action comments were imported as task-level notes with an `[NS]` prefix. These are historical workflow comments from NetSuite actions (e.g., task status changes, permit submissions, inspection results) that provide context for project history.

**Data source:** 7 stage-specific CSV files exported from NetSuite, each containing action comments with timestamps, authors, and task mappings.

**Import pipeline:**
- `scripts/import-action-comments.ts` — parses NetSuite CSV exports, maps actions to MicroGRID task IDs, formats as note records.
- `scripts/upload-action-comments.ts` — uploads parsed comments to the `notes` table with `task_id` set and `[NS]` prefix on each message.

**Display:** Action comments appear in per-task note panels in ProjectPanel's Tasks tab, interleaved with regular notes. The `[NS]` prefix distinguishes imported historical comments from user-created notes.

## Onboarding Email System

30-day automated training email series for new MicroGRID users, powered by **Resend**.

### Architecture

- `lib/email.ts` — Resend client wrapper. Singleton `getResend()` with lazy init. `sendEmail(to, subject, html)` sends from `nova@gomicrogridenergy.com`. Gracefully no-ops if `RESEND_API_KEY` is not set.
- `lib/email-templates.ts` — 30 HTML email templates (one per day), organized into 4 weeks: Foundations (days 1-7), Operations (days 8-14), Power Features (days 15-21), Mastery (days 22-30). Each template is a factory function `(name: string) => { subject, html }` wrapped in a dark-themed HTML layout with CTA buttons. Exports: `getTemplate(day, userName)`, `getMaxDay()` (returns 30).
- `app/api/email/send-daily/route.ts` — GET endpoint triggered by Vercel Cron. Loads active (non-paused, non-completed) enrollments from `email_onboarding`, sends the next day's template to each, advances `current_day`, and marks completed at day 30. Skips if already sent today. Auth: `CRON_SECRET` bearer token.
- `app/api/email/enroll/route.ts` — POST endpoint. Creates an enrollment in `email_onboarding` and immediately sends Day 1. Deduplicates by `user_id`.
- `app/api/email/announce/route.ts` — POST endpoint. Sends a one-off announcement email to all active users (or filtered by role). Wraps provided HTML in the MicroGRID email layout. Auth: optional `ADMIN_API_SECRET`.
- `components/admin/EmailManager.tsx` — Admin portal section (`email_onboarding` module). Shows enrollment stats (total/active/paused/completed), searchable table with day progress, status badges, and pause/resume per user. Super admin actions: "Enroll All Users", "Trigger Daily Send", "Send Announcement" (modal with subject, message, role filter). Includes a 30-day progress bar visualization.

### Database Table

- **`email_onboarding`** — enrollment tracking. Fields: `id`, `user_id`, `user_email`, `user_name`, `current_day` (1-30), `started_at`, `last_sent_at`, `paused` (boolean), `completed` (boolean).

### Cron Schedule

Configured in `vercel.json`: `0 13 * * 1-5` (weekdays at 8 AM CT / 1 PM UTC).

### Environment Variables

- `RESEND_API_KEY` — Resend API key (required for email sending; no-ops without it)
- `CRON_SECRET` — bearer token for the `/api/email/send-daily` cron endpoint
- `ADMIN_API_SECRET` — optional auth for the `/api/email/announce` endpoint
- `NEXT_PUBLIC_APP_URL` — base URL for CTA links in emails (defaults to `https://nova.gomicrogridenergy.com`)

## Sentry Error Tracking

Sentry is integrated via `@sentry/nextjs` for error monitoring, performance tracing, and session replay on errors.

**Config files:**
- `sentry.client.config.ts` — browser-side init (tracing at 10%, replay on errors only)
- `sentry.server.config.ts` — Node.js server-side init
- `sentry.edge.config.ts` — Edge runtime init
- `instrumentation.ts` — Next.js instrumentation hook that imports server/edge configs at runtime
- `next.config.ts` — wrapped with `withSentryConfig` (source map upload disabled until org/project configured)
- `app/error.tsx` and `app/global-error.tsx` — call `Sentry.captureException(error)` on render

**Graceful degradation:** If `NEXT_PUBLIC_SENTRY_DSN` is not set, Sentry does not initialize and has zero runtime impact. No crashes, no console errors.

**Environment variable:**
- `NEXT_PUBLIC_SENTRY_DSN` — Sentry DSN (e.g., `https://examplePublicKey@o0.ingest.sentry.io/0`). Set in Vercel to activate. Optional — app works fine without it.

**To enable source map uploads** (recommended for production): set `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` env vars, then set `sourcemaps.disable` to `false` in `next.config.ts`.

## Co-Author Convention

All commits use `Atlas (Claude Opus 4.6)` as co-author:
```
Co-Authored-By: Atlas (Claude Opus 4.6) <noreply@anthropic.com>
```
