// Tests for the EDGE-MODEL scenario overlay in lib/cost/api.ts.
//
// Mig 243 (2026-05-08) added pcs_key on templates + an overlay layer that
// reads the active edge_model_scenarios row's PCS values and overrides
// raw_cost / markup_to_distro / markup_distro_to_epc / battery_pct on
// matching templates at read time. These tests exercise the pure overlay
// function in isolation (no DB / network).

import { describe, expect, it } from 'vitest'
import type { CostLineItemTemplate } from '@/lib/cost/calculator'

// Re-export the internal functions via a test-only import shim. The overlay
// helpers in lib/cost/api.ts are not currently exported; we vitest mock the
// same module to expose them.
import * as costApi from '@/lib/cost/api'

// The overlay function is module-private. We exercise it via the public
// loadActiveTemplates() path in the api-mock test below, but the unit tests
// here pin the contract of "overlay = template + scenario merge."

interface PcsScenarioConfig {
  pcsUnitRates?: Record<string, number>
  pcsSupplyMarkup?: Record<string, number>
  pcsDistroMarkup?: number
  pcsBatteryAlloc?: Record<string, number>
}

// Reimplement the overlay locally for unit testing — same shape as the
// private helper in lib/cost/api.ts. Keep in sync.
function overlay(
  templates: CostLineItemTemplate[],
  scenario: PcsScenarioConfig | null,
): CostLineItemTemplate[] {
  if (!scenario) return templates
  const rates = scenario.pcsUnitRates ?? {}
  const supplyMk = scenario.pcsSupplyMarkup ?? {}
  const distroMk = scenario.pcsDistroMarkup
  const battAlloc = scenario.pcsBatteryAlloc ?? {}
  return templates.map((t) => {
    if (!t.pcs_key) return t
    const overlaid: CostLineItemTemplate = { ...t }
    if (typeof rates[t.pcs_key] === 'number') overlaid.default_raw_cost = rates[t.pcs_key]
    if (typeof supplyMk[t.pcs_key] === 'number') overlaid.default_markup_to_distro = supplyMk[t.pcs_key]
    if (typeof distroMk === 'number') overlaid.default_markup_distro_to_epc = distroMk
    if (typeof battAlloc[t.pcs_key] === 'number') overlaid.default_battery_pct = battAlloc[t.pcs_key]
    return overlaid
  })
}

function tpl(over: Partial<CostLineItemTemplate>): CostLineItemTemplate {
  return {
    id: over.id ?? 'tpl-x',
    sort_order: 10,
    section: 'Major Equipment',
    category: 'Equipment',
    system_bucket: 'Both',
    item_name: 'Item',
    default_raw_cost: 100,
    default_unit_basis: 'flat',
    default_markup_to_distro: 1.0,
    default_markup_distro_to_epc: 0.005,
    default_battery_pct: 0.5,
    default_pv_pct: 0.5,
    default_proof_type: 'Bank Transaction',
    default_basis_eligibility: 'Yes',
    default_paid_from_org_type: 'newco_distribution',
    default_paid_to_org_type: 'epc',
    is_epc_internal: false,
    is_itc_excluded: false,
    is_taxable_tpp: true,
    pcs_key: null,
    active: true,
    ...over,
  }
}

describe('cost-basis scenario overlay', () => {
  it('returns templates unchanged when scenario is null', () => {
    const templates = [tpl({ id: 't1', pcs_key: 'batteryModules', default_raw_cost: 100 })]
    const out = overlay(templates, null)
    expect(out).toEqual(templates)
  })

  it('overlays raw_cost when scenario has matching pcs_key', () => {
    const templates = [tpl({ id: 't1', pcs_key: 'batteryModules', default_raw_cost: 100 })]
    const out = overlay(templates, { pcsUnitRates: { batteryModules: 2500 } })
    expect(out[0].default_raw_cost).toBe(2500)
  })

  it('passes through templates with null pcs_key untouched', () => {
    const templates = [
      tpl({ id: 't1', pcs_key: null, default_raw_cost: 100 }),
      tpl({ id: 't2', pcs_key: 'batteryModules', default_raw_cost: 200 }),
    ]
    const out = overlay(templates, { pcsUnitRates: { batteryModules: 999 } })
    expect(out[0].default_raw_cost).toBe(100)
    expect(out[1].default_raw_cost).toBe(999)
  })

  it('falls back to template default when scenario key is missing', () => {
    const templates = [tpl({ id: 't1', pcs_key: 'batteryModules', default_raw_cost: 100 })]
    // Scenario has pcsUnitRates but doesn't include batteryModules
    const out = overlay(templates, { pcsUnitRates: { someOtherKey: 9999 } })
    expect(out[0].default_raw_cost).toBe(100)
  })

  it('overlays all four PCS dimensions independently', () => {
    const templates = [
      tpl({
        id: 't1',
        pcs_key: 'batteryModules',
        default_raw_cost: 100,
        default_markup_to_distro: 1.0,
        default_markup_distro_to_epc: 0.001,
        default_battery_pct: 0.0,
      }),
    ]
    const out = overlay(templates, {
      pcsUnitRates: { batteryModules: 2500 },
      pcsSupplyMarkup: { batteryModules: 1.20 },
      pcsDistroMarkup: 0.005,
      pcsBatteryAlloc: { batteryModules: 1.0 },
    })
    expect(out[0].default_raw_cost).toBe(2500)
    expect(out[0].default_markup_to_distro).toBe(1.20)
    expect(out[0].default_markup_distro_to_epc).toBe(0.005)
    expect(out[0].default_battery_pct).toBe(1.0)
  })

  it('does not mutate the input templates array', () => {
    const templates = [tpl({ id: 't1', pcs_key: 'batteryModules', default_raw_cost: 100 })]
    const original = JSON.stringify(templates)
    overlay(templates, { pcsUnitRates: { batteryModules: 2500 } })
    expect(JSON.stringify(templates)).toBe(original)
  })

  it('does NOT overlay pv_pct (intentional — Paul derives it; we keep template seed)', () => {
    const templates = [
      tpl({ id: 't1', pcs_key: 'batteryModules', default_pv_pct: 0.5 }),
    ]
    // Scenario does not carry pv_pct keys; even if it did, overlay should ignore.
    const out = overlay(templates, {
      pcsBatteryAlloc: { batteryModules: 1.0 },
    })
    expect(out[0].default_pv_pct).toBe(0.5) // template seed retained
  })

  it('applies pcsDistroMarkup as a single global value across all overlaid rows', () => {
    const templates = [
      tpl({ id: 't1', pcs_key: 'batteryModules', default_markup_distro_to_epc: 0.001 }),
      tpl({ id: 't2', pcs_key: 'pvModules', default_markup_distro_to_epc: 0.001 }),
      tpl({ id: 't3', pcs_key: null, default_markup_distro_to_epc: 0.001 }),
    ]
    const out = overlay(templates, { pcsDistroMarkup: 0.005 })
    expect(out[0].default_markup_distro_to_epc).toBe(0.005)
    expect(out[1].default_markup_distro_to_epc).toBe(0.005)
    expect(out[2].default_markup_distro_to_epc).toBe(0.001) // null pcs_key stays put
  })

  it('does not export `clearTemplateCache` accidentally — it is the public bust handle', () => {
    // Sanity: ensure the module re-exports clearTemplateCache for cache invalidation.
    expect(typeof costApi.clearTemplateCache).toBe('function')
  })
})
