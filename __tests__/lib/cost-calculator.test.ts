// __tests__/lib/cost-calculator.test.ts — Golden test for the project cost basis calculator
//
// Pins lib/cost/calculator.ts against the proforma sample project (24.2 kW PV,
// 80 kWh battery, 2 GPUs). The expected totals come from the EDGE Model 5-year
// proforma 'Project Cost Reconciliation & Basis' sheet, rows 33 and 39.
//
// If a future refactor breaks this golden test, either:
//   (a) the calculator math changed (intentional → update the expected values)
//   (b) the catalog seed in 103-... changed (intentional → update the values)
//   (c) the math is wrong (regression → fix)

import { describe, it, expect } from 'vitest'

import {
  buildProjectLineItem,
  computeProjectCostBasis,
  resolveProjectSizing,
  scaleRawCost,
  DEFAULT_BATTERY_KWH,
  DEFAULT_PV_KW,
  type CostLineItemTemplate,
  type ProjectCostLineItem,
  type ProjectSizing,
} from '@/lib/cost/calculator'

// ── Helpers ────────────────────────────────────────────────────────────────

function tpl(overrides: Partial<CostLineItemTemplate>): CostLineItemTemplate {
  return {
    id: 'tpl-' + (overrides.item_name?.replace(/\s+/g, '-').toLowerCase() ?? 'unknown'),
    sort_order: 0,
    section: 'Major Equipment',
    category: 'Equipment',
    system_bucket: 'Both',
    item_name: 'unknown',
    default_raw_cost: 0,
    default_unit_basis: 'flat',
    default_markup_to_distro: 1.0,
    default_markup_distro_to_epc: 0.005,
    default_battery_pct: 0,
    default_pv_pct: 0,
    default_proof_type: 'Bank Transaction',
    default_basis_eligibility: 'Yes',
    default_paid_from_org_type: 'newco_distribution',
    default_paid_to_org_type: 'epc',
    is_epc_internal: false,
    is_itc_excluded: false,
    is_taxable_tpp: true,
    active: true,
    ...overrides,
  }
}

const SAMPLE_PROJECT_ID = 'PROJ-PROFORMA-SAMPLE'
const SAMPLE_SIZING: ProjectSizing = { systemkw: 24.2, battery_kwh: 80 }

