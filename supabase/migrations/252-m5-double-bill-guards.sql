-- Migration 252 — M5 double-bill guards (finance-auditor R1 follow-up)
--
-- Mig 251 enabled multiple chain invoices for the same (project_id, rule_id,
-- milestone) tuple — one set per cost_basis_snapshot. finance-auditor R1
-- (2026-05-09, M5 audit) caught three reachable double-billing / orphan
-- paths that mig 251 alone left exposed:
--
--   C1: apply_paid_invoice doesn't check for sibling chain invoices in the
--       same (project_id, rule_id, milestone) group already paid/sent.
--       Result: paying invoice 041 then 048 (different snapshots, same
--       rule) double-bills EDGE for the same milestone.
--   H2: regen-chain route can leave an orphan active snapshot if the chain
--       step fails after the snapshot RPC succeeds. Need a rollback path.
--   H3: clearing_runs writes a new row per chain regen with no supersede
--       column. AR aggregators that SUM total_gross across rows over-count
--       by N× the number of regens.

BEGIN;

-- ── C1: sibling-paid guard inside apply_paid_invoice ──────────────────────
-- Hard-block the paid transition when another chain invoice for the same
-- (project_id, rule_id, milestone) is already paid OR sent. User can
-- explicitly cancel old invoices first if they want to re-pay against a
-- newer snapshot's invoice — cancelled rows are excluded by the WHERE.

CREATE OR REPLACE FUNCTION public.apply_paid_invoice(
  p_invoice_id            uuid,
  p_current_status        text,
  p_paid_at               timestamptz,
  p_payment_method        text,
  p_payment_reference     text,
  p_explicit_paid_amount  numeric DEFAULT NULL
)
RETURNS TABLE(
  invoice          jsonb,
  applied_ids      uuid[],
  total_deducted   numeric,
  net_amount       numeric,
  gross_amount     numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv             public.invoices%ROWTYPE;
  v_from_org_type   text;
  v_to_org_type     text;
  v_gross_cents     bigint;
  v_total_cents     bigint := 0;
  v_amt_cents       bigint;
  v_applied_ids     uuid[] := ARRAY[]::uuid[];
  v_now             timestamptz := COALESCE(p_paid_at, now());
  v_net             numeric;
  v_updated_inv     jsonb;
  v_sibling_id      uuid;
  v_sibling_num     text;
  v_sibling_status  text;
  r                 record;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status IS DISTINCT FROM p_current_status THEN
    RAISE EXCEPTION 'invoice_status_changed: expected % got %',
      p_current_status, v_inv.status USING ERRCODE = '40001';
  END IF;

  -- M5 sibling-paid guard (mig 252, finance-auditor R1 C1).
  -- After mig 251, multiple chain invoices for the same rule/milestone can
  -- coexist (different snapshots). Block if a sibling is already paid/sent.
  -- User must cancel old invoice(s) first to free up the rule for re-pay.
  IF v_inv.rule_id IS NOT NULL AND v_inv.project_id IS NOT NULL AND v_inv.milestone IS NOT NULL THEN
    -- Statuses that count as "claiming AR": paid (settled), sent (in
    -- collection), viewed (sent + opened), overdue (aged sent), disputed
    -- (receiver contests). Excludes draft + cancelled. migration-planner
    -- R2 follow-up to mig 252.
    SELECT id, invoice_number, status
      INTO v_sibling_id, v_sibling_num, v_sibling_status
      FROM public.invoices
     WHERE project_id = v_inv.project_id
       AND rule_id    = v_inv.rule_id
       AND milestone  = v_inv.milestone
       AND id        <> v_inv.id
       AND status    IN ('paid','sent','viewed','overdue','disputed')
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'sibling_chain_invoice_already_paid: invoice % (status=%) already covers the same rule/milestone for project % — cancel it first to re-pay against a different snapshot',
        v_sibling_num, v_sibling_status, v_inv.project_id
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF p_explicit_paid_amount IS NOT NULL THEN
    v_net := round(p_explicit_paid_amount, 2);
  ELSE
    SELECT org_type INTO v_from_org_type FROM public.organizations WHERE id = v_inv.from_org;
    SELECT org_type INTO v_to_org_type   FROM public.organizations WHERE id = v_inv.to_org;
    v_gross_cents := round(COALESCE(v_inv.total, 0) * 100);
    IF v_gross_cents < 0 THEN v_gross_cents := 0; END IF;
    IF v_from_org_type = 'epc' AND v_to_org_type = 'platform' THEN
      FOR r IN
        SELECT id, amount, source_claim_id, created_at
        FROM public.funding_deductions
        WHERE target_epc_id = v_inv.from_org AND status = 'open'
        ORDER BY created_at ASC NULLS LAST, id ASC
        FOR UPDATE SKIP LOCKED
      LOOP
        v_amt_cents := round(COALESCE(r.amount, 0) * 100);
        IF v_total_cents + v_amt_cents > v_gross_cents THEN CONTINUE; END IF;
        v_total_cents := v_total_cents + v_amt_cents;
        v_applied_ids := v_applied_ids || r.id;
      END LOOP;
      v_net := (greatest(0, v_gross_cents - v_total_cents)::numeric) / 100;
    ELSE
      v_net := (v_gross_cents::numeric) / 100;
    END IF;
    IF cardinality(v_applied_ids) > 0 THEN
      UPDATE public.funding_deductions
         SET status = 'applied', applied_invoice_id = p_invoice_id, applied_at = v_now
       WHERE id = ANY(v_applied_ids);
    END IF;
  END IF;

  UPDATE public.invoices
     SET status            = 'paid',
         paid_at           = v_now,
         payment_method    = p_payment_method,
         payment_reference = p_payment_reference,
         paid_amount       = v_net,
         updated_at        = v_now
   WHERE id = p_invoice_id
   RETURNING to_jsonb(public.invoices.*) INTO v_updated_inv;

  RETURN QUERY SELECT
    v_updated_inv,
    v_applied_ids,
    (v_total_cents::numeric / 100),
    v_net,
    (COALESCE(v_inv.total, 0))::numeric;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) TO service_role;

