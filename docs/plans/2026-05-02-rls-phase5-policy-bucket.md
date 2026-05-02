# Phase 5 — Internal-Writer Policy Bucket & Proposed Rewrites

**Source:** Phase 5 of `2026-04-28-multi-tenant-rls-hardening-plan.md`. Step 1 of 4: enumerate every `auth_is_internal_writer()` policy on prod (`hzymsezqfxzpbcqryeim`) and propose a per-policy rewrite for review **before** any migration is written. Branch dry-run mandatory after design sign-off.

**Status:** DESIGN — Greg's design decisions locked 2026-05-02 (see "Decisions locked" at end). No SQL applied. No migration written. Awaiting final review on the worked-out rewrites for the 6 sensitive items, then migration writing begins.

**Totals (queried from `pg_policies` on 2026-05-02):** 158 policies across 92 tables that touch `auth_is_internal_writer()` and have NO existing org/project scope.

| Bucket | Policies | Tables | Rewrite strategy |
|---|--:|--:|---|
| A. needs_org_scope | 28 | 21 | Mechanical: append `AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())` |
| B. needs_project_scope | 48 | 25 | Mechanical: append `AND auth_can_see_project(project_id)` |
| C. cross-tenant / other | 82 | 46 | Case-by-case (5 sub-buckets below) |

---

## Bucket A — needs_org_scope (28 policies, 21 tables)

Tables with `org_id` column, policy currently `auth_is_internal_writer()` only. Rewrite is mechanical:

```sql
-- BEFORE
USING (auth_is_internal_writer())

-- AFTER
USING (
  auth_is_internal_writer()
  AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
)
```

WITH CHECK gets the same conjunction on writes.

| Table | Policy | Cmd | Notes |
|---|---|---|---|
| commission_config | cc_select | SELECT | |
| commission_geo_modifiers | comm_geo_select | SELECT | |
| commission_hierarchy | comm_hier_select | SELECT | |
| commission_rates | comm_rates_select | SELECT | |
| crew_rates | crew_rates_read | SELECT | |
| document_requirements | doc_requirements_delete | DELETE | |
| document_requirements | doc_requirements_insert | INSERT | |
| document_requirements | doc_requirements_update | UPDATE | |
| job_cost_labor | job_cost_labor_read | SELECT | also has project_id; org_id scoping is sufficient |
| job_cost_materials | job_cost_materials_read | SELECT | also has project_id; org_id scoping is sufficient |
| job_cost_overhead | job_cost_overhead_read | SELECT | also has project_id; org_id scoping is sufficient |
| notification_rules | rules_read | SELECT | |
| notification_rules | rules_write | ALL | |
| onboarding_requirements | or_select | SELECT | |
| pay_distribution | pd_select | SELECT | |
| pay_scales | ps_select | SELECT | |
| queue_sections | qs_read | SELECT | |
| queue_sections | qs_write | ALL | |
| schedule | schedule_select | SELECT | also has project_id |
| task_reasons | reasons_read | SELECT | |
| task_reasons | reasons_write | ALL | |
| ticket_categories | ticket_categories_select | SELECT | |
| ticket_resolution_codes | ticket_resolution_codes_select | SELECT | |
| tickets | tickets_insert | INSERT | also has project_id |
| tickets | tickets_update | UPDATE | also has project_id |
| vendors | Authenticated users can manage vendors | ALL | |
| warehouse_stock | warehouse_stock_insert | INSERT | |
| warehouse_stock | warehouse_stock_update | UPDATE | |

**Risk:** any insert/update path that currently writes a row with `org_id` not in the caller's `auth_user_org_ids()` set will start failing post-migration. The Phase 1 backfill ensures all existing rows are MG-scoped, but this is a **runtime** check on the row being written, so any code path that hard-codes `org_id` to a non-MG value (test-only, or a partner-portal write) will break. Mitigation: branch dry-run with full integration test suite + manual smoke as MG sales user.

---

## Bucket B — needs_project_scope (48 policies, 25 tables)

Tables with `project_id` (no `org_id`), policy currently `auth_is_internal_writer()` only. Rewrite uses the helper added in Phase 2:

```sql
-- BEFORE
USING (auth_is_internal_writer())

-- AFTER
USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
```

`auth_can_see_project(text)` already covers MG project rows, legacy_projects, customer-portal access, and platform-user bypass.

