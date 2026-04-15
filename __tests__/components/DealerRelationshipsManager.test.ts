import { describe, it, expect } from 'vitest'

// ── DealerRelationshipsManager unit tests ───────────────────────────────────
// Pure-logic tests mirroring the filters + validation inside
// components/admin/DealerRelationshipsManager.tsx. Follows the OrgManager
// pattern: inline the helpers so tests don't require mounting React.

interface OrgOption {
  id: string
  name: string
  slug: string
  org_type: string
  settings: { is_sales_originator?: boolean; is_underwriter?: boolean } | null
}

// ── Helpers extracted from the component ─────────────────────────────────────

function filterEpcs(orgs: OrgOption[]): OrgOption[] {
  // Installers onboardable as dealers — every EPC except MG Energy itself.
  return orgs.filter((o) => o.org_type === 'epc' && o.slug !== 'microgrid')
}

function filterOriginators(orgs: OrgOption[]): OrgOption[] {
  return orgs.filter((o) => o.settings?.is_sales_originator === true)
}

function findMgEnergyId(orgs: OrgOption[]): string {
  return orgs.find((o) => o.settings?.is_underwriter === true)?.id ?? ''
}

function findEdgeId(orgs: OrgOption[]): string {
  return orgs.find((o) => o.org_type === 'platform')?.id ?? ''
}

function validateContractDraft(draft: {
  epc_org_id?: string
  originator_org_id?: string
}): { ok: true } | { ok: false; error: string } {
  if (!draft.epc_org_id || !draft.originator_org_id) {
    return { ok: false, error: 'EPC and originator are required' }
  }
  return { ok: true }
}

function validateFeeDraft(draft: {
  epc_org_id?: string
  underwriter_org_id?: string
  billed_to_org_id?: string
  fee_amount?: number
}): { ok: true } | { ok: false; error: string } {
  if (!draft.epc_org_id || !draft.underwriter_org_id || !draft.billed_to_org_id) {
    return { ok: false, error: 'EPC, underwriter, and payer are required' }
  }
  if (!draft.fee_amount || draft.fee_amount <= 0) {
    return { ok: false, error: 'Fee amount must be positive' }
  }
  return { ok: true }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mgEnergy: OrgOption = {
  id: 'a0000000-0000-0000-0000-000000000001',
  name: 'MicroGRID Energy',
  slug: 'microgrid',
  org_type: 'epc',
  settings: { is_sales_originator: true, is_underwriter: true },
}
const edge: OrgOption = {
  id: 'b0000000-0000-0000-0000-000000000002',
  name: 'EDGE Energy',
  slug: 'edge',
  org_type: 'platform',
  settings: null,
}
const otherEpc: OrgOption = {
  id: 'c0000000-0000-0000-0000-000000000003',
  name: 'Sunshine Solar',
  slug: 'sunshine-solar',
  org_type: 'epc',
  settings: null,
}
const dseCorp: OrgOption = {
  id: 'd0000000-0000-0000-0000-000000000004',
  name: 'Direct Supply Equity Corporation',
  slug: 'direct-supply-equity-corp',
  org_type: 'direct_supply_equity_corp',
  settings: null,
}

const allOrgs: OrgOption[] = [mgEnergy, edge, otherEpc, dseCorp]

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DealerRelationshipsManager', () => {
  describe('filterEpcs', () => {
    it('returns EPCs excluding MG Energy', () => {
      const result = filterEpcs(allOrgs)
      expect(result).toHaveLength(1)
      expect(result[0].slug).toBe('sunshine-solar')
    })

    it('excludes non-EPC org types', () => {
      const result = filterEpcs(allOrgs)
      expect(result.every((o) => o.org_type === 'epc')).toBe(true)
      expect(result.find((o) => o.slug === 'edge')).toBeUndefined()
      expect(result.find((o) => o.slug === 'direct-supply-equity-corp')).toBeUndefined()
    })

    it('returns empty when only MG Energy is present', () => {
      expect(filterEpcs([mgEnergy])).toEqual([])
    })
  })

  describe('filterOriginators', () => {
    it('returns only orgs with is_sales_originator=true', () => {
      const result = filterOriginators(allOrgs)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(mgEnergy.id)
    })

    it('excludes orgs missing the flag entirely', () => {
      expect(filterOriginators([edge, otherEpc])).toEqual([])
    })

    it('excludes orgs where is_sales_originator is false', () => {
      const disabled = { ...mgEnergy, settings: { is_sales_originator: false } }
      expect(filterOriginators([disabled])).toEqual([])
    })
  })

  describe('findMgEnergyId', () => {
    it('returns the org flagged is_underwriter=true', () => {
      expect(findMgEnergyId(allOrgs)).toBe(mgEnergy.id)
    })

    it('returns empty string when no underwriter exists', () => {
      expect(findMgEnergyId([edge, otherEpc])).toBe('')
    })
  })

  describe('findEdgeId', () => {
    it('returns the first org with org_type=platform', () => {
      expect(findEdgeId(allOrgs)).toBe(edge.id)
    })

    it('returns empty string when no platform org exists', () => {
      expect(findEdgeId([mgEnergy, otherEpc])).toBe('')
    })
  })

  describe('validateContractDraft', () => {
    it('rejects missing epc_org_id', () => {
      const result = validateContractDraft({ originator_org_id: mgEnergy.id })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/required/)
    })

    it('rejects missing originator_org_id', () => {
      const result = validateContractDraft({ epc_org_id: otherEpc.id })
      expect(result.ok).toBe(false)
    })

    it('rejects both missing', () => {
      expect(validateContractDraft({}).ok).toBe(false)
    })

    it('accepts both present', () => {
      const result = validateContractDraft({
        epc_org_id: otherEpc.id,
        originator_org_id: mgEnergy.id,
      })
      expect(result.ok).toBe(true)
    })
  })

  describe('validateFeeDraft', () => {
    const validBase = {
      epc_org_id: otherEpc.id,
      underwriter_org_id: mgEnergy.id,
      billed_to_org_id: edge.id,
      fee_amount: 500,
    }

    it('rejects missing EPC', () => {
      expect(validateFeeDraft({ ...validBase, epc_org_id: undefined }).ok).toBe(false)
    })

    it('rejects missing underwriter', () => {
      expect(validateFeeDraft({ ...validBase, underwriter_org_id: undefined }).ok).toBe(false)
    })

    it('rejects missing billed_to', () => {
      expect(validateFeeDraft({ ...validBase, billed_to_org_id: undefined }).ok).toBe(false)
    })

    it('rejects zero amount', () => {
      expect(validateFeeDraft({ ...validBase, fee_amount: 0 }).ok).toBe(false)
    })

    it('rejects negative amount', () => {
      expect(validateFeeDraft({ ...validBase, fee_amount: -100 }).ok).toBe(false)
    })

    it('rejects missing amount', () => {
      expect(validateFeeDraft({ ...validBase, fee_amount: undefined }).ok).toBe(false)
    })

    it('accepts a fully populated draft', () => {
      expect(validateFeeDraft(validBase).ok).toBe(true)
    })
  })
})
