# MicroGRID Multi-Tenant RLS Hardening — 7-Phase Migration Plan

**Source:** Atlas migration-planner subagent, 2026-04-28
**Project:** `hzymsezqfxzpbcqryeim` (MG prod)
**Bundles greg_actions:** #350 (NULL-bypass), #351 (auth_full_access), #352 (internal_writer no-org), #360 (projects_update WITH CHECK)
**Current cursor:** migration `182` applied (Phase B — org_select + mention spoof). Phase 1 of THIS plan is migration `183`.
**Verdict from planner:** "DO NOT execute as a single bundled migration. Apply one phase at a time, branch dry-run before Phase 2 (highest-blast-radius), staged across days."

---

## Why phased

The bundled fix touches 30+ tables, drops 11 permissive policies that would silently break v2 reads, rewrites 53 v2 policies, backfills 75 rows, adds NOT NULL constraints, and tightens 130+ internal-writer-only policies. Doing it as one big migration:
- Risk of hitting a broken assumption in step N and not knowing whether N-1 already succeeded
- Locks too many tables in one window for prod-write safety
- Rollback becomes a multi-table reverse-puzzle instead of N small reverses

Each phase below is independently applicable, independently rollback-able, and gated by pre-flight + post-flight queries.

---

## Phase status tracker

| Phase | Status | Migration file | Date applied |
|---|---|---|---|
| 1 — Backfill 75 NULL `org_id` rows | **applied 2026-04-28** | `183_rls_phase1_backfill_org_id_nulls.sql` | 2026-04-28 |
| 2 — Drop 11 `auth_full_access` policies + add v2 write coverage + helper | pending | `184_rls_phase2_drop_auth_full_access.sql` | — |
| 3 — Rewrite 53 NULL-bypass v2 policies | pending | `185_rls_phase3_drop_null_bypass.sql` | — |
| 4 — Enforce `org_id NOT NULL` on 9 backfilled tables | pending | `186_rls_phase4_org_id_not_null.sql` | — |
| 5 — Add org-scoping to 130+ internal-writer policies | pending | `187_rls_phase5_internal_writer_org_scope.sql` | — |
| 6 — Customer portal coverage gaps + advisor sweep | pending | `188_rls_phase6_finalization.sql` | — |
| 7 — Performance indexes for new EXISTS predicates | pending | `189_rls_phase7_indexes.sql` | — |

---

## Phase 1 — Backfill 75 NULL `org_id` rows (DONE)

**Lock profile:** row-level UPDATE on small tables (≤27 rows each). Row locks only.
**Rollback:** revert `PROJ-30331` to NULL; leave seeded reference tables backfilled (no harm).

**Pre-flight:**
```sql
SELECT 'projects' AS t, count(*) FROM public.projects WHERE org_id IS NULL  -- expect 1
UNION ALL SELECT 'queue_sections', count(*) FROM public.queue_sections WHERE org_id IS NULL  -- 1
UNION ALL SELECT 'ticket_categories', count(*) FROM public.ticket_categories WHERE org_id IS NULL  -- 26
UNION ALL SELECT 'ticket_resolution_codes', count(*) FROM public.ticket_resolution_codes WHERE org_id IS NULL  -- 15
UNION ALL SELECT 'commission_config', count(*) FROM public.commission_config WHERE org_id IS NULL  -- 12
UNION ALL SELECT 'onboarding_requirements', count(*) FROM public.onboarding_requirements WHERE org_id IS NULL  -- 7
UNION ALL SELECT 'pay_distribution', count(*) FROM public.pay_distribution WHERE org_id IS NULL  -- 7
UNION ALL SELECT 'commission_rates', count(*) FROM public.commission_rates WHERE org_id IS NULL  -- 6
UNION ALL SELECT 'pay_scales', count(*) FROM public.pay_scales WHERE org_id IS NULL  -- 4
ORDER BY t;
```

**Migration SQL:** see `supabase/migrations/183_rls_phase1_backfill_org_id_nulls.sql`. All 75 rows updated to `org_id = 'a0000000-0000-0000-0000-000000000001'` (MG org).

**Post-flight (run after apply):** same query above; expect every count = 0. Plus `SELECT id, org_id FROM public.projects WHERE id='PROJ-30331'` returns the MG uuid.

---

## Phase 2 — Drop `auth_full_access` permissive policies + add v2 write coverage

**Why this is the highest-blast-radius phase:** 11 tables (notes 182k rows, task_state 25k, project_folders 27k, schedule, service_calls, etc.) currently have a permissive `auth_full_access` policy (`qual = wc = auth.role() = 'authenticated'`) that is OR'd with their v2 policies. Dropping the permissive policy means v2 takes effect — which means EVERY app code path that reads/writes these tables must work under v2 alone. **Mandatory branch dry-run before applying.**

