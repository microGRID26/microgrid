# Disposition Canonical Definition (UNRESOLVED)

**Status:** OPEN — needs Greg + Heidi to write the definitive rule.

This file is the single source of truth for "what counts as a sale" in MicroGRID. Until the rule is locked AND verified against NetSuite, no Atlas surface should generate aggregate sales counts.

## Why this matters

On 2026-05-06 Atlas told Greg that Regan Spencer had **166 sales** since Sept 1, 2025. Greg's NetSuite-equivalent saved search returned **175**. The 9-row gap (5%) is a trust killer — wrong-by-a-little is worse than "I don't know."

The drift came from `SCHEMA_HINTS` in `app/api/atlas/query/route.ts` telling the LLM to filter `disposition = 'Sale'`. But this codebase has THREE conflicting rules:

| File | Filter | Result for Regan since 9/1/25 |
|---|---|---|
| `components/pipeline/pipeline.tsx` | `NOT IN ('In Service','Loyalty','Cancelled','Legal','On Hold')` | not measured |
| `app/api/atlas/query/route.ts` (pre-2026-05-06) | `disposition = 'Sale'` | **166** |
| `app/api/reports/chat/route.ts` (inline note) | `disposition IS NULL OR = 'Sale'` (claims "NULL means active") | **166** (no nulls in Regan's recent rows) |
| Tested broader: `disposition NOT IN ('Cancel','Cancelled','Test')` | includes `Loyalty` | **171** |
| Greg's reference (source unknown) | ??? | **175** |

**4 rows still unaccounted for.** The 175 likely comes from a different attribution rule (e.g. `consultant OR advisor`), a different table join, or a different date semantic. Until we know, all "sales count" answers from Atlas are unreliable.

## Open questions

1. **What is the canonical NetSuite saved search for "EC sales since date"?**
   - What's its name?
   - What are its filter criteria (in NetSuite saved-search syntax)?
   - Greg/Heidi to provide a screenshot or export.

2. **Attribution: `consultant` or `advisor` (or both)?**
   - In prod: 213 rows have `consultant='Regan Spencer'`, 209 rows have `advisor='Regan Spencer'`. They overlap heavily but not perfectly.
   - Which one does NetSuite use for "EC of record"?

3. **Disposition NULL: active or unknown?**
   - The chat-route inline notes claim "NULL means Sale/active"; my prod scan found ZERO null dispositions in Regan's recent set, so the rule is untested.
   - Are nulls ever active? Or are they always import errors / deleted rows?

4. **What about `Loyalty` and `In Service`?**
   - These are post-sale states. Does NetSuite count them as sales? (My intuition: yes, because they happened.)
   - Does NetSuite distinguish "current pipeline" from "historical sales"? If so, there are TWO definitions, not one.

5. **Cancelled deals:**
   - Some are `disposition='Cancel'`; some `disposition='Cancelled'`. Other terminal states: `Legal`, `On Hold`, `Loss`, ?
   - Are these EVER counted as sales for any report (e.g. "deals attempted YTD")?

## Locking the rule

Before anyone writes another LLM hint, do this:

1. **Greg + Heidi screen-share NetSuite.** Open the saved search Heidi runs to answer "how many sales did EC X have since date Y." Document the criteria verbatim into this file (replace the placeholder section below).
2. **Translate to SQL.** Write the equivalent SQL against `projects` (and any joined tables). Run it for Regan since 9/1/25. Confirm it returns 175.
3. **Lock.** Commit the SQL as a SECURITY DEFINER function in the canonical-reports catalog (see `~/.claude/plans/twinkly-jumping-thimble.md`). Mark `verified_at = now()` and capture the 175 row count + sample row IDs as drift baseline.
4. **Update every other surface.** Any place in the codebase that filters by `disposition` to derive sales must either (a) call the canonical RPC OR (b) have an inline reference to this file justifying why it diverges (e.g. UI-level pipeline filter is INTENTIONALLY narrower).

## Until the rule is locked

- `/api/atlas/query` and `/api/reports/chat` SCHEMA_HINTS instruct the LLM to REFUSE sales-count questions and explain that the canonical reports catalog is incoming.
- AskAtlasWidget data-fallthrough is disabled. Widget answers from the KB only; data questions get the standard escalation path.
- `/reports` page shows an experimental banner.

## Canonical SQL (placeholder — to be filled in)

```sql
-- TODO: Greg + Heidi to fill this in after NetSuite saved-search screen-share.
--
-- For now, this file documents the OPEN question, not the answer.
SELECT 'rule not yet locked' AS status;
```

When this section is filled in, the SQL goes live as `atlas_canonical_ec_sales_since(p_ec_name text, p_since_date date)` per the catalog architecture.

---

*Last updated: 2026-05-06. Owner: Greg. References: `~/.claude/plans/twinkly-jumping-thimble.md`.*
