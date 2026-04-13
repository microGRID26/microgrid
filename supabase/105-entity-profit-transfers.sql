-- 105-entity-profit-transfers.sql — DSE → SPE2 profit auto-transfer (Tier 2 Phase 3.2)
--
-- Background (from 2026-04-13 Mark Bench + Paul Christodoulou meeting):
--   Mark: "Direct Supply Equity Corporation must automatically invest the
--   profit it generates into an SPE entity" — DSE buys raw materials from
--   upstream suppliers, sells to NewCo at marked-up prices (1.2x to 4.0x),
--   and the profit (revenue − raw cost) is supposed to flow into SPE2 as
--   tax equity investment, ahead of any specific projects being assigned.
--
--   Paul: "Then SPE2 needs to get the actual contracts that support that
--   and have them put in there. And then then you'll have the depreciation
--   being able to be used by DSE." Plus: "the tax equity investment from
--   direct supply equity can come ahead of sale. It doesn't have to have
--   projects assigned to it. It can invest and be at risk as early as we
--   want."
--
--   This migration adds the audit table that records each profit transfer
--   when a DSE → NewCo invoice (the first link in the chain) transitions
--   to 'paid'. The hook in lib/invoices/profit-transfer.ts computes:
--     profit = epc_price total of the invoice − raw_cost total
--   and inserts a row targeting SPE2.
--
--   Phase 3.2a (this migration + the hook) — RECORD ONLY. No real money
--   moves. The audit row is the legal substantiation for the tax equity
--   investment narrative.
--
--   Phase 3.2b (banking integration) — blocked on greg_actions queue items
--   #49 (Drew clarifies SPE1/SPE2 IRS registration) and #51 (clearing-house
--   provider decision). When unblocked, a SECURITY DEFINER function will
--   transition rows from 'pending' to 'paid' as actual ACH transfers settle.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.entity_profit_transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The org generating the profit (currently always DSE Corp, but the
  -- schema supports future intercompany flows that route differently).
  source_org_id            UUID NOT NULL REFERENCES public.organizations(id),
  -- Target SPE entity. Free text for now because SPE1/SPE2 don't have
  -- their own organizations.organizations rows yet — they're financial
  -- entities, not platform tenants. Will become a UUID FK once Drew
  -- clarifies the IRS registration model (greg_actions #49).
  target_entity            TEXT NOT NULL DEFAULT 'SPE2',
  -- Project-scoped or batch transfer? Mark said the investment can come
  -- ahead of sale, so project_id is nullable to support batch / unallocated
  -- transfers in the future.
  project_id               TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  -- Triggering invoice — the DSE → NewCo invoice that just transitioned to paid
  triggered_by_invoice_id  UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  -- Money breakdown
  raw_cost                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- 'auto' = computed by the status-transition hook
  -- 'manual' = entered by an admin via the UI (Phase 3.3+)
  -- 'reversal' = unwinds a prior transfer (refund / chargeback)
  transfer_type            TEXT NOT NULL DEFAULT 'auto'
                           CHECK (transfer_type IN ('auto', 'manual', 'reversal')),
  -- 'pending' = recorded but no ACH movement yet (current default)
  -- 'recorded' = audit-only, never expected to move money
  -- 'paid' = banking integration confirmed the wire / ACH settled
  -- 'failed' = banking integration tried and failed
  -- 'reversed' = unwound by a later 'reversal' transfer
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'recorded', 'paid', 'failed', 'reversed')),
  notes                    TEXT,
  recorded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One auto transfer per triggering invoice — reruns of the status hook
-- shouldn't insert duplicates. Manual transfers are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ept_invoice_auto
  ON entity_profit_transfers(triggered_by_invoice_id)
  WHERE triggered_by_invoice_id IS NOT NULL AND transfer_type = 'auto';

CREATE INDEX IF NOT EXISTS idx_ept_source ON entity_profit_transfers(source_org_id);
CREATE INDEX IF NOT EXISTS idx_ept_target ON entity_profit_transfers(target_entity);
CREATE INDEX IF NOT EXISTS idx_ept_status ON entity_profit_transfers(status);
CREATE INDEX IF NOT EXISTS idx_ept_recorded ON entity_profit_transfers(recorded_at DESC);

-- ── RLS — internal-only ────────────────────────────────────────────────────
-- Same gate as clearing_runs and project_cost_line_items: platform + DSE Corp
-- members only. Profit transfer data is the most sensitive financial record
-- in the system since it directly feeds the tax equity investment narrative.

ALTER TABLE entity_profit_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY ept_select ON entity_profit_transfers
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

CREATE POLICY ept_insert ON entity_profit_transfers
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

-- No UPDATE policy — append-only. Status transitions go through a future
-- SECURITY DEFINER function tied to the banking integration (Phase 3.2b).

CREATE POLICY ept_delete ON entity_profit_transfers
  FOR DELETE TO authenticated
  USING (auth_is_super_admin());

COMMENT ON TABLE public.entity_profit_transfers IS
  'Audit trail of DSE Corp profit transfers to SPE2 (tax equity reinvestment). One auto row per triggering DSE → NewCo invoice (unique partial index). Status starts as pending; banking integration (Phase 3.2b) flips to paid when ACH settles.';
