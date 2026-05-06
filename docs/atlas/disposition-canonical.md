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

## 2026-05-06 investigation findings (Greg gave the rule, schema didn't fit cleanly)

Greg defined a sale as: **"a signed contract AND a completed welcome call."**

Mapped to MG schema:
- **"Signed contract"** — most likely `projects.sale_date IS NOT NULL` (the date the contract was signed). No dedicated `signed_at` column exists. `projects.contract` (dollar amount) is non-null on most sales but is a value, not an event marker.
- **"Completed welcome call"** — `task_state` has a `welcome` task with `status='Complete'` for 864 projects. `welcome_call_logs` (raw SubHub VWC webhook log) has 3107 rows for 781 distinct projects.

Spot-check against Greg's reference list of 175 sales for Regan since 9/1/25:

| Project | Sale date | `task_state.welcome` | `welcome_call_logs` rows |
|---|---|---|---|
| PROJ-30334 (Glenn) | 2026-04-27 | **Ready To Start** | 0 |
| PROJ-30335 (Davenport) | 2026-04-27 | **Ready To Start** | 0 |
| PROJ-29026 (Marzan) | 2025-09-06 | Complete | 1 |
| PROJ-28987 (Derksen) | 2025-09-04 | Complete | 1 |
| PROJ-28998 (Thompson) | 2025-09-04 | Complete | 1 |

Recent April-2026 entries in Greg's 175 list have `welcome=Ready To Start` (NOT Complete). **The strict "signed + welcome complete" rule excludes them and returns 72**, not 175.

Filter rules tried, against Regan with `sale_date >= 2025-09-01`:

| Rule | Count |
|---|---|
| `disposition='Sale'` | 166 |
| `disposition NULL OR Sale OR Loyalty` | 171 |
| `consultant OR advisor` Regan | 172 |
| Strict: `task_state.welcome='Complete'` | **72** |
| Greg's reference list | **175** |

## Hypothesis: Two definitions exist

1. **Booked sales** = signed contract recorded (`sale_date IS NOT NULL` + valid sale_date). Counts mid-flight projects whose welcome call hasn't completed yet. = ~175 for Regan.
2. **Closed sales** = signed + welcome complete (the strict rule). = ~72 for Regan.

Most CRMs / finance systems track both. Sales/comp pay against booked, install ops tracks against closed.

## Greg's resolution (2026-05-06)

> "In this case it's 175. We just haven't been doing welcome calls lately. At least not marking them off. The welcome calls are being done virtually via SubHub VWC. One thing we will need to build in SPARK. Already partially built."

So the operational state is:
- **Welcome-call task signal (`task_state.welcome='Complete'`) is stale.** Heidi/install ops haven't been marking it off. Don't trust it.
- **Welcome-call webhook signal (`welcome_call_logs` rows from SubHub VWC)** is the real signal — but it's also patchy (recent April-2026 sales like Glenn / Davenport have 0 wcl rows, yet Greg counts them as sales).
- **For "how many sales" today, booked-only is the right rule.** The welcome-completion gate is conceptually correct but unenforced because the data is broken.

**Therefore the v1 canonical SQL for "EC sales since date" is BOOKED ONLY:**
```sql
-- atlas_canonical_ec_booked_sales_since(p_params jsonb)
-- p_params: { ec_name: text, since_date: date }
SELECT p.id, p.name, p.address, p.consultant, p.advisor,
       NULLIF(p.sale_date,'')::date AS sale_date,
       NULLIF(p.systemkw,'')::numeric AS systemkw,
       NULLIF(p.contract,'')::numeric AS contract,
       p.disposition, p.stage
FROM public.projects p
WHERE (p.consultant = (p_params->>'ec_name') OR p.advisor = (p_params->>'ec_name'))
  AND NULLIF(p.sale_date,'')::date >= (p_params->>'since_date')::date
  AND COALESCE(p.disposition,'') NOT IN ('Cancel','Cancelled','Test')
ORDER BY NULLIF(p.sale_date,'')::date DESC NULLS LAST;
```

Reproduces ~172 vs Greg's 175 — the 3-row gap is acceptable for v1 verification but worth documenting in `verified_params` + `verified_sample_ids` so future drift cron catches if the gap widens.

**Open: when SPARK virtual-welcome-call build lands** (partially built per Greg's note 2026-05-06), the canonical rule should be re-locked as `booked AND welcome_complete` and the existing rule deprecated. New canonical report ID: `atlas_canonical_ec_closed_sales_since`. Both can coexist with separate verification baselines.

## Open questions

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
