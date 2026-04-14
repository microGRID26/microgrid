-- 106-sales-dealer-relationships.sql — Sales-platform-as-tenant + EPC underwriting fees (Tier 2 Phase 4.1)
--
-- Background (from 2026-04-13 Mark Bench + Paul Christodoulou meeting):
--   Mark: "All dealers will operate as tenants within MicroGRID Energy's sales platform...
--   All installation companies will be required to sign a sales dealer relationship with
--   MicroGRID Energy to funnel their sales through them."
--
--   Mark also noted a distinct revenue stream beyond sales commissions: MicroGRID Energy
--   gets paid extra for "underwriting and serving as a gatekeeper for onboarding new
--   installation companies." Mark + Paul agreed MG Energy is paid the same as other EPCs
--   for installation work; the underwriting fee is ADDITIONAL.
--
--   BILLING DIRECTION: MicroGRID Energy → EDGE Energy (confirmed 2026-04-14). EDGE is the
--   financier with capital at risk from unvetted EPCs — the underwriting fee is EDGE paying
--   for risk reduction, not the EPC paying a toll to join the network. This keeps EPC
--   onboarding friction low while early network growth is the priority.
--
-- This migration adds two tables:
--
--   sales_dealer_relationships — the signed contract between an EPC installer and
--     MicroGRID Energy as the sales originator. One row per EPC per active contract
--     period. Status lifecycle: pending_signature → active → suspended → terminated.
--
--   epc_underwriting_fees — audit trail of the underwriting/gatekeeping fee EDGE
--     pays to MG Energy when a new EPC is onboarded. Linked to an invoice once
--     generated. One row per (epc_org_id, contract_start) to allow renewals.
--
-- Idempotent: safe to re-run.

-- ── sales_dealer_relationships ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sales_dealer_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The EPC installer being onboarded as a dealer
  epc_org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- The sales originator (MicroGRID Energy — the platform operator)
  originator_org_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- Contract lifecycle
  status              TEXT NOT NULL DEFAULT 'pending_signature'
                      CHECK (status IN ('pending_signature', 'active', 'suspended', 'terminated')),
  contract_url        TEXT,
  signed_at           TIMESTAMPTZ,
  effective_date      DATE,
  termination_date    DATE,
  -- Underwriting notes from the review (internal)
  underwriting_notes  TEXT,
  -- Metadata
  created_by_id       UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An EPC can have at most one active/pending contract at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_active_epc
  ON sales_dealer_relationships(epc_org_id)
  WHERE status IN ('pending_signature', 'active');

CREATE INDEX IF NOT EXISTS idx_sdr_epc        ON sales_dealer_relationships(epc_org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_originator  ON sales_dealer_relationships(originator_org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_status      ON sales_dealer_relationships(status);

CREATE OR REPLACE FUNCTION update_sdr_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER sdr_updated_at
  BEFORE UPDATE ON sales_dealer_relationships
  FOR EACH ROW EXECUTE FUNCTION update_sdr_updated_at();

-- ── RLS — platform users (EDGE org members) + DSE Corp ──────────────────────

ALTER TABLE sales_dealer_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY sdr_select ON sales_dealer_relationships
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

CREATE POLICY sdr_insert ON sales_dealer_relationships
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_platform_user());

CREATE POLICY sdr_update ON sales_dealer_relationships
  FOR UPDATE TO authenticated
  USING (auth_is_platform_user());

CREATE POLICY sdr_delete ON sales_dealer_relationships
  FOR DELETE TO authenticated
  USING (auth_is_super_admin());

-- ── epc_underwriting_fees ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.epc_underwriting_fees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- EPC being onboarded
  epc_org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- MicroGRID Energy (the underwriter performing the vetting)
  underwriter_org_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- EDGE Energy (pays the fee per confirmed billing direction — Option A)
  billed_to_org_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- Links to the sales_dealer_relationships contract this fee is associated with
  relationship_id     UUID REFERENCES public.sales_dealer_relationships(id) ON DELETE SET NULL,
  -- Fee structure
  fee_amount          NUMERIC(14,2) NOT NULL,
  fee_type            TEXT NOT NULL DEFAULT 'one_time_onboarding'
                      CHECK (fee_type IN ('one_time_onboarding', 'recurring_gatekeeping', 'per_project_review')),
  -- Links to the invoice once generated (MG Energy → EDGE)
  invoice_id          UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  -- Status lifecycle
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'invoiced', 'paid', 'waived', 'disputed')),
  notes               TEXT,
  created_by_id       UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_euf_epc          ON epc_underwriting_fees(epc_org_id);
CREATE INDEX IF NOT EXISTS idx_euf_underwriter  ON epc_underwriting_fees(underwriter_org_id);
CREATE INDEX IF NOT EXISTS idx_euf_billed_to    ON epc_underwriting_fees(billed_to_org_id);
CREATE INDEX IF NOT EXISTS idx_euf_status       ON epc_underwriting_fees(status);

CREATE OR REPLACE FUNCTION update_euf_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER euf_updated_at
  BEFORE UPDATE ON epc_underwriting_fees
  FOR EACH ROW EXECUTE FUNCTION update_euf_updated_at();

-- ── RLS — platform-internal only ────────────────────────────────────────────

ALTER TABLE epc_underwriting_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY euf_select ON epc_underwriting_fees
  FOR SELECT TO authenticated
  USING (auth_is_platform_user());

CREATE POLICY euf_insert ON epc_underwriting_fees
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_platform_user());

CREATE POLICY euf_update ON epc_underwriting_fees
  FOR UPDATE TO authenticated
  USING (auth_is_platform_user());

CREATE POLICY euf_delete ON epc_underwriting_fees
  FOR DELETE TO authenticated
  USING (auth_is_super_admin());

COMMENT ON TABLE public.sales_dealer_relationships IS
  'Signed contracts between EPC installers and MicroGRID Energy as the sales originator. All EPCs must sign before funneling sales through the platform (per Mark Bench 2026-04-13).';

COMMENT ON TABLE public.epc_underwriting_fees IS
  'MicroGRID Energy → EDGE Energy underwriting/gatekeeping fees for onboarding new EPC installers. EDGE pays because they bear the capital risk from unvetted EPCs (10-year warranty liability). Billing direction confirmed 2026-04-14.';
