// lib/cost/calculator.ts — Pure project cost basis calculator (Tier 2 Phase 2.3)
//
// Mirrors the proforma's Project Cost Reconciliation & Basis sheet at
// rows 3–30 (line items) and the I34:M39 summary block. Given a set of
// per-project line items, it computes:
//
//   total_basis           — SUM(epc_price)
//   pv_basis              — SUM(pv_cost)
//   battery_basis         — SUM(battery_cost)
//   gpu_basis             — SUM(epc_price WHERE system_bucket='GPU')
//   itc_eligible_basis    — total_basis minus is_itc_excluded items
//   itc_eligible_pct      — itc_eligible_basis / total_basis
//   pv_basis_pct          — pv_basis / total_basis
//   battery_basis_pct     — battery_basis / total_basis
//   gpu_basis_pct         — gpu_basis / total_basis
//
// Pure function — no DB, no network, no side effects.
//
// Also includes the pure helper used by the backfill script + the chain
// orchestrator (Phase 3+) to instantiate a per-project line item from a
// catalog template, scaling raw_cost by project size where the template
// uses per_kw or per_kwh unit basis.
//
// Tested via __tests__/lib/cost-calculator.test.ts with the proforma sample
// (24.2 kW PV / 80 kWh battery / 2 GPUs) as a golden test:
//   expected total basis     = $423,714.7744 (proforma row 33 N column)
//   expected ITC-eligible    = $360,615.85   (proforma row 39 L column, with GPU excluded)
//   expected ITC-eligible %  = 85.108%       (proforma row 39 M column)

// ── Types ───────────────────────────────────────────────────────────────────

export type SystemBucket = 'Battery' | 'PV' | 'GPU' | 'Both'
export type UnitBasis = 'flat' | 'per_kw' | 'per_kwh'
export type ProofType = 'Bank Transaction' | 'EPC-Attestation'
export type BasisEligibility = 'Yes' | 'Partial' | 'No' | 'TBD'

/** Catalog template row — what the Postgres table holds. */
export interface CostLineItemTemplate {
  id: string
  sort_order: number
  section: string
  category: string | null
  system_bucket: SystemBucket
  item_name: string
  default_raw_cost: number
  default_unit_basis: UnitBasis
  default_markup_to_distro: number
  default_markup_distro_to_epc: number
  default_battery_pct: number
  default_pv_pct: number
  default_proof_type: ProofType
  default_basis_eligibility: BasisEligibility
  default_paid_from_org_type: string
  default_paid_to_org_type: string
  is_epc_internal: boolean
  is_itc_excluded: boolean
  /** TX sales-tax classification: true = taxable TPP, false = non-TPP service.
   *  Read by chain.ts when computing EPC→EDGE invoice tax. #526. */
  is_taxable_tpp: boolean
  active: boolean
}

/** Per-project instance of a catalog row, with computed prices. */
export interface ProjectCostLineItem {
  id?: string
  project_id: string
  template_id: string | null
  sort_order: number
  section: string
  category: string | null
  system_bucket: SystemBucket
  item_name: string
  raw_cost: number
  markup_to_distro: number
  distro_price: number
  markup_distro_to_epc: number
  epc_price: number
  battery_pct: number
  pv_pct: number
  battery_cost: number
  pv_cost: number
  proof_of_payment_status: 'Pending' | 'Yes' | 'No' | 'TBD'
  proof_type: ProofType
  basis_eligibility: BasisEligibility
  paid_from_org_id: string | null
  paid_to_org_id: string | null
  is_epc_internal: boolean
  is_itc_excluded: boolean
  /** Mirrored from template at materialization. Read by chain.ts tax filter. #526. */
  is_taxable_tpp: boolean
}

/** Project sizing inputs used to scale per_kw / per_kwh templates. */
export interface ProjectSizing {
  /** PV system size in kW DC. From projects.systemkw. */
  systemkw: number | null
  /** Battery storage in kWh. Estimated from battery_qty if not stored explicitly. */
  battery_kwh: number
}

