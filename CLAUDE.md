Built and maintained by Atlas (AI assistant) for MicroGRID Energy / EDGE.

# CLAUDE.md

Essential guidance for Claude Code. Detailed reference in `ARCHITECTURE.md`.

## Project

MicroGRID — solar project management system for MicroGRID Energy / EDGE. Tracks ~938 active residential solar installation projects through a 7-stage pipeline (evaluation → survey → design → permit → install → inspection → complete). Built for PMs who each own a set of projects. Migrated from NetSuite. 14,705 legacy In Service projects in `legacy_projects` table.

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

**Vitest** + React Testing Library with jsdom. 2,728+ tests across 90 files. Supabase globally mocked in `vitest.setup.ts`. Tests focus on business logic, not rendering. When adding features, add corresponding tests. API route tests in `__tests__/api/`.

Test categories: `__tests__/lib/` (API, utils), `__tests__/logic/` (SLA, funding, filters), `__tests__/pages/` (page logic), `__tests__/auth/` (OAuth, proxy), `__tests__/hooks/` (custom hooks), `__tests__/components/` (UI components).

## Architecture Patterns

### Pages
All pages in `app/*/page.tsx` as client components. Each fetches data via Supabase browser client on mount, subscribes to realtime changes. Root `/` redirects to user's preferred homepage.

**49 pages total** — see `ARCHITECTURE.md` for full inventory. Key pages: `/command` (morning briefing — Fix These First + Push These Forward), `/queue` (PM worklist), `/pipeline` (Kanban), `/analytics` (10 tabs: Executive, Cash Flow, Install Velocity, Pipeline, By PM, Sales, Crew, Forecast, Job Costing, Operations), `/schedule` (crew calendar), `/funding` (M1/M2/M3 milestones + Ready to Collect cards), `/tickets` (issue tracking), `/ramp-up` (install planning with proximity clustering + schedule sync).

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
`types/database.ts` covers core tables. Some tables (project_funding, service_calls, ahjs, utilities, users) accessed via `lib/api/` or `db()` helper. 10 `as any` casts remain in production code — use API layer or `db()` instead of adding new casts.

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

## Cron Jobs (Vercel)
- `/api/email/send-daily` — weekdays 1 PM UTC (onboarding emails)
- `/api/email/onboarding-reminder` — weekdays 3 PM UTC
- `/api/email/digest` — weekdays noon UTC (PM digest)

## Known Issues
- `active` field on `crews` is string not boolean
- `useSupabaseQuery` cannot query views or untyped tables — use `lib/api/` or `db()`
- SubHub webhook requires `SUPABASE_SECRET_KEY` env var
- 2 `any` usages remain in production code: `db()` return type (`SupabaseClient<any>` for untyped tables) and `RefEditRecord` index signature in `ProjectPanel.tsx`
- Ops dashboard "Last Year" period only queries active `projects` table, not `legacy_projects`
- CSP uses `unsafe-inline`/`unsafe-eval` in script-src (Next.js requirement, should move to nonce-based)
- Role cookie HMAC prefers `ROLE_COOKIE_SECRET` env var, falls back to anon key (set secret in Vercel)
- `schedule` table `org_id` column added (migration 072, not yet applied to Supabase)
- 8 page/component files still exceed 1000 lines (7 largest were split in S26)
- Job costing schema (migration 071) created but not yet applied to Supabase

## Co-Author Convention

```
Co-Authored-By: Atlas (Claude Opus 4.6) <noreply@anthropic.com>
```
