# Atlas Canonical Reports — Seed Catalog Candidates

**Status:** DRAFT — needs Heidi/Greg input. P2 of `~/.claude/plans/twinkly-jumping-thimble.md`.

This file lists the 5-10 reports we should build first as canonical, NetSuite-verified entries in `atlas_canonical_reports`. The pick is intentionally narrow — ship 5 great reports before 50 mediocre ones.

## Why this list isn't from the query log

The log (`atlas_query_log`, `atlas_questions`) has 11 widget questions ever, mostly seed/demo data. The one real-user question that triggered this work was:

> **"how many sales has regan spencer had since last september"** — Greg, 2026-05-06, /reports, low-confidence (KB miss)

That one question is enough to define the first canonical report. The rest of the list comes from inferred high-value questions Heidi/Greg/Mark probably ask weekly + the existing `/api/reports/chat` SCHEMA_HINTS that document common queries.

## Proposed seed catalog (priority order)

### 1. **`ec_sales_since`** — Active sales by EC since date
Question shapes:
- "How many sales has Regan had since last September?"
- "Show me Heidi's sales last 30 days"
- "Top 10 ECs by KW sold YTD"

Params: `ec_name` (validated against `sales_reps.name`), `since_date` (date)
NetSuite ground truth: TBD — Greg/Heidi to identify the saved search and confirm row count.

### 2. **`pipeline_by_stage`** — Active pipeline counts by stage
Question shapes:
- "What's our pipeline right now?"
- "How many projects in install?"
- "Pipeline breakdown by stage"

Params: `org_filter` (optional — default all org), `exclude_stages` (optional)
NetSuite ground truth: TBD.

### 3. **`one_project_summary`** — Single-project lookup
Question shapes:
- "What's the status of PROJ-30188?"
- "Show me Patricia Smith's project"
- "Is the Davenport project blocked?"

Params: `project_id` (validated against `projects.id`) OR `customer_name` (ILIKE on `projects.name`)
Ground truth: project dashboard page (data already shown there).

### 4. **`installs_scheduled`** — Installs scheduled in date range
Question shapes:
- "Which installs are scheduled this week?"
- "What's installing tomorrow?"
- "Install schedule next 7 days"

Params: `since_date`, `until_date`
NetSuite ground truth: TBD.

### 5. **`stuck_projects_by_stage`** — Projects stuck in a stage > N days
Question shapes:
- "Which permits have been pending 30+ days?"
- "Stuck projects in inspection"

Params: `stage`, `days_threshold` (default 30)
Ground truth: pipeline page already surfaces "blocker" — this is the count version.

### 6. **`commissions_by_rep_ytd`** — Rep commission totals YTD
Question shapes:
- "What's Regan's commission YTD?"
- "Top earners this year"
- "How much have we paid out in commissions?"

Params: `rep_name` (optional — if absent, show all), `year` (default current)
NetSuite ground truth: NetSuite Commissions saved search. **CRITICAL:** must reconcile against `commission_records` table on-prem too — if those disagree, NetSuite wins (per architecture plan open question #4).

### 7. **`new_proposals_this_week`** — Proposals created in date range
Question shapes:
- "How many new deals this week?"
- "What did sales close yesterday?"

Params: `since_date`, `until_date`
NetSuite ground truth: TBD.

### 8. **`projects_by_financier`** — Project counts by financier
Question shapes:
- "How many GoodLeap deals?"
- "Mosaic vs Sungage breakdown"

Params: `since_date` (optional)
NetSuite ground truth: TBD.

### 9. **`pto_status_summary`** — PTO completion stats
Question shapes:
- "How many waiting on PTO?"
- "PTO completion rate this quarter"

Params: `since_date` (optional)
NetSuite ground truth: TBD.

### 10. **`top_ahjs_by_volume`** — Project counts by AHJ
Question shapes:
- "Which AHJs do we work in most?"
- "Top permitting jurisdictions"

Params: `since_date` (optional), `limit` (default 20)
NetSuite ground truth: probably none — this is on-prem data.

## P2 acceptance criteria (per plan)

For EACH of the first 5 reports:
1. Greg or Heidi opens the equivalent NetSuite saved search.
2. Same params → same row count between Atlas and NetSuite.
3. Random 5 row IDs from Atlas result also appear in NetSuite result.
4. Catalog row marked `verified` with `expected_row_count`, `expected_aggregates`, `verified_sample_ids`, `ground_truth_source`.

If a report has NO NetSuite equivalent (e.g. `top_ahjs_by_volume`), use `verification_method = 'consensus_with_heidi'` and capture the consensus snapshot.

## Outstanding questions before P2 starts

1. Which 3 of these 10 should be P2 launch (verify together)?
2. Is there a NetSuite saved search for each — names?
3. Who owns the verification handshake (Greg checks Greg's ones, Heidi checks Heidi's)?
4. Which reports need `org_id` scoping (multi-tenancy) vs not?

---

*Last updated: 2026-05-06. Ranking is my best guess — Heidi's actual asks should override.*