/** Result of the basis summary calculation — mirrors I34:M39 in the proforma. */
export interface CostBasisSummary {
  total_basis: number
  pv_basis: number
  battery_basis: number
  gpu_basis: number
  itc_eligible_basis: number
  itc_eligible_pct: number
  pv_basis_pct: number
  battery_basis_pct: number
  gpu_basis_pct: number
  line_item_count: number
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Default battery kWh used when the project has no explicit battery_kwh and no battery_qty. */
export const DEFAULT_BATTERY_KWH = 80

/** Default PV kW used when the project has no systemkw set. */
export const DEFAULT_PV_KW = 24.2

// ── Helpers ─────────────────────────────────────────────────────────────────

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function roundPct(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

/**
 * Resolve project sizing from a Project row. Falls back to proforma defaults
 * (24.2 kW / 80 kWh) when the project has no system size. The fallback is
 * intentional — projects with no system size still need a placeholder
 * reconciliation to show up in the UI; the user can fix the sizing later.
 *
 * Battery kWh estimation: if `explicit_battery_kwh` is provided, use it.
 * Otherwise estimate as `battery_qty * 16` (Duracell default) or fall back to
 * DEFAULT_BATTERY_KWH if both are null.
 */
export function resolveProjectSizing(project: {
  systemkw?: number | null
  battery_qty?: number | null
}, opts: { explicit_battery_kwh?: number; battery_kwh_per_unit?: number } = {}): ProjectSizing {
  const systemkw = project.systemkw && project.systemkw > 0 ? project.systemkw : DEFAULT_PV_KW
  const battery_kwh =
    opts.explicit_battery_kwh && opts.explicit_battery_kwh > 0
      ? opts.explicit_battery_kwh
      : project.battery_qty && project.battery_qty > 0
        ? project.battery_qty * (opts.battery_kwh_per_unit ?? 16)
        : DEFAULT_BATTERY_KWH
  return { systemkw, battery_kwh }
}

/**
 * Scale a template's raw_cost based on its unit basis and the project's
 * size. flat → return as-is; per_kw → multiply by systemkw; per_kwh →
 * multiply by battery_kwh. Pure function.
 */
export function scaleRawCost(
  template: Pick<CostLineItemTemplate, 'default_raw_cost' | 'default_unit_basis'>,
  sizing: ProjectSizing,
): number {
  switch (template.default_unit_basis) {
    case 'flat':
      return roundMoney(template.default_raw_cost)
    case 'per_kw':
      return roundMoney(template.default_raw_cost * (sizing.systemkw ?? DEFAULT_PV_KW))
    case 'per_kwh':
      return roundMoney(template.default_raw_cost * sizing.battery_kwh)
    default:
      return roundMoney(template.default_raw_cost)
  }
}

/**
 * Build a per-project line item from a catalog template, scaling raw_cost by
 * project size and computing distro_price / epc_price / battery_cost / pv_cost.
 * Used by the backfill script in scripts/backfill-project-cost-line-items.ts
 * and by the inline upsert when a new project is created.
 *
 * Sales tax is NOT applied here — that's a chain-orchestrator concern
 * (Phase 1.5) and applies only to the EPC → EDGE invoice link.
 */
export function buildProjectLineItem(
  template: CostLineItemTemplate,
  sizing: ProjectSizing,
  projectId: string,
): Omit<ProjectCostLineItem, 'id'> {
  const raw_cost = scaleRawCost(template, sizing)
  // Both markups are ADDITIONAL factors, not total multipliers. So
  //   distro = raw × (1 + markup_to_distro)
  //   epc   = distro × (1 + markup_distro_to_epc)
  // This matches the semantics of the proforma's K and M columns: K=1.2 means
  // "+120% on top of raw", so a $37,452.80 raw becomes $82,396.16 distro
  // (= 37,452.80 × 2.2), which matches proforma row 3 column L exactly.
  const distro_price = roundMoney(raw_cost * (1 + template.default_markup_to_distro))
  const epc_price = roundMoney(distro_price * (1 + template.default_markup_distro_to_epc))
  const battery_cost = roundMoney(epc_price * template.default_battery_pct)
  const pv_cost = roundMoney(epc_price * template.default_pv_pct)

  return {
    project_id: projectId,
    template_id: template.id,
    sort_order: template.sort_order,
    section: template.section,
    category: template.category,
    system_bucket: template.system_bucket,
    item_name: template.item_name,
    raw_cost,
    markup_to_distro: template.default_markup_to_distro,
    distro_price,
    markup_distro_to_epc: template.default_markup_distro_to_epc,
    epc_price,
    battery_pct: template.default_battery_pct,
    pv_pct: template.default_pv_pct,
    battery_cost,
    pv_cost,
    proof_of_payment_status: 'Pending',
    proof_type: template.default_proof_type,
    basis_eligibility: template.default_basis_eligibility,
    paid_from_org_id: null, // resolved at chain-orchestration time
    paid_to_org_id: null,
    is_epc_internal: template.is_epc_internal,
    is_itc_excluded: template.is_itc_excluded,
    is_taxable_tpp: template.is_taxable_tpp,
  }
}

// ── Main calculator ─────────────────────────────────────────────────────────

/**
 * Compute the I34:M39 summary block from a set of project cost line items.
 * Pure function — no DB, no rounding errors compounding.
 */
export function computeProjectCostBasis(lineItems: ProjectCostLineItem[]): CostBasisSummary {
  let total_basis = 0
  let pv_basis = 0
  let battery_basis = 0
  let gpu_basis = 0
  let itc_eligible_basis = 0

  for (const li of lineItems) {
    total_basis += li.epc_price
    pv_basis += li.pv_cost
    battery_basis += li.battery_cost
    if (li.system_bucket === 'GPU') {
      gpu_basis += li.epc_price
    }
    if (!li.is_itc_excluded) {
      itc_eligible_basis += li.epc_price
    }
  }

  total_basis = roundMoney(total_basis)
  pv_basis = roundMoney(pv_basis)
  battery_basis = roundMoney(battery_basis)
  gpu_basis = roundMoney(gpu_basis)
  itc_eligible_basis = roundMoney(itc_eligible_basis)

  return {
    total_basis,
    pv_basis,
    battery_basis,
    gpu_basis,
    itc_eligible_basis,
    itc_eligible_pct: total_basis > 0 ? roundPct(itc_eligible_basis / total_basis) : 0,
    pv_basis_pct: total_basis > 0 ? roundPct(pv_basis / total_basis) : 0,
    battery_basis_pct: total_basis > 0 ? roundPct(battery_basis / total_basis) : 0,
    gpu_basis_pct: total_basis > 0 ? roundPct(gpu_basis / total_basis) : 0,
    line_item_count: lineItems.length,
  }
}
