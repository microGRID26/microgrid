-- Migration 246: cost-basis snapshot versioning + drift detection (Phase F)
--
-- Background: Mark/Greg call 2026-05-08, transcript lines 1163-1175. Mark's
-- exact ask: when a user opens a project's invoice / cost-basis tab, check
-- whether Paul's model has been updated since the snapshot was generated. If
-- it has, prompt: "create a new cost reconciliation report?" — never overwrite
-- history. Multiple reconciliation reports per project are intentional; user
-- decides which to keep.
--
-- This migration introduces snapshot versioning to project_cost_line_items so
-- multiple snapshots per project can coexist, plus a metadata table tracking
-- which snapshot is currently active (= shown by default on the Cost Basis
-- tab) and an audit-stamped RPC for creating fresh snapshots.
--
-- Drift detection itself is TS-side (lib/cost/api.ts) because it needs the
-- edge_model_scenarios overlay logic, which already lives in TS. The RPC
-- here only handles snapshot creation.
--
-- Backwards compatibility:
--   • backfill_project_cost_line_items() keeps its old single-arg call shape
--     via DEFAULT NULL on the new p_snapshot_id parameter — old callers get
--     a fresh snapshot uuid generated for them.
--   • Existing 25,900 rows across 925 projects each get one shared
--     snapshot_id (one snapshot per existing project, marked active).
--
-- R1 audit deltas applied in-line (2026-05-08, red-teamer + migration-planner):
--   • CRITICAL — added per-project org-membership gate to
--     atlas_create_cost_basis_snapshot (mirrors app/api/invoices/generate-chain).
--   • HIGH — pg_advisory_xact_lock on (project_id) serializes concurrent
--     create-snapshot calls; replaces the post-INSERT unique-violation race.
--   • HIGH — email-only caller resolution (action #628 sweep) is consciously
--     adopted to match the rest of the atlas_* RPC family. Tightened by #628.
--   • HIGH — audit_log.changed_by_id polymorphism (some rows are auth.users.id
--     via mig 214 trigger, others are public.users.id) is a pre-existing repo
--     inconsistency. This RPC writes public.users.id::text to match the rest
--     of the atlas_* family; will be reconciled in a separate sweep.
--   • LOW — added 1000-char cap on p_reason to prevent unbounded writes.
--   • TS-side follow-up REQUIRED before any user clicks "Generate new
--     report" in prod: lib/cost/api.ts loadProjectLineItems must filter
--     reads to the active snapshot via cost_basis_snapshots join. Until
--     that ships, multi-snapshot projects double-count totals.

BEGIN;

-- ── 1. Add nullable snapshot_id column ──────────────────────────────────────
ALTER TABLE public.project_cost_line_items
  ADD COLUMN IF NOT EXISTS snapshot_id uuid;

-- ── 2. Backfill: each project's existing rows share one snapshot_id ─────────
-- 925 projects × 28 rows ≈ 25,900 rows. Single UPDATE; ~brief lock.
WITH per_project AS (
  SELECT DISTINCT project_id, gen_random_uuid() AS sid
  FROM public.project_cost_line_items
  WHERE snapshot_id IS NULL
)
UPDATE public.project_cost_line_items pcli
   SET snapshot_id = pp.sid
  FROM per_project pp
 WHERE pcli.project_id = pp.project_id
   AND pcli.snapshot_id IS NULL;

-- ── 3. SET NOT NULL + DEFAULT for new inserts ───────────────────────────────
-- gen_random_uuid() is volatile; Postgres stores it as a metadata-only default
-- (no table rewrite). NOT NULL scan is brief on 25,900 rows.
ALTER TABLE public.project_cost_line_items
  ALTER COLUMN snapshot_id SET NOT NULL,
  ALTER COLUMN snapshot_id SET DEFAULT gen_random_uuid();

-- ── 4. Replace the old (project_id, template_id) partial unique idx ─────────
-- Old idx blocked multiple snapshots per project from coexisting. New idx
-- adds snapshot_id so each (project, template, snapshot) tuple is unique
-- but a project can have multiple snapshots holding the same templates.
DROP INDEX IF EXISTS public.idx_pcli_project_template;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pcli_project_template_snapshot
  ON public.project_cost_line_items (project_id, template_id, snapshot_id)
  WHERE template_id IS NOT NULL;

-- ── 5. cost_basis_snapshots metadata table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cost_basis_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason        text,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_cost_basis_snapshots_project_created
  ON public.cost_basis_snapshots (project_id, created_at DESC);

-- One active snapshot per project. Partial unique idx enforces this without
-- preventing multiple inactive snapshots from coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_basis_snapshots_one_active_per_project
  ON public.cost_basis_snapshots (project_id) WHERE is_active = true;

-- ── 6. Backfill snapshot rows from the unique snapshot_ids on pcli ──────────
INSERT INTO public.cost_basis_snapshots (id, project_id, reason, is_active)
SELECT DISTINCT pcli.snapshot_id, pcli.project_id, 'mig 246 backfill', true
  FROM public.project_cost_line_items pcli
ON CONFLICT (id) DO NOTHING;

-- ── 7. RLS on cost_basis_snapshots (mirrors pcli_* policies) ────────────────
ALTER TABLE public.cost_basis_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY cost_basis_snapshots_select
  ON public.cost_basis_snapshots
  FOR SELECT
  TO authenticated
  USING (
    public.auth_is_platform_user() OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = ANY(public.auth_user_org_ids())
        AND o.org_type = 'direct_supply_equity_corp'
        AND o.active = true
    )
  );

