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

Key pages: `/command` (SLA dashboard), `/queue` (PM-filtered task-based worklist with collapsible sections), `/pipeline` (visual stage grid), `/analytics`, `/audit` (task compliance), `/schedule` (crew calendar), `/service`, `/funding` (M1/M2/M3 milestones with sortable columns), `/change-orders` (HCO/change order queue with 6-step workflow), `/admin`, `/help`.

### Data Layer

- `lib/supabase/client.ts` — browser Supabase client (used by all pages)
- `lib/supabase/server.ts` — server Supabase client (used by middleware)
- No API routes for data — pages query Supabase directly
- Realtime: `supabase.channel().on('postgres_changes', ...)` pattern in each page

### Shared Code

- `lib/utils.ts` — `cn()` (clsx+twMerge), `fmt$()`, `fmtDate()`, `daysAgo()`, `escapeIlike()` (sanitizes user input for Supabase `.ilike()` queries), `STAGE_LABELS`, `STAGE_ORDER`, `SLA_THRESHOLDS`, `STAGE_TASKS` (task definitions per stage)
- `lib/tasks.ts` — single source of truth for task definitions, statuses, reasons, and cascade helper. Exports: `TASKS`, `TASK_STATUSES`, `STATUS_STYLE`, `PENDING_REASONS`, `REVISION_REASONS`, `ALL_TASKS_MAP`, `ALL_TASKS_FLAT`, `TASK_TO_STAGE`, `TASK_DATE_FIELDS` (11 task→project date mappings), `getSameStageDownstream()` (BFS for revision cascade), `AHJ_REQUIRED_TASKS` (AHJ-conditional task requirements), `isTaskRequired()` (checks if a task is required given an AHJ). Includes cycle detection at module load.
- `lib/export-utils.ts` — CSV export with field picker (50+ fields, grouped)
- `types/database.ts` — full TypeScript types for all Supabase tables
- `components/Nav.tsx` — shared navigation bar with right-side slot for page controls
- `components/project/ProjectPanel.tsx` — large modal (overview/tasks/notes/files/BOM tabs) used across multiple pages
- `components/FeedbackButton.tsx` — floating feedback button rendered on every page (bottom-right corner). Submits to `feedback` table with type, message, user info, and current page. Insert allowed for all authenticated users via permissive RLS policy.
- `components/SessionTracker.tsx` — automatic session tracking component. Logs user sessions to `user_sessions` table with login time, current page, and 60-second heartbeat for duration. Auth fallback handles edge cases where session is not yet available.

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

As of March 2026: 938 projects, 53K+ notes (49,517 project-level + 3,660 task-level), 67K+ task history entries, 4,185 adders, 922 service cases, 937 project_funding records, 4,500+ files in Google Drive across 937 project folders. NetSuite is potentially permanently unavailable.

### SLA System

SLA thresholds are centralized in `lib/utils.ts` (`SLA_THRESHOLDS`). Command Center classifies projects in priority order: Overdue → Blocked → Critical → At Risk → Stalled (5+ days, SLA ok) → Aging (90+ cycle days) → On Track. Loyalty and In Service dispositions are separated out.

**SLA thresholds are currently paused** — all values are set to 999 in `SLA_THRESHOLDS` (original values preserved in comments). This means all projects will appear as "On Track" for SLA purposes until thresholds are re-enabled. The 12 SLA-related tests are skipped (`it.skip`) in the test suite.

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

`types/database.ts` only covers core tables (`projects`, `task_state`, `notes`, `crews`, `schedule`, `stage_history`, `project_folders`). Several tables used in the app — `project_funding`, `service_calls`, `ahjs`, `utilities`, `users`, `sla_thresholds`, `project_adders` — are **not** in the generated types. Pages that query these tables use `as any` casts on the Supabase response. When adding or modifying queries for these tables, expect to cast. The `admin/page.tsx` file is especially cast-heavy due to managing all the untyped reference tables.

Also note: the `Project` type defines a `loyalty: string | null` field, but it is **never read anywhere** in the codebase. All loyalty logic uses `p.disposition === 'Loyalty'` instead. The `loyalty` column appears to be legacy/dead.

### Role-Based Access

The `users` table has a `role` column with values: `super_admin`, `admin`, `finance`, `manager`, `user`. The `useCurrentUser()` hook returns `role`, `isAdmin`, `isSuperAdmin`, `isFinance`, `isManager` convenience booleans. RLS policies use `auth_is_admin()` and `auth_is_super_admin()` Postgres functions that check the `role` column. When adding admin-gated features, check `isAdmin` or `isSuperAdmin` from the hook on the client side; the database enforces the same via RLS.

**Permission model**: All authenticated users can create and edit projects (not just admins). Project deletion is super-admin-only. Admin portal access requires `admin` or `super_admin` role. Feedback submission uses a `SECURITY DEFINER` function to allow all users to insert regardless of RLS policies.

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

## Known Bugs

- The `loyalty` field on `projects` is unused — all loyalty logic checks `disposition === 'Loyalty'` instead. The column should eventually be dropped or reconciled.
- RLS policies are enforced but still evolving. `auth_is_admin()` and `auth_is_super_admin()` Postgres functions gate write access based on the `role` column. Some tables may still have permissive policies that need tightening.
- The `active` field on `crews` is a string instead of a boolean, leading to defensive dual-case checking throughout the codebase.

## @Mention System

Notes support @mentions for tagging team members. Type `@` in any note input to trigger an autocomplete dropdown of active users. Mentions render as green highlighted names in note text. When a user is mentioned, a notification is created in the `mention_notifications` table and surfaces via the bell icon in the nav bar. Migration: `supabase/015-mentions.sql`.

### mention_notifications Table

- **mention_notifications** — notification records for @mentions. Fields: `id`, `note_id`, `mentioned_user_id`, `mentioner_user_id`, `project_id`, `read`, `created_at`. Migration: `supabase/015-mentions.sql`. RLS scoped so users can only read their own notifications.

## HOA Manager

The Admin portal includes an HOA Manager for managing 421 HOA records. HOA data is referenced during the permitting stage to determine HOA approval requirements for projects.

## Permit Drop Off Notification

An automation that notifies PMs when permit-related tasks have been idle. Helps ensure permits do not stall without follow-up after submission.
