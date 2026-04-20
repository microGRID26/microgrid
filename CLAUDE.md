Built and maintained by Atlas (AI assistant) for MicroGRID Energy / EDGE.

# CLAUDE.md

Essential guidance for Claude Code. Detailed reference in `ARCHITECTURE.md`.

## Session Startup (auto-orient)

At the start of EVERY new conversation, before doing anything else:
1. Read the latest session state memory file (check MEMORY.md for the most recent `session*_state.md`)
2. Read feedback files: `feedback_audit_rubric.md`, `feedback_self_prompt_protocol.md`, `feedback_straight_talk.md`
3. Run `git log --oneline -5` and `npm test -- --run` (tail last 5 lines)
4. Report: latest commit, test count, any failures, last session summary, blocked items
5. Ask Greg what he wants to work on

Keep the report under 20 lines. If tests fail or TS errors exist, flag prominently.

## Project

MicroGRID — solar project management system for MicroGRID Energy / EDGE. Tracks ~920 active residential solar installation projects (`projects` table where `disposition='Sale'`) through a 7-stage pipeline (evaluation → survey → design → permit → install → inspection → complete). Built for PMs who each own a set of projects. Migrated from NetSuite.

**Data architecture (verified post-cleanup 2026-04-08):**
- `projects` table: 1,567 rows total
  - 920 `Sale` (active pipeline — what every page shows)
  - 391 `Cancelled`, 149 `Loyalty`, 106 `Legal`, 1 `On Hold`
  - 0 `In Service` (shadow copies removed in cleanup)
- `legacy_projects` table: 15,585 rows (canonical NetSuite archive: 15,330 In Service, 149 Loyalty, 106 Legal)
- **April 6 2026 import event + Apr 8 cleanup:** On 2026-04-06, ~15,090 rows were bulk-inserted into `projects` from `legacy_projects` (no commit, no documentation). On 2026-04-08, drift investigation found that the import had brought in **223 corrected contract values** from a fresher NetSuite source where `legacy_projects.contract` had $0 placeholders. Cleanup steps:
  1. Backfilled the 223 corrected contract values from `projects` → `legacy_projects` (preserved the corrections in the canonical archive)
  2. Deleted the 15,098 shadow copies from `projects` (CASCADE removed 43 `project_adders` rows)
  3. Cleaned ~832 orphan rows in `task_state`/`task_history`/`service_calls`/`project_funding` that pointed to deleted projects (no FK enforced these)
- **`legacy_projects` is now the canonical archive** for In Service projects (15,585 rows: 15,330 In Service, 149 Loyalty, 106 Legal). `projects` table contains active pipeline only (~920 Sale + 391 Cancelled + 149 Loyalty + 106 Legal + 1 On Hold).
- `/legacy` page reads from `legacy_projects` directly. Drift check `npx tsx scripts/check-legacy-drift.ts` is preserved for future safety.
- **Manual review TODO:** 3 contract values have a true disagreement between `projects` and `legacy_projects` (both positive, different values, all `projects < legacy`). These were preserved in both tables — check whether the legacy value (higher) or the projects value (lower) is correct:
  - PROJ-1716 Damaris Renteria — projects=$13,280.64, legacy=$31,939.41
  - PROJ-3620 Robert Hassell — projects=$6,150, legacy=$20,202
  - PROJ-12649 Gabe Harman — projects=$72,000, legacy=$73,000

## Commands

```bash
npm run dev        # Dev server on :3000
npm run build      # Production build (Next.js)
npm run lint       # ESLint (Next.js + TypeScript presets)
npm test           # Run all tests (Vitest, single run)
npm run test:watch # Run tests in watch mode
```

Auto-deploys to Vercel on push to `main`.

## Tech Stack

- **Next.js 16** (App Router, `"use client"` pages — no RSC data fetching)
- **React 19** + TypeScript (strict)
- **Tailwind CSS v4** (PostCSS plugin, not config-based)
- **Supabase** — PostgreSQL, Auth (Google OAuth), Realtime subscriptions
- **No state management library** — pure `useState`/`useEffect`/`useCallback` + Supabase realtime
- **Leaflet** — maps (ramp-up planner proximity clustering)
- **Resend** — transactional email (onboarding, digest, announcements)
- **Sentry** — error tracking (optional, activated by `NEXT_PUBLIC_SENTRY_DSN`)
- **date-fns** — date manipulation
- **lucide-react** — icons

### Native Mobile App (`/mobile`)

A standalone Expo React Native app lives in the `/mobile` directory with its own `package.json` and `app.json`. It is the customer-facing companion to the web portal (`/portal/*`). **Not part of the Next.js build** — it has its own dependency tree and dev server.

- **Expo SDK 54** + React Native 0.81 + React 19 + TypeScript
- **Expo Router 6** (file-based routing) with tab navigation (Home, Support, Atlas, Account)
- **Supabase** client with `expo-secure-store` for token persistence
- **Push notifications** via `expo-notifications` (Expo Push Token saved to `customer_accounts.push_token`)
- **Commands**: `cd mobile && npm install && npx expo start`

## Testing

**Vitest** + React Testing Library with jsdom. **3,259 tests across 118 files** (verified 2026-04-15, Session 51). Supabase globally mocked in `vitest.setup.ts`. Tests focus on business logic, not rendering. When adding features, add corresponding tests. API route tests in `__tests__/api/`.

Test categories: `__tests__/lib/` (API, utils), `__tests__/logic/` (SLA, funding, filters), `__tests__/pages/` (page logic), `__tests__/auth/` (OAuth, proxy), `__tests__/hooks/` (custom hooks), `__tests__/components/` (UI components).

## Architecture Patterns

### Pages
All pages in `app/*/page.tsx` as client components. Each fetches data via Supabase browser client on mount, subscribes to realtime changes. Root `/` redirects to user's preferred homepage.