**Helper added in this phase:**
```sql
CREATE OR REPLACE FUNCTION public.auth_can_see_project(p_project_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.auth_is_platform_user()
    OR EXISTS (SELECT 1 FROM public.projects p
               WHERE p.id = p_project_id AND p.org_id = ANY(public.auth_user_org_ids()))
    OR (public.auth_is_internal_writer()
        AND EXISTS (SELECT 1 FROM public.legacy_projects lp WHERE lp.id = p_project_id))
    OR EXISTS (SELECT 1 FROM public.customer_accounts ca
               WHERE ca.project_id = p_project_id
                 AND ca.auth_user_id = (SELECT auth.uid())
                 AND ca.status = 'active');
$$;
GRANT EXECUTE ON FUNCTION public.auth_can_see_project(text) TO authenticated;
```

**Then for each of the 11 tables:** add `<table>_insert_v2`, `<table>_update_v2`, `<table>_delete_v2` policies using `auth_can_see_project(project_id)`. **Then** drop `auth_full_access`. (Order matters: write coverage must exist before dropping the bypass.)

**Mandatory pre-apply gates:**
1. Apply to a Supabase branch first.
2. Run the full test suite (`npm test`) against the branch.
3. Manual smoke from a `manager` test account: project list loads, notes render on project detail, ticket creation works, customer-portal `/portal/[token]` loads.
4. Diff `get_advisors(type='security')` before vs after on the branch — flag any new ERROR-level lint.

---

## Phase 3 — Rewrite 53 NULL-bypass v2 policies

**Pattern:** every v2 policy of shape `((org_id IS NULL) OR (org_id = ANY(auth_user_org_ids())) OR auth_is_platform_user())` gets rewritten to drop the `org_id IS NULL` disjunct. Done programmatically via DO block + `regexp_replace`. Migration also closes #360 (projects_update_v2 WITH CHECK accepting NULL).

**Pre-flight:** confirm Phase 1 ran (no NULLs left to bypass to).
**Snapshot table:** write to `public._rls_phase3_snapshot` before rewriting; rollback reads from snapshot.

---

## Phase 4 — Enforce `org_id NOT NULL` on 9 backfilled tables

`ALTER TABLE … SET NOT NULL` scans every row to verify. Largest = `projects` at 1,584 rows — milliseconds. Safe under load.

**Skip for now:** `crews`, `schedule`, `tickets`, `vendors`, etc. Those still have nullable org_id; defer to a Phase 4b after their own policy review.

---

## Phase 5 — Add org-scoping to 130+ internal-writer policies

**Strategy:** for each `auth_is_internal_writer()`-only policy, add a conjunct based on table shape:
- Tables with `org_id` → `AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())`
- Tables with `project_id` only → `AND auth_can_see_project(project_id)`
- Cross-tenant reference tables (`ahjs`, `utilities`, `hoas`, `financiers`, `nonfunded_codes`, `legacy_projects`, `equipment`, `feature_flags`, `sla_thresholds`) → keep reads open but tighten WRITES to admin/platform.

Programmatic DO block + `regexp_replace` for the additive case; explicit DROP/CREATE for the cross-tenant references.

---

## Phase 6 — Customer portal coverage gaps + advisor sweep

Phases 2+5 will likely open narrow gaps in customer-portal reads that previously fell through `auth_full_access`. Add explicit `notes_customer_read` (and possibly `project_folders_customer_read`, `schedule_customer_read`) using `EXISTS (customer_accounts WHERE auth_user_id = auth.uid())`. Re-run `get_advisors(type='security')` to confirm no NEW lints.

---

## Phase 7 — Performance indexes

`CREATE INDEX CONCURRENTLY` on the project_id columns the new EXISTS predicates query. Many likely exist already from earlier migrations — verify via `pg_indexes` first.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_project_id           ON public.notes (project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legacy_notes_project_id    ON public.legacy_notes (project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_folders_project_id ON public.project_folders (project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_state_project_id      ON public.task_state (project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stage_history_project_id   ON public.stage_history (project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_accounts_auth_uid ON public.customer_accounts (auth_user_id) WHERE status='active';
```

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Each statement is its own migration call OR run via direct SQL.

---

## Rollout cadence

- Phase 1 — applied 2026-04-28 (this session). Self-contained; safe under load.
- Phase 2 — apply day +1 after monitoring is in place. **Branch dry-run mandatory.**
- Phase 3 — apply day +2 (after observing Phase 2 stable for 24h).
- Phase 4 — apply day +3.
- Phase 5 — apply day +4.
- Phase 6 — apply day +5.
- Phase 7 — apply during low-traffic window.

**Monitoring during each rollout:**
- Vercel error rate on `/api/*` and `/portal/*` ≥30 min after each phase
- `pg_stat_statements` for newly-slow queries (Phase 7 indexes may need to land sooner if EXISTS predicates spike latency)
- PostHog event volume on `/projects/[id]` and `/portal/[token]` (sudden drop = silent RLS lockout)
- `get_advisors(type='security')` before AND after each phase

---

## Greg-action references

- #350 (P0) — closed by Phases 1 + 3 + 4 (backfill + drop NULL bypass + NOT NULL)
- #351 (P0) — closed by Phase 2 (drop auth_full_access)
- #352 (P0) — closed by Phase 5 (add org-scoping to internal-writer policies)
- #360 (P1) — closed by Phase 3 (projects_update_v2 WITH CHECK rewrite)

After all 7 phases land, all 4 actions can be closed with the migration filenames as evidence.
