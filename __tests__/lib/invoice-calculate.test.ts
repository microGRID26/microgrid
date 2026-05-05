import { describe, it, expect } from 'vitest'
import {
  buildInvoiceFromRule,
  parsePercentageFromRuleName,
  addDays,
  DEFAULT_INVOICE_CEILING_USD,
  type CalculatorContext,
} from '@/lib/invoices/calculate'
import type { Project, InvoiceRule, Organization } from '@/types/database'

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseProject: Project = {
  id: 'PROJ-00001',
  name: 'Jane Smith',
  city: 'Austin',
  zip: '78701',
  address: '123 Solar Ln',
  phone: null,
  email: null,
  sale_date: '2026-01-01',
  stage: 'install',
  stage_date: null,
  pm: null,
  pm_id: null,
  disposition: 'Sale',
  contract: 50000,
  systemkw: 12.5,
  financier: null,
  ahj: null,
  utility: null,
  advisor: null,
  consultant: null,
  blocker: null,
  financing_type: null,
  down_payment: null,
  tpo_escalator: null,
  financier_adv_pmt: null,
  module: null,
  module_qty: null,
  inverter: null,
  inverter_qty: null,
  battery: null,
  battery_qty: null,
  optimizer: null,
  optimizer_qty: null,
  meter_location: null,
  panel_location: null,
  voltage: null,
  msp_bus_rating: null,
  mpu: null,
  shutdown: null,
  performance_meter: null,
  interconnection_breaker: null,
  main_breaker: null,
  hoa: null,
  esid: null,
  meter_number: null,
  permit_number: null,
  utility_app_number: null,
  permit_fee: null,
  reinspection_fee: null,
  city_permit_date: null,
  utility_permit_date: null,
  ntp_date: null,
  survey_scheduled_date: null,
  survey_date: null,
  install_scheduled_date: null,
  install_complete_date: null,
  city_inspection_date: null,
  utility_inspection_date: null,
  pto_date: null,
  in_service_date: null,
  site_surveyor: null,
  consultant_email: null,
  dealer: null,
  follow_up_date: null,
  energy_community: false,
  org_id: 'org-epc-1',
  created_at: '2026-01-01T00:00:00Z',
}

const ntpRule: InvoiceRule = {
  id: 'rule-ntp-30',
  name: 'EPC Services — NTP (30%)',
  milestone: 'ntp',
  from_org_type: 'epc',
  to_org_type: 'platform',
  line_items: [
    { description: 'Engineering, Procurement & Construction — NTP Milestone (30%)', category: 'epc' },
  ],
  active: true,
  rule_kind: 'milestone',
  use_project_catalog: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const engineeringRule: InvoiceRule = {
  id: 'rule-eng-flat',
  name: 'Engineering Design Services',
  milestone: 'installation',
  from_org_type: 'engineering',
  to_org_type: 'epc',
  line_items: [
    { description: 'System Design & Engineering', quantity: 1, unit_price: 1200, category: 'engineering' },
  ],
  active: true,
  rule_kind: 'milestone',
  use_project_catalog: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const monthlyRule: InvoiceRule = {
  id: 'rule-monthly',
  name: 'Retail Energy & VPP Revenue',
  milestone: 'monthly',
  from_org_type: 'platform',
  to_org_type: 'epc',
  line_items: [
    { description: '$6/kWh battery capacity', category: 'energy' },
  ],
  active: true,
  rule_kind: 'monthly',
  use_project_catalog: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const priceTbdRule: InvoiceRule = {
  id: 'rule-tbd',
  name: 'Retail Energy & VPP — Light Energy',
  milestone: 'installation',
  from_org_type: 'epc',
  to_org_type: 'customer',
  line_items: [
    { description: 'Retail Energy & VPP Revenue (price under negotiation)', category: 'energy' },
  ],
  active: false,
  rule_kind: 'milestone',
  use_project_catalog: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const fromOrg: Pick<Organization, 'id'> = { id: 'org-epc-1' }
const toOrg: Pick<Organization, 'id'> = { id: 'org-platform-1' }

const fixedNow = new Date('2026-04-13T15:00:00Z')

function ctx(overrides: Partial<CalculatorContext> = {}): CalculatorContext {
  return {
    project: baseProject,
    rule: ntpRule,
    fromOrg,
    toOrg,
    invoiceNumber: 'INV-20260413-001',
    now: fixedNow,
    ...overrides,
  }
}

// ── parsePercentageFromRuleName ─────────────────────────────────────────────

describe('parsePercentageFromRuleName', () => {
  it('extracts 30 from "EPC Services — NTP (30%)"', () => {
    expect(parsePercentageFromRuleName('EPC Services — NTP (30%)')).toBeCloseTo(0.3)
  })
  it('extracts 50 from "(50%)"', () => {
    expect(parsePercentageFromRuleName('EPC Services — Install (50%)')).toBeCloseTo(0.5)
  })
  it('extracts 20 from "(20%)"', () => {
    expect(parsePercentageFromRuleName('EPC Services — PTO (20%)')).toBeCloseTo(0.2)
  })
  it('returns null when no percentage present', () => {
    expect(parsePercentageFromRuleName('Equipment & Materials')).toBeNull()
  })
  it('handles decimal percentages', () => {
    expect(parsePercentageFromRuleName('X (2.5%)')).toBeCloseTo(0.025)
  })
  it('rejects negative and over-100 values', () => {
    expect(parsePercentageFromRuleName('X (-10%)')).toBeNull()
    expect(parsePercentageFromRuleName('X (150%)')).toBeNull()
  })
  it('rejects zero percent', () => {
    expect(parsePercentageFromRuleName('X (0%)')).toBeNull()
  })
})

// ── addDays ─────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds 30 days to a fixed date', () => {
    expect(addDays(new Date('2026-04-13T12:00:00Z'), 30)).toBe('2026-05-13')
  })
  it('crosses a month boundary correctly', () => {
    expect(addDays(new Date('2026-01-15T12:00:00Z'), 20)).toBe('2026-02-04')
  })
})

