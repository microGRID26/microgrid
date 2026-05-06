# Invoicing — module rules

## Sales tax precision policy (closes #531)

Sales tax is stored and rendered **only at the invoice level**, never per line.

- `invoices.tax` is the single source of truth.
- `invoice_line_items` has no `tax_amount` column. Do not add one.
- The PDF renderer (`pdf.tsx`) shows one `TX Sales Tax (8.25%)` row in the totals block; it does not render tax per line.
- Chain orchestrator (`chain.ts`) computes `tax = round(draft.subtotal * TX_SALES_TAX_RATE)` once, on the subtotal-of-rounded line totals.

### Why this matters

If a future change starts rendering tax per line in the PDF (or storing per-line `tax_amount`), summed-per-line tax will drift $0.01–$0.05 from invoice-level tax for any chain invoice with 20+ lines. Customers spot the off-by-a-cent and email Heidi. Source: finance-auditor R1 H4 (#479 audit, action #531).

### If you need per-line tax in the future

Pick one and propagate everywhere — chain.ts, pdf.tsx, the customer billing API, and any reconciliation report:

- (a) **Stay invoice-level (current).** PDF subtotal block + one tax row.
- (b) **Per-line.** Add `invoice_line_items.tax_amount numeric`, populate at insert in `chain.ts`, sum into `invoices.tax` (instead of computing fresh), render in PDF table.

Mixing the two is the bug.
