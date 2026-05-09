// Tests for the cost-basis drift detection in lib/cost/api.ts.
//
// Mig 246 (2026-05-08, Phase F of Mark/Greg call) introduced
// computeDrift() to compare a persisted snapshot's raw_cost against
// what the live overlay'd templates would produce TODAY at the
// project's current sizing. When any line drifts beyond $0.50,
// the Cost Basis tab shows a banner asking the user to regen.

import { describe, expect, it } from 'vitest'

import { computeDrift } from '@/lib/cost/api'
import type {
  CostLineItemTemplate,
  ProjectCostLineItem,
  ProjectSizing,
} from '@/lib/cost/calculator'

const sizing: ProjectSizing = {
  systemkw: 24.2,
  battery_kwh: 80,
  battery_qty: 16,
  inverter_qty: 2,
  panel_qty: 55,
}

function makeTemplate(overrides: Partial<CostLineItemTemplate>): CostLineItemTemplate {
  return {
    id: 'tpl-1',
    sort_order: 1,
    section: 'PV',
    category: null,
    system_bucket: 'PV',
    item_name: 'Test',
    default_raw_cost: 100,
    default_unit_basis: 'flat',
    default_markup_to_distro: 0,
    default_markup_distro_to_epc: 0,
    default_battery_pct: 0,
    default_pv_pct: 1,
    default_proof_type: 'Bank Transaction',
    default_basis_eligibility: 'Yes',
    default_paid_from_org_type: 'epc',
    default_paid_to_org_type: 'distro',
    is_epc_internal: false,
    is_itc_excluded: false,
    is_taxable_tpp: false,
    pcs_key: null,
    active: true,
    ...overrides,
  }
}

function makeLineItem(overrides: Partial<ProjectCostLineItem>): ProjectCostLineItem {
  return {
    project_id: 'PROJ-1',
    template_id: 'tpl-1',
    sort_order: 1,
    section: 'PV',
    category: null,
    system_bucket: 'PV',
    item_name: 'Test',
    raw_cost: 100,
    markup_to_distro: 0,
    distro_price: 100,
    markup_distro_to_epc: 0,
    epc_price: 100,
    battery_pct: 0,
    pv_pct: 1,
    battery_cost: 0,
    pv_cost: 100,
    proof_of_payment_status: 'Pending',
    proof_type: 'Bank Transaction',
    basis_eligibility: 'Yes',
    paid_from_org_id: null,
    paid_to_org_id: null,
    is_epc_internal: false,
    is_itc_excluded: false,
    is_taxable_tpp: false,
    ...overrides,
  }
}

describe('computeDrift', () => {
  it('reports clean (is_stale=false) when persisted matches live', () => {
    const templates = [makeTemplate({ id: 'tpl-1', default_raw_cost: 100 })]
    const persisted = [makeLineItem({ template_id: 'tpl-1', raw_cost: 100 })]
    const d = computeDrift(persisted, templates, sizing)
    expect(d.is_stale).toBe(false)
    expect(d.drifted_count).toBe(0)
    expect(d.max_dollar_delta).toBe(0)
  })

  it('flags drift when template raw_cost has changed', () => {
    // Snapshot recorded raw_cost=100, but live template now reads 150.
    const templates = [makeTemplate({ id: 'tpl-1', default_raw_cost: 150 })]
    const persisted = [makeLineItem({ template_id: 'tpl-1', raw_cost: 100 })]
    const d = computeDrift(persisted, templates, sizing)
    expect(d.is_stale).toBe(true)
    expect(d.drifted_count).toBe(1)
    expect(d.max_dollar_delta).toBe(50)
  })

  it('ignores sub-threshold drift (rounding noise under $0.50)', () => {
    const templates = [makeTemplate({ id: 'tpl-1', default_raw_cost: 100.25 })]
    const persisted = [makeLineItem({ template_id: 'tpl-1', raw_cost: 100 })]
    const d = computeDrift(persisted, templates, sizing)
    expect(d.is_stale).toBe(false)
    expect(d.drifted_count).toBe(0)
    expect(d.max_dollar_delta).toBe(0.25)
  })

  it('scales per-unit bases against current sizing', () => {
    // per_battery template at $2,340.80 × 16 batteries = $37,452.80 expected.
    // Persisted at the OLD per_kwh basis: $46.00 × 80 kWh = $3,680.00.
    // Delta should be huge — drift flags loudly.
    const templates = [
      makeTemplate({
        id: 'tpl-batt',
        default_unit_basis: 'per_battery',
        default_raw_cost: 2340.8,
      }),
    ]
    const persisted = [
      makeLineItem({ template_id: 'tpl-batt', raw_cost: 3680 }),
    ]
    const d = computeDrift(persisted, templates, sizing)
    expect(d.is_stale).toBe(true)
    expect(d.drifted_count).toBe(1)
    expect(d.max_dollar_delta).toBeCloseTo(33772.8, 1)
  })

  it('skips line items with null template_id (manual-add safety)', () => {
    // A line item not tied to a template (rep added a custom item) shouldn't
    // count as drift. Drift only applies to template-driven rows.
    const templates = [makeTemplate({ id: 'tpl-1', default_raw_cost: 999 })]
    const persisted = [makeLineItem({ template_id: null, raw_cost: 100 })]
    const d = computeDrift(persisted, templates, sizing)
    expect(d.is_stale).toBe(false)
    expect(d.drifted_count).toBe(0)
  })

  it('aggregates max_dollar_delta across multiple drifted lines', () => {
    const templates = [
      makeTemplate({ id: 'tpl-a', default_raw_cost: 100 }),
      makeTemplate({ id: 'tpl-b', default_raw_cost: 1000 }),
    ]
    const persisted = [
      makeLineItem({ template_id: 'tpl-a', raw_cost: 50 }),  // $50 delta
      makeLineItem({ template_id: 'tpl-b', raw_cost: 200 }), // $800 delta
    ]
    const d = computeDrift(persisted, templates, sizing)
    expect(d.is_stale).toBe(true)
    expect(d.drifted_count).toBe(2)
    expect(d.max_dollar_delta).toBe(800)
  })

  it('handles persisted line items whose template was deactivated', () => {
    // Template no longer in the live list (deactivated). Drift detection
    // skips it rather than throwing — gives stale snapshots a graceful
    // "we can't compare this anymore" path.
    const templates: CostLineItemTemplate[] = [] // none active
    const persisted = [makeLineItem({ template_id: 'tpl-deleted', raw_cost: 100 })]
    const d = computeDrift(persisted, templates, sizing)
    expect(d.is_stale).toBe(false)
    expect(d.drifted_count).toBe(0)
  })
})