**51 pages total** — see `ARCHITECTURE.md` for full inventory. Key pages: `/command` (morning briefing — Fix These First + Push These Forward), `/queue` (PM worklist), `/pipeline` (Kanban), `/analytics` (10 tabs: Executive, Cash Flow, Install Velocity, Pipeline, By PM, Sales, Crew, Forecast, Job Costing, Operations), `/schedule` (crew calendar), `/funding` (M1/M2/M3 milestones + Ready to Collect cards), `/tickets` (issue tracking), `/ramp-up` (install planning with proximity clustering + schedule sync).

### API Layer
All data access via `lib/api/` — 20+ modules. Pages import from `@/lib/api`. The API layer handles error logging, type casting, `.limit()` calls, and consistent return shapes. Use `db()` helper from `lib/db.ts` for writes to untyped tables.

### Hooks (`lib/hooks/`)
- **`useSupabaseQuery<T>`** — generic data fetching with LRU cache (50 entries, 5-min TTL), request dedup, stale-while-revalidate, pagination, realtime subscriptions, org-scoped filtering. `clearQueryCache()` after bulk mutations.
- **`useProjectTasks`** — all task automation logic (500+ lines): status changes, revision cascade, auto-advance stage, funding triggers, blocker detection, notification rules.
- **`useOrg`** — multi-tenant org context via `OrgProvider`. Returns `orgId`, `orgName`, `switchOrg`.
- **`usePmFilter`** — shared PM dropdown state for Command/Queue.
- **`useServerFilter`** — filter/search state management producing Supabase query params.
- **`useEdgeSync`** — fire-and-forget EDGE webhook triggers.

### Realtime
`supabase.channel().on('postgres_changes', ...)` pattern. `useSupabaseQuery` supports `subscribe: true` with optional `realtimeFilter` for scoped subscriptions.

### Task Automation Chain
When task statuses change in ProjectPanel:
1. Auto-populate project dates (11 task→date mappings)
2. Auto-advance stage when last required task completes
3. Auto-detect/clear blockers on stuck tasks
4. Funding milestone triggers (Install Complete → M2 Eligible, PTO → M3 Eligible)
5. Revision cascade resets downstream tasks + clears dates
6. Auto-set dependent tasks to Ready To Start
7. Auto-set In Service disposition on final task

### Multi-Tenant Organizations
`organizations` + `org_memberships` tables. `org_id` on 8 tables. Org-scoped RLS on 30 tables (migration 043). `useOrg()` hook provides context. Default org: MicroGRID Energy (`a0000000-...0001`). `OrgSwitcher` component in nav for multi-org users.

### Offboarding convention
**Offboard a user by flipping `users.active=false`** — never by deleting `org_memberships` rows or `users` rows. Migration 130 makes every RLS helper (`auth_user_org_ids`, `auth_is_platform_user`, `auth_is_org_member/admin`, `auth_is_admin`, `auth_is_super_admin`, `auth_user_role`, `auth_is_internal_writer`) short-circuit on `active=false`, and `provision_user` skips re-adding memberships for inactive rows. Deleting membership rows alone does not stick — `provision_user` re-adds them on next OAuth login.

## Style Conventions

- Dark theme: `bg-gray-900` (page), `bg-gray-800` (cards), green accent (`#1D9E75` / `text-green-400`)
- Status colors: green = on track, amber = at risk, red = critical/blocked, blue = in progress
- Font: Inter (Google Fonts)
- Use `cn()` from `lib/utils.ts` for conditional Tailwind classes
- Icon library: `lucide-react`
- Date formatting: `fmtDate()` and `daysAgo()` helpers (native Date API, returns `'—'` for null)
- Currency: `fmt$()` — whole dollars, no decimals on dashboards

## Critical Patterns

### Filter Pattern
When combining search with dropdown filters, do NOT early-return the search match. This was a recurring bug:
```typescript
// WRONG — search overrides other filters
if (search.trim()) { return name.includes(q) || id.includes(q) }
// RIGHT — search narrows, other filters still apply
if (search.trim()) { if (!name.includes(q) && !id.includes(q)) return false }
return true
```

