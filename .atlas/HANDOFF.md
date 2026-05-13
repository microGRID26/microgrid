# Chain handoff — planset

**Topic:** planset
**Last updated:** 2026-05-13 ~15:30 UTC (Phase 7b R1-deferrals sweep + cumulative milestone R1 — all 4 deferrals closed [#1021 verified non-issue, #1022 + #1023 + #1024 shipped], Grade-B audit across the integrated Phase 5→7b v2 surface, 2H + 5M + 3L all fixed inline, migration 222 + 222b applied to prod hardening the use_sld_v2 column to admin-only writes)
**Project:** MicroGRID
**Worktree:** `~/repos/MicroGRID-planset-phase1`
**Branch:** `feat/planset-v8-layouts` — **HEAD = `8bb365b` (origin matches; 0 commits ahead).** Four commits this session: `57dc174` (close #1022 ESLint sibling-import gap), `042cc1d` (close #1023 + #1024 — Inter SHA-256 verify + spy regression catch), `4d1a2da` (cumulative R1 fix sweep — 2H + 5M + 3L closed), `8bb365b` (mig 222b — NULL auth.role() bypass fix). Greg authorized the end-of-session push; all four commits live on origin. Vercel preview rebuilding on `8bb365b` (build kicked off at push).
**Latest commit (HEAD = origin):** `8bb365b` fix(mig-222b): NULL auth.role() bypass — explicit current_user allowlist

## Chain instruction (read this first, every session)

Pickup ritual:

1. **Chain audit (~5 min).** Read this doc's `✅ Shipped this session` block and run every verification command. For commit SHAs: `cd ~/repos/MicroGRID-planset-phase1 && git log --oneline <sha> -1`. For tests: `npx vitest run __tests__/sld-v2/`. For renders: re-run the named harness, run the collision validator, eyeball the staged PDF.

2. **Walk the open follow-ups** (`## Open follow-ups` section) — for any action ID listed, run `python3 ~/.claude/scripts/greg_actions.py show <id>` and grep the cited file. If the bug no longer reproduces, close the action via `greg_actions.py close <id> "verified shipped in <sha>"` and document under "Pre-resolved follow-ups verified this session" in the chain-history entry. Don't ship duplicates.

3. **Enter plan mode (`EnterPlanMode`).** Read the `### ⬅ Phase X (next session)` block. Surface its `Decisions Greg must answer before this phase starts` numbered list verbatim — DO NOT pre-answer them. Wait for "do it" before exiting plan mode.

4. **Claim the action** (parallel-session coordination). If the phase has a `greg_actions` row, `python3 ~/.claude/scripts/greg_actions.py claim <id>`. If no row exists, file one + claim.

5. **Plain-English session brief** (front bookend, mandatory). Post a 3-4 bullet brief in chat AFTER plan-mode approval but BEFORE first execution tool call. Lead with what this session will deliver in outcome terms. See the chain skill for the standard format.

6. **Ship.** Build → typecheck → test → R1 audit if applicable → fix → R2 → commit (no push without explicit auth per CLAUDE.md).

7. **Handoff back at end** — update this file's `✅ Shipped this session` + `### ⬅ Phase X` blocks + `## Open follow-ups` + 4-section in-chat digest. Write a session recap via `atlas_add_session_recap`.

## The chain in one paragraph

Multi-session effort to bring the MicroGRID planset generator's SLD output from "10 pages of mostly-empty placeholders" to RUSH-Engineering-stamp-ready drafting quality. Reference benchmark = `PROJ-26922 Corey Tyson Rev1.pdf` (36 pages, RUSH-stamped). Forward equipment baseline = Seraphim SRP-440-BTD-BG + Duracell PC Max Hybrid 15kW × 2 + 16× Duracell 5kWh LFP (80 kWh).

**As of 2026-05-12 the chain pivoted** from canvas-iterating the v1 hand-positioned spec to a declarative equipment list → elkjs layout engine → React/SVG renderer with prop-driven label slots. Code lives in `lib/sld-v2/` + `components/planset-v2/`. v1 stays untouched and operational behind the existing routing in `lib/sld-layout.ts`. Phases 0-4 (equipment kinds + elkjs adapter + label picker + PlansetData adapter) shipped 2026-05-12. Phase 5 (SVG → PDF export) shipped 2026-05-13 morning. Phase 6 (feature flag + nodeOverrides + production route) shipped 2026-05-13 mid-morning. Phase 7a (per-project `use_sld_v2` column + 3-arg flag + SheetPV5 inline v2 swap) shipped 2026-05-13 ~11 UTC. **Phase 7b (this session) closes the v2 PDF into stamp-ready shape and runs the first live pilot through it.**

**Plan doc**: `~/.claude/plans/smooth-mixing-milner.md` (Greg approved 2026-05-12), Phase 7b plan `~/.claude/plans/virtual-scribbling-raven.md` (Greg approved 2026-05-13).

## ✅ Shipped this session (2026-05-13 pm, Phase 7b R1-deferrals sweep + cumulative milestone R1)

### Commit 1 — `57dc174` (close #1022 R1-L1 — ESLint sibling-import gap)

`eslint.config.mjs` — added `./pdf` and `../pdf` to the `no-restricted-imports` `paths` array. The Phase 7b rule blocked `@/lib/sld-v2/pdf` (absolute) and `**/lib/sld-v2/pdf` (pattern), but a hostile or accidental sibling import like `./pdf` from inside `lib/sld-v2/*` would have bypassed both. Verified via a transient bait test (`lib/_eslint-bait-sibling/index.ts`) — all three import shapes hard-error post-fix; bait removed.

### Commit 2 — `042cc1d` (close #1023 + #1024 — Inter SHA-256 verify + spy regression catch)

- **`lib/sld-v2/fonts/inter-loader.ts`** — added `INTER_EXPECTED_SHA256 = '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82'` + `INTER_SHA_MISMATCH_PREFIX` sentinel. Hash verified on every first-load against the buffer; mismatch throws via the sentinel-prefix error so the catch block can distinguish loud (hash mismatch → re-throw) from benign (ENOENT/EACCES → Helvetica fallback warn). **Self-review catch pre-commit:** initial diff had the throw inside the try-block, which the existing catch would have swallowed as "load failed → Helvetica fallback" — exact opposite of #1023's intent. Fixed before commit.
- **`__tests__/sld-v2/pdf.test.ts`** — added `vi.mock` for inter-loader + `vi.importActual` + a spy assertion: `expect(loadInterTtfBase64).not.toHaveBeenCalled()` when titleBlock is absent. Regression catch for a future "always-load Inter" refactor that would silently re-break Phase 5's NEC 690.12 strings-grep assertion. Test count 60 → 61.

#1021 (R1-M2 ELK singleton race) **closed as verified non-issue.** Reality check on `lib/sld-v2/layout.ts:71-77`: `getElk()` is synchronous, `new ELK()` is a synchronous constructor, JavaScript is single-threaded with no yield point between the null-check and the assignment. Race window = 0 ticks. The original red-teamer was pattern-matching on "lazy singleton" without language-level reasoning. No code change. Defense-in-depth deferred until `new ELK()` becomes async (which would be obvious in code review).

### Commit 3 — `4d1a2da` (cumulative milestone R1 fix sweep — 2H + 5M + 3L closed)

The chain protocol's cumulative R1 at sprint milestones ran across the integrated Phase 5→7b v2 surface (~2,580 LOC: `lib/sld-v2/*`, `components/planset-v2/*`, the v2 PDF route, the `use_sld_v2` column, the 3-arg feature flag, the ESLint server-only gate, font supply chain, the `isDuracellHybrid` topology gate). **Grade B verdict.** Two Highs surfaced — both cross-phase seams that no per-phase R1 saw:

- **H1 — `?sld=v2` URL flag overrode per-project `use_sld_v2=false`.** OR-precedence in `lib/sld-v2/feature-flag.ts:25-29` broke Phase 7a's rollout-gating contract. FIX: gate `?sld=v2` to `NODE_ENV !== 'production'`. URL flag stays available in test/dev/preview for the smoke harnesses. +3 regression tests asserting prod no-op + prod project-flag passthrough + prod env-flag passthrough.
- **H2 — ESLint exempt list stale.** `__tests__/sld-v2/title-block.test.ts` shipped in Phase 7b but wasn't added to the exempt block, so `npx eslint title-block.test.ts` hard-errored — meaning the gate didn't gate. FIX: both v2 test files now listed explicitly. Confirmed lint clean across all 6 exempt files post-fix.

Five Mediums (all fixed inline in this commit):
- **M2** — dropped `finance` from `INTERNAL_ROLES` in the v2 PDF route. Copy-paste drift from cost-basis precedent; SLDs are engineering output.
- **M3** — `layoutEquipmentGraph` + `placeLabels` + React `renderToStaticMarkup` now run INSIDE the mutex closure in `lib/sld-v2/pdf.ts`. Closes the elkjs singleton-touch seam between two concurrent route calls at the `await elk.layout()` boundary.
- **M4** — replaced raw `err.message` in catch logs with structured `{name, code, stack-truncated}` via `structuredErrorLog()`. No more upstream-lib PII fragments in Vercel runtime logs.
- **M5** — dropped `cached = null` from inter-loader ENOENT path. Previously a partial Vercel deploy that lost the ttf would silently fall back to Helvetica for the dyno's lifetime; now every request re-attempts + warns until the file is restored.
- **M1 (DRAFT migration 222 shipped as part of this commit)** — see Commit 4 for the prod-apply notes.

Three Lows (all fixed inline):
- **L1** + **L2** — switched role lookup + rate-limit key from `user.email` to `user.id`. Email is mutable in Supabase Auth; user.id is stable.
- **L3** — `crypto.randomUUID().slice(0,8)` replaces `Math.random()` for correlation IDs at both catch sites.

Tests: 61 → 64 sld-v2 pass (+3 H1 regression tests). Typecheck clean. Baseline diff vs Phase 5 (`8a5df3949028`) → NEW_FAIL=0.

### Commit 4 — `8bb365b` (migration 222b — NULL auth.role() bypass fix)

Migration 222 (BEFORE UPDATE trigger restricting `use_sld_v2` flips to admin/super_admin) applied via Supabase MCP. **migration-planner audit gate ran first and returned GO (Grade A, 0C/0H/0M/0L).** Post-apply smoke test caught a real bug in the trigger logic: `IF auth.role() <> 'authenticated' THEN RETURN NEW;` was meant to bypass service_role/postgres/CLI contexts, but `auth.role()` returns NULL for MCP `execute_sql` + direct postgres-role connections, and `NULL <> 'authenticated'` evaluates to NULL — which is falsy in plpgsql IF semantics. The bypass never fired for those callers; the trigger raised on what should be allowlisted DB-level flips.

Repro: `UPDATE projects SET use_sld_v2 = false WHERE id = 'PROJ-32115'` via Supabase MCP hit `42501` despite `current_user = 'postgres'`. Migration **222b** swaps the auth.role() check for an explicit `current_user IN ('postgres', 'supabase_admin', 'service_role')` allowlist combined with `auth_is_admin()` for end-user JWT contexts. Applied + verified: postgres-role flip-down + flip-back-up succeeds; Lohf pilot (PROJ-32115) is back to `use_sld_v2 = true`. **The same latent bug exists in 215b's stage trigger** but stage flips always route through the `set_project_stage` RPC, never direct UPDATE, so the bug is dormant there. Left untouched — separate cleanup, not part of this audit sweep.

### Audit gates summary (this session)

- Cumulative milestone R1 (red-teamer): **B (0C / 2H / 5M / 3L)** → after triage commit `4d1a2da`: **A (0C / 0H / 0M / 0L unmitigated)**.
- Migration 222 pre-apply (migration-planner): **A (0C / 0H / 0M / 0L)** — Verdict: safe to execute as planned.
- Migration 222b post-apply smoke test: passed (postgres-role flip works; trigger present in pg_trigger).

### Pre-resolved follow-ups verified this session

None. All 4 deferrals (#1021–#1024) ended this session closed; #1025 remains open waiting on RUSH.

## Verification commands for the next operator

```bash
cd ~/repos/MicroGRID-planset-phase1

# Commit history check — should see 8bb365b at HEAD on origin
git log --oneline -8
git log origin/feat/planset-v8-layouts --oneline -1   # should match 8bb365b

# Typecheck the whole worktree (v1 + v2 must coexist clean)
npx tsc --noEmit

# Run v2 test suites — 64 tests pass (was 60; +1 spy #1024 + +3 H1 prod-flag regression)
npx vitest run __tests__/sld-v2/

# ESLint server-only gate — all 6 exempt files clean
npx eslint --no-warn-ignored \
  'app/api/sld/v2/**/route.ts' \
  lib/sld-v2/pdf.ts \
  scripts/render-sld-v2-pdf.tsx \
  scripts/sld-v2-pdf-concurrency-smoke.tsx \
  __tests__/sld-v2/pdf.test.ts \
  __tests__/sld-v2/title-block.test.ts
# Expected: no errors

# ESLint server-only gate (bait — should error on sibling + parent imports)
cat > /tmp/eslint-bait.ts <<'EOF'
import { renderSldToPdf as a } from "./pdf";
import { renderSldToPdf as b } from "../pdf";
import { renderSldToPdf as c } from "@/lib/sld-v2/pdf";
EOF
mkdir -p lib/_eslint-bait && mv /tmp/eslint-bait.ts lib/_eslint-bait/index.ts
npx eslint --no-warn-ignored lib/_eslint-bait/index.ts   # expect 4 errors
rm -rf lib/_eslint-bait/

# Chain test baseline — confirm no new regressions
/opt/homebrew/bin/python3.12 ~/.claude/scripts/chain_test_baseline.py diff --repo $(pwd) --sha 8a5df3949028
# Expected: NEW_FAIL = 0, STILL_FAIL = 16 (pre-existing v1)

# Migration 222 + 222b applied (use_sld_v2 admin-only write trigger)
# Verify via Supabase MCP execute_sql:
#   SELECT tgname FROM pg_trigger WHERE tgname = 'projects_block_direct_use_sld_v2_update_trg';
#   -- Expect 1 row.

# Render Lohf pilot PDF (still works, the actual pilot artifact)
npx tsx scripts/render-sld-v2-pilot-lohf.tsx
# Expected: wrote ~/.claude/tmp/sld-v2-pilot-lohf.pdf (~197 KB)
strings ~/.claude/tmp/sld-v2-pilot-lohf.pdf | grep -E 'Charles Lohf|PROJ-32115|Windrift|Round Rock|SINGLE LINE|PV-5'

# Render Tyson with title block (regression check)
npx tsx scripts/render-sld-v2-pdf.tsx
# Expected: ~/.claude/tmp/sld-v2-tyson-titled.pdf (~171 KB, title block present)

# Render Tyson WITHOUT title block (Phase 5/6 path, NEC grep still works)
npx tsx scripts/render-sld-v2-pdf.tsx --no-title
strings ~/.claude/tmp/sld-v2-tyson.pdf | grep -c 'NEC 690.12'   # Expected: ≥4
```

## Spec deltas discovered this session (R1 sweep + cumulative milestone audit)

Three deltas, all folded into shipped code:

- **`?sld=v2` URL flag was OR-precedence, not AND.** Phase 7a's stated rollout-gating contract ("flip one project at a time without env-wide blast radius") was broken by the URL flag's OR semantics — any authed manager could override `use_sld_v2 = false` by appending `?sld=v2`. Today's blast radius is tiny (v2 only differs in title-block paint), but Phase 8 will add semantic differences and the gating contract is load-bearing. FIX: URL flag gated to `NODE_ENV !== 'production'`. Project flag and env flag still work everywhere.

- **ESLint exempt list was point-in-time, not invariant-checked.** Phase 7b shipped a second test file (`title-block.test.ts`) but the exempt block stayed at the Phase 5 footprint. `npx eslint title-block.test.ts` hard-errored today — meaning the supposedly-gating rule didn't gate. Caught only because the cumulative R1 grepped for the test file's imports against the exempt list. FIX: both v2 test files listed explicitly; comment in the exempt block flags that any new server-only test must be added here.

- **The 215b/222 trigger pattern has a NULL `auth.role()` blind spot.** Pattern is `IF auth.role() <> 'authenticated' THEN RETURN NEW;`. But `auth.role()` returns NULL for MCP execute_sql + direct postgres-role connections, and `NULL <> 'authenticated' = NULL` is falsy in plpgsql, so the bypass never fires. 215b dodges it because stage flips use the RPC, never direct UPDATE. 222 hit it on the first smoke test. FIX in 222b: explicit `current_user IN ('postgres', 'supabase_admin', 'service_role')` allowlist + `auth_is_admin()`. **215b's stage trigger has the same dormant bug — flag for cleanup but not blocking.**

## Test baseline

Captured via vitest run on the final commit `8bb365b`:
- **sld-v2 suite: 64 tests pass, 0 fail.** Was 60 at end of Phase 7b. +1 spy regression catch (#1024), +3 H1 production-flag regression tests.
- Chain baseline diff vs Phase 5 (`8a5df3949028`): **NEW_FAIL=0, STILL_FAIL=16** (pre-existing v1 sld-layout + SheetPV failures unchanged).
- Cumulative since Phase 5 baseline: +24 passing tests (Phase 6 +6, Phase 7a +6, Phase 7b +4, this session +4).

## Status table

- ✅ Phase 0 — Collision validator
- ✅ Phase 1.1–1.3 — Equipment model + 10 components + all-kinds harness
- ✅ Phase 2 — elkjs adapter + SldRenderer
- ✅ Phase 3 — Label slot picker + leader callouts
- ✅ Phase 4 — PlansetData → EquipmentGraph adapter
- ✅ Phase 5 — SVG → PDF export
- ✅ Phase 6 — feature-flag + nodeOverrides + production route
- ✅ Phase 7a — per-project use_sld_v2 column + 3-arg flag + SheetPV5 inline v2 swap
- ✅ Phase 7b — title block paint + Inter ttf + ESLint gate + runtime guard + Vercel deploy fix + Lohf pilot — 2026-05-13 ~12:50 UTC
- ✅ **Phase 7b R1-deferrals sweep + cumulative milestone R1 — 2H + 5M + 3L closed inline, migration 222 + 222b applied — 2026-05-13 ~15:30 UTC**
- ⏳ Awaiting RUSH stamp turnaround on Lohf pilot (#1025)
- ☐ Phase 7c (conditional) — fold RUSH feedback (typography, layout, NEC compliance)
- ☐ Phase 7.x — Fill `StringInverterBox` / `MicroInverterBox` / `EVChargerBox` (deferred kinds)
- ☐ PROJ-26922 Tyson stamp unblock — PDF-edit r12 path (Atlas-side, not blocked by v2)

## Audit gates (this session)

- **Cumulative milestone R1** (red-teamer, against `042cc1d` integrated surface): **B** (0C / 2H / 5M / 3L). All 10 findings fixed inline in commit `4d1a2da`. Post-fix grade: **A** (0 unmitigated).
- **Migration 222 pre-apply** (migration-planner, against draft `222-projects-block-direct-use-sld-v2-update.sql`): **A** (0C / 0H / 0M / 0L) — Verdict: safe to execute as planned. Mirrors production-proven 215b pattern; ShareRowExclusive sub-second on 36 MB table; no UPDATE call sites in app code; service_role bypass intact (later corrected to current_user allowlist in 222b); idempotent re-run; rollback is two DROPs.
- **Mig 222 + 222b post-apply** smoke test: passed (`projects_block_direct_use_sld_v2_update_trg` present in `pg_trigger`; postgres-role flip-down + flip-back-up on PROJ-32115 succeeds without raising).
- **Phase 7b R1 deferrals**: #1021 closed as verified non-issue (JS single-threaded semantics); #1022 + #1023 + #1024 shipped with R1 self-review catching the #1023 catch-block swallow bug pre-commit.

## Live state worth knowing

- **Branch status**: `feat/planset-v8-layouts` HEAD = `8bb365b`, origin matches (0 ahead). Four commits this session (57dc174, 042cc1d, 4d1a2da, 8bb365b) pushed together with Greg's end-of-session auth.
- **Vercel preview URL**: `https://microgrid-git-feat-planset-v8-layouts-gkelsch-7941s-projects.vercel.app/api/sld/v2/PROJ-32115?sld=v2` (with auth cookie + internal role). **NOTE**: `?sld=v2` is now a NO-OP in production. The Vercel preview env is treated as production unless `NEXT_PUBLIC_VERCEL_ENV !== 'production'` makes NODE_ENV non-prod — check before assuming it works on preview. Use `SLD_V2_DEFAULT=1` env var or per-project `use_sld_v2=true` for forced v2 in any env.
- **PROJ-32115 use_sld_v2 = true** — flipped via Supabase MCP. Production route will serve the v2 PDF for any authed internal user requesting Lohf's plansheet. **NEW: the column is now trigger-protected** — only `current_user IN ('postgres','supabase_admin','service_role')` OR `auth_is_admin()` can flip it. Manager-role end users get `42501`.
- **This session's commit SHAs**: `57dc174` (R1-L1), `042cc1d` (R1-L2 + R1-L3), `4d1a2da` (cumulative R1 sweep), `8bb365b` (mig 222b). Earlier phases unchanged.
- **Migrations applied this session**: `222_projects_block_direct_use_sld_v2_update` + `222b_use_sld_v2_trigger_fix_null_auth_role`. Both visible via `mcp__claude_ai_Supabase__list_migrations`.
- **Python 3.12 required** for `scripts/sld-collision-check.py` (3.14 has broken pyexpat) — unchanged from Phase 5.
- **Port id convention** unchanged from Phase 2 — dot-format (`pv.N`).
- **PDF font behavior** — when `titleBlock` is present, Inter Regular ttf is registered (SHA-256 verified on load post-#1023, throws loud on mismatch). When absent, Inter is NOT registered; everything renders in Helvetica + WinAnsi (preserves `strings | grep NEC 690.12`).
- **PDF concurrency mutex** now covers `layoutEquipmentGraph` + `placeLabels` + `renderToStaticMarkup` (post-M3). elkjs singleton-touch seam closed.
- **inter-loader ENOENT no longer caches null** (post-M5). Per-request warn instead of silent dyno-lifetime Helvetica fallback.
- **`canvas` is a native dep** — Phase 6's route has `export const runtime = 'nodejs'`, unchanged.
- **Visual companion**: brainstorm server lived at `http://localhost:57354` for this session (NOTE: different port than the Phase 7b session's 50737 — port is dynamic, not fixed). Content dir at `.superpowers/brainstorm/60886-1778695837/content/`.

## Open follow-ups

(Read each `python3 ~/.claude/scripts/greg_actions.py show <id>` before working on it — pre-resolution gate per chain rule.)

- **#1025 (P1)** — RUSH stamp turnaround tracking for PROJ-32115 (Charles Lohf). Greg eyeballs PDF, mails to RUSH, records turnaround + feedback when stamp returns. Closes when stamped sheet returns + decision on Phase 7c made. **Open for ~1 week.**
- ~~#1021~~ — closed this session ("verified non-issue: JS single-threaded, race window = 0 ticks").
- ~~#1022~~ — closed this session (shipped 57dc174).
- ~~#1023~~ — closed this session (shipped 042cc1d).
- ~~#1024~~ — closed this session (shipped 042cc1d).
- ~~#1012~~, ~~#1017~~ — closed in Phase 7a/7b sessions.

### Latent / informational (not blocking, not yet filed as actions)

- **215b's `set_project_stage` trigger has the same NULL `auth.role()` bypass bug** that 222 hit (see Spec deltas). Dormant because stage flips always go through the RPC, never direct UPDATE. A 5-line patch (swap `auth.role()` check for `current_user` allowlist) would harden it. Worth filing as P2 hygiene when there's slack.

## Next phase to pick up

### ⬅ Phase 7c (next session) — fold RUSH stamp feedback (conditional on #1025)

Phase 7b shipped end-to-end. The next phase IS the RUSH feedback loop: pick up only after #1025 closes (stamp returns with feedback). Until then the chain is at a natural waiting point.

**Decisions Greg must answer before this phase starts:**

(No decisions until RUSH feedback arrives. The shape of Phase 7c depends entirely on what RUSH dings.)

**Phase work (anticipated):**

- Fold any RUSH typography feedback — switch from Helvetica to bundled Inter Bold (current session deferred Bold per Greg's pick).
- Fold any layout feedback — row sizing, sheet-number font size, NEC notes box placement.
- Fold any NEC compliance feedback — additional `graph.notes` painting, callout placement.
- If RUSH stamps clean, mark v2 as the production default for new projects (separate chain).

**Estimated effort:** depends on RUSH feedback. 30 min if clean stamp, 2-4 hours if substantive redraw.

### ⬅ Hardening backlog (any-time)

- **215b NULL auth.role() bypass patch** — 5-line cleanup mirroring 222b. Dormant bug, never bites today, fix when there's slack.
- All four Phase 7b R1 deferrals are CLOSED — no remaining items here.

### ⬅ Phase 7.x (deferred — not blocking) — missing equipment kinds

- Fill `StringInverterBox` / `MicroInverterBox` / `EVChargerBox` when the first live non-Duracell project hits the v2 path (`isDuracellHybrid` gate at route line 134 will 422 until then).

## Specific gotchas for the next operator

- **Branch is pushed.** All commits through `8bb365b` live on origin. Any new commits in Phase 7c still need Greg's per-push auth per CLAUDE.md / `feedback_no_mid_session_push.md`.
- **PROJ-32115 use_sld_v2 = true** — Lohf is live on v2. Re-render via the route → expect the title-block PDF. **Column is now trigger-protected** (mig 222 + 222b); flipping requires `current_user IN ('postgres','supabase_admin','service_role')` OR an admin/super_admin JWT. MCP execute_sql works; the Supabase JS client as a manager-role user will get `42501`.
- **`?sld=v2` URL flag is a NO-OP in production** (H1 fix). To force v2 for a project in prod, flip `use_sld_v2 = true` via Supabase MCP. The URL flag still works in test/preview/dev.
- **inter-loader throws loud on SHA-256 mismatch** (#1023). If a partial Vercel deploy ships a corrupted or replaced ttf, the route returns 500 immediately. Expected SHA is `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82`. To re-vendor from rsms/inter, update the constant in `lib/sld-v2/fonts/inter-loader.ts:31-32` in the same commit as the file replacement.
- **inter-loader no longer caches null on ENOENT** (M5 fix). Every request re-attempts the read until the file is restored. Negligible perf cost (~340KB read + base64) and visibility-positive.
- **Visual companion content dir** (`.superpowers/brainstorm/<port>-<pid>/content/`) is gitignored implicitly and includes the Lohf pilot PDF. Don't commit it.
- **`scripts/render-sld-v2-pilot-lohf.tsx`** is a session-local script; safe to keep around for future Lohf re-renders.
- **WinAnsi sanitizer is one-way.** "Peña" → "Pena" in the PDF; users seeing the PDF won't get back the original glyph. If RUSH demands Unicode-correct rendering, Phase 7c needs to switch the title-block painter to use the embedded Inter font (with Inter Bold also registered).
- **The two-canvas iteration loop is dead** — same as Phase 7a, don't reopen v1 hand-positioning.
- **`@react-pdf/renderer@^4.4.1`** still in active prod use for invoices / cost-basis — DO NOT remove.

## Reference

- **Plan doc (architectural)**: `~/.claude/plans/smooth-mixing-milner.md` (Greg-approved 2026-05-12)
- **Phase 7b session plan**: `~/.claude/plans/virtual-scribbling-raven.md` (Greg-approved 2026-05-13)
- **Lohf pilot PDF**: `~/Desktop/sld-v2-pilot-lohf.pdf` (197 KB)
- **Tyson demo PDF**: `~/.claude/tmp/sld-v2-tyson-titled.pdf` (171 KB)
- **RUSH stamp tracking**: action #1025 (P1) — Greg eyeballs → email → record turnaround
- **HQ recap UI**: hq.gomicrogridenergy.com/recaps
- **HQ actions UI**: hq.gomicrogridenergy.com/actions

---

**End of handoff. Next session: pick up only when RUSH feedback arrives (#1025). All Phase 7b R1 deferrals are closed; only the 215b dormant-bug cleanup remains in the hardening backlog. Pass it forward.**

## Chain state (auto)

```yaml
chain_state_auto:
  project: MicroGRID
  generated_at: 2026-05-13T21:37:43Z  # auto — do not hand-edit, run chain_state_snapshot.py
  current_branch: feat/planset-v8-layouts
  main_head: 8d1e801  # feat(mig 321): seer_listen_progress — resume-where-left-off for Seer TTS
  main_head_committed: 2026-05-13T15:00:25-05:00
  recent_recaps:  # newest first; pulled from atlas_session_recaps
    - planset-2026-05-13-r1-deferrals-sweep (2026-05-13T19:49:04, 57dc174): Closed all four Phase 7b R1 deferrals + cumulative milestone R1 (Grade B) across SLD v2 surface
    - planset-7b-2026-05-13-pm (2026-05-13T17:50:26, ba81df5): Phase 7b ships: v2 SLD PDF gets a title block, RUSH stamp pilot rendered for PROJ-32115, Vercel previews un...
    - planset-phase-7a-2026-05-13 (2026-05-13T16:24:27, c7e1c3a): Phase 7a — production cutover infrastructure for the new SLD generator (per-project flip switch shipped)
    - planset-phase-6-closeout-2026-05-13 (2026-05-13T15:46:01, c7e1c3a): planset chain Phase 6 close-out — #998 + #1006 fixed inline (R1 A, both follow-ups closed)
    - planset-phase-6-2026-05-13 (2026-05-13T15:20:02, 2d826cb): planset chain Phase 6 — feature-flag + nodeOverrides + v2 PDF route shipped (R1 B → R2 A)
    - planset-phase-5-pdf-2026-05-13 (2026-05-13T14:44:11, 8a5df39): Planset sld-v2 Phase 5 — SVG→PDF export shipped (67,538-byte ANSI B PDF, grep-able NEC text)
  branches_with_work:
    - feat/atlas-canonical-pipeline-installs (cba5a83): 1 ahead of main
    - feat/atlas-canonical-subhub-signed-vwc (8a1590a): 3 ahead of main
    - feat/customer-documents-rls (60374c8): 1 ahead of main
    - feat/employee-mobile-F0-foundation (698537c): 5 ahead of main, never pushed
    - feat/mobile-2026-05-07-production-ready (96b1577): 8 ahead of main
    - feat/mobile-project-activity (15beb0f): 6 ahead of main, 4 unpushed to origin/feat/mobile-project-activity
    - feat/partner-fanout-dlq (a4b6db7): 11 ahead of main
    - feat/phase-2-prod-readiness (3fad16b): 23 ahead of main
    - feat/planset-v8-layouts (8bb365b): 39 ahead of main
    - feat/subhub-payload-shape-diag (520d571): 2 ahead of main, never pushed
    - feat/together-phase-1 (5350f05): 14 ahead of main, never pushed
    - fix/atlas-canonical-optional-since (09e3917): 2 ahead of main
    - fix/atlas-canonical-save-draft-guard-598 (bbd953b): 1 ahead of main, never pushed
    - fix/atlas-data-query-deploy (a677037): 4 ahead of main
    - fix/funding-deduction-fifo-538 (a1a6867): 1 ahead of main, never pushed
    - fix/invoice-ceiling-533 (6849a45): 1 ahead of main, never pushed
    - fix/restage-fanout-retry-565 (3738ee8): 1 ahead of main
    - fix/shared-rounding-helper-583 (33bd956): 3 ahead of main, never pushed
    - fix/tx-tax-tpp-526 (1d5164e): 1 ahead of main
    - restage/atlas-canonical-p1-p2 (7ede9e7): 1 ahead of main
  open_prs:
    - #16 feat/atlas-canonical-drift-cron: feat(atlas): canonical-reports drift cron — daily snapshot replay + alerting
  # autonomy-band flags below are owned by the chain skill, not this snapshot
```