COMMENT ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) IS
  'Mig 252: added M5 sibling-paid guard. Mig 240 base behavior preserved.';

-- ── H2: rollback RPC for orphan snapshots ─────────────────────────────────
-- regen-chain route calls atlas_create_cost_basis_snapshot then chain
-- generation. If chain fails, the new snapshot is permanently active with
-- zero invoices tied to it — every subsequent read sees an orphan as
-- "current truth". This RPC undoes the active flip cleanly.

CREATE OR REPLACE FUNCTION public.atlas_rollback_cost_basis_snapshot(
  p_snapshot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snap        cost_basis_snapshots%ROWTYPE;
  v_prior_id    uuid;
  v_invoice_count int;
BEGIN
  SELECT * INTO v_snap FROM public.cost_basis_snapshots WHERE id = p_snapshot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'snapshot_not_found: %', p_snapshot_id USING ERRCODE = 'P0002';
  END IF;

  -- Safety: refuse to rollback a snapshot that already has invoices stamped
  -- to it. Once invoices exist, the snapshot is load-bearing.
  SELECT COUNT(*) INTO v_invoice_count FROM public.invoices WHERE snapshot_id = p_snapshot_id;
  IF v_invoice_count > 0 THEN
    RAISE EXCEPTION 'snapshot_has_invoices: cannot rollback snapshot % with % invoices', p_snapshot_id, v_invoice_count USING ERRCODE = 'P0001';
  END IF;

  -- Find the most recent OTHER snapshot for the project (the prior active).
  SELECT id INTO v_prior_id
    FROM public.cost_basis_snapshots
   WHERE project_id = v_snap.project_id AND id <> p_snapshot_id
   ORDER BY created_at DESC LIMIT 1;

  -- Two-step within tx: (a) flip orphan inactive, (b) restore prior to
  -- active. Partial unique idx on (project_id) WHERE is_active=true means
  -- we MUST do (a) before (b) or the flip will violate the constraint.
  UPDATE public.cost_basis_snapshots SET is_active = false WHERE id = p_snapshot_id;
  IF v_prior_id IS NOT NULL THEN
    UPDATE public.cost_basis_snapshots SET is_active = true WHERE id = v_prior_id;
  END IF;

  RETURN jsonb_build_object(
    'rolled_back_snapshot_id', p_snapshot_id,
    'restored_prior_snapshot_id', v_prior_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_rollback_cost_basis_snapshot(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_rollback_cost_basis_snapshot(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.atlas_rollback_cost_basis_snapshot(uuid) TO service_role, authenticated;

COMMENT ON FUNCTION public.atlas_rollback_cost_basis_snapshot(uuid) IS
  'M5 H2 fix (mig 252). Reverses an active-snapshot flip when chain '
  'generation fails after snapshot creation. Refuses if the snapshot has '
  'invoices stamped to it. Called by /api/projects/[id]/regen-chain on '
  'chain-step failure.';

-- ── H3: clearing_runs.superseded_at + chain.ts marks prior superseded ─────
-- Each chain regen writes a new clearing_runs row. Without a supersede
-- column, AR aggregators that SUM(total_gross) over-count by N×.

ALTER TABLE public.clearing_runs
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_run_id uuid REFERENCES public.clearing_runs(id);

CREATE INDEX IF NOT EXISTS idx_clearing_runs_active
  ON public.clearing_runs (project_id, run_at DESC)
 WHERE superseded_at IS NULL;

-- One-time backfill: for projects with multiple clearing_runs rows, mark
-- all but the latest as superseded by the latest. AR aggregators that
-- start filtering on superseded_at IS NULL won't see N-stacked totals
-- from pre-mig-252 regens. migration-planner R2 anchor.
WITH ranked AS (
  SELECT id,
         project_id,
         row_number() OVER (PARTITION BY project_id ORDER BY run_at DESC, id DESC) AS rn,
         first_value(id) OVER (PARTITION BY project_id ORDER BY run_at DESC, id DESC) AS latest_id
    FROM public.clearing_runs
   WHERE superseded_at IS NULL
)
UPDATE public.clearing_runs cr
   SET superseded_at = now(),
       superseded_by_run_id = ranked.latest_id
  FROM ranked
 WHERE cr.id = ranked.id
   AND ranked.rn > 1;

COMMENT ON COLUMN public.clearing_runs.superseded_at IS
  'M5 H3 fix (mig 252). When chain.ts inserts a new run for a project, '
  'prior runs for the same project get superseded_at = now() and '
  'superseded_by_run_id = new run id. AR aggregators MUST filter '
  'WHERE superseded_at IS NULL to avoid over-counting on regens.';

COMMIT;