| Table | Policy | Cmd |
|---|---|---|
| audit_log | audit_write | INSERT |
| change_orders | Authenticated users can insert change_orders | INSERT |
| change_orders | Authenticated users can read change_orders | SELECT |
| change_orders | Authenticated users can update change_orders | UPDATE |
| custom_field_values | cfv_insert | INSERT |
| custom_field_values | cfv_select | SELECT |
| custom_field_values | cfv_update | UPDATE |
| edge_sync_log | edge_sync_insert | INSERT |
| equipment_warranties | ew_delete | DELETE |
| equipment_warranties | ew_insert | INSERT |
| equipment_warranties | ew_update | UPDATE |
| funding_nf_changes | funding_nf_changes_insert | INSERT |
| funding_nf_changes | funding_nf_changes_update | UPDATE |
| jsa | Authenticated users can manage JSAs | ALL |
| legacy_notes | legacy_notes_insert | INSERT |
| legacy_notes | legacy_notes_select | SELECT |
| material_requests | Auth users manage MRFs | ALL |
| mention_notifications | mentions_insert | INSERT |
| notes | notes_select_legacy_internal | SELECT |
| project_adders | adders_write | ALL |
| project_documents | project_documents_insert | INSERT |
| project_documents | project_documents_update | UPDATE |
| project_folders | anon_read_project_folders | SELECT |
| project_folders | project_folders_select_legacy_internal | SELECT |
| project_materials | project_materials_delete | DELETE |
| project_materials | project_materials_insert | INSERT |
| project_materials | project_materials_update | UPDATE |
| project_readiness | readiness_insert | INSERT |
| project_readiness | readiness_select | SELECT |
| project_readiness | readiness_update | UPDATE |
| purchase_orders | po_insert | INSERT |
| purchase_orders | po_update | UPDATE |
| ramp_schedule | ramp_insert | INSERT |
| ramp_schedule | ramp_select | SELECT |
| ramp_schedule | ramp_update | UPDATE |
| stage_history | stage_history_select_legacy_internal | SELECT |
| task_history | task_history_write | INSERT |
| task_state | task_state_write | ALL |
| time_entries | te_insert | INSERT |
| time_entries | te_select | SELECT |
| time_entries | te_update | UPDATE |
| warranty_claims | wc_delete | DELETE |
| warranty_claims | wc_insert | INSERT |
| warranty_claims | wc_update | UPDATE |
| welcome_call_logs | wcl_insert | INSERT |
| welcome_call_logs | wcl_read | SELECT |
| work_orders | wo_insert | INSERT |
| work_orders | wo_update | UPDATE |

