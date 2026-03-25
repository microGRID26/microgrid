Built and maintained by Atlas (AI assistant) for MicroGRID Energy / EDGE.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MicroGRID CRM (NOVA) — solar project management system for MicroGRID Energy / EDGE. Tracks ~938 active residential solar installation projects through a 7-stage pipeline (evaluation → survey → design → permit → install → inspection → complete). Built for PMs (project managers) who each own a set of projects. Migrated from NetSuite (which is potentially permanently unavailable as of March 2026).

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
- `pages/` — page-level logic for command (9-section classification), pipeline (sort/filter), queue (priority), funding, schedule, service, admin
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

Key pages: `/command` (SLA dashboard), `/queue` (PM-filtered task-based worklist with collapsible sections), `/pipeline` (visual stage grid), `/analytics` (6 tabs: Leadership, Pipeline Health, By PM, Funding, Cycle Times, Dealers), `/audit` (task compliance), `/audit-trail` (admin-only change log with sortable columns, filters, pagination at 50/page, and ProjectPanel integration), `/schedule` (crew calendar), `/service`, `/funding` (M1/M2/M3 milestones with sortable columns, powered by `funding_dashboard` Postgres view), `/change-orders` (HCO/change order queue with 6-step workflow), `/documents` (file browser hub + `/documents/missing` missing docs report), `/reports` (AI-powered natural language query interface), `/legacy` (read-only lookup of 14,705 In Service legacy TriSMART projects), `/admin`, `/help`.

### API Layer

Centralized data access functions live in `lib/api/`:

