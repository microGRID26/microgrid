// __tests__/lib/invoice-chain.test.ts — Pure-function tests for the chain orchestrator
//
// Phase 1 (Session 47) introduced lib/invoices/chain.ts with the sales-tax predicate
// and the CHN-prefix convention. Phase 1.5 (Session 54) added per-project catalog
// wiring so chain line items reflect actual project sizing instead of the proforma's
// 24.2 kW / 80 kWh boilerplate.
//
// The DB-touching parts of the orchestrator (generateProjectChain) require a live
// Supabase client, so this file covers only the pure helpers.

import { describe, it, expect } from 'vitest'

import type { ProjectCostLineItem } from '@/lib/cost/calculator'
import {
  TX_SALES_TAX_RATE,
  CHAIN_MILESTONE,
  shouldApplySalesTax,
  computeChainTax,
  pickChainPriceField,
  buildChainLineItemsFromCatalog,
} from '@/lib/invoices/chain'
import type { InvoiceRule } from '@/types/database'

function buildRule(from: string, to: string, name = 'test rule'): InvoiceRule {
  return {
    id: `rule-${from}-${to}`,
    name,
    milestone: 'chain',
    from_org_type: from,
    to_org_type: to,
    line_items: [{ description: 'test', unit_price: 100, category: 'test' }],
    active: true,
    rule_kind: 'chain',
    use_project_catalog: false,
    percentage: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function buildCatalogRow(
  overrides: Partial<ProjectCostLineItem> & { item_name: string; sort_order: number },
): ProjectCostLineItem {
  return {
    project_id: 'PROJ-TEST',
    template_id: 'tmpl-test',
    section: 'Major Equipment',
    category: null,
    system_bucket: 'PV',
    raw_cost: 1000,
    markup_to_distro: 1.2,
    distro_price: 2200,
    markup_distro_to_epc: 0.005,
    epc_price: 2211,
    battery_pct: 0,
    pv_pct: 1,
    battery_cost: 0,
    pv_cost: 2211,
    proof_of_payment_status: 'Pending',
    proof_type: 'Bank Transaction',
    basis_eligibility: 'Yes',
    paid_from_org_id: null,
    paid_to_org_id: null,
    is_epc_internal: false,
    is_itc_excluded: false,
    is_taxable_tpp: true,
    ...overrides,
  }
}

// ── Phase 1 regression: sales-tax predicate ─────────────────────────────────

describe('shouldApplySalesTax', () => {
  it('returns true ONLY for EPC → platform invoices', () => {
    expect(shouldApplySalesTax(buildRule('epc', 'platform'))).toBe(true)
  })

  it('returns false for DSE → NewCo (resale-exempt)', () => {
    expect(shouldApplySalesTax(buildRule('direct_supply_equity_corp', 'newco_distribution'))).toBe(false)
  })

  it('returns false for NewCo → EPC (resale-exempt with 0.5% markup)', () => {
    expect(shouldApplySalesTax(buildRule('newco_distribution', 'epc'))).toBe(false)
  })

  it('returns false for Rush Engineering → EPC (services)', () => {
    expect(shouldApplySalesTax(buildRule('engineering', 'epc'))).toBe(false)
  })

  it('returns false for MicroGRID Sales → EPC (commission)', () => {
    expect(shouldApplySalesTax(buildRule('sales', 'epc'))).toBe(false)
  })

  it('returns false for platform → epc (reverse direction does not match)', () => {
    expect(shouldApplySalesTax(buildRule('platform', 'epc'))).toBe(false)
  })

  it('returns false for epc → epc (same-org, never charged)', () => {
    expect(shouldApplySalesTax(buildRule('epc', 'epc'))).toBe(false)
  })

  it('returns false for customer → platform (B2C, not in chain)', () => {
    expect(shouldApplySalesTax(buildRule('customer', 'platform'))).toBe(false)
  })
})

describe('TX_SALES_TAX_RATE', () => {
  it('is exactly 8.25% per Mark Bench 2026-04-13 meeting', () => {
    expect(TX_SALES_TAX_RATE).toBe(0.0825)
  })

  it('computes the expected tax amount for the proforma sample subtotal', () => {
    const subtotal = 391_422.42
    const tax = Math.round(subtotal * TX_SALES_TAX_RATE * 100) / 100
    expect(tax).toBeCloseTo(32_292.35, 0)
  })
})

describe('CHAIN_MILESTONE constant', () => {
  it('is the magic value used by every chain rule', () => {
    expect(CHAIN_MILESTONE).toBe('chain')
  })
})

// ── Phase 1.5: catalog-sourced line items ───────────────────────────────────

describe('pickChainPriceField', () => {
  it('DSE → NewCo uses raw_cost (supplier → distributor, no markup)', () => {
    expect(pickChainPriceField('direct_supply_equity_corp', 'newco_distribution')).toBe('raw_cost')
  })

  it('NewCo → EPC uses distro_price (distributor → EPC, raw × (1 + markup_to_distro))', () => {
    expect(pickChainPriceField('newco_distribution', 'epc')).toBe('distro_price')
  })

  it('EPC → platform uses epc_price (final invoice to EDGE, distro × (1 + markup_distro_to_epc))', () => {
    expect(pickChainPriceField('epc', 'platform')).toBe('epc_price')
  })

  it('Rush Engineering → EPC returns null (not catalog-sourced)', () => {
    expect(pickChainPriceField('engineering', 'epc')).toBeNull()
  })

  it('Sales → EPC returns null (commission is flat, not catalog)', () => {
    expect(pickChainPriceField('sales', 'epc')).toBeNull()
  })

  it('returns null for reverse direction (platform → epc)', () => {
    expect(pickChainPriceField('platform', 'epc')).toBeNull()
  })
})

describe('buildChainLineItemsFromCatalog', () => {
  const equipment = buildCatalogRow({
    item_name: 'PV Module — Seraphim 550W',
    sort_order: 3,
    raw_cost: 37_452.80,
    distro_price: 82_396.16,
    epc_price: 82_808.14,
    is_epc_internal: false,
    is_itc_excluded: false,
  })
  const labor = buildCatalogRow({
    item_name: 'Field Execution Labor — Install',
    sort_order: 20,
    raw_cost: 5_000,
    distro_price: 5_000,
    epc_price: 5_000,
    is_epc_internal: true, // EPC pays itself, no upstream flow
    is_itc_excluded: false,
  })
  const gpu = buildCatalogRow({
    item_name: 'GPU (ITC-excluded)',
    sort_order: 10,
    raw_cost: 1_500,
    distro_price: 3_300,
    epc_price: 3_316.50,
    system_bucket: 'GPU',
    is_epc_internal: false,
    is_itc_excluded: true, // still flows through chain; ITC exclusion only affects basis math
  })
  const catalog = [equipment, labor, gpu]

  it('DSE → NewCo: uses raw_cost, filters out is_epc_internal items', () => {
    const items = buildChainLineItemsFromCatalog(catalog, 'direct_supply_equity_corp', 'newco_distribution')
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      description: 'PV Module — Seraphim 550W',
      quantity: 1,
      unit_price: 37_452.80,
    })
    expect(items[1]).toMatchObject({
      description: 'GPU (ITC-excluded)',
      unit_price: 1_500,
    })
    // labor (is_epc_internal=true) was dropped
    expect(items.find((li) => li.description.includes('Labor'))).toBeUndefined()
  })

  it('NewCo → EPC: uses distro_price, filters out is_epc_internal items', () => {
    const items = buildChainLineItemsFromCatalog(catalog, 'newco_distribution', 'epc')
    expect(items).toHaveLength(2)
    expect(items[0].unit_price).toBe(82_396.16)
    expect(items[1].unit_price).toBe(3_300)
  })

  it('EPC → platform: uses epc_price AND includes is_epc_internal labor items', () => {
    const items = buildChainLineItemsFromCatalog(catalog, 'epc', 'platform')
    expect(items).toHaveLength(3) // labor included this time
    expect(items[0].unit_price).toBe(82_808.14)
    const laborItem = items.find((li) => li.description.includes('Labor'))
    expect(laborItem).toBeDefined()
    expect(laborItem?.unit_price).toBe(5_000)
  })

  it('returns empty array for unmapped link (engineering → epc)', () => {
    const items = buildChainLineItemsFromCatalog(catalog, 'engineering', 'epc')
    expect(items).toEqual([])
  })

  it('returns empty array when catalog is empty', () => {
    const items = buildChainLineItemsFromCatalog([], 'direct_supply_equity_corp', 'newco_distribution')
    expect(items).toEqual([])
  })

  it('coerces NUMERIC string values to Number (PostgREST NUMERIC returns string)', () => {
    const stringyRow = buildCatalogRow({
      item_name: 'Stringy row',
      sort_order: 1,
      raw_cost: '4200.42' as unknown as number,
    })
    const items = buildChainLineItemsFromCatalog(
      [stringyRow],
      'direct_supply_equity_corp',
      'newco_distribution',
    )
    expect(items[0].unit_price).toBe(4_200.42)
    expect(typeof items[0].unit_price).toBe('number')
  })

  it('preserves sort order from catalog (sorted externally before call)', () => {
    // Catalog is pre-sorted by the orchestrator via .order('sort_order'); this helper
    // is a pure map so it must not reorder.
    const reversed = [gpu, equipment] // sort_orders 10, 3
    const items = buildChainLineItemsFromCatalog(
      reversed,
      'direct_supply_equity_corp',
      'newco_distribution',
    )
    expect(items[0].description).toContain('GPU')
    expect(items[1].description).toContain('PV Module')
  })

  it('sets category from li.section (Major Equipment, etc.)', () => {
    const items = buildChainLineItemsFromCatalog(
      [equipment],
      'direct_supply_equity_corp',
      'newco_distribution',
    )
    expect(items[0].category).toBe('Major Equipment')
  })
})