### Search Sanitization
All `.ilike()` queries must use `escapeIlike()` from `lib/utils.ts` to escape `%`, `_`, `\`.

### cycleDays Helper
`daysAgo()` returns `0` for null. Use `||` not `??` when falling back:
```typescript
daysAgo(p.sale_date) || daysAgo(p.stage_date)  // RIGHT
daysAgo(p.sale_date) ?? daysAgo(p.stage_date)   // WRONG — 0 won't trigger ??
```

### Crews Table Quirk
`active` column is a **string** (`'TRUE'`/`'FALSE'`), not boolean. Filter with `.eq('active', 'TRUE')`.

### TypeScript
`types/database.ts` covers core tables. Some tables (project_funding, service_calls, ahjs, utilities, users) accessed via `lib/api/` or `db()` helper. **~9 intentional `as any` casts in production code**, all admin/partner-API paths where the service-role client accesses untyped tables (partner_api_logs, partner_event_outbox, partner partitions) and the reports/chat planner where the query output is schema-validated at runtime. Each is tagged with `eslint-disable-next-line @typescript-eslint/no-explicit-any` and scoped to one expression. Do NOT add new casts outside these paths — use API layer or `db()` instead. 1 `: any` remains in `mobile/app/onboarding.tsx` (Feather icon name from external data, acceptable).

### Disposition Filtering
States: `null`/`'Sale'` (active), `'Loyalty'`, `'In Service'`, `'Cancelled'`. `Cancelled` always excluded from active views. Loyalty shown in Queue/Audit (intentional). Transitions constrained: Sale → Loyalty → Cancelled (no skipping).

### Centralized Constants
- `lib/utils.ts` — `SLA_THRESHOLDS`, `STAGE_LABELS`, `STAGE_ORDER`
- `lib/tasks.ts` — `TASKS`, `ALL_TASKS_MAP`, `TASK_DATE_FIELDS`, `JOB_LABELS`, `INTERNAL_DOMAINS`
- All job type labels centralized in `lib/tasks.ts` (JOB_LABELS). Do not hardcode job type display strings elsewhere.
- Internal email domains centralized as `INTERNAL_DOMAINS` in `lib/tasks.ts`.

## Security

### Auth
Email domain whitelist: `@gomicrogridenergy.com`, `@energydevelopmentgroup.com`, `@trismartsolar.com`. Unauthorized domains redirected to login.

### Route Protection (two layers)
1. **Server-side** (`proxy.ts`) — role-based route access with hierarchy: super_admin(5) > admin(4) > finance(3) > manager(2) > user(1) > sales(0). Role cached in httpOnly cookie (5 min). Admin/System always query DB.
2. **Client-side** — operational pages check `useCurrentUser().isManager`.

### Role-Based Access
`users.role`: super_admin, admin, finance, manager, user. RLS via `auth_is_admin()` / `auth_is_super_admin()`. All authenticated users can create/edit projects. Delete is super-admin-only. Cancel/Reactivate is admin+.

### Org-Scoped RLS
30 tables have org-scoped SELECT policies. Direct `org_id` check on 8 tables, EXISTS subquery via `project_id` on 16 tables, FK inheritance on 3 tables. All include `org_id IS NULL` backward compat + `auth_is_platform_user()` for cross-org visibility. When adding new tables with `project_id`, add org-scoped RLS using the EXISTS pattern from migration 043.

### Security Headers
`next.config.ts`: X-Frame-Options DENY, nosniff, HSTS, XSS protection, Content-Security-Policy. Webhook secrets use timing-safe comparison. Role cookie HMAC-signed to prevent forgery.

## Supabase Configuration
- `pgrst.db_max_rows` = 50000
- All project queries use `.limit(2000)`, task_state `.limit(50000)`
- All `lib/api/` queries have explicit `.limit()` calls (55 limits across 16 files)
- Reference tables: `.limit(500)`, data tables: `.limit(1000)`-`.limit(2000)`, equipment: `.limit(5000)`

## QA Daily Driver

Daily QA banner on `/command` (Command Center) that hands each tester one specific test case per day. Mirrors the SPARK QA Daily Driver (Spark migration 035 / Session 16).

**Gate:** authenticated user MUST have at least one `test_assignments` row OR be admin/manager/super_admin (admin override sees the full role-filtered pool). 8 testers already have assignments — see `test_assignments` table.

**Tables:** `qa_runs`, `qa_run_events` (migration 096). `tester_id` is `text` matching `users.id` (NOT auth.uid()).

**Selection algorithm** (`lib/qa/case-selection.ts`, pure / unit-tested):
1. Filter cases the tester has run in the last 14 days (cooldown).
2. Filter by role — MicroGRID has `role_filter` values `'all'`, `'manager'`, `'admin'`. `user`/`sales`/`finance` see `'all'` only; `manager` sees `all` + `manager`; admins see everything.
3. Sort by priority desc → days-since-last-run desc → plan/case sort_order → daily seed hash (`djb2(testerId:utcDate:caseId)`).
4. When `assignedCaseIds` is non-null, the picker is constrained to ONLY those cases.

**Components:**
- `components/qa/QADailyDriver.tsx` — banner mounted in `app/command/page.tsx` between Nav and filter bar
- `components/qa/QARunOverlay.tsx` — global side panel mounted in `components/Providers.tsx` via Suspense, activates when URL has `?qa_run=<id>`
- `app/testing/components/QADrivers.tsx` — Daily Drivers sub-tab inside the existing Admin testing panel (toggle: Manual Tests / Daily Drivers)
- `app/testing/components/QAEditor.tsx` — inline "New Plan" / "New Case" forms inside Manual Tests sub-tab

**API routes:**
- `GET /api/qa/today` — returns `{ done, streak, case|activeRun, empty?, hasMore? }`. Accepts `?force=1` for "Run another"
- `POST /api/qa/runs/start` — creates qa_runs row, idempotent for double-clicks
- `POST /api/qa/runs/[id]/event` — append qa_run_events (nav, console_error, click, etc.)
- `POST /api/qa/runs/[id]/complete` — atomic claim → finalize → dual-write test_results
- `POST /api/qa/runs/[id]/skip` — finalize as skipped
- `POST /api/qa/skip-today` — create a fresh skipped row when banner hits Skip without ever starting
- `POST /api/admin/qa-plans` — admin only, create new plan
- `POST /api/admin/qa-cases` — admin only, create new case
- `GET /api/cron/qa-runs-cleanup` — daily 5 AM UTC, abandons stale `started` runs (>8h)

**Type note:** the Database type doesn't include qa_runs/qa_run_events, so `lib/qa/server.ts` uses an untyped admin client (cast to `any`). All input validation is enforced explicitly in the routes.

## Cron Jobs (Vercel)
- `/api/email/send-daily` — weekdays 1 PM UTC (onboarding emails) — fleet slug `mg-email-send-daily`
- `/api/email/onboarding-reminder` — weekdays 3 PM UTC — fleet slug `mg-email-onboarding-reminder`
- `/api/email/digest` — weekdays noon UTC (PM digest) — fleet slug `mg-email-digest`
- `/api/cron/qa-runs-cleanup` — daily 5 AM UTC (abandons stale QA runs >8h) — fleet slug `mg-qa-runs-cleanup`
- `/api/cron/partner-event-fanout` — every 1 min (drains partner_event_outbox, POSTs to env-configured partners) — fleet slug `mg-partner-event-fanout`
- `/api/cron/partner-logs-retention` — daily 5 AM UTC (partition maintenance + idempotency sweep for partner API) — fleet slug `mg-partner-logs-retention`

## ATLAS HQ Fleet Reporting
All four crons above self-report to the ATLAS HQ `/intel` Agent Runs tab via `lib/hq-fleet.ts` → `atlas_report_agent_run` RPC on the MG Supabase. Each route is wrapped in a try/finally that posts one row per execution with status, items processed, and a human-readable output summary. Failure is non-blocking: if `HQ_*` env vars aren't set, `reportFleetRun()` silently returns false and the cron still succeeds on its own terms.

**Status derivation:**
- `success` — all work completed without errors
- `partial` — some per-item errors (e.g., some emails failed to send) but the route completed
- `error` — hard failure (query error, internal error, early 5xx return)

**Required Vercel env vars (already set on `microgrid` project):**
- `HQ_SUPABASE_URL` — `https://hzymsezqfxzpbcqryeim.supabase.co` (same as MG itself)
- `HQ_SUPABASE_PUBLISHABLE_KEY` — MG publishable key (grants RPC access)
- `HQ_FLEET_SECRET` — shared secret validated by the write-path RPC