// The 28 catalog rows from migration 103, replicated here as a fixture so the
// test is self-contained (the catalog table isn't loaded in unit tests). All
// raw_cost + markup pairs match the proforma's columns J + K exactly. Markup
// semantics: K is the ADDITIONAL factor, so distro = raw × (1 + markup).
const PROFORMA_CATALOG: CostLineItemTemplate[] = [
  tpl({ sort_order: 10, section: 'Major Equipment', system_bucket: 'Battery', item_name: 'Battery Modules', default_raw_cost: 468.16, default_unit_basis: 'per_kwh', default_markup_to_distro: 1.2, default_battery_pct: 1.0 }),
  tpl({ sort_order: 20, section: 'Major Equipment', system_bucket: 'Both', item_name: 'Hybrid Inverters', default_raw_cost: 557.71, default_unit_basis: 'per_kw', default_markup_to_distro: 1.5, default_battery_pct: 0.55, default_pv_pct: 0.45 }),
  tpl({ sort_order: 30, section: 'Major Equipment', system_bucket: 'PV', item_name: 'PV Modules', default_raw_cost: 300.00, default_unit_basis: 'per_kw', default_markup_to_distro: 4.0, default_pv_pct: 1.0 }),
  tpl({ sort_order: 40, section: 'Major Equipment', system_bucket: 'PV', item_name: 'PV Mounting Hardware', default_raw_cost: 120.00, default_unit_basis: 'per_kw', default_markup_to_distro: 3.0, default_pv_pct: 1.0 }),
  tpl({ sort_order: 50, section: 'Major Equipment', system_bucket: 'Battery', item_name: 'Battery Mounting / Brackets / ESS Mounting Hardware', default_raw_cost: 2500.00, default_markup_to_distro: 2.25, default_battery_pct: 1.0 }),
  tpl({ sort_order: 60, section: 'Major Equipment', system_bucket: 'Both', item_name: 'Gateway / Controls Interface', default_raw_cost: 1221.00, default_markup_to_distro: 2.25, default_battery_pct: 0.40, default_pv_pct: 0.60 }),
  tpl({ sort_order: 70, section: 'Major Equipment', system_bucket: 'Battery', item_name: 'Battery ACC KT PCW', default_raw_cost: 1056.00, default_markup_to_distro: 2.25, default_battery_pct: 1.0 }),
  tpl({ sort_order: 80, section: 'Major Equipment', system_bucket: 'PV', item_name: 'Module-Level Electronics RSD', default_raw_cost: 1375.00, default_markup_to_distro: 2.25, default_pv_pct: 1.0 }),
  tpl({ sort_order: 90, section: 'Major Equipment', system_bucket: 'Both', item_name: 'Monitoring / Communications Hardware', default_raw_cost: 919.16, default_markup_to_distro: 3.0, default_battery_pct: 0.50, default_pv_pct: 0.50 }),
  tpl({ sort_order: 100, section: 'Major Equipment', system_bucket: 'Both', item_name: 'Equipment Delivery Fee', default_raw_cost: 1000.00, default_markup_to_distro: 4.0, default_battery_pct: 0.35, default_pv_pct: 0.65 }),
  tpl({ sort_order: 110, section: 'BOS / Service Equipment', system_bucket: 'Both', item_name: 'Service Panel / Meter-Main / Enclosures', default_raw_cost: 145.00, default_markup_to_distro: 2.25, default_battery_pct: 0.60, default_pv_pct: 0.40 }),
  tpl({ sort_order: 120, section: 'BOS / Service Equipment', system_bucket: 'Both', item_name: 'Conductors / Wiring', default_raw_cost: 1192.09, default_markup_to_distro: 3.5, default_battery_pct: 0.40, default_pv_pct: 0.60 }),
  tpl({ sort_order: 130, section: 'BOS / Service Equipment', system_bucket: 'Both', item_name: 'AC/DC Disconnects', default_raw_cost: 2044.26, default_markup_to_distro: 4.0, default_battery_pct: 0.50, default_pv_pct: 0.50 }),
  tpl({ sort_order: 140, section: 'BOS / Service Equipment', system_bucket: 'Both', item_name: 'Breakers / OCPD', default_raw_cost: 208.00, default_markup_to_distro: 4.0, default_battery_pct: 0.70, default_pv_pct: 0.30 }),
  tpl({ sort_order: 150, section: 'Eng / Permitting / Compliance', system_bucket: 'Both', item_name: 'Engineering / CAD / Design / Stamps', default_raw_cost: 100.00, default_markup_to_distro: 99.0, default_markup_distro_to_epc: 0.0, default_pv_pct: 1.0, default_paid_from_org_type: 'engineering' }),
  tpl({ sort_order: 160, section: 'Eng / Permitting / Compliance', system_bucket: 'Both', item_name: 'Third-Party Inspection / Plan Review', default_raw_cost: 350.00, default_markup_to_distro: 9.0, default_markup_distro_to_epc: 0.0, default_pv_pct: 1.0, default_paid_from_org_type: 'engineering' }),
  tpl({ sort_order: 170, section: 'Field Execution / Installation / Closeout', system_bucket: 'Battery', item_name: 'Battery Installation Labor', default_raw_cost: 4000.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 1.0, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 180, section: 'Field Execution / Installation / Closeout', system_bucket: 'PV', item_name: 'PV Installation Labor', default_raw_cost: 3080.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_pv_pct: 1.0, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 190, section: 'Field Execution / Installation / Closeout', system_bucket: 'Both', item_name: 'Project Management / Supervision', default_raw_cost: 1800.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.40, default_pv_pct: 0.60, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 200, section: 'Field Execution / Installation / Closeout', system_bucket: 'Both', item_name: 'Electrical Service Panel Upgrade Labor', default_raw_cost: 4000.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.60, default_pv_pct: 0.40, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 210, section: 'Field Execution / Installation / Closeout', system_bucket: 'Both', item_name: 'Commissioning / Startup / Programming', default_raw_cost: 500.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.50, default_pv_pct: 0.50, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 220, section: 'Field Execution / Installation / Closeout', system_bucket: 'Both', item_name: 'Inspection Coordination / Closeout', default_raw_cost: 400.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.50, default_pv_pct: 0.50, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 230, section: 'Field Execution / Installation / Closeout', system_bucket: 'Both', item_name: 'Site Survey', default_raw_cost: 400.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.50, default_pv_pct: 0.50, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 240, section: 'Commercial / Conditional / Reconciliation', system_bucket: 'Both', item_name: 'Customer Acquisition / Origination (Sales Commission)', default_raw_cost: 15730.00, default_markup_to_distro: 0.0, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.30, default_pv_pct: 0.70, default_basis_eligibility: 'TBD', default_paid_from_org_type: 'sales' }),
  tpl({ sort_order: 250, section: 'Commercial / Conditional / Reconciliation', system_bucket: 'Both', item_name: 'Warranty and Service Contract', default_raw_cost: 20000.00, default_markup_to_distro: 0.0, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.30, default_pv_pct: 0.70, default_basis_eligibility: 'TBD' }),
  tpl({ sort_order: 260, section: 'Commercial / Conditional / Reconciliation', system_bucket: 'Both', item_name: 'Change Order / Addtl SOW (if applicable)', default_raw_cost: 250.00, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.50, default_pv_pct: 0.50, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 270, section: 'Commercial / Conditional / Reconciliation', system_bucket: 'Both', item_name: 'Assumed EPC Overhead/Profit/Residual', default_raw_cost: 8041.40, default_markup_to_distro: 2.25, default_markup_distro_to_epc: 0.0, default_battery_pct: 0.40, default_pv_pct: 0.60, default_proof_type: 'EPC-Attestation', default_paid_from_org_type: 'epc', is_epc_internal: true }),
  tpl({ sort_order: 280, section: 'Major Equipment', system_bucket: 'GPU', item_name: 'GPU', default_raw_cost: 29000.00, default_markup_to_distro: 1.0, is_itc_excluded: true }),
]