// ── #526: TX-tax filter over taxable-TPP line items ─────────────────────────

describe('computeChainTax — #526 taxable-TPP filter', () => {
  type TaxLine = { quantity: number; unit_price: number; is_taxable_tpp: boolean }

  it('returns 0 when shouldApply is false (non-EPC→EDGE links)', () => {
    const items: TaxLine[] = [
      { quantity: 1, unit_price: 1000, is_taxable_tpp: true },
      { quantity: 1, unit_price: 5000, is_taxable_tpp: true },
    ]
    expect(computeChainTax(items, false)).toBe(0)
  })

  it('returns 0 for an empty line-items array', () => {
    expect(computeChainTax([], true)).toBe(0)
  })

  it('all-taxable: tax = 8.25% of full subtotal', () => {
    // Pre-#526 behavior on a fully-taxable invoice — output should match the
    // old draft.subtotal × rate exactly.
    const items: TaxLine[] = [
      { quantity: 1, unit_price: 100_000, is_taxable_tpp: true },
      { quantity: 1, unit_price: 25_000, is_taxable_tpp: true },
    ]
    // 125,000 × 0.0825 = 10,312.50
    expect(computeChainTax(items, true)).toBe(10_312.5)
  })

  it('all-non-taxable: tax = 0', () => {
    const items: TaxLine[] = [
      { quantity: 1, unit_price: 26_000, is_taxable_tpp: false }, // EPC residual
      { quantity: 1, unit_price: 10_000, is_taxable_tpp: false }, // engineering
    ]
    expect(computeChainTax(items, true)).toBe(0)
  })

  it('mixed: tax only over the taxable subset (the #526 fix)', () => {
    // Mirrors action #526 numbers: $300k subtotal with $75k of non-TPP service.
    // Pre-fix taxed all $300k = $24,750. Post-fix taxes $225k = $18,562.50.
    // Delta = $6,187.50 = the over-collection #526 was filed against.
    const items: TaxLine[] = [
      // Taxable goods + delivery fee + BOS — total $225,000
      { quantity: 1, unit_price: 100_000, is_taxable_tpp: true },
      { quantity: 1, unit_price: 80_000, is_taxable_tpp: true },
      { quantity: 1, unit_price: 45_000, is_taxable_tpp: true },
      // Non-TPP services — total $75,000 (excluded from tax basis)
      { quantity: 1, unit_price: 26_000, is_taxable_tpp: false }, // EPC residual
      { quantity: 1, unit_price: 10_000, is_taxable_tpp: false }, // engineering
      { quantity: 1, unit_price: 3_500, is_taxable_tpp: false }, // inspection
      { quantity: 1, unit_price: 15_700, is_taxable_tpp: false }, // sales commission
      { quantity: 1, unit_price: 19_800, is_taxable_tpp: false }, // warranty
      // Total non-taxable = 75,000
    ]
    // 225,000 × 0.0825 = 18,562.50
    expect(computeChainTax(items, true)).toBe(18_562.5)
    // Sanity: pre-fix would have been (300,000 × 0.0825) = 24,750
    // Delta = 6,187.50 — matches the action body's stated over-collection.
  })

  it('respects quantity > 1 in the taxable subset', () => {
    const items: TaxLine[] = [
      { quantity: 4, unit_price: 1_000, is_taxable_tpp: true }, // 4,000 taxable
      { quantity: 2, unit_price: 500, is_taxable_tpp: false }, // 1,000 non-tax
    ]
    // 4,000 × 0.0825 = 330.00
    expect(computeChainTax(items, true)).toBe(330)
  })

  it('rounds to cents (matches existing chain.ts rounding semantics)', () => {
    // Fractional cents in input — confirm we round per-line and final.
    const items: TaxLine[] = [
      { quantity: 1, unit_price: 1234.567, is_taxable_tpp: true },
    ]
    // Per-line rounding: 1234.57. Tax: 1234.57 × 0.0825 = 101.85202… → 101.85
    expect(computeChainTax(items, true)).toBe(101.85)
  })
})