**Adding a new cron:** after wiring up the route + `vercel.json` entry, (1) insert a row into `atlas_agents` on the MG Supabase with slug/name/schedule/description, (2) wrap the route body in a try/finally that calls `reportFleetRun({ slug, status, startedAt, finishedAt: new Date(), itemsProcessed, outputSummary, errorMessage })`. The new agent shows up in HQ `/intel` → Agent Runs automatically.

## Known Issues

Real quirks and limitations to be aware of:

- `active` field on `crews` is string `'TRUE'`/`'FALSE'`, not boolean. Filter with `.eq('active', 'TRUE')`.
- `useSupabaseQuery` cannot query views or untyped tables — use `lib/api/` or `db()` helper instead.
- SubHub webhook requires `SUPABASE_SECRET_KEY` env var.
- Ops dashboard "Last Year" period only queries active `projects` table, not `legacy_projects` — historical year-over-year comparisons will undercount.
- CSP uses `unsafe-inline` in script-src (Next.js requirement). `unsafe-eval` removed in production, kept in dev.
- Role cookie HMAC prefers `ROLE_COOKIE_SECRET` env var, falls back to anon key. Set the explicit secret in Vercel for prod.
- 1 oversized file remains: `app/tickets/page.tsx` at 893 lines (5 components already extracted; the rest is tightly coupled page logic).
- 1 `: any` remains in `mobile/app/onboarding.tsx` (Feather icon name from external data, acceptable).
- `db()` return type is untyped by design.
- Greg's local `npm install` in `mobile/` hangs silently after the version line — likely lockfile/cache/post-install issue. Doesn't affect EAS Build (remote does its own clean install) but blocks local mobile dev. Try `rm -rf node_modules package-lock.json && npm install` or `npm cache clean --force`.

## Conventions

Always-do patterns. Breaking these will be caught in audit.

