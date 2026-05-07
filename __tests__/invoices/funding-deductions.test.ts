// __tests__/invoices/funding-deductions.test.ts
//
// Unit tests for the funding-deductions pure calculator.
// No DB access — all I/O is mocked or excluded from the pure-function tests.

import { describe, expect, it } from 'vitest'

import { computeNetPayment, type DeductionRow } from '@/lib/invoices/funding-deductions'

// ── computeNetPayment ────────────────────────────────────────────────────────

describe('computeNetPayment', () => {
  function row(id: string, amount: number, created_at?: string): DeductionRow {
    return { id, amount, source_claim_id: `claim-${id}`, created_at }
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

  it('skips a single deduction that exceeds gross — row stays open (#538)', () => {
    // #538: previously netAmount=0 and the $5,000 deduction was marked applied
    // (silently lost). New behavior: row doesn't fit → skip, paid=gross, row
    // stays open for the next invoice.
    const result = computeNetPayment(1_000, [row('d1', 5_000)])
    expect(result.totalDeducted).toBe(0)
    expect(result.netAmount).toBe(1_000)
    expect(result.grossAmount).toBe(1_000)
    expect(result.appliedDeductionIds).toEqual([])
  })

  it('FIFO partial coverage — applies oldest deductions while sum ≤ gross (#538)', () => {
    // gross 100, three deductions oldest→newest: $40, $30, $50.
    // FIFO: $40 (40 ≤ 100) ✓, $30 (70 ≤ 100) ✓, $50 (120 > 100) skip.
    // Result: paid $30, $50 carries open, totalDeducted $70.
    const result = computeNetPayment(100, [
      row('old', 40, '2026-01-01T00:00:00Z'),
      row('mid', 30, '2026-02-01T00:00:00Z'),
      row('new', 50, '2026-03-01T00:00:00Z'),
    ])
    expect(result.totalDeducted).toBe(70)
    expect(result.netAmount).toBe(30)
    expect(result.appliedDeductionIds).toEqual(['old', 'mid'])
  })

  it('FIFO continues past an over-budget row to apply later smaller rows (#538)', () => {
    // gross 1_000, FIFO order: $5_000 (skip), $300 (apply), $200 (apply).
    // Confirms `continue` (not `break`) on overflow.
    const result = computeNetPayment(1_000, [
      row('big', 5_000, '2026-01-01T00:00:00Z'),
      row('s1', 300, '2026-02-01T00:00:00Z'),
      row('s2', 200, '2026-03-01T00:00:00Z'),
    ])
    expect(result.totalDeducted).toBe(500)
    expect(result.netAmount).toBe(500)
    expect(result.appliedDeductionIds).toEqual(['s1', 's2'])
  })

  it('id breaks tie when two deductions share created_at (#538)', () => {
    // Same timestamp on both rows; sort falls back to id ASC.
    const result = computeNetPayment(50, [
      row('b', 30, '2026-01-01T00:00:00Z'),
      row('a', 30, '2026-01-01T00:00:00Z'),
    ])
    // 'a' < 'b' → 'a' applied first ($30 ≤ $50), then 'b' ($60 > $50) skipped.
    expect(result.appliedDeductionIds).toEqual(['a'])
    expect(result.totalDeducted).toBe(30)
    expect(result.netAmount).toBe(20)
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

  it('NaN grossAmount is treated as 0 (guard against corrupted DB records)', () => {
    const result = computeNetPayment(NaN, [])
    expect(result.grossAmount).toBe(0)
    expect(result.netAmount).toBe(0)
    expect(result.totalDeducted).toBe(0)
  })

  it('Infinity grossAmount is treated as 0', () => {
    const result = computeNetPayment(Infinity, [row('d1', 100)])
    expect(result.grossAmount).toBe(0)
    expect(result.netAmount).toBe(0)
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
