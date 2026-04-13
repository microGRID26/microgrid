-- 104-clearing-runs.sql — Same-day clearing audit trail (Tier 2 Phase 3.1)
--
-- Background (from 2026-04-13 Mark Bench + Paul Christodoulou meeting):
--   "I want to get to the point we're doing same day transactions" — Mark
--   wants the chain (DSE → NewCo → EPC → EDGE) to fire as one logical unit
--   on the same day, with documentation that "money flows the way that we
--   say it's going to flow to substantiate the transaction." Paul added that
--   once tax equity investors are comfortable, we can switch to a "clearing
--   house" model where payments are netted at end-of-day.
--
--   This migration adds the audit trail — every time the chain orchestrator
--   fires for a project, a clearing_runs row is inserted capturing the
--   gross flow as documented. No real money moves yet (banking integration
--   is Phase 3.1b, blocked on greg_actions queue item #51 — clearing-house
--   provider decision: Plaid / Mercury / Stripe Treasury / etc).
--
--   Future toggle: when we're ready to switch from gross to net, flip the
--   `mode` column from 'gross_substantiation' to 'netted_eod' and the
--   orchestrator will compute net per party at end-of-day instead of moving
--   the full amounts.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.clearing_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  fired_by_user_id    UUID,
  -- mode discriminator: 'gross_substantiation' = current default, every
  -- chain link generates a real invoice + (eventually) real money movement
  -- so the substantiation trail is auditable for tax equity investors.
  -- 'netted_eod' = future mode where we batch transactions and net per
  -- party at end-of-day. Both modes write the same audit row.
  mode                TEXT NOT NULL DEFAULT 'gross_substantiation'
                      CHECK (mode IN ('gross_substantiation', 'netted_eod')),
  -- Aggregate totals across the chain invoices fired in this run
  total_gross         NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoices_created    INTEGER NOT NULL DEFAULT 0,
  invoices_skipped    INTEGER NOT NULL DEFAULT 0,
  -- Status of the run itself (independent of the underlying invoice statuses)
  status              TEXT NOT NULL DEFAULT 'recorded'
                      CHECK (status IN ('recorded', 'paid', 'failed', 'reversed')),
  notes               TEXT,
  -- Snapshot of the chain rule IDs that fired (JSONB array of rule UUIDs)
  fired_rule_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clearing_runs_project ON clearing_runs(project_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_clearing_runs_status ON clearing_runs(status);
CREATE INDEX IF NOT EXISTS idx_clearing_runs_run_at ON clearing_runs(run_at DESC);

-- ── RLS — internal-only via platform / DSE Corp org membership ─────────────

ALTER TABLE clearing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY clearing_runs_select ON clearing_runs
  FOR SELECT TO authenticated
  USING (
    auth_is_platform_user()
    OR EXISTS (
      SELECT 1 FROM organizations o
      JOIN org_memberships om ON om.org_id = o.id
      WHERE om.user_id = auth.uid()
        AND o.org_type IN ('platform', 'direct_supply_equity_corp')
        AND o.active = true
    )
  );

CREATE POLICY clearing_runs_insert ON clearing_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_platform_user()
    OR EXISTS (
      SELECT 1 FROM organizations o
      JOIN org_memberships om ON om.org_id = o.id
      WHERE om.user_id = auth.uid()
        AND o.org_type IN ('platform', 'direct_supply_equity_corp')
        AND o.active = true
    )
  );

-- No UPDATE policy: clearing runs are append-only audit records.
-- Status transitions (recorded → paid / failed / reversed) happen via
-- a SECURITY DEFINER function (Phase 3.1b) when banking integration lands.

CREATE POLICY clearing_runs_delete ON clearing_runs
  FOR DELETE TO authenticated
  USING (auth_is_super_admin());

COMMENT ON TABLE public.clearing_runs IS
  'Audit trail of chain orchestrator firings. One row per chain run per project. Currently records gross flow (mode=gross_substantiation); future banking integration will switch to netted_eod mode for tax equity investor scaling.';