- **`escapeFilterValue()`** in `utils.ts` for PostgREST `.or()` contexts. Use instead of `escapeIlike()` in `.or()` strings. All existing `.or()` calls use it.
- **`timingSafeEqual()`** for ALL secret/token comparison in API routes — never plain `===`. Use `import { timingSafeEqual } from 'crypto'` (ESM) — never `require('crypto')`.
- **`.trim()` every webhook env-var read** — URL and secret. Whitespace in Vercel UI silently kills HMAC comparison (2026-04-17 incident: leading space in `EDGE_WEBHOOK_SECRET` killed MG↔EDGE for 14 days; trailing newline in SPARK's `NOVA_WEBHOOK_URL` killed SPARK→MG). Current trim sites: `lib/api/edge-sync.ts`, `app/api/webhooks/edge/route.ts`, `app/api/webhooks/subhub/route.ts`, `app/api/webhooks/subhub-vwc/route.ts`. Add to any new webhook endpoint.
- **Rate limiting** via `lib/rate-limit.ts` — uses Upstash Redis when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, falls back to in-memory. All sensitive routes are rate-limited.
- **`INACTIVE_DISPOSITIONS`** / **`INACTIVE_DISPOSITION_FILTER`** constants in `utils.ts` for all active project queries. Includes: In Service, Loyalty, Cancelled, Legal, On Hold, Test. Never inline the filter string — import the constant so adding a new inactive state is a one-line change. The `Test` disposition was added 2026-04-14 for 10 test/QA rows that were inflating dashboards; new test rows in MG CRM should be flagged `disposition='Test'` at creation time.
- **Error boundaries:** all user-facing routes have `error.tsx` files (parent boundaries cover nested routes).
- **`lib/tasks.ts`** is the single source of truth for `JOB_LABELS` and `JOB_LABELS_SHORT`. Never redefine job labels locally.
- **`lib/api/` API wrappers** for cross-page queries: `loadLiveStats()`, `loadAHJs()`, `loadProjectsForMap()`, `loadOrgNames()`, `loadTodaySchedule()`, `loadScheduleForCrewWeek()`.
- **Atlas IS the customer feedback admin UI** — query `customer_feedback` directly via Supabase MCP when Greg asks to "look at the feedback." No CRM `/feedback` page by design (see `feedback_atlas_collects_app_feedback.md` memory).
- **Run integrity checks BEFORE recommending destructive cleanup**, never as the first step of execution. Session 29 near-miss almost cost ~$7M in contract corrections (see `feedback_drift_check_before_destructive.md` memory).

## Migrations Log

Running list of applied Supabase migrations (recent first):

| # | Purpose |
|---|---|
| **119** | B→A: `projects.subhub_id` column + unique partial index. Closes SubHub webhook idempotency gap where a typo in `name` or `address` created duplicate projects. `/api/webhooks/subhub` now prefers `subhub_id` for dedup; DB unique index is the ultimate backstop. |
| **118** | B→A: drop 5 broad SELECT policies on `storage.objects` for public buckets (`customer-feedback`, `Project-documents`, `rep-files`, `ticket-attachments`, `wo-photos`). Public buckets serve via direct URL — they don't need a SELECT policy, and having one enables LIST operations that let clients enumerate every file. Zero TS callers use `.list()` on these buckets (pre-check grep). |
| **117** | B→A: `auth_is_internal_writer()` helper (modeled on `auth_is_admin()`) + DO-block replacement of 89 `rls_policy_always_true` policies across ~35 tables. Swaps `USING(true)` / `WITH CHECK(true)` for `auth_is_internal_writer()`. Strictly tighter than today (today = any authenticated session; after = active + role-assigned users row only). Service_role bypasses RLS so cron/backfill paths are unaffected. |
| **116** | B→A: pin `search_path = public, extensions, pg_catalog` on 17 functions flagged by Supabase advisor as `function_search_path_mutable`. Closes the schema-shadowing attack vector where an attacker with CREATE on a schema earlier in the caller's path could shadow an unqualified name. Includes `extensions` for any future trgm-using refactor. |
| **115** | B→A: move `pg_trgm` out of `public` into `extensions` schema + set per-role default `search_path = public, extensions` on `authenticated`/`anon`/`service_role`. 3 GIN indexes use `gin_trgm_ops` — `ALTER EXTENSION SET SCHEMA` preserves them via OID references. 0 function bodies call pg_trgm ops directly (verified), so 116 didn't need trgm special-casing. |
| **114** | #94 R2 — revoke `EXECUTE FROM PUBLIC` on 53 `atlas_*` RPCs (kept on `atlas_report_agent_run`). Migration 113 missed PUBLIC (the implicit role anon/authenticated inherit from) so anon still slipped through via the default grant. R2 curl test caught it by successfully inserting an attacker `greg_actions` row; this migration revokes PUBLIC and deletes the polluted id=95 row. Post-fix: anon returns 401 "permission denied for function" at the PostgREST layer. |
| **113** | #94 R1 — revoke anon/authenticated EXECUTE on 53 `atlas_*` SECURITY DEFINER RPCs. Anon-key holder could previously POST `/rest/v1/rpc/atlas_hq_create_user` with `{role:'owner'}` and mint an HQ owner-level user. Now only `service_role` executes HQ-only RPCs. Auth-flow RPCs (`atlas_hq_get_user_role`, `atlas_hq_link_auth_user`) and 11 EDGE-MODEL RPCs keep `authenticated` for the user-JWT path. `atlas_report_agent_run` keeps anon — it self-gates via `p_secret`. HQ + EDGE-MODEL Vercel env vars (`MICROGRID_SUPABASE_SERVICE_KEY`) flipped to `sb_secret_*` so server paths now resolve as service_role. HQ `.env.local` updated so `greg_actions.py` + `atlas_session.py` scripts keep working. |
| **112** | Drop `users.users_update` permissive policy — had `USING(true)`, role=`public`, bypassing admin-only `users_write(auth_is_admin())`. Any authenticated Google-OAuth employee could `UPDATE users SET role='admin', super_admin=true` on any row and escalate. Only client write to `users` is `components/admin/UsersManager.tsx` (admin-only), which still passes `users_write`. |
| **111** | Security audit R1 — RLS enabled on `rep_licenses` + `rep_files` (admin-only policies, 10 rows of rep PII previously readable via anon key); RLS enabled on 6 partner partition children; `ensure_partner_partitions` patched to enable RLS on future children; 4 views switched to `security_invoker=true` (`ticket_metrics`, `funding_dashboard`, `project_cost_basis_summary`, `ticket_rep_stats`) closing a leak where per-kW cost basis was returned to all authenticated users despite the API route being role-gated. |
| **110** | Partner API Phase 3 — adds `projects.origination_partner_org_id` (FK → organizations), `origination_partner_actor_id` (FK → partner_actors), and `partner_documents JSONB NOT NULL DEFAULT '[]'`. Partial index on `origination_partner_org_id WHERE NOT NULL` keeps the index small since most projects come via SubHub/web UI. Enables Solicit (D2D) leads via `POST /api/v1/partner/leads` with attribution to the originating org + rep. |
| **109** | Partner API platform foundation — 7 tables (`partner_api_keys`, `partner_actors`, `partner_webhook_subscriptions`, `partner_event_outbox`, `partner_webhook_deliveries`, `partner_idempotency_keys`, `partner_api_logs`). Delivery + logs tables are monthly range-partitioned with partial `(status, next_attempt_at)` indexes; 90-day retention via `ensure_partner_partitions` + `drop_old_partner_partitions` RPCs. `partner_emit_event` outbox writer RPC called from mutation sites. Extends `organizations.org_type` CHECK with `sales_d2d`. URL-format CHECK on webhook subscriptions. RLS platform-internal; partners flow through the Next.js API layer under a service-role client. |
| **107** | Tier 2 Phase 4.2 — `workmanship_claims` (5-status lifecycle `pending → deployed → invoiced → recovered | voided`) + `funding_deductions` (open chargebacks netted from EPC's next `EPC → EDGE` invoice payment). RLS internal-only. Void transitions cancel open deductions (Session 50 R2 High fix). |
| **106** | Tier 2 Phase 4.1 — `sales_dealer_relationships` (EPC ↔ MicroGRID Energy originator contracts, status lifecycle `pending_signature → active → suspended → terminated`) + `epc_underwriting_fees` (fee_type: `one_time_onboarding | recurring_gatekeeping | per_project_review`). **Billing direction: MG Energy → EDGE pays** (EDGE bears capital risk, not onboarding EPC). RLS platform-internal via `auth_is_platform_user()`. Session 51 shipped the admin UI (`components/admin/DealerRelationshipsManager.tsx`). |
| **105** | Tier 2 Phase 3.2 — `entity_profit_transfers` append-only ledger for DSE Corp → SPE2 profit auto-transfers. Unique partial index on `(triggered_by_invoice_id) WHERE transfer_type='auto'` makes the recorder idempotent. RLS internal-only (platform + DSE Corp org members). Status starts `pending`; banking integration (Phase 3.2b) flips to `paid` when ACH settles. |
| **104** | Tier 2 Phase 3.1 — `clearing_runs` audit table for chain orchestrator firings. `mode` discriminator (`gross_substantiation` default; `netted_eod` future toggle when tax equity investors are comfortable per Paul). Captures `total_gross`, `invoices_created`, `invoices_skipped`, `fired_rule_ids` JSONB. Append-only with internal-only RLS. |
| **103** | Tier 2 Phase 2.2 — Project Cost Reconciliation catalog seed. 28 line items from the proforma's `Project Cost Reconciliation & Basis` sheet rows 3–30. Per-kW basis for hybrid inverters / PV modules / mounting. Per-kWh for battery modules. GPU is `is_itc_excluded=true`. Field execution labor lines are `is_epc_internal=true`. |
| **102** | Tier 2 Phase 2.1 — `project_cost_line_item_templates` catalog table + `project_cost_line_items` per-project instances + `project_cost_basis_summary` view aggregating I34:M39 from proforma. Unique partial index on `(project_id, template_id)` prevents duplicate-row drift on re-backfill. RLS internal-only via platform + `direct_supply_equity_corp` org membership. |
| **101** | Tier 2 Phase 1.6 — `invoice_attestations` append-only table for capturing the EPC certification signature on EPC→EDGE invoices. Snapshots `attestation_text` at sign time so future text changes don't retroactively rewrite signed records. Unique index on `invoice_id`. RLS gated to from/to org members. |
| **100** | Tier 2 Phase 1.2 — adds `rule_kind` discriminator (`milestone | chain | monthly`) to `invoice_rules`. Backfills 2 existing monthly VPP rules. Seeds 5 new chain rules: DSE→NewCo, NewCo→EPC, Rush→EPC, MG Sales→EPC, EPC→EDGE. Existing milestone trigger filters `rule_kind='milestone'` so the two paths don't collide. |
| **099** | Tier 2 Phase 1.1 — extends `organizations.org_type` CHECK constraint with `direct_supply_equity_corp` and `newco_distribution`. Seeds DSE Corp + NewCo Distribution LLC + Rush Engineering placeholder orgs. Upserts canonical MicroGRID Energy row (id `a0000000-0000-0000-0000-000000000001`, slug `microgrid` — NOT `microgrid-energy`) with `is_sales_originator=true` + `is_underwriter=true` flags. **Lesson: always upsert canonical org by id, not slug.** |
| **098** | Tier 1 invoicing automation — `viewed_at`, `generated_by`, `rule_id` on invoices; `billing_email` / `billing_address` on organizations; unique partial index on `(project_id, rule_id, milestone)` for idempotent rule-driven invoice generation. |
| **096** | QA Daily Driver — `qa_runs` + `qa_run_events` tables for the daily QA banner on `/command`. Indexes on `(tester_id, started_at desc)`, `test_case_id`, `status`. RLS mirrors test_results (permissive read/write for authenticated, admin override via `auth_is_admin()`). |
| **088** | NPS support — adds `'nps'` category to `customer_feedback`, extends rating CHECK to 0-10, adds `customer_accounts.nps_prompts_shown JSONB` for one-shot prompt tracking |
| **087** | Customer in-app feedback — `customer_feedback` + `customer_feedback_attachments` tables, RLS, public storage bucket `customer-feedback` |
| **086** | Security fixes — tightened `customer_messages.cm_update_read` (was wide-open `USING(true)`), added `org_id` + org-scoped RLS to `customer_payment_methods` and `customer_payments` |
| **085** | QA testing framework (5 tables) |
| **084** | `customer_messages` with Realtime |
| **083** | `customer_billing_statements` + `customer_payment_methods` + `customer_payments` |
| **082** | `customer_referrals` |
| **081** | `permit_submissions` + AHJ e-filing columns |
| **080** | `material_requests` + `material_request_items`, `photo_audit_*` on work_orders, `meet_link` on calendar_sync |
| **079** | `cancellation_fee` + `cancellation_fee_status` on projects |
| **078** | `vendors` table + `vendor_onboarding_docs` |
| **077** | JSA tables (`jsa`, `jsa_activities`, `jsa_acknowledgements`) |
| **076** | 11 performance indexes, `aggregate_earnings` RPC, milestone progression trigger |
| **072** | `org_id` column on `schedule` table |
| **043** | Org-scoped RLS enforcement (30 tables) |

**Postgres triggers in production:**
- M1→M2→M3 funding progression (can't submit M2 before M1, M3 before M2)
- `link_customer_account_on_signup()` — auto-links pre-seeded `customer_accounts` to `auth.users` on first OTP login (Session 29)

## Features Reference

Quick map of where things live:

- **Partner API platform (Phase 1+2+3, 2026-04-16):** Multi-tenant API for external vendors (Rush Engineering, Solicit D2D, NewCo Supply, future partners). Endpoint namespace: `/api/v1/partner/*`. Auth: Stripe-style bearer (`mg_live_<32 base62 chars>`, SHA-256 hashed at rest). `withPartnerAuth()` middleware enforces: pre-auth IP rate limit (120/min/IP), bearer extract, DB key lookup, org-active gate, Redis revoke-bit kill switch, per-tier per-category rate limit, scope check, optional `X-MG-Actor` actor resolution against `partner_actors`. 10 scopes in `lib/partner-api/scope-constants.ts`. Tiers: standard / premium / unlimited. Monthly-partitioned `partner_api_logs` + `partner_webhook_deliveries` tables with 90-day retention. **Phase 1**: auth, scopes, rate-limit, idempotency, logger, admin UI (`/admin` → Partner API module), `/api/v1/partner/me`. **Phase 2**: transactional outbox (`partner_event_outbox` + `partner_emit_event` RPC) fired from `lib/api/engineering.ts` mutations; env-configured partner registry (`PARTNER_WEBHOOKS` JSON); SSRF guard; outbound HMAC signing (`X-MG-Signature-256`, `X-MG-Timestamp`); fanout cron; Rush endpoints: `GET/PATCH /engineering/assignments`, `POST /deliverables`, `GET /projects/:id`, `/photos`, `/planset` (structured JSON). **Phase 3**: Solicit lead endpoints — `POST /leads` (actor + idempotency required, creates a project row with `origination_partner_*` attribution, generates `LEAD-<12 hex>` id), `GET /leads` (cursor paged), `GET /leads/:id`, `PATCH /leads/:id` (whitelisted fields only, non-string values coerced to null for clearing), `GET /leads/:id/status` (lightweight milestone read joining project_funding), `POST /leads/:id/documents` (appends to `projects.partner_documents` JSONB). Actor CRUD under `/api/admin/partner-actors/*`. Lead validators extracted to `lib/partner-api/leads.ts` for pure testability. Migration 110 adds origination columns + partner_documents. Events: `lead.created`, `lead.updated`, `lead.document_uploaded`. **Phase 4 (webhook subscription CRUD + retry queue + signed-URL planset) is the next build.**
- **Tier 2 invoicing chain (DSE → NewCo → EPC → EDGE):** Per Mark Bench's 2026-04-13 meeting, every project can generate a 4-link tax-substantiation chain via `POST /api/invoices/generate-chain` (admin-gated). Chain rules live in `invoice_rules` with `rule_kind='chain'` and are loaded by the orchestrator at `lib/invoices/chain.ts`. Self-invoice skip when MicroGRID Energy is both the sales originator AND the EPC. 8.25% TX sales tax applied only on the EPC→EDGE link. Each chain firing writes a `clearing_runs` audit row. When a DSE→NewCo invoice transitions to `paid`, `lib/invoices/profit-transfer.ts` auto-records a profit row in `entity_profit_transfers` targeting `SPE2`. Branded per-tenant PDFs render via `lib/invoices/pdf.tsx` `BrandTheme` (resolved from `organizations.settings.brand`). EPC→EDGE PDFs render the certification block + signature lines for the EPC attestation flow at `app/api/invoices/[id]/attest/route.ts`. **Phase 3 is RECORD ONLY** — banking integration is Phase 3.1b/3.2b, blocked on queue #52 (clearing-house provider decision).
- **Tier 2 Phase 4 — sales-dealer relationships + workmanship chargebacks (Session 50):** Migration 106 adds `sales_dealer_relationships` (EPC → MG Energy originator contracts) and `epc_underwriting_fees` (MG Energy → EDGE billing). Migration 107 adds `workmanship_claims` + `funding_deductions` — when an `EPC → EDGE` invoice transitions to `paid` in `lib/api/invoices.ts`, `lib/invoices/funding-deductions.ts` pre-checks open `funding_deductions` for the EPC and writes `paid_amount = net` instead of `total`. NaN/Infinity guard on `grossAmount` (R2 Critical). Void of a workmanship claim cancels the already-created deduction so remediated issues aren't still charged. Admin UI shipped in Session 51: `components/admin/DealerRelationshipsManager.tsx` manages contracts + fees. `/warranty/claims` page (manager+ gated) for workmanship claim creation with EPC filter + deployed-EPC assignment modal. Phase 4 open item: **EPC onboarding-complete trigger** for auto-firing `epc_underwriting_fees` rows — blocked on queue #66.
- **Project Cost Reconciliation & Basis tab (Tier 2 Phase 2):** Internal-only "Cost Basis 🔒" subsection on every project's details tab. Pulls per-project rows from `project_cost_line_items` (28 catalog templates × 925 active projects = ~25,900 rows backfilled 2026-04-13). The catalog is at `project_cost_line_item_templates` and the math is in `lib/cost/calculator.ts` (pure: `distro = raw × (1 + K)`, `epc = distro × (1 + M)`). Aggregation via `project_cost_basis_summary` view mirroring proforma I34:M39. PDF render at `lib/cost/pdf.tsx` (single-page sectioned table + summary block + ITC eligible callout + colored row tints). API endpoints `app/api/projects/[id]/cost-basis/{,/pdf}/route.ts`. Tab component `components/project/ProjectCostBasisTab.tsx`. **NUMERIC fields come back from PostgREST as strings** — always coerce via the local `num()` helper before `.toFixed()` / `.toLocaleString()`. Backfill script at `scripts/backfill-project-cost-line-items.ts` (or use the SQL function `public.backfill_project_cost_line_items(text)` via Supabase MCP if local creds are stale).
- **Job costing:** `/job-costing` page (P&L, crew rates, cost entry), API at `lib/api/job-costing.ts`, auto-capture from WO completion
- **Auto-schedule suggestions:** SuggestionPanel on `/schedule`, API at `lib/api/schedule-suggestions.ts`
- **Vendor scorecard:** tab on `/vendors`, API at `lib/api/vendor-scorecard.ts`
- **Permit tracking:** tab on `/permits`, API at `lib/api/permit-submissions.ts`
- **Planset generator:** `/planset` produces 9 base + 4 enhanced (`?enhanced=1`) = 13 sheets. RUSH Engineering grade. Spatial SLD for ≤2 inverters. **Data flow:** `inverterCount` and `batteryCount` use Duracell defaults (2 inv, 16 batt), NOT `project.inverter_qty`/`battery_qty` (which are old microinverter/battery counts). Old values populate `existingInverterCount`/`existingPanelCount` for comparison display. Seraphim SRP-440-BTD-BG default panel. Print preloads images + waits for fonts.
- **Planset Phase 6 (Drive auto-pull + vision classification):** On project load, `/planset` calls `GET /api/planset/drive-photos?projectId=X` which pulls photos from the project's Google Drive folder and classifies them with Claude Haiku 4.5 vision. **Pipeline:**
  1. Query `project_folders` table for `folder_url`, parse Drive folder ID out of the URL (column `folder_id` is NULL for 98% of rows, URL is 100% populated)
  2. `lib/google-drive.ts` — service account JWT via `GOOGLE_CALENDAR_CREDENTIALS` env var (`drive.readonly` scope). Discover parent Shared Drive ID via `files.get`, then use `corpora=drive + driveId` on `files.list` (required for service accounts — `corpora=allDrives` silently returns empty)
  3. Find `07 Site Survey` and `08 Design` subfolders (08 is a nested workspace with 0 flat images, kept for file-count diagnostics)
  4. Take first 20 images ≤3MB (Anthropic vision cap), parallel download via `getFileBytes`
  5. `lib/planset/vision-classify.ts` — send each image to Claude Haiku 4.5 with a fixed prompt, classify into `aerial | house | site_plan | roof_plan | msp | inverter | battery | meter | roof_closeup | other`. 10s timeout per call, never throws (returns `'other'` on failure)
  6. Slot-fill: first `aerial` → PV-1, first `house` → PV-1, first 4 `{msp,inverter,battery,meter}` → PV-3.1 equipment slots. **PV-3 and PV-4 are intentionally NOT auto-filled** (decision via action #43, 2026-04-13) — those sheets render auto-generated vector module/roof drawings from project data, and a satellite photo would cover the exact module placement Rush Engineering needs to stamp. `site_plan`/`roof_plan` classifications still appear in `meta.classificationBreakdown` for diagnostics. Manual upload via `OverridesPanel` remains available if a user wants to override the auto-drawing with a photo.
- **Regex-based classification was attempted first and abandoned** — TriSMART's mobile checklist app names photos `checklist_media_tri_smart_site_survey_checklist_0.jpg` through `_120.jpg`, so filenames have zero semantic content. Vision is the only viable classifier for that data shape.
- **Cost envelope:** ~$0.0015 per Haiku vision call × 20 images = ~$0.03 per `/planset` open. 5-min in-memory cache per projectId. Rate limit tightened to 10/min/user on this endpoint to cap runaway cost at ~$0.30/min/user.
- **Proxy route:** `/api/planset/drive-image/[fileId]` streams Drive bytes with auth gate, MIME allowlist (`image/{jpeg,png,webp}`), 10MB size cap, browser cache 5 min. Drive doesn't support signed URLs so proxying is the only way to serve in `<img>` tags.
- **Failure modes surface in `meta.fallbackReason`:** `project_folders row not found` / `project has no drive folder` / `could not fetch parent folder metadata (check service account grant)` / `ANTHROPIC_API_KEY not set` / `drive listing failed: …`. `meta.classificationBreakdown` shows the label tally when classification ran.
- **Requires:** (1) `GOOGLE_CALENDAR_CREDENTIALS` env var set in Vercel, (2) Drive API enabled on the owning GCP project (microgrid-prod-493215), (3) service account granted Viewer on the `MicroGRID Projects` Shared Drive, (4) `ANTHROPIC_API_KEY` env var set. Missing any of these and auto-pull falls back silently to manual upload placeholders — zero regression on the existing manual flow.
- **`/legacy` page** reads from `legacy_projects` directly. Tab counts pulled live (not hardcoded).
- **Drift detection:** `npx tsx scripts/check-legacy-drift.ts` (pure logic in `lib/legacy-drift.ts`, exits 1 on disagreement, 11 unit tests)
- **Customer in-app feedback** (mobile): floating FAB on every `(tabs)` screen of customer app → category/rating/message/screenshots + auto-captures screen path + app version + device info via `react-native-view-shot`. Files: `mobile/lib/feedback.ts`, `mobile/components/FeedbackButton.tsx`, `mobile/components/FeedbackModal.tsx`, `mobile/components/NPSPrompt.tsx`. Storage bucket `customer-feedback` (public).
- **Privacy policy** at `/privacy` (public, no auth — added to `PUBLIC_ROUTES` in `proxy.ts`). Static page in `app/privacy/page.tsx`. App Store Connect → Privacy Policy URL points here. Required for App Store submission.
- **Account deletion** (App Store guideline 5.1.1(v)): mobile Account screen → "Delete Account" button → two-step typed-DELETE confirmation modal → calls `POST /api/customer/delete-account` → deletes `customer_accounts` row (FK CASCADE handles feedback/billing/payments/referrals) + `auth.users` row via admin client. Does NOT touch `projects`, `customer_messages`, or any installation business records (retained for warranty/legal per privacy policy). Rate limited 3/hour/user. Files: `app/api/customer/delete-account/route.ts`, `mobile/lib/api.ts` (`deleteCustomerAccount()`), `mobile/app/(tabs)/account.tsx`.
- **NPS prompts** trigger once per session 5s after entering tabs (deduped via useRef). Milestones: `pto_complete`, `first_billing_30d`, `onboarding_complete`.
- **Feedback reply API:** `POST /api/notifications/feedback-reply` (timing-safe + Supabase session auth, rate limit 30/min/feedback). Looks up feedback row, bumps `status='responded'`, fires Expo push via `sendCustomerFeedbackReplyNotification`. Atlas calls this after writing `admin_response`.
- **Customer billing/messaging/QA tables (082-085)** are fully typed in `types/database.ts`.
- **`/job-costing`** and **`/planset`** are in main nav (Financial + Tools sections).
- **8 pages refactored** with `components/` subfolders: infographic, command, fleet, planset, inventory, change-orders, work-orders, engineering.

## Mobile App Reference

- iOS app on TestFlight (Expo SDK 54, RN 0.81, build via EAS GitHub integration → Mac builders)
- **iOS 26 SDK deadline: April 28, 2026** — Apple ITMS-90725. Builds with iOS 18.4 SDK rejected after this date. Upgrade target: Expo SDK 55 (RN 0.83, Xcode 26). Effort: medium (1-3 days).
- **Account deletion flow** in `mobile/app/(tabs)/account.tsx` — required by Apple guideline 5.1.1(v). Two-step typed-DELETE confirmation modal calls `POST /api/customer/delete-account`.
- **Privacy Policy link** in mobile Account screen (Security section) opens `https://app.gomicrogridenergy.com/privacy` via `Linking.openURL`. (Custom domain configured 2026-04-09: GoDaddy CNAME `app` → Vercel. Replaces dead `nova.gomicrogridenergy.com` and the temporary Vercel default URL.)
- Folly coroutine fix: `plugins/withFollyFix.js` injects `-DFOLLY_CFG_NO_COROUTINES=1`
- Work order types: install, service, inspection, rnr (renamed from repair), survey
- Vendor categories: manufacturer, distributor, install_partner, electrical, plumbing, hvac, roofing, interior, other
- Ticket categories include `'monitoring'`
- Supabase Storage buckets: `wo-photos` (work order checklist photos), `customer-feedback` (in-app feedback screenshots, public)
- `react-native-view-shot@~4.0.3` for screen capture in feedback feature

## Co-Author Convention

```
Co-Authored-By: Atlas (Claude Opus 4.6) <noreply@anthropic.com>
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **MicroGRID** (4767 symbols, 11477 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/MicroGRID/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/MicroGRID/context` | Codebase overview, check index freshness |
| `gitnexus://repo/MicroGRID/clusters` | All functional areas |
| `gitnexus://repo/MicroGRID/processes` | All execution flows |
| `gitnexus://repo/MicroGRID/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