-- No direct INSERT/UPDATE/DELETE policies — mutations go through
-- atlas_create_cost_basis_snapshot SECURITY DEFINER RPC only.

-- ── 8. Update backfill_project_cost_line_items to take optional snapshot_id ─
-- Backwards compatible: callers without p_snapshot_id get a fresh uuid. New
-- return shape: (inserted_count int, snapshot_id uuid). Old shape's
-- skipped_count is dropped — the function is no longer idempotent at the
-- (project_id, template_id) level since multiple snapshots are allowed.
DROP FUNCTION IF EXISTS public.backfill_project_cost_line_items(text);

CREATE OR REPLACE FUNCTION public.backfill_project_cost_line_items(
  p_project_id text,
  p_snapshot_id uuid DEFAULT NULL
)
RETURNS TABLE(inserted_count integer, snapshot_id uuid)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_systemkw      numeric;
  v_systemwatts   numeric;
  v_battery_qty   numeric;
  v_battery_kwh   numeric;
  v_inverter_qty  numeric;
  v_panel_qty     numeric;
  v_panel_pairs   numeric;
  v_inserted      int := 0;
  v_unknown_basis text;
  v_snapshot      uuid := COALESCE(p_snapshot_id, gen_random_uuid());
BEGIN
  -- Fail loudly if any active template has a basis the CASE below doesn't
  -- handle (mig 129 R1 anchor).
  SELECT default_unit_basis INTO v_unknown_basis
    FROM project_cost_line_item_templates
   WHERE active = true
     AND default_unit_basis NOT IN (
       'flat','per_kw','per_kwh','per_battery','per_inverter',
       'per_panel','per_panel_pair','per_watt'
     )
   LIMIT 1;
  IF v_unknown_basis IS NOT NULL THEN
    RAISE EXCEPTION
      'backfill_project_cost_line_items: unsupported default_unit_basis %s in active templates',
      quote_literal(v_unknown_basis);
  END IF;

  SELECT
    COALESCE(NULLIF(NULLIF(systemkw::text, '')::numeric, 0), 24.2),
    COALESCE(NULLIF(NULLIF(battery_qty::text, '')::numeric, 0), 16),
    COALESCE(NULLIF(NULLIF(inverter_qty::text, '')::numeric, 0), 2),
    COALESCE(NULLIF(NULLIF(module_qty::text, '')::numeric, 0), 55)
  INTO v_systemkw, v_battery_qty, v_inverter_qty, v_panel_qty
  FROM projects WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found: %', p_project_id;
  END IF;

  v_systemwatts := v_systemkw * 1000;
  v_battery_kwh := v_battery_qty * 5;
  v_panel_pairs := ceil(v_panel_qty / 2);

  WITH new_rows AS (
    INSERT INTO project_cost_line_items (
      project_id, template_id, snapshot_id, sort_order, section, category, system_bucket, item_name,
      raw_cost, markup_to_distro, distro_price, markup_distro_to_epc, epc_price,
      battery_pct, pv_pct, battery_cost, pv_cost,
      proof_of_payment_status, proof_type, basis_eligibility,
      is_epc_internal, is_itc_excluded
    )
    SELECT
      p_project_id, t.id, v_snapshot,
      t.sort_order, t.section, t.category, t.system_bucket, t.item_name,
      ROUND(s.scale * 1::numeric, 2)                                                                AS raw_cost,
      t.default_markup_to_distro,
      ROUND(s.scale * (1 + t.default_markup_to_distro), 2)                                          AS distro_price,
      t.default_markup_distro_to_epc,
      ROUND(s.scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc), 2)   AS epc_price,
      t.default_battery_pct,
      t.default_pv_pct,
      ROUND(s.scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc) * t.default_battery_pct, 2) AS battery_cost,
      ROUND(s.scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc) * t.default_pv_pct, 2)      AS pv_cost,
      'Pending'::text, t.default_proof_type, t.default_basis_eligibility,
      t.is_epc_internal, t.is_itc_excluded
    FROM project_cost_line_item_templates t,
    LATERAL (
      SELECT t.default_raw_cost * (CASE t.default_unit_basis
        WHEN 'flat'           THEN 1
        WHEN 'per_kw'         THEN v_systemkw
        WHEN 'per_kwh'        THEN v_battery_kwh
        WHEN 'per_battery'   THEN v_battery_qty
        WHEN 'per_inverter'   THEN v_inverter_qty
        WHEN 'per_panel'      THEN v_panel_qty
        WHEN 'per_panel_pair' THEN v_panel_pairs
        WHEN 'per_watt'       THEN v_systemwatts
      END)::numeric AS scale
    ) s
    WHERE t.active = true
      AND NOT EXISTS (
        SELECT 1 FROM project_cost_line_items existing
        WHERE existing.project_id = p_project_id
          AND existing.template_id = t.id
          AND existing.snapshot_id = v_snapshot
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM new_rows;

  RETURN QUERY SELECT v_inserted, v_snapshot;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.backfill_project_cost_line_items(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_project_cost_line_items(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.backfill_project_cost_line_items(text, uuid) TO service_role;

-- ── 9. atlas_create_cost_basis_snapshot — admin-gated regen path ────────────
-- Per Mark's call (transcript ~01:09): never overwrite, always create. This
-- RPC marks the prior active snapshot as inactive, creates a new active one,
-- and emits an audit_log row stamped with the caller.
CREATE OR REPLACE FUNCTION public.atlas_create_cost_basis_snapshot(
  p_project_id text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller         uuid := auth.uid();
  v_caller_pubid   uuid;
  v_caller_role    text;
  v_new_snapshot   uuid := gen_random_uuid();
  v_old_snapshot   uuid;
  v_old_total      numeric;
  v_new_total      numeric;
  v_project_org    uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve public.users.id from the JWT email. NOTE: action #628 tracks
  -- the repo-wide hardening to also cross-check `auth_user_id = auth.uid()`
  -- here. This RPC adopts the email-only pattern in line with every other
  -- atlas_* RPC; it'll be tightened by the #628 sweep alongside its peers.
  SELECT u.id, u.role INTO v_caller_pubid, v_caller_role
    FROM public.users u
   WHERE lower(u.email) = lower((auth.jwt() ->> 'email'))
   LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin','admin','manager') THEN
    RAISE EXCEPTION 'admin role required to create cost-basis snapshot'
      USING ERRCODE = '42501';
  END IF;

  -- Reason length cap (red-teamer R1 LOW: prevent unbounded text writes).
  IF length(coalesce(p_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'p_reason exceeds 1000 char limit' USING ERRCODE = '22023';
  END IF;

  -- Project existence + tenant scope check (red-teamer R1 CRITICAL fix).
  -- Without this, any admin/manager from any tenant could deactivate the
  -- active snapshot of any other tenant's project. Mirrors the per-project
  -- org-membership gate from app/api/invoices/generate-chain/route.ts.
  SELECT p.org_id INTO v_project_org
    FROM public.projects p WHERE p.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found: %', p_project_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_is_platform_user()
     AND NOT (v_project_org = ANY(public.auth_user_org_ids())) THEN
    RAISE EXCEPTION 'forbidden — caller is not a member of project org'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent callers per project (red-teamer R1 HIGH fix).
  -- Two parallel calls without a lock both saw is_active=true, both UPDATEd,
  -- both INSERTed, and the partial unique idx caught the second insert
  -- *after* backfill_project_cost_line_items had already fired ~28 rows.
  -- Advisory xact lock keyed on project serializes them cleanly even when
  -- no active snapshot exists yet (FOR UPDATE on a non-existent row would
  -- be a no-op).
  PERFORM pg_advisory_xact_lock(hashtext('cost_basis_snapshot_create:' || p_project_id));

  -- Snapshot of the old total (epc_price sum) for the audit row.
  SELECT s.id, COALESCE(SUM(pcli.epc_price), 0)
    INTO v_old_snapshot, v_old_total
    FROM public.cost_basis_snapshots s
    LEFT JOIN public.project_cost_line_items pcli
      ON pcli.project_id = s.project_id AND pcli.snapshot_id = s.id
   WHERE s.project_id = p_project_id AND s.is_active = true
   GROUP BY s.id
   LIMIT 1;

  -- Mark old snapshot inactive (if any).
  UPDATE public.cost_basis_snapshots
     SET is_active = false
   WHERE project_id = p_project_id AND is_active = true;

  -- Create new active snapshot row.
  INSERT INTO public.cost_basis_snapshots (id, project_id, created_by_id, reason, is_active)
  VALUES (v_new_snapshot, p_project_id, v_caller_pubid,
          COALESCE(p_reason, 'Cost-basis regen via Cost Basis tab banner'), true);

  -- Generate fresh line items under the new snapshot_id.
  PERFORM public.backfill_project_cost_line_items(p_project_id, v_new_snapshot);

  -- New total for audit.
  SELECT COALESCE(SUM(epc_price), 0) INTO v_new_total
    FROM public.project_cost_line_items
   WHERE project_id = p_project_id AND snapshot_id = v_new_snapshot;

  -- Audit log row. project_id is real (not 'CATALOG' sentinel).
  INSERT INTO public.audit_log (project_id, field, old_value, new_value, changed_by, changed_by_id, reason)
  VALUES (
    p_project_id,
    'cost_basis_snapshot',
    CASE WHEN v_old_snapshot IS NULL
         THEN NULL
         ELSE format('snapshot=%s, total=$%s', v_old_snapshot, v_old_total::text)
    END,
    format('snapshot=%s, total=$%s', v_new_snapshot, v_new_total::text),
    'atlas_create_cost_basis_snapshot',
    v_caller_pubid::text,
    COALESCE(p_reason, 'Cost-basis regen via Cost Basis tab banner')
  );

  RETURN v_new_snapshot;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_create_cost_basis_snapshot(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_create_cost_basis_snapshot(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.atlas_create_cost_basis_snapshot(text, text) TO authenticated;

COMMIT;