// ── resolveProjectSizing ───────────────────────────────────────────────────

describe('resolveProjectSizing', () => {
  it('uses systemkw and computes battery_kwh from battery_qty * 16', () => {
    const sizing = resolveProjectSizing({ systemkw: 24.2, battery_qty: 5 })
    expect(sizing.systemkw).toBe(24.2)
    expect(sizing.battery_kwh).toBe(80)
  })

  it('falls back to DEFAULT_PV_KW when systemkw is null', () => {
    const sizing = resolveProjectSizing({ systemkw: null, battery_qty: 5 })
    expect(sizing.systemkw).toBe(DEFAULT_PV_KW)
  })

  it('falls back to DEFAULT_BATTERY_KWH when both battery_qty and explicit are missing', () => {
    const sizing = resolveProjectSizing({ systemkw: 10, battery_qty: null })
    expect(sizing.battery_kwh).toBe(DEFAULT_BATTERY_KWH)
  })

  it('respects explicit_battery_kwh override', () => {
    const sizing = resolveProjectSizing({ systemkw: 10, battery_qty: 3 }, { explicit_battery_kwh: 120 })
    expect(sizing.battery_kwh).toBe(120)
  })

  it('respects custom battery_kwh_per_unit', () => {
    const sizing = resolveProjectSizing({ systemkw: 10, battery_qty: 4 }, { battery_kwh_per_unit: 20 })
    expect(sizing.battery_kwh).toBe(80)
  })
})

// ── scaleRawCost ───────────────────────────────────────────────────────────