// ── buildInvoiceFromRule — percentage mode ──────────────────────────────────

describe('buildInvoiceFromRule — percentage rules', () => {
  it('computes 30% of contract for the NTP rule', () => {
    const result = buildInvoiceFromRule(ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.subtotal).toBe(15000) // 50000 * 0.30
    expect(result.draft.total).toBe(15000)
    expect(result.draft.line_items).toHaveLength(1)
    expect(result.draft.line_items[0].unit_price).toBe(15000)
    expect(result.draft.line_items[0].quantity).toBe(1)
    expect(result.draft.milestone).toBe('ntp')
    expect(result.draft.rule_id).toBe('rule-ntp-30')
    expect(result.draft.generated_by).toBe('rule')
    expect(result.draft.due_date).toBe('2026-05-13') // now + 30d
  })

  it('computes 50% of contract for the install rule', () => {
    const installRule = {
      ...ntpRule,
      id: 'rule-install-50',
      name: 'EPC Services — Install (50%)',
      milestone: 'installation',
    }
    const result = buildInvoiceFromRule(ctx({ rule: installRule }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.total).toBe(25000)
    expect(result.draft.milestone).toBe('installation')
  })

  it('computes 20% of contract for the PTO rule', () => {
    const ptoRule = {
      ...ntpRule,
      id: 'rule-pto-20',
      name: 'EPC Services — PTO (20%)',
      milestone: 'pto',
    }
    const result = buildInvoiceFromRule(ctx({ rule: ptoRule }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.total).toBe(10000)
  })

  it('returns contract_value_missing when contract is null', () => {
    const result = buildInvoiceFromRule(ctx({ project: { ...baseProject, contract: null } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('contract_value_missing')
  })

  it('returns contract_value_missing when contract is zero', () => {
    const result = buildInvoiceFromRule(ctx({ project: { ...baseProject, contract: 0 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('contract_value_missing')
  })

  // projects.contract is TEXT in Postgres (#528). The runtime value can arrive
  // as a string even though TypeScript types it as number. Verify the guard
  // handles comma-formatted, currency-prefixed, and non-numeric strings.
  it('parses comma-formatted contract string correctly', () => {
    const result = buildInvoiceFromRule(ctx({ project: { ...baseProject, contract: '9,970.00' as unknown as number } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.subtotal).toBeCloseTo(9970 * 0.3, 2)
  })

  it('parses dollar-sign + comma contract string correctly', () => {
    const result = buildInvoiceFromRule(ctx({ project: { ...baseProject, contract: '$50,000' as unknown as number } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.subtotal).toBeCloseTo(50000 * 0.3, 2)
  })

  it('returns contract_value_missing for empty string contract', () => {
    const result = buildInvoiceFromRule(ctx({ project: { ...baseProject, contract: '' as unknown as number } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('contract_value_missing')
  })

  it('returns contract_value_missing for non-numeric contract string', () => {
    const result = buildInvoiceFromRule(ctx({ project: { ...baseProject, contract: 'pending' as unknown as number } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('contract_value_missing')
  })
})

// ── buildInvoiceFromRule — flat rate mode ───────────────────────────────────

describe('buildInvoiceFromRule — flat rate rules', () => {
  it('uses the rule unit_price directly', () => {
    const result = buildInvoiceFromRule(ctx({ rule: engineeringRule }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.subtotal).toBe(1200)
    expect(result.draft.line_items[0].quantity).toBe(1)
    expect(result.draft.line_items[0].unit_price).toBe(1200)
  })

  it('flat rate works even when contract is null', () => {
    const result = buildInvoiceFromRule(ctx({
      rule: engineeringRule,
      project: { ...baseProject, contract: null },
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.total).toBe(1200)
  })
})

// ── buildInvoiceFromRule — rejection cases ──────────────────────────────────

describe('buildInvoiceFromRule — rejections', () => {
  it('refuses monthly rules', () => {
    const result = buildInvoiceFromRule(ctx({ rule: monthlyRule }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('per_unit_not_supported')
  })

  it('refuses inactive rules', () => {
    const result = buildInvoiceFromRule(ctx({ rule: priceTbdRule }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('inactive_rule')
  })

  it('refuses rules where line items have no price and no percentage in name', () => {
    const badRule: InvoiceRule = {
      ...engineeringRule,
      id: 'rule-bad',
      name: 'Equipment & Materials',
      line_items: [{ description: 'Solar panels', category: 'equipment' }],
    }
    const result = buildInvoiceFromRule(ctx({ rule: badRule }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('line_item_missing_price')
  })

  it('refuses rules with empty line items', () => {
    const emptyRule = { ...engineeringRule, line_items: [] }
    const result = buildInvoiceFromRule(ctx({ rule: emptyRule }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('empty_line_items')
  })

  it('refuses when total exceeds default ceiling', () => {
    // 30% of $2M contract = $600k > $500k default ceiling
    const result = buildInvoiceFromRule(ctx({
      project: { ...baseProject, contract: 2_000_000 },
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('total_exceeds_ceiling')
  })

  it('allows override of ceiling via ctx.maxTotal', () => {
    const result = buildInvoiceFromRule(ctx({
      project: { ...baseProject, contract: 2_000_000 },
      maxTotal: 1_000_000,
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.total).toBe(600_000)
  })

  it('DEFAULT_INVOICE_CEILING_USD is 500_000', () => {
    expect(DEFAULT_INVOICE_CEILING_USD).toBe(500_000)
  })
})

// ── buildInvoiceFromRule — invariants ───────────────────────────────────────

describe('buildInvoiceFromRule — invariants', () => {
  it('preserves rule id and milestone on draft for idempotency key', () => {
    const result = buildInvoiceFromRule(ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.rule_id).toBe(ntpRule.id)
    expect(result.draft.milestone).toBe(ntpRule.milestone)
    expect(result.draft.project_id).toBe(baseProject.id)
  })

  it('stable sort_order on line items', () => {
    const multiRule: InvoiceRule = {
      ...engineeringRule,
      line_items: [
        { description: 'A', quantity: 1, unit_price: 100 },
        { description: 'B', quantity: 2, unit_price: 50 },
        { description: 'C', quantity: 1, unit_price: 25 },
      ],
    }
    const result = buildInvoiceFromRule(ctx({ rule: multiRule }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.line_items.map(li => li.sort_order)).toEqual([0, 1, 2])
    expect(result.draft.subtotal).toBe(225) // 100 + 100 + 25
  })

  it('rounds money to cents', () => {
    // 33.33% of $100 = $33.333 → rounds to $33.33
    const oddRule = { ...ntpRule, name: 'X (33.33%)' }
    const result = buildInvoiceFromRule(ctx({
      rule: oddRule,
      project: { ...baseProject, contract: 100 },
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.subtotal).toBe(33.33)
  })
})
