-- 099-org-types-multi-tenant-chain.sql — Multi-tenant invoicing chain (Tier 2 Phase 1.1)
--
-- Background (from 2026-04-13 Mark Bench + Paul Christodoulou meeting):
--   The EDGE business is being structured around a 4-link tax-substantiation chain
--   that creates step-up basis for ITC eligibility:
--
--     [external supplier] → Direct Supply Equity Corp → NewCo Distribution → EPC → EDGE
--
--   Direct Supply Equity Corporation (DSE) buys raw materials from upstream suppliers
--   (ABC Supply, Elliot Electric, GPU manufacturers), sells them to NewCo Distribution
--   (an LLC owned by Everett Brewer) at a marked-up price (typically 1.2x–4.0x raw),
--   NewCo then sells to the installer (EPC) with a flat half-percent markup, and the
--   EPC bills EDGE for the full project (column N in the proforma) plus 8.25% TX sales
--   tax + EPC internal cost rows. The profit DSE generates is automatically reinvested
--   into SPE2 as tax equity (Phase 3.2).
--
--   This migration adds the two new org_type enum values needed to model the chain
--   and seeds placeholder orgs for the new entities. Real entity names will be
--   backfilled once Paul registers DSE in Wyoming and Everett confirms the NewCo
--   filed name (greg_actions queue items #46 and #50).
--
-- Idempotent: safe to re-run.

-- ── 1. Extend org_type CHECK constraint ─────────────────────────────────────

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_org_type_check;

ALTER TABLE public.organizations ADD CONSTRAINT organizations_org_type_check
  CHECK (org_type IN (
    'platform',
    'epc',
    'sales',
    'engineering',
    'supply',
    'customer',
    'direct_supply_equity_corp',  -- DSE Corp: buys from suppliers, sells to NewCo
    'newco_distribution'           -- NewCo Distro LLC: buys from DSE, sells to EPC at 0.5% markup
  ));

-- ── 2. Seed the new chain orgs (placeholders until real entities are registered) ─

-- Direct Supply Equity Corporation — placeholder until Paul registers in Wyoming.
-- Will become one of EDGE's largest tax equity investors via SPE2 reinvestment.
INSERT INTO public.organizations (name, slug, org_type, active, settings, billing_email, billing_address)
VALUES (
  'Direct Supply Equity Corporation',
  'direct-supply-equity-corp',
  'direct_supply_equity_corp',
  true,
  jsonb_build_object(
    'is_placeholder', true,
    'jurisdiction_pending', 'WY',
    'brand', jsonb_build_object(
      'primary_color', '#1a3a5c',
      'secondary_color', '#0f1f33',
      'font', 'Helvetica',
      'tagline', 'Equipment Supply & Distribution'
    )
  ),
  'billing@directsupplyequity.com',
  'TBD — pending entity registration'
)
ON CONFLICT (slug) DO NOTHING;

-- NewCo Distribution LLC — placeholder until Everett Brewer confirms the filed entity name.
-- Acts as a thin distribution layer (0.5% markup from DSE → EPC).
INSERT INTO public.organizations (name, slug, org_type, active, settings, billing_email, billing_address)
VALUES (
  'NewCo Distribution LLC',
  'newco-distribution',
  'newco_distribution',
  true,
  jsonb_build_object(
    'is_placeholder', true,
    'owned_by', 'Everett Brewer',
    'brand', jsonb_build_object(
      'primary_color', '#5c4a1a',
      'secondary_color', '#3a2f10',
      'font', 'Helvetica',
      'tagline', 'Solar Equipment Distribution'
    )
  ),
  'billing@newcodistribution.com',
  'TBD — pending entity registration'
)
ON CONFLICT (slug) DO NOTHING;

-- Rush Engineering — may already exist; insert if missing.
-- Existing org_type 'engineering' covers Rush, no new enum value needed.
INSERT INTO public.organizations (name, slug, org_type, active, settings, billing_email, billing_address)
VALUES (
  'Rush Engineering',
  'rush-engineering',
  'engineering',
  true,
  jsonb_build_object(
    'brand', jsonb_build_object(
      'primary_color', '#7a1a1a',
      'secondary_color', '#4a0f0f',
      'font', 'Helvetica',
      'tagline', 'Solar Engineering, CAD & Design'
    )
  ),
  'billing@rushengineering.com',
  'TBD'
)
ON CONFLICT (slug) DO NOTHING;

-- MicroGRID Energy — the canonical row already exists with id
-- a0000000-0000-0000-0000-000000000001 and slug 'microgrid' (per migration 039
-- + the org seed). Per Phase 4.1 of the meeting plan, MicroGRID Energy plays a
-- dual role: it is one of the EPC installers AND it is the sales originator
-- that all other installers funnel through. The is_sales_originator flag tells
-- the chain orchestrator to skip self-invoicing when MG Energy is both the
-- from_org and the to_org on a sales commission rule. is_underwriter flags it
-- for the future EPC underwriting fee work in Phase 4.1.
--
-- WARNING: do NOT recreate this row with a different slug ('microgrid-energy').
-- The first migration apply on 2026-04-13 hit that bug — the ON CONFLICT
-- missed the canonical row and created a duplicate which had to be deleted
-- by hand. Use the existing slug 'microgrid' or upsert by id.
INSERT INTO public.organizations (id, name, slug, org_type, active, settings, billing_email)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'MicroGRID Energy',
  'microgrid',
  'epc',
  true,
  jsonb_build_object(
    'is_sales_originator', true,
    'is_underwriter', true,
    'brand', jsonb_build_object(
      'primary_color', '#1D9E75',
      'secondary_color', '#0f5040',
      'font', 'Helvetica',
      'tagline', 'Solar EPC & Sales Platform'
    )
  ),
  'billing@gomicrogridenergy.com'
)
ON CONFLICT (id) DO UPDATE SET
  settings = COALESCE(public.organizations.settings, '{}'::jsonb) || jsonb_build_object(
    'is_sales_originator', true,
    'is_underwriter', true,
    'brand', COALESCE(public.organizations.settings->'brand', jsonb_build_object(
      'primary_color', '#1D9E75',
      'secondary_color', '#0f5040',
      'font', 'Helvetica',
      'tagline', 'Solar EPC & Sales Platform'
    ))
  );

-- ── 3. Comments on new types ────────────────────────────────────────────────

COMMENT ON CONSTRAINT organizations_org_type_check ON public.organizations IS
  'Tenant types in the EDGE multi-org platform. The chain types (direct_supply_equity_corp, newco_distribution) were added 2026-04-13 to model the 4-link tax-substantiation invoice chain per Mark Bench''s methodology. See plan: federated-questing-duckling.md.';