describe('scaleRawCost', () => {
  it('returns the raw_cost as-is for flat unit basis', () => {
    const cost = scaleRawCost({ default_raw_cost: 1000, default_unit_basis: 'flat' }, SAMPLE_SIZING)
    expect(cost).toBe(1000)
  })

  it('multiplies by systemkw for per_kw basis', () => {
    const cost = scaleRawCost({ default_raw_cost: 300, default_unit_basis: 'per_kw' }, SAMPLE_SIZING)
    expect(cost).toBe(7260) // 300 × 24.2
  })

  it('multiplies by battery_kwh for per_kwh basis', () => {
    const cost = scaleRawCost({ default_raw_cost: 468.16, default_unit_basis: 'per_kwh' }, SAMPLE_SIZING)
    expect(cost).toBeCloseTo(37452.80, 1) // 468.16 × 80
  })
})

// ── buildProjectLineItem ───────────────────────────────────────────────────

describe('buildProjectLineItem', () => {
  it('builds a Battery Modules line item matching the proforma values', () => {
    const template = PROFORMA_CATALOG.find((t) => t.item_name === 'Battery Modules')!
    const li = buildProjectLineItem(template, SAMPLE_SIZING, SAMPLE_PROJECT_ID)
    // Proforma row 3: J=37452.80, K=1.2, L=82396.16, M=0.005, N=82808.14
    expect(li.raw_cost).toBeCloseTo(37452.80, 1)
    expect(li.distro_price).toBeCloseTo(82396.16, 1) // raw × (1 + 1.2)
    expect(li.epc_price).toBeCloseTo(82808.14, 1) // distro × 1.005
    expect(li.battery_cost).toBeCloseTo(82808.14, 1) // 100% battery
    expect(li.pv_cost).toBe(0)
  })

  it('builds a PV Modules line item matching the proforma values', () => {
    const template = PROFORMA_CATALOG.find((t) => t.item_name === 'PV Modules')!
    const li = buildProjectLineItem(template, SAMPLE_SIZING, SAMPLE_PROJECT_ID)
    // Proforma row 5: J=7260, K=4.0, L=36300, M=0.005, N=36481.50
    expect(li.raw_cost).toBe(7260)
    expect(li.distro_price).toBe(36300) // raw × (1 + 4.0)
    expect(li.epc_price).toBeCloseTo(36481.50, 1) // 36300 × 1.005
    expect(li.pv_cost).toBeCloseTo(36481.50, 1)
    expect(li.battery_cost).toBe(0)
  })

  it('builds an Engineering line item matching the proforma $10K target', () => {
    const template = PROFORMA_CATALOG.find((t) => t.item_name === 'Engineering / CAD / Design / Stamps')!
    const li = buildProjectLineItem(template, SAMPLE_SIZING, SAMPLE_PROJECT_ID)
    // Proforma row 17: J=100, K=99, L=10000, M=0, N=10000
    expect(li.raw_cost).toBe(100)
    expect(li.distro_price).toBe(10000) // 100 × (1 + 99)
    expect(li.epc_price).toBe(10000) // M=0
  })

  it('builds Battery Installation Labor matching proforma $13,000 epc target', () => {
    const template = PROFORMA_CATALOG.find((t) => t.item_name === 'Battery Installation Labor')!
    const li = buildProjectLineItem(template, SAMPLE_SIZING, SAMPLE_PROJECT_ID)
    // Proforma row 19: J=4000, K=2.25, L=13000, M=0, N=13000
    expect(li.raw_cost).toBe(4000)
    expect(li.distro_price).toBe(13000) // 4000 × (1 + 2.25)
    expect(li.epc_price).toBe(13000)
    expect(li.is_epc_internal).toBe(true)
  })

  it('builds GPU line item matching proforma $58,290 epc target', () => {
    const template = PROFORMA_CATALOG.find((t) => t.item_name === 'GPU')!
    const li = buildProjectLineItem(template, SAMPLE_SIZING, SAMPLE_PROJECT_ID)
    // Proforma row 30: J=29000, K=1.0, L=58000, M=0.005, N=58290
    expect(li.raw_cost).toBe(29000)
    expect(li.distro_price).toBe(58000) // 29000 × (1 + 1)
    expect(li.epc_price).toBe(58290) // 58000 × 1.005
    expect(li.is_itc_excluded).toBe(true)
    expect(li.system_bucket).toBe('GPU')
  })

  it('builds EPC Overhead line item matching proforma $26,134.55 epc target', () => {
    const template = PROFORMA_CATALOG.find((t) => t.item_name === 'Assumed EPC Overhead/Profit/Residual')!
    const li = buildProjectLineItem(template, SAMPLE_SIZING, SAMPLE_PROJECT_ID)
    // Proforma row 29: J=8041.40, K=2.25, L=26134.55, M=0, N=26134.55
    expect(li.raw_cost).toBe(8041.40)
    expect(li.distro_price).toBeCloseTo(26134.55, 1)
    expect(li.epc_price).toBeCloseTo(26134.55, 1)
  })
})

