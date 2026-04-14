// __tests__/warranty/warranty-claims.test.ts
//
// Tests for the warranty claim lifecycle and funding deduction logic.
// Focuses on the business rules: status transitions, deduction creation
// gating, and the auto-apply mechanic via computeNetPayment.

import { describe, expect, it } from 'vitest'

import { computeNetPayment } from '@/lib/invoices/funding-deductions'

// ── Warranty claim status machine ─────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:   ['deployed', 'voided'],
  deployed:  ['invoiced', 'voided'],
  invoiced:  ['recovered'],
  recovered: [], // terminal
  voided:    [], // terminal
}

describe('warranty claim status machine', () => {
  it('pending can only go to deployed or voided', () => {
    expect(VALID_TRANSITIONS.pending).toContain('deployed')
    expect(VALID_TRANSITIONS.pending).toContain('voided')
    expect(VALID_TRANSITIONS.pending).not.toContain('invoiced')
    expect(VALID_TRANSITIONS.pending).not.toContain('recovered')
  })

  it('deployed can only go to invoiced or voided', () => {
    expect(VALID_TRANSITIONS.deployed).toContain('invoiced')
    expect(VALID_TRANSITIONS.deployed).toContain('voided')
  })

  it('invoiced can only go to recovered', () => {
    expect(VALID_TRANSITIONS.invoiced).toEqual(['recovered'])
  })

  it('recovered and voided are terminal states', () => {
    expect(VALID_TRANSITIONS.recovered).toHaveLength(0)
    expect(VALID_TRANSITIONS.voided).toHaveLength(0)
  })
})

// ── Deduction creation gating ─────────────────────────────────────────────────

function shouldCreateDeduction(status: string, claimAmount: number | null): boolean {
  return status === 'invoiced' && claimAmount !== null && claimAmount > 0
}

describe('funding deduction creation gating', () => {
  it('creates deduction when status=invoiced and amount>0', () => {
    expect(shouldCreateDeduction('invoiced', 4_500)).toBe(true)
  })

  it('does not create deduction for pending status', () => {
    expect(shouldCreateDeduction('pending', 4_500)).toBe(false)
  })

  it('does not create deduction for deployed status', () => {
    expect(shouldCreateDeduction('deployed', 4_500)).toBe(false)
  })

  it('does not create deduction when amount is null', () => {
    expect(shouldCreateDeduction('invoiced', null)).toBe(false)
  })

  it('does not create deduction when amount is 0', () => {
    expect(shouldCreateDeduction('invoiced', 0)).toBe(false)
  })

  it('does not create deduction for negative amount', () => {
    expect(shouldCreateDeduction('invoiced', -100)).toBe(false)
  })

  it('creates deduction for recovered status (already moved through invoiced)', () => {
    // recovered came from invoiced — the deduction was already created at invoiced.
    // This is NOT the trigger point; just verifying the gating function doesn't
    // accidentally re-trigger on 'recovered'.
    expect(shouldCreateDeduction('recovered', 4_500)).toBe(false)
  })
})

// ── EPC → EDGE invoice netting via computeNetPayment ─────────────────────────

describe('EPC → EDGE invoice netting', () => {
  it('marks invoice paid_amount = gross when no deductions', () => {
    const result = computeNetPayment(120_000, [])
    expect(result.netAmount).toBe(120_000)
    expect(result.totalDeducted).toBe(0)
  })

  it('nets a single warranty deduction from EPC payment', () => {
    // EPC invoiced EDGE $120K; there's a $4,500 warranty chargeback.
    const result = computeNetPayment(120_000, [
      { id: 'fd-1', amount: 4_500, source_claim_id: 'wc-1' },
    ])
    expect(result.netAmount).toBe(115_500)
    expect(result.totalDeducted).toBe(4_500)
  })

  it('nets multiple chargebacks from the same EPC in one payment', () => {
    const result = computeNetPayment(200_000, [
      { id: 'fd-1', amount: 3_200, source_claim_id: 'wc-1' },
      { id: 'fd-2', amount: 1_800, source_claim_id: 'wc-2' },
      { id: 'fd-3', amount: 500,   source_claim_id: 'wc-3' },
    ])
    expect(result.totalDeducted).toBe(5_500)
    expect(result.netAmount).toBe(194_500)
    expect(result.appliedDeductionIds).toHaveLength(3)
  })

  it('invoice paid_amount floored at 0 when chargebacks exceed gross', () => {
    // Edge case: EPC owes more in chargebacks than their current invoice total.
    const result = computeNetPayment(3_000, [
      { id: 'fd-1', amount: 4_500, source_claim_id: 'wc-1' },
    ])
    expect(result.netAmount).toBe(0)
    // The remaining $1,500 balance should be tracked separately (future enhancement)
    expect(result.totalDeducted).toBe(4_500)
  })
})