**HIGH PRIORITY in this bucket:** `legacy_notes` (288k rows, the #352 leak surface). `welcome_call_logs` (3k rows of customer call recordings). `project_documents` (file links), `project_folders`, `notes`. These are the highest-value rewrites — they account for the bulk of #352's exploit surface.

**Risk:** `auth_can_see_project()` does `EXISTS (... projects WHERE id = $1 AND org_id = ANY(auth_user_org_ids()))` per row evaluated. Without indexes on the project_id columns of these 25 tables, this could degrade SELECT performance on legacy_notes (288k rows). Phase 7 indexes mitigate — but if Phase 5 ships before Phase 7, monitor `pg_stat_statements`. Phase 7 indexes draft already exists in plan.

---

## Bucket C — cross-tenant / other (82 policies, 46 tables)

No `org_id`, no `project_id`. Five sub-buckets by intent:

### C1 — Pure cross-tenant reference data (open reads OK; tighten writes to admin/platform)

These are catalog-like tables shared across all orgs. Sales reps reading them is fine; sales reps writing them is not.

| Table | Read policy | Write policy | Rewrite |
|---|---|---|---|
| ahjs | ahjs_read | ahjs_insert / ahjs_update | Keep `_read` open via `auth.role()='authenticated'` (no internal_writer). Lock `_insert` + `_update` to `auth_is_admin() OR auth_is_platform_user()`. |
| ahj_messages | ahj_messages_read | ahj_messages_insert / ahj_messages_update | Same as ahjs — read open to authenticated, write admin/platform only. |
| commission_tiers | comm_tiers_select | (no write) | Read open to authenticated. (Add org_id in Phase 5b if MG and dealer commission tiers diverge.) |
| custom_field_definitions | cfd_select | (no write) | Same: read open. (Schema-level definitions, not row-level data.) |
| engineering_config | eng_config_select | (no write) | Read open. |
| equipment | equipment_select | (no write internal_writer) | Read open. |
| feature_flags | ff_select | (no write internal_writer) | Read open. (Writes already gated elsewhere.) |
| financiers | fin_read | fin_write | Read open; write admin/platform. |
| hoas | hoas_read | hoas_write | Read open; write admin/platform. |
| invoice_rules | inv_rules_select | (no write) | Read open. |
| nonfunded_codes | nf_codes_read | (no write) | Read open. |
| permission_matrix | perm_matrix_select | (no write) | Read open. |
| project_cost_line_item_templates | pcli_templates_select | (no write) | Read open. |
| ramp_config | ramp_config_select | (no write) | Read open. |
| sla_thresholds | sla_read | (no write) | Read open. |
| utilities | utilities_read | utilities_insert / utilities_update | Read open; write admin/platform. |
| utility_messages | utility_messages_read | utility_messages_insert / utility_messages_update | Read open; write admin/platform. |

### C2 — FK indirection (scope through parent's project_id or org_id)

Child tables that don't carry `project_id` themselves but inherit scope from a FK parent.

| Child | FK column | Parent | Parent's scope | Proposed rewrite |
|---|---|---|---|---|
| po_line_items | po_id | purchase_orders | project_id | `EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_line_items.po_id AND auth_can_see_project(po.project_id))` |
| wo_checklist_items | work_order_id | work_orders | project_id | `EXISTS (SELECT 1 FROM work_orders wo WHERE wo.id = wo_checklist_items.work_order_id AND auth_can_see_project(wo.project_id))` |
| material_request_items | request_id | material_requests | project_id | `EXISTS (... material_requests mr ... auth_can_see_project(mr.project_id))` |
| jsa_acknowledgements | jsa_id | jsa | project_id | `EXISTS (... jsa j ... auth_can_see_project(j.project_id))` |
| jsa_activities | jsa_id | jsa | project_id | Same |
| ticket_comments | ticket_id | tickets | project_id (also org_id) | `EXISTS (... tickets t ... auth_can_see_project(t.project_id))` |
| ticket_history | ticket_id | tickets | project_id (also org_id) | Same |
| qa_run_events | run_id | qa_runs | (no scope on parent yet) | Defer to Phase 5b: parent qa_runs needs org_id first |
| utility_messages | utility_id | utilities | (cross-tenant reference) | Keep reads open; tighten writes admin/platform (covered in C1) |
| ahj_messages | ahj_id | ahjs | (cross-tenant reference) | Same as C1 |
| vehicle_maintenance | vehicle_id | vehicles | (no scope on parent yet) | Defer to Phase 5b: vehicles fleet ownership not modeled |
| note_mentions | mentioned_by / mentioned_user_id | users | (user-owned) | See C3 |
| rep_notes | rep_id | sales_reps | (sales_reps already has org-scoped RLS) | `EXISTS (SELECT 1 FROM sales_reps sr WHERE sr.id = rep_notes.rep_id)` — sales_reps RLS does the org scoping |
| test_assignments / test_results / test_comments | test_case_id | test_cases | (internal infra) | See C4 |

**New helper proposal:** add `auth_can_see_purchase_order(uuid)`, `auth_can_see_work_order(uuid)`, `auth_can_see_jsa(uuid)`, `auth_can_see_ticket(uuid)` SECURITY DEFINER helpers wrapping the EXISTS pattern. Keeps policies one-liners and matches the Phase 2 helper style. Decision: build helpers OR inline EXISTS? Helpers are cleaner; inline is one fewer indirection. Recommend helpers.

### C3 — Self-scoped (filter by auth.uid)

Rows belong to a specific user. Internal-writer alone is too permissive.

| Table | Owner column | Proposed rewrite |
|---|---|---|
| saved_queries | (verify column: `user_id` likely) | `auth_is_internal_writer() AND user_id = auth.uid()` for `_insert` only — already user-scoped. |
| user_sessions | user_id | Lock to `user_id = auth.uid()` only. Internal-writer scope is wrong here. |
| email_onboarding | (verify column) | If user_id present, scope by it; otherwise admin/platform only. |
| calendar_sync | (verify column: `user_id`) | `user_id = auth.uid()` for SELECT/UPDATE/DELETE; service-role only for INSERT. |
| calendar_settings | (verify column) | Same. |

**Action:** verify the user-id column on each — query `information_schema.columns` for these 5 tables before final rewrite SQL.

### C4 — Internal admin / platform only

Tables that only platform users / super-admins should touch. `auth_is_internal_writer()` lets `sales` role through and that's wrong for these.

| Table | Current policy | Proposed |
|---|---|---|
| atlas_metric_snapshots | service_role_all | Already service-role; confirm + leave (this isn't actually internal_writer despite the bucket — it's `auth.role() = 'service_role'`). |
| qa_runs / qa_run_events | qa_runs_*, qa_run_events_* | Lock to `auth_is_admin() OR auth_is_platform_user()`. QA infrastructure, not customer-facing. |
| test_cases / test_plans / test_results / test_assignments / test_comments | test_*_read / _insert / _update | Same: admin/platform only. Internal test infra. |
| feedback | Authenticated users can insert/read feedback | INSERT keep open (anyone can submit); SELECT to admin/platform only. |
| bread_of_life_feedback | authenticated_select | **Question for Greg:** why is Bloom feedback in MG db? Should be in Bloom's project. Flag as cleanup. |
| vendor_onboarding_docs | Authenticated users can manage vendor docs | Vendors live in `vendors` (org_id). Scope via FK: `EXISTS (SELECT 1 FROM vendors v WHERE v.id = vendor_onboarding_docs.vendor_id AND v.org_id = ANY(auth_user_org_ids()))`. |
| vehicles / vehicle_maintenance | veh_*, vm_* | **Defer to Phase 5b:** fleet ownership model not designed. Today: sales rep at TriSMART can read MG vehicles. Mark explicit TODO. |
| legacy_projects | legacy_select / legacy_insert | Lock reads to `auth_is_internal_writer() AND auth_is_platform_user()` OR a designated `org_id = MG` constant. Legacy = MG/TriSMART history; partner orgs should never see this. |

### C5 — Sensitive surfaces (case-by-case judgment required)

| Table | Policy | Concern | Proposed |
|---|---|---|---|
| **users** | users_read | Today any internal_writer reads ALL users across orgs. **Critical leak** for the moment a non-MG `sales` user lands in `users`. | `auth_is_internal_writer() AND id IN (SELECT user_id FROM org_memberships WHERE org_id = ANY(auth_user_org_ids())) OR auth_is_platform_user()`. Verify `org_memberships` shape and column names. |
| note_mentions | note_mentions_insert | Insert path for @-mentions; needs to verify the inserter can see the note being referenced. | `EXISTS (SELECT 1 FROM notes n WHERE n.id = note_mentions.note_id AND auth_can_see_project(n.project_id))`. Verify note_mentions has `note_id` FK. |

---

## Decisions locked (Greg, 2026-05-02)

### Q1 — C2 FK indirection: build helpers ✅

Add 4 SECURITY DEFINER helpers to migration `217-rls-phase5a-helpers.sql`. Same pattern as Phase 2's `auth_can_see_project`:

```sql
CREATE OR REPLACE FUNCTION public.auth_can_see_purchase_order(p_po_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth_is_platform_user()
      OR EXISTS (
           SELECT 1 FROM public.purchase_orders po
           WHERE po.id = p_po_id AND public.auth_can_see_project(po.project_id)
         );
$$;

-- Identical shape for: auth_can_see_work_order(uuid),
-- auth_can_see_jsa(uuid), auth_can_see_ticket(uuid).
```

Each gets `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated` (matches Atlas Migration Guard pattern).

### Q2 — Phase 5b deferral: stop-gap admin/platform lock now ✅ (Atlas decision)

For tables with no scope column (`vehicles`, `vehicle_maintenance`, `qa_runs`, `qa_run_events`, `test_*`, `atlas_metric_snapshots`): replace `auth_is_internal_writer()` with `auth_is_admin() OR auth_is_platform_user()` as a stop-gap. This is more restrictive than today (sales role loses access) but those surfaces are fleet/QA/test infra that sales never legitimately touches anyway. Phase 5b adds proper org_id columns + scoping when fleet ownership and per-org QA infra are designed.

### Q3 — `bread_of_life_feedback` does not belong in MG db ✅

This table is Bloom-app feedback that ended up in MG by mistake. 1 real row from 2026-04-16. Phase 5 stop-gap: lock the read policy to `auth_is_platform_user()` only (just Greg), so no MG user accidentally exposes Bloom data. Cleanup tracked as **greg_action #463** (P2): migrate the 1 row to Bloom's project, then `DROP TABLE` from MG.

### Q4 — `legacy_projects` scope: all MG internal users; sales reps see only their own ✅

`legacy_projects` has no `org_id` and no FK to `sales_reps`. Rep attribution is by **TEXT name** in three columns: `advisor` (closer), `consultant` (setter), `pm` (project manager). Final read policy:

```sql
USING (
  auth_is_internal_writer()
  AND (
    auth_is_platform_user()
    OR auth_user_role() <> 'sales'   -- super_admin, admin, finance, manager, user roles see all
    OR EXISTS (                       -- sales role: name match against own user.name
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (legacy_projects.advisor   = u.name
          OR legacy_projects.consultant = u.name
          OR legacy_projects.pm         = u.name)
    )
  )
)
```

Caveat for the migration: TEXT-match is fragile. Names with typos in historical NetSuite imports won't match. A "Greg Kelsch" user with `users.name = 'Greg'` won't match `advisor='Greg Kelsch'`. **Pre-flight check** to add: report any sales rep whose `users.name` doesn't appear verbatim in advisor/consultant/pm of their currently-attributed legacy_projects rows, so Greg can fix typos before the migration applies.

`legacy_insert` write policy: lock to `auth_is_admin() OR auth_is_platform_user()` (sales reps don't backfill historical data).

### Q5 — `users.users_read` final rewrite ✅

`users` has no `org_id` column. Multi-org membership lives in `org_memberships(user_id, org_id, org_role)`. Two users can see each other iff they share at least one org. Final policy:

```sql
USING (
  auth_is_platform_user()
  OR EXISTS (
    SELECT 1
    FROM public.org_memberships me
    JOIN public.org_memberships them ON them.org_id = me.org_id
    WHERE me.user_id   = auth.uid()
      AND them.user_id = users.id
  )
  OR users.id = auth.uid()  -- always allow self-read (covers the case of a user with no org_memberships row yet)
)
```

Drops `auth_is_internal_writer()` entirely from the read — anon and customer-portal users have no `org_memberships` row, so they fail the EXISTS naturally. Performance: needs index on `org_memberships(org_id, user_id)` — verify in Phase 7. Also need a Phase 6 follow-up to handle service-role reads (admin tools that list all users) explicitly.

### Q6 — C1 cross-tenant reference reads: scope to MG org ✅ (Atlas decision)

These tables (`ahjs`, `utilities`, `financiers`, `hoas`, `nonfunded_codes`, `sla_thresholds`, `commission_tiers`, `equipment`, `feature_flags`, etc.) are MG/TriSMART historical catalogs. A future Dealer-X partner doesn't need to read them. Final read policy:

```sql
USING (
  auth_is_internal_writer()
  AND (
    'a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids())
    OR auth_is_platform_user()
  )
)
```

(MG org uuid `a0000000-0000-0000-0000-000000000001` matches Phase 1 backfill constant.) Writes locked to `auth_is_admin() OR auth_is_platform_user()`. Customer-portal users don't need to query these as lists — their project page hydrates AHJ/utility/financier from project's text columns.

---

## Migration plan once design is signed off

Split into 4 migrations to keep blast radius bounded:

1. **`217-rls-phase5a-helpers.sql`** — add `auth_can_see_purchase_order`, `auth_can_see_work_order`, `auth_can_see_jsa`, `auth_can_see_ticket` if approved (otherwise skip).
2. **`218-rls-phase5b-needs-org-scope.sql`** — Bucket A (28 policies, 21 tables). Mechanical regexp_replace + DROP/CREATE per policy.
3. **`219-rls-phase5c-needs-project-scope.sql`** — Bucket B (48 policies, 25 tables). Same pattern.
4. **`220-rls-phase5d-cross-tenant.sql`** — Bucket C (82 policies, 46 tables). Hand-written per-table.

Each on its own apply window. Branch dry-run + full Vitest run between each. Monitor Vercel error rate + PostHog page-event volume on `/projects/[id]`, `/portal/[token]`, `/legacy-notes`, `/tickets/[id]` for ≥30 min after each apply.

## Rollback

Per-policy: each policy is a single `DROP POLICY` + `CREATE POLICY` pair. Reverse migration drops the new policy and recreates the old `auth_is_internal_writer()`-only version. Pre-flight snapshot of every policy text into `_rls_phase5_snapshot` table before mutation, so reverse is `INSERT INTO ... SELECT FROM _rls_phase5_snapshot`.

---

**End of design doc. No SQL applied.** Awaiting Greg review on (a) the proposed rewrites in each bucket and (b) the 6 open questions before any migration is written.
