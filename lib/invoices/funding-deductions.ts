// lib/invoices/funding-deductions.ts — Warranty chargeback netting (Tier 2 Phase 4.2)
//
// When an EPC → EDGE invoice transitions to 'paid', the apply_paid_invoice
// RPC (migration 240) atomically:
//   1. locks the invoice row,
//   2. validates TOCTOU (current status matches caller's read),
//   3. locks matching status='open' funding_deductions for the EPC with
//      FOR UPDATE SKIP LOCKED,
//   4. applies the FIFO algorithm in computeNetPayment below,
//   5. UPDATEs the invoice (paid_amount, paid_at, payment_*),
//   6. UPDATEs deductions to status='applied'.
//
// Single PG TX commits all of it or rolls all of it back — no orphaned
// 'applied' deductions can survive caller process death (#613 Critical fix).
//
// This module exports only the pure FIFO calculator (computeNetPayment) plus
// types. The caller in lib/api/invoices.ts invokes the RPC directly. The
// pure calculator is the algorithmic spec the PL/pgSQL must mirror — drift
// between the two is what the test suite guards against.
//
// Lifecycle:
//   1. EDGE ops opens a warranty_claim (pending)
//   2. Replacement EPC is deployed (deployed), cost known
//   3. funding_deduction row inserted (open)
//   4. Next EPC → EDGE invoice transitions to 'paid'
//   5. apply_paid_invoice RPC nets + applies + writes paid in one TX
//
// Idempotent: the unique partial index on funding_deductions(source_claim_id)
// WHERE status != 'cancelled' prevents double-deductions.

// ── Types ────────────────────────────────────────────────────────────────────

export interface DeductionRow {
  id: string
  amount: number
  source_claim_id: string
  /** When the deduction row was inserted. Used to apply oldest-first (FIFO) so
   *  partial-coverage rounds carry the newest deductions forward. #538. */
  created_at?: string
}

export interface FundingDeductionResult {
  /** Gross amount on the invoice (invoice.total). */
  grossAmount: number
  /** Sum of all open deductions applied. 0 if none. */
  totalDeducted: number
  /** Net amount to record as paid_amount (floored at 0). */
  netAmount: number
  /** IDs of the funding_deduction rows that were applied. */
  appliedDeductionIds: string[]
}

// ── Pure calculator ──────────────────────────────────────────────────────────

/**
 * Compute the net payment after applying open deductions, FIFO.
 * Pure function — no DB access. The PL/pgSQL apply_paid_invoice RPC
 * implements the same algorithm; this function is the canonical spec
 * the SQL side must match.
 */
export function computeNetPayment(
  grossAmount: number,
  openDeductions: DeductionRow[],
): FundingDeductionResult {
  // Guard: if grossAmount is NaN or Infinity (e.g., malformed DB record),
  // treat it as 0 — conservative behavior that avoids writing garbage to paid_amount.
  const safeGross = Number.isFinite(grossAmount) ? grossAmount : 0
  const safeGrossR = Math.round(safeGross * 100) / 100

  // #538: previously we summed ALL open deductions and floored net at 0,
  // marking every deduction applied even when total > gross — the excess was
  // silently lost. Now we apply deductions FIFO, only marking each row as
  // applied if its cumulative sum stays ≤ gross. Remaining rows stay 'open'
  // and carry forward to the next invoice.
  // Sort oldest-first (ascending). NULL/undefined `created_at` sorts LAST so a
  // row missing its timestamp doesn't leap the queue (R1 audit M1, #538).
  const ordered = openDeductions
    .slice()
    .sort((a, b) => {
      const at = a.created_at
      const bt = b.created_at
      if (at && bt) {
        if (at !== bt) return at < bt ? -1 : 1
      } else if (at && !bt) {
        return -1
      } else if (!at && bt) {
        return 1
      }
      // Tiebreaker on id, lowercase-normalized so the TS sort matches the
      // PG `ORDER BY id ASC` (UUID byte-order ≈ lowercase-string-order). R1
      // HIGH on #613.
      const aid = a.id.toLowerCase()
      const bid = b.id.toLowerCase()
      return aid < bid ? -1 : aid > bid ? 1 : 0
    })

  const appliedDeductionIds: string[] = []
  let totalDeductedCents = 0
  const grossCents = Math.round(safeGrossR * 100)
  for (const d of ordered) {
    const amtCents = Math.round(Number(d.amount) * 100)
    if (totalDeductedCents + amtCents > grossCents) {
      // Adding this row would over-deduct. Skip — leaves the row 'open' for
      // a future invoice. We don't split partial deductions; the schema
      // doesn't model "partially applied" today.
      continue
    }
    totalDeductedCents += amtCents
    appliedDeductionIds.push(d.id)
  }
  const totalDeducted = totalDeductedCents / 100
  // Pure integer subtraction in cents — no fp re-introduction (R1 audit M2, #538).
  const netAmount = Math.max(0, grossCents - totalDeductedCents) / 100
  return {
    grossAmount: safeGrossR,
    totalDeducted,
    netAmount,
    appliedDeductionIds,
  }
}
