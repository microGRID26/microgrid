-- 107-warranty-claims-funding-deductions.sql — Workmanship warranty chargeback (Tier 2 Phase 4.2)
--
-- Background (from 2026-04-13 Mark Bench + Paul Christodoulou meeting):
--   Mark: "Edge will warranty the service provisions and use a network of installation
--   companies to fulfill the service side, starting with the original EPC. If the original
--   EPC fails to honor their 10-year workmanship warranty, Edge will deploy another company
--   (potentially MicroGRID Energy) and deduct the costs from the original EPC's NEXT
--   FUNDING PAYMENT."
--
--   The deduction-from-next-funding mechanic is the key operational detail: EDGE doesn't
--   pursue a separate collections action — they just net the chargeback from the guilty
--   EPC's next milestone disbursement. This keeps the financial trail clean and gives EDGE
--   leverage.
--
-- This migration adds two tables:
--
--   workmanship_claims — tracks warranty service events where the original EPC failed to honor
--     their 10-year workmanship obligation. EDGE opens a claim, records the work required,
--     and optionally deploys a replacement EPC.
--
--   funding_deductions — amounts to be netted from a specific EPC's next EPC → EDGE invoice
--     payment. Created when a warranty claim reaches 'deployed' status (actual cost known).
--     Applied (status → 'applied') when the deduction is netted from a paid invoice.
--
-- Idempotent: safe to re-run.

-- ── workmanship_claims ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workmanship_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Project where the warranty failure occurred
  project_id          TEXT NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  -- EPC that failed to honor the warranty (chargebacks go against this org)
  original_epc_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- Date the warranty failure was discovered / reported
  claim_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Description of the failure and required remediation work
  description         TEXT NOT NULL,
  work_required       TEXT NOT NULL,
  -- If EDGE has deployed a replacement EPC to do the warranty work
  deployed_epc_id     UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  deployed_at         TIMESTAMPTZ,
  -- Actual cost of remediation (known once deployed EPC invoices back)
  claim_amount        NUMERIC(14,2),
  -- Status lifecycle:
  --   pending    = claim opened, work not yet deployed
  --   deployed   = replacement EPC deployed, awaiting invoice
  --   invoiced   = replacement EPC invoice received, claim_amount known
  --   recovered  = deduction applied, original EPC has been charged back
  --   voided     = claim closed without chargeback (e.g., original EPC cured)
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'deployed', 'invoiced', 'recovered', 'voided')),
  -- Internal notes (EDGE ops team)
  notes               TEXT,
  created_by_id       UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wc_project      ON workmanship_claims(project_id);
CREATE INDEX IF NOT EXISTS idx_wc_original_epc ON workmanship_claims(original_epc_id);
CREATE INDEX IF NOT EXISTS idx_wc_status       ON workmanship_claims(status);
CREATE INDEX IF NOT EXISTS idx_wc_claim_date   ON workmanship_claims(claim_date DESC);

CREATE OR REPLACE FUNCTION update_wc_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER wc_updated_at
  BEFORE UPDATE ON workmanship_claims
  FOR EACH ROW EXECUTE FUNCTION update_wc_updated_at();

-- ── RLS — platform-internal only ────────────────────────────────────────────

ALTER TABLE workmanship_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY wc_select ON workmanship_claims
  FOR SELECT TO authenticated
  USING (auth_is_platform_user());

CREATE POLICY wc_insert ON workmanship_claims
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_platform_user());

CREATE POLICY wc_update ON workmanship_claims
  FOR UPDATE TO authenticated
  USING (auth_is_platform_user());

CREATE POLICY wc_delete ON workmanship_claims
  FOR DELETE TO authenticated
  USING (auth_is_super_admin());

-- ── funding_deductions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.funding_deductions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- EPC that will have this amount netted from their next payment
  target_epc_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- Warranty claim that generated this deduction
  source_claim_id     UUID NOT NULL REFERENCES public.workmanship_claims(id) ON DELETE RESTRICT,
  -- Amount to deduct
  amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  -- Invoice this deduction was applied against (set when status → 'applied')
  applied_to_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  applied_at          TIMESTAMPTZ,
  -- Status lifecycle:
  --   open       = deduction is pending, will be netted from next EPC payment
  --   applied    = netted from an invoice (applied_to_invoice_id is set)
  --   cancelled  = voided without being applied (e.g., source claim was voided)
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'applied', 'cancelled')),
  notes               TEXT,
  created_by_id       UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active deduction per warranty claim (prevents double-deductions)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fd_claim_active
  ON funding_deductions(source_claim_id)
  WHERE status != 'cancelled';

CREATE INDEX IF NOT EXISTS idx_fd_target_epc  ON funding_deductions(target_epc_id);
CREATE INDEX IF NOT EXISTS idx_fd_status      ON funding_deductions(status);
CREATE INDEX IF NOT EXISTS idx_fd_invoice     ON funding_deductions(applied_to_invoice_id);

CREATE OR REPLACE FUNCTION update_fd_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER fd_updated_at
  BEFORE UPDATE ON funding_deductions
  FOR EACH ROW EXECUTE FUNCTION update_fd_updated_at();

-- ── RLS — platform-internal only ────────────────────────────────────────────

ALTER TABLE funding_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY fd_select ON funding_deductions
  FOR SELECT TO authenticated
  USING (auth_is_platform_user());

CREATE POLICY fd_insert ON funding_deductions
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_platform_user());

CREATE POLICY fd_update ON funding_deductions
  FOR UPDATE TO authenticated
  USING (auth_is_platform_user());

CREATE POLICY fd_delete ON funding_deductions
  FOR DELETE TO authenticated
  USING (auth_is_super_admin());

COMMENT ON TABLE public.workmanship_claims IS
  'Warranty service events where an EPC failed to honor their 10-year workmanship obligation. EDGE deploys a replacement and recoups costs from the guilty EPC via funding_deductions on their next invoice payment.';

COMMENT ON TABLE public.funding_deductions IS
  'Amounts to be netted from an EPC''s next EPC → EDGE invoice payment. Created from warranty claims once remediation cost is known. Applied automatically by lib/invoices/funding-deductions.ts when the EPC''s next invoice is marked paid.';