- `lib/api/projects.ts` — `loadProjects`, `loadProjectFunding`, `updateProject`, `loadUsers`, `loadProjectAdders`, `addProjectAdder`, `deleteProjectAdder`, `loadProjectById`, `loadProjectsByIds`, `searchProjects`
- `lib/api/notes.ts` — `loadProjectNotes`, `loadTaskNotes`, `addNote`, `deleteNote`, `createMentionNotification`
- `lib/api/tasks.ts` — `upsertTaskState`, `loadTaskStates`, `loadTaskHistory`, `insertTaskHistory`
- `lib/api/schedules.ts` — `loadScheduleByDateRange`
- `lib/api/change-orders.ts` — `loadChangeOrders`
- `lib/api/crews.ts` — `loadCrewsByIds`, `loadActiveCrews`
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
- `lib/classify.ts` — extracted Command Center classification logic. Exports: `classify()` (projects → 10 sections), `cycleDays()`, `getSLA()`, `getStuckTasks()`. Types: `Section`, `Classified`, `TaskEntry`, `StuckTask`. Previously inline in `app/command/page.tsx`.
- `lib/hooks/` — reusable hook infrastructure (see [Hook Infrastructure](#hook-infrastructure) section below)
- `lib/export-utils.ts` — CSV export with field picker (50+ fields, grouped)
- `types/database.ts` — full TypeScript types for all Supabase tables
- `components/Nav.tsx` — two-tier navigation bar. 6 primary links always visible (Command, Queue, Pipeline, Schedule, Funding, Analytics) + "More" dropdown for secondary pages (Service, Change Orders, Documents, Reports, Redesign, Legacy). Audit Trail link in More dropdown for admins. Right-side slot for page controls.
- `components/project/ProjectPanel.tsx` — large modal (overview/tasks/notes/files/BOM tabs) used across multiple pages
- `components/project/FilesTab.tsx` — extracted Files tab component for ProjectPanel (Google Drive link or "no folder" state)
- `components/BulkActionBar.tsx` — bulk operations toolbar (see [Bulk Operations](#bulk-operations) section below)
- `components/Pagination.tsx` — reusable pagination control (see [Pagination](#pagination) section below)
- `components/admin/` — 16 extracted admin section components (see [File Consolidation](#file-consolidation-complete) section)
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
- **Module-level cache** with 30-second TTL, shared across hook instances
- **Request deduplication** — identical in-flight queries reuse the same promise
- **Stale-while-revalidate** — returns cached data immediately while refetching in background
- **Pagination** — pass `page: 1` to enable; returns `totalCount`, `hasMore`, `nextPage`, `prevPage`, `setPage`, `currentPage`
- **Realtime** — pass `subscribe: true` to auto-invalidate cache and refetch on postgres_changes
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
- **schedule** — crew assignments with `job_type` (survey/install/inspection/service)
- **project_funding** — M1/M2/M3 milestone amounts, dates, CB credits
- **stage_history** — audit trail of stage transitions
- **change_orders** — HCO/change order records. Fields: `project_id`, `title`, `type`, `reason`, `origin`, `priority`, `status` (Open/In Progress/Waiting On Signature/Complete/Cancelled), `assigned_to`, `created_by`, `notes` (chronological timestamped text). 6-step workflow booleans: `design_request_submitted`, `design_in_progress`, `design_pending_approval`, `design_approved`, `design_complete`, `design_signed`. Original/new design values: `original_panel_count`/`new_panel_count`, `original_system_size`/`new_system_size`, etc.
- **feedback** — user-submitted feedback. Fields: `type` (Bug/Feature Request/Improvement/Question), `message`, `status` (New/Reviewing/In Progress/Addressed/Won't Fix), `user_name`, `user_email`, `page`, `admin_notes`. Delete policy uses `auth_is_super_admin()` SECURITY DEFINER function.
- **user_sessions** — login/session tracking. Fields: `user_id`, `user_name`, `user_email`, `logged_in_at`, `last_active_at`, `page`. Updated via 60-second heartbeat from `SessionTracker` component. Duration computed client-side.
- **audit_log** — change audit trail. Records all project field changes with `project_id`, `field`, `old_value`, `new_value`, `changed_by`, `changed_by_id`, `changed_at`. Also logs project deletions (`field = 'project_deleted'`) before cascade.
- **ahjs**, **utilities** — reference data for permit authorities and utility companies
- **project_adders** — project adders/extras (e.g., EV charger, critter guard, ground mount). Fields: `id`, `project_id`, `name`, `price`, `quantity`, `created_at`. RLS open to all authenticated users. Migration: `supabase/013-adders.sql`. Contains 4,185 records imported from NetSuite.

### Data Inventory

As of March 2026: 938 active projects, 14,705 legacy In Service projects (imported from TriSMART/NetSuite), ~330K total notes (53K original project/task notes + 127,207 NetSuite action comments imported as task-level notes with [NS] prefix + 150,633 legacy BluChat notes for 8,299 legacy projects), 67K+ task history entries, 4,185 adders, 922 service cases, 12,054 funding records (937 active + ~11,117 legacy M2/M3), 4,500+ files in Google Drive across 937 project folders. NetSuite is potentially permanently unavailable.

### SLA System

SLA thresholds are centralized in `lib/utils.ts` (`SLA_THRESHOLDS`). Command Center classifies projects in priority order: Overdue → Blocked → Critical → At Risk → Stalled (5+ days, SLA ok) → Aging (90+ cycle days) → On Track. Loyalty and In Service dispositions are separated out.

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

### File References in Notes

File references in project notes are rendered as clickable blue links. Clicking a filename opens a Google Drive search for that filename within the project's Drive folder. Inline images (base64/data URIs) are excluded from link detection.

### Equipment and Crew History

Equipment specifications and crew assignments imported from NetSuite are stored as historical notes on their respective projects, preserving the original data as timestamped records.

### Service Page

The service page (`/service`) displays 922 imported service cases from NetSuite. Column names in the database use `issue`, `type`, `created`, `date` (not `issue_type`, `description`, `created_at`). The page queries `service_calls` and displays status, project, issue, type, and dates.

### Google Drive Integration

New projects auto-create a folder structure in the MicroGRID Projects shared Google Drive via a Google Apps Script webhook. The script creates 16 subfolders (01 Proposal through 20 Cases). The Drive folder URL is saved to the `project_folders` table and accessible from the Files tab in ProjectPanel.

### Queue Page (Task-Based Sections)

The Queue page (`/queue`) was redesigned with task-based sections instead of a flat priority-sorted list. Sections are collapsible (all start collapsed except Follow-ups Today):

1. **Follow-ups Today** — projects with task-level or project-level `follow_up_date` that is today or overdue
2. **City Permit Ready** — projects where `city_permit` task status is "Ready To Start"
3. **City Permit Submitted** — projects where `city_permit` task is In Progress, Scheduled, Pending Resolution, or Revision Required
4. **Utility Permit Submitted** — same as above for `util_permit` task
5. **Utility Inspection Ready** — projects where `util_insp` task is "Ready To Start"
6. **Utility Inspection Submitted** — same active statuses for `util_insp`
7. **Blocked** — projects with a non-null `blocker`
8. **Active** — everything not in a special section and not complete
9. **Complete** — projects in the `complete` stage

PM filter uses `pm_id` (user UUID) stored in localStorage as `mg_pm`. PM dropdown is populated from distinct PMs on loaded projects.

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

`types/database.ts` covers core tables (`projects`, `task_state`, `notes`, `crews`, `schedule`, `stage_history`, `project_folders`) plus types added during refactoring: `ServiceCall`, `HOA`, `MentionNotification`, `ProjectAdder`, `ProjectBom`. The `Schedule` interface was expanded with 11 new fields. Several tables used in the app — `project_funding`, `service_calls`, `ahjs`, `utilities`, `users`, `sla_thresholds` — are **not** in the generated types but are accessed through the `lib/api/` layer or `db()` helper which handle casting internally.

**Type safety improved**: `as any` casts reduced from ~198 to ~43 across the codebase. Remaining casts are justified (dynamic property access in admin, test mocks, Supabase RPC calls). New code should use the API layer (`@/lib/api`) or `db()` helper rather than adding new `as any` casts.

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
  - Pipeline uses server-side filtering for dropdowns (PM, financier, AHJ, utility — AHJ and Utility are multi-select) but client-side search with 350ms debounce (no server re-fetch on keystrokes)
  - Queue loads only queue-relevant task_state rows (8 specific task IDs + non-null follow_up_date)
  - Command loads only stuck/complete task_state rows (Pending Resolution, Revision Required, Complete)
  - Audit loads only non-Complete task_state rows

### SubHub Webhook

API endpoint at `/api/webhooks/subhub` (route: `app/api/webhooks/subhub/route.ts`). Receives POST from SubHub when a contract is signed. Creates the project, initial task states, stage history, funding record, Google Drive folder, and adders in NOVA.

- **Disabled by default** — requires `SUBHUB_WEBHOOK_ENABLED=true` in environment variables
- **Authentication** — optional `SUBHUB_WEBHOOK_SECRET` verified via `Authorization` or `X-Webhook-Secret` header
- **Requires `SUPABASE_SECRET_KEY`** — uses service role key for database writes (no anon key fallback). Will return 500 if not configured.
- **Idempotency** — checks for existing project by ID before creating to prevent duplicates
- **GET endpoint** — health check returning enabled/disabled status

### AI Reports

Natural language query interface at `/reports` (page: `app/reports/page.tsx`, API: `app/api/reports/chat/route.ts`). Users type questions about project data in plain English, and Claude generates a Supabase query plan, executes it, and returns results in a sortable table.

- **Access**: Manager+ role required (`isManager` check from `useCurrentUser`)
- **AI model**: Claude Sonnet (`claude-sonnet-4-6`) for fast query generation
- **Rate limiting**: 10 requests/minute + 25 requests/day per user (in-memory, per Vercel instance)
- **Allowed tables**: projects, project_funding, task_state, notes, schedule, service_calls, change_orders
- **Max results**: 500 rows per query
- **Features**: sortable results table, CSV export, follow-up suggestions, conversation history, clickable project IDs (opens ProjectPanel), starter prompts
- **Client-side filters**: `daysAgo_gt` and `daysAgo_lt` for date-relative queries (e.g., "projects stuck more than 30 days")
- **Security**: query plan validated before execution; only whitelisted tables/ops allowed; service role key used for read-only queries
- **Requires**: `ANTHROPIC_API_KEY` environment variable; returns 503 if not configured

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

1. **Financiers** (`financiers`, migration 017) — Reference table for financing companies. Admin CRUD in Admin portal, autocomplete in project Info tab. Seeded with 10 financiers (Cash, EDGE, Mosaic, Sungage, GoodLeap, Dividend, Sunrun, Tesla, Sunnova, Loanpal).
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
- `022-legacy-projects.sql` — Legacy projects table for 14,705 In Service TriSMART projects
- `legacy_notes` table — created directly in production (no numbered migration file). 150,633 BluChat messages for 8,299 legacy projects.
- `023-document-management.sql` — Document management tables: `project_files` (Drive file inventory), `document_requirements` (admin-configurable required docs per stage), `project_documents` (per-project document status tracking)
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

### Security Headers

`next.config.ts` includes security headers applied to all routes:
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME type sniffing
- `Referrer-Policy: origin-when-cross-origin` — limits referrer information
- `X-XSS-Protection: 1; mode=block` — enables XSS filtering

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

### File Consolidation (Complete)

All three planned consolidation targets from Session 15 have been completed in Session 16:

**Admin page** — `app/admin/page.tsx` split into 16 components in `components/admin/`:
- `shared.tsx` — shared styles, types, and utility components (SectionShell, ModalShell, etc.)
- `UsersManager.tsx`, `CrewsManager.tsx`, `AHJManager.tsx`, `UtilityManager.tsx`, `HOAManager.tsx`
- `FinancierManager.tsx`, `ReasonsManager.tsx`, `NotificationRulesManager.tsx`, `QueueConfigManager.tsx`
- `SLAManager.tsx`, `FeedbackManager.tsx`, `AuditTrailManager.tsx`, `PermissionMatrix.tsx`
- `CRMInfo.tsx`, `ReleaseNotes.tsx`

**ProjectPanel** — `components/project/FilesTab.tsx` extracted as standalone component.

**Command Center** — `lib/classify.ts` extracted from `app/command/page.tsx`. Contains `classify()`, `cycleDays()`, `getSLA()`, `getStuckTasks()` with full TypeScript types.

### Code Quality

**Current rating: 9.5/10** (up from 9/10 after Session 16). Session 17 improvements: comprehensive audit fixed 40 issues across 24 files, dead `loyalty` column dropped, permission matrix updated to reflect actual RLS, Cancel/Reactivate gated to Admin+, legacy projects page and import pipeline (14,705 projects + 150K notes), API layer expanded (6 new functions, 4 pages migrated), document management system (3 tables, file browser, missing docs report, admin CRUD), 127K NetSuite action comments imported, nav redesigned to two-tier, pipeline utility filter + multi-select AHJ/Utility, construction banner removed, security headers added. **447 tests passing with 0 failures, 12 skipped** (SLA tests remain skipped while thresholds are paused). **E2E tests:** Playwright installed with 3 smoke test specs in `e2e/`. Remaining debt: some untyped tables still accessed via `as any` casts (~43 remaining).

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

The Admin portal includes an HOA Manager for managing 421 HOA records stored in the `hoas` table. HOA data is referenced in the project Info tab with autocomplete lookup. The Info tab shows HOA contact details (name, phone, email, website, notes) when matched. Admin portal supports full CRUD on HOA records.

### hoas Table

- **hoas** — HOA reference data. Fields: `id`, `name`, `phone`, `website`, `contact_name`, `contact_email`, `notes`. 421 records. Used for autocomplete in project Info tab.

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

On the Queue page, Loyalty projects are separated into their own collapsible section (purple-themed) and excluded from all other queue sections. This ensures Loyalty projects are visible but do not clutter the active workflow sections.

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
- `components/admin/DocumentRequirementsManager.tsx` — admin CRUD for document requirements (add/edit/delete/reorder/toggle active).

**API:** `lib/api/documents.ts` — `loadAllProjectFiles`, `searchAllProjectFiles`, `loadProjectFiles`, `loadDocumentRequirements`, `loadProjectDocuments`, `upsertProjectDocument`.

**Scripts:**
- `scripts/sync-drive-files.py` — Python script to scan Google Drive and export file metadata as JSON for upload.
- `scripts/upload-drive-files.ts` — TypeScript script to upload Drive file metadata to `project_files` table.

## NetSuite Action Comments

127,207 NetSuite action comments were imported as task-level notes with an `[NS]` prefix. These are historical workflow comments from NetSuite actions (e.g., task status changes, permit submissions, inspection results) that provide context for project history.

**Data source:** 7 stage-specific CSV files exported from NetSuite, each containing action comments with timestamps, authors, and task mappings.

**Import pipeline:**
- `scripts/import-action-comments.ts` — parses NetSuite CSV exports, maps actions to NOVA task IDs, formats as note records.
- `scripts/upload-action-comments.ts` — uploads parsed comments to the `notes` table with `task_id` set and `[NS]` prefix on each message.

**Display:** Action comments appear in per-task note panels in ProjectPanel's Tasks tab, interleaved with regular notes. The `[NS]` prefix distinguishes imported historical comments from user-created notes.

## Co-Author Convention

All commits use `Atlas (Claude Opus 4.6)` as co-author:
```
Co-Authored-By: Atlas (Claude Opus 4.6) <noreply@anthropic.com>
```
