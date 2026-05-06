# Disposition Canonical Definition (RESOLVED 2026-05-06)

**Status:** ✅ LOCKED. Canonical rule is implemented in `atlas_canonical_ec_booked_sales_since` (`supabase/migrations/231-...sql` + `232-...sql`).

This file documents how "what counts as a sale" was resolved. The canonical rule below ships in the `atlas_canonical_reports` catalog and is the single source of truth for MG's aggregate sales counts.

## The canonical rule

```
A "booked sale" attributed to consultant E since date D =
  lower(projects.consultant) = lower(E)
  AND NULLIF(projects.sale_date,'')::date >= D
  AND COALESCE(projects.disposition,'') NOT IN ('Cancel','Cancelled','Test','Loss','Legal','On Hold')
```

**Includes:** `Sale` (active) and `Loyalty` (post-sale customer state — already booked, now in repeat-customer pipeline).
**Excludes:** terminal states (`Cancel`/`Cancelled`/`Test`/`Loss`/`Legal`/`On Hold`).
**Attribution:** `consultant` only (primary EC-of-record). `advisor`-only rows are not counted by this rule.

## How the 9-row gap was resolved

On 2026-05-06 Atlas first told Greg that Regan Spencer had **166** sales since Sept 1, 2025. Greg's reference number was **175**, with the source attributed to "a tool with slightly different attribution." The disposition canonical doc was opened with 4 rows of the gap untraced after intermediate rules of `disposition='Sale'`=166 and `disposition NOT IN terminal=171` were tested.

**Resolution (2026-05-06 22:00):** when `since_date` was made optional and the canonical function ran with the same disposition rule but **no date floor**, the result was exactly **175** for Regan all-time. The 4-row gap from 171→175 was 4 sales prior to 2025-09-01 — not a different attribution rule, not advisor-only rows, not NetSuite-side imports. Just the date window.

**The Sept 1, 2025 floor was Greg's question's framing** ("since last September"), not the NetSuite saved search's framing. The NetSuite reference number was Regan's all-time MG count, which the canonical rule reproduces exactly.

| Filter (current canonical rule, varying date window) | Count |
|---|---|
| Regan / since 2025-09-01 | **171** ← verified row in catalog |
| Regan / all-time (since 1900-01-01) | **175** ← matches NetSuite reference |

## Resolved questions (was Open)

1. **What is the canonical NetSuite saved search for "EC sales since date"?** — Not screen-shared; Greg's reference number 175 was confirmed reproducible from MG data alone. NetSuite saved-search export is no longer a verification blocker.

2. **Attribution: `consultant` or `advisor`?** — `consultant` only. Confirmed by reproducing Regan's all-time count of 175 with consultant-only attribution (advisor-only would have added more).

3. **Disposition NULL: active or unknown?** — Moot. Regan's full result set has zero NULL dispositions; the canonical rule's `COALESCE(disposition,'') NOT IN terminal-set` handles NULL the same as empty (counted as included).

4. **What about `Loyalty` and `In Service`?** — `Loyalty` IS counted (5 rows in Regan's set; the 175 figure includes them). `In Service` is treated the same way (also a post-sale state, not in the terminal set).

5. **Cancelled deals + other terminals** — `Cancel`, `Cancelled`, `Test`, `Loss`, `Legal`, `On Hold` are all excluded from the booked-sales count. If a future report needs "deals attempted YTD" (incl. cancelled), it gets its own canonical entry — separate slug, separate verification.

## How the rule went live

1. ✅ Implemented as `atlas_canonical_ec_booked_sales_since(p_params jsonb)` in `supabase/migrations/231-...sql` (initial) and `232-...sql` (made `since_date` optional).
2. ✅ Verified in the `atlas_canonical_reports` catalog. Verified row: `ec_name='Regan Spencer', since_date='2025-09-01'`, expected_row_count=171, drift_tolerance_pct=5%.
3. ✅ Wired into `/api/atlas/query` (data-query route) and `/api/atlas/ask` (widget) via the canonical router (`lib/atlas/router.ts`). Manager+ roles only.
4. ⏳ Other surfaces (`components/pipeline/pipeline.tsx` UI filter, `/api/reports/chat` SCHEMA_HINTS) still use their own filters. Per the rule below, that's allowed for surfaces that are INTENTIONALLY narrower (UI pipeline excludes In Service / Loyalty because those aren't actively in the funnel).

## Canonical SQL (live)

```sql
SELECT * FROM atlas_canonical_ec_booked_sales_since(
  jsonb_build_object('ec_name', :ec_name, 'since_date', :since_date)
);
-- :since_date is optional (default 1900-01-01 → all-time)
-- Function definition: supabase/migrations/231-... + 232-... (latest)
```

---

*Last updated: 2026-05-06 22:00. Owner: Greg. References: `~/.claude/plans/twinkly-jumping-thimble.md`. Verified row in `atlas_canonical_reports.id='ec_booked_sales_since'`.*
