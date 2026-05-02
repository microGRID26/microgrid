# Single-app scaling + safety plan (Marley + Zach concerns)

**Author:** Atlas
**Date:** 2026-05-01
**Recipients:** Mark, Zach, Marley
**Context:** companion to `2026-05-01-mg-app-strategy-1-vs-2.md`. That memo recommends two apps. THIS memo answers "what if we go single-app anyway — how do we scale it and how do we keep AI from assigning the wrong permission to the wrong user?"

---

## TL;DR

A single combined app CAN scale to 10K+ users across customers, employees, and subs IF we do four things: (1) RLS-first data layer with no client-trusted role flags, (2) compile-time role partitioning of UI bundles, (3) AI-permission-assignment gated through a dual-control review queue rather than direct write, and (4) telemetry that catches role mismatches in production. Below is the spec for each.

This is the harder path. The two-app split costs ~15% more upfront and removes most of these concerns by design. If Mark accepts the two-app path, this memo is moot.

---

## (1) Partitioning by role — the data layer

The non-negotiable is: **no client-supplied role flag is ever trusted server-side.** Today the codebase is largely there but not fully:

- ✅ Every multi-tenant table uses `org_id = ANY(auth_user_org_ids())` or `auth_is_platform_user()` — RLS resolves identity from the JWT, not from a client header.
- ✅ Sensitive RPCs (e.g., the new `set_project_stage` we shipped 2026-05-01 in migration 213) are SECURITY DEFINER with the role check INSIDE the function body, not the caller's UI.
- ⚠ Some queries still trust `currentUser.isManager` for UI gating. That's fine for UX (hiding buttons) but **must not** be used to decide what data flows back from Supabase. Audit the remaining call sites.
- ⚠ `audit_log.changed_by_id` was client-supplied until the trigger we shipped today (migration 214). Now the auth-resolved actor overrides whatever the client passes. This pattern (BEFORE INSERT trigger that overwrites identity columns) should be applied to `task_history.changed_by`, `notes.author_id`, `tickets.created_by`, etc. — file as a sweep.

In a single-app world, every screen that renders compensation, customer PII, or admin actions needs to be backed by a query that *cannot* return the wrong data even if the client lied about what role it has. This is the project for the next 60 days.

## (2) Partitioning by role — the UI bundle

Even with airtight server-side gates, having admin code SHIPPED to customer devices is bad:
- Reverse-engineering reveals internal flows
- Bundle bloat (cold start cost on lower-end Android)
- App Store reviewer sees "admin tabs" they're not supposed to see

Solution: **runtime role detection + lazy-loaded route bundles.**

```ts
// app/_layout.tsx
const role = useCurrentUser().role
const RoleStack = useMemo(() => {
  if (role === 'customer')   return lazy(() => import('./(customer)'))
  if (role === 'sales')      return lazy(() => import('./(sales)'))
  if (role === 'crew')       return lazy(() => import('./(field)'))
  if (role === 'admin')      return lazy(() => import('./(admin)'))
  return CustomerStack // fail-closed default
}, [role])
```

Each `(role)` directory is a separate Expo route group. Metro bundles them as separate chunks. A customer device fetches only the customer chunk on first launch.

**Caveat:** RN's chunk-splitting is weaker than web's. The "customer never sees the admin chunk" guarantee depends on the Hermes bytecode being properly tree-shaken; verify with `npx expo export --dump-sourcemap` and inspect the resulting JSC bundle. If the admin code is still in the customer bundle, escalate to a separate app (back to the two-app recommendation).

## (3) AI permission-assignment safety gates (Marley's concern)

Marley's worry: AI suggests permission assignments and gets them wrong (e.g., promoting a sub to admin because the prompt was ambiguous). Real risk; here's the gate stack.

### Layer 1 — AI proposes, never writes
The AI agent calls a SECURITY DEFINER RPC `propose_permission_change(target_user_id, new_role, reason)` that writes to a `permission_proposals` table with status='pending'. It does NOT update `users.role` directly.

### Layer 2 — Dual control review
Every pending proposal is shown to (Greg + Mark) OR (Greg + super_admin Zach) in a `/permissions/review` page. Both must click approve before the role flips. One-click rejection is also allowed.

### Layer 3 — High-impact role gating
Promotions to `admin` or `super_admin` require Greg-only approval AND a second factor (e.g., re-entering the Atlas HQ admin password). No AI can ever propose `super_admin`.

### Layer 4 — Audit + reversal
Every approved change writes to `permission_audit_log` (separate from `audit_log` — narrow surface, retained 7 years). One-click revert.

### Layer 5 — Anomaly detection
Telemetry: count permission changes per week. If the AI-proposal rate spikes >2σ above baseline, alert Greg (Sentry + Slack). Also alert on any `super_admin` proposal regardless of source.

This stack means a runaway AI hallucinating "promote subcontractor to admin" has to:
1. Get past the RPC's input validation
2. Get human-clicked-approve from TWO of (Greg, Mark, Zach)
3. Survive 7-year audit retention
4. Not trip the anomaly detector

A single failure mode is required at each layer. The probability of all four failing in the same incident is approximately zero.

## (4) Production telemetry for role mismatches

Single-app-architecture means a customer COULD theoretically see admin UI if the runtime role check fails (e.g., race condition during login, stale cache, JWT-refresh edge case). The telemetry catches it:

- Sentry: log every render of a role-gated screen with `{ user_role, screen_required_role }`. Alert if they mismatch.
- PostHog: pageview events tagged with role; daily query for "role=customer AND pathname starts with /admin" — should be zero forever.
- Server-side: every API route logs `{ jwt_role, request_path }`. Alert on any customer-role request to admin paths.

If any of these fire, ship a hot-fix that hard-redirects the user to the customer home and invalidates their session.

## Scaling concerns — data volume

Beyond role partitioning, "all-encompassing" implies the screen surface area is proportional to the user's role:

- **Sub** sees ~5 projects (their assignments) → trivial.
- **Employee** sees their org's active projects (~50–200 today, ~500 at scale) → manageable.
- **Manager / admin** sees 2K+ projects (current count) growing toward 10K → must paginate, virtualize, server-side filter. Mobile RN's `FlatList` handles 1K rows fine; 10K needs `windowing + recycling`. Use `@shopify/flash-list`.

For all-projects screens, the rule from CLAUDE.md ("build for scale") applies: never load the full table into the client. Use cursor-based pagination + server-side filtering. The web app already does this; mirror in mobile.

## Summary of the four scaling pillars

| Pillar | What | Shipped today? | Effort to complete |
|---|---|---|---|
| RLS-first data | Server enforces role, client never trusted | ~80% | 2 weeks audit + sweep |
| Bundle partition | Customer device never gets admin code | 0% | 1 week + verification |
| AI proposal queue | AI suggests, humans approve | 0% | 1 week |
| Telemetry on role mismatch | Catch failures in prod | 0% | 3 days |

Total: ~5 weeks of additional work on top of the base single-app build. The two-app path absorbs most of pillars 2 and 4 by construction.

---

## Recommendation reconciliation

If Mark approves two apps (per `2026-05-01-mg-app-strategy-1-vs-2.md`): pillars 1 and 3 still apply, pillars 2 and 4 are mostly free. Net cost ~3 weeks.

If Mark approves single app: all four pillars are mandatory, ~5 weeks. Plus the operating risks (Apple review, customer UX, AI permission blast radius) above.

The 5 vs 3 week delta is small; the structural risk delta is larger. Still recommend two apps.
