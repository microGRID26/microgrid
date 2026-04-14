// __tests__/invoices/funding-deductions.test.ts
//
// Unit tests for the funding-deductions pure calculator.
// No DB access — all I/O is mocked or excluded from the pure-function tests.

import { describe, expect, it } from 'vitest'

import { computeNetPayment, type DeductionRow } from '@/lib/invoices/funding-deductions'

// ── computeNetPayment ────────────────────────────────────────────────────────

describe('computeNetPayment', () => {
  function row(id: string, amount: number): DeductionRow {
    return { id, amount, source_claim_id: `claim-${id}` }
  }

  it('returns grossAmount unchanged when no deductions', () => {
    const result = computeNetPayment(10_000, [])
    expect(result.grossAmount).toBe(10_000)
    expect(result.totalDeducted).toBe(0)
    expect(result.netAmount).toBe(10_000)
    expect(result.appliedDeductionIds).toEqual([])
  })

  it('nets a single deduction correctly', () => {
    const result = computeNetPayment(50_000, [row('d1', 3_500)])
    expect(result.grossAmount).toBe(50_000)
    expect(result.totalDeducted).toBe(3_500)
    expect(result.netAmount).toBe(46_500)
    expect(result.appliedDeductionIds).toEqual(['d1'])
  })

  it('nets multiple deductions and sums them', () => {
    const result = computeNetPayment(80_000, [row('d1', 4_000), row('d2', 6_000)])
    expect(result.totalDeducted).toBe(10_000)
    expect(result.netAmount).toBe(70_000)
    expect(result.appliedDeductionIds).toHaveLength(2)
    expect(result.appliedDeductionIds).toContain('d1')
    expect(result.appliedDeductionIds).toContain('d2')
  })

  it('floors netAmount at 0 when deductions exceed gross', () => {
    const result = computeNetPayment(1_000, [row('d1', 5_000)])
    expect(result.netAmount).toBe(0)
    expect(result.totalDeducted).toBe(5_000)
    expect(result.grossAmount).toBe(1_000)
  })

  it('handles fractional cents — rounds to 2 decimal places', () => {
    // $333.33 gross, $100.001 deduction → net should be $233.33 (rounded)
    const result = computeNetPayment(333.33, [row('d1', 100.001)])
    expect(result.totalDeducted).toBe(100)
    expect(result.netAmount).toBe(233.33)
  })

  it('grossAmount is also rounded to 2 decimal places', () => {
    const result = computeNetPayment(99.999, [])
    expect(result.grossAmount).toBe(100)
  })

  it('exact-zero deduction amount is a no-op', () => {
    const result = computeNetPayment(10_000, [row('d1', 0)])
    expect(result.totalDeducted).toBe(0)
    expect(result.netAmount).toBe(10_000)
    expect(result.appliedDeductionIds).toContain('d1')
  })

  it('string amounts from PostgREST are coerced via Number()', () => {
    // Supabase NUMERIC columns return as strings — verify Number() coercion
    const deductionWithStringAmount = {
      id: 'd1',
      amount: '2500.00' as unknown as number,
      source_claim_id: 'claim-d1',
    }
    const result = computeNetPayment(10_000, [deductionWithStringAmount])
    expect(result.totalDeducted).toBe(2_500)
    expect(result.netAmount).toBe(7_500)
  })

  it('returns all deduction IDs in appliedDeductionIds even with zero-amount rows', () => {
    const rows = [row('d1', 100), row('d2', 0), row('d3', 200)]
    const result = computeNetPayment(5_000, rows)
    expect(result.appliedDeductionIds).toEqual(['d1', 'd2', 'd3'])
  })
})