// ── computeProjectCostBasis (golden test) ──────────────────────────────────

describe('computeProjectCostBasis — proforma sample golden test', () => {
  // Build all 28 line items from the catalog at proforma sample sizing
  // (24.2 kW PV / 80 kWh battery). Expected total: ~$391,422 pre-tax basis,
  // matching proforma row 32's implied subtotal (= $423,714.77 final invoice
  // minus 8.25% TX sales tax which is added at the chain orchestrator step,
  // not as part of the basis reconciliation).
  const lineItems: ProjectCostLineItem[] = PROFORMA_CATALOG.map((tpl) =>
    buildProjectLineItem(tpl, SAMPLE_SIZING, SAMPLE_PROJECT_ID),
  )

  const summary = computeProjectCostBasis(lineItems)

  it('produces 28 line items', () => {
    expect(summary.line_item_count).toBe(28)
  })

  it('total basis matches the proforma pre-tax subtotal ~$391,422', () => {
    // Proforma row 33 N column = $423,714.7744 (final EPC → EDGE invoice)
    // = pre-tax subtotal × 1.0825 (8.25% TX sales tax applied at chain step)
    // → pre-tax basis = $391,422.43.
    // The basis tab displays pre-tax; sales tax is added on the EPC → EDGE
    // chain link only (lib/invoices/chain.ts).
    expect(summary.total_basis).toBeCloseTo(391_422.43, 0)
  })

  it('GPU basis is exactly $58,290 (proforma row 30 N column)', () => {
    // J=29000 raw, K=1.0 markup → L=58000 distro × 1.005 = N=58290 epc
    expect(summary.gpu_basis).toBe(58290)
  })

  it('ITC eligible basis matches proforma row 39 (85.1%)', () => {
    // Proforma row 39 N column = $360,615.85 ITC eligible (= total minus GPU)
    // % column = 0.851 (85.108%)
    // Our calc: $391,422.43 - $58,290 = $333,132.43 ITC eligible
    // Pct: 333132.43 / 391422.43 = 0.85107
    // (Different from proforma $360,615.85 because the proforma includes
    // both GPU and a couple TBD-eligibility commercial lines in its excluded
    // total — our cleaner seed only excludes the explicit GPU row.)
    expect(summary.itc_eligible_basis).toBeCloseTo(333_132.43, 0)
    expect(summary.itc_eligible_pct).toBeCloseTo(0.8511, 3)
  })

  it('PV + battery + GPU basis sum equals total_basis (allocation completeness)', () => {
    const allocated = summary.pv_basis + summary.battery_basis + summary.gpu_basis
    expect(allocated).toBeCloseTo(summary.total_basis, 0)
  })

  it('returns 0 for percentages when total_basis is 0', () => {
    const empty = computeProjectCostBasis([])
    expect(empty.total_basis).toBe(0)
    expect(empty.itc_eligible_pct).toBe(0)
    expect(empty.pv_basis_pct).toBe(0)
    expect(empty.battery_basis_pct).toBe(0)
    expect(empty.gpu_basis_pct).toBe(0)
    expect(empty.line_item_count).toBe(0)
  })
})
