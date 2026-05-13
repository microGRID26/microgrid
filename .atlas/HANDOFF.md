# Chain handoff — planset

**Topic:** planset
**Last updated:** 2026-05-13 ~22:30 UTC (Phase H1 — RUSH-blocked window hygiene + typography prep: P0 silent-break on 222b caught + fixed, mig 223 + 224 land session_user fix, Inter Bold + Unicode-correct title block shipped, 67/67 sld-v2 tests pass)
**Project:** MicroGRID
**Worktree:** `~/repos/MicroGRID-planset-phase1`
**Branch:** `feat/planset-v8-layouts` — **HEAD = `5714af3` (4 commits ahead of origin `c73d1b7`; not pushed per no-mid-session-push rule).** Four commits this session: `978392c` (mig 223/224 — session_user fix on stage + use_sld_v2 triggers), `de73e92` (Inter Bold + Unicode title block typography prep), `2756a73` (R1-sweep postcondition asserts + smoke-test evidence on migrations), `5714af3` (HANDOFF refresh + chain_state_auto YAML).
**Latest commit:** `5714af3` docs(planset/.atlas): handoff refresh — Phase H1 (RUSH-blocked window)

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

**As of 2026-05-12 the chain pivoted** from canvas-iterating the v1 hand-positioned spec to a declarative equipment list → elkjs layout engine → React/SVG renderer with prop-driven label slots. Code lives in `lib/sld-v2/` + `components/planset-v2/`. v1 stays untouched and operational behind the existing routing in `lib/sld-layout.ts`. Phases 0-4 (equipment kinds + elkjs adapter + label picker + PlansetData adapter) shipped 2026-05-12. Phase 5 (SVG → PDF export) shipped 2026-05-13 morning. Phase 6 (feature flag + nodeOverrides + production route) shipped 2026-05-13 mid-morning. Phase 7a (per-project `use_sld_v2` column + 3-arg flag + SheetPV5 inline v2 swap) shipped 2026-05-13 ~11 UTC. Phase 7b (title block paint + Inter Regular + Lohf pilot PDF) shipped 2026-05-13 ~13 UTC; the cumulative R1 + R1-deferrals sweep shipped ~15:30 UTC. **Phase H1 (this session, evening 2026-05-13) used the RUSH-blocked window to fix two SECURITY DEFINER bypass bugs in the trigger guards (mig 223 + 224 — including a silently-broken-in-prod gap on 222b) and pre-empt the most likely RUSH typography ding by adding Inter Bold + Unicode-correct title-block rendering.** Phase 7c (folding RUSH stamp feedback) is the next forward phase but gated on the stamp turnaround for PROJ-32115 / Lohf (#1025, ~1 week out).

**Plan docs:** `~/.claude/plans/smooth-mixing-milner.md` (architectural, Greg-approved 2026-05-12), `~/.claude/plans/virtual-scribbling-raven.md` (Phase 7b, 2026-05-13), `~/.claude/plans/bright-forging-hare.md` (Phase H1, 2026-05-13 evening).

## ✅ Shipped this session (2026-05-13 evening — Phase H1: RUSH-blocked window hygiene + typography prep)

The chain was at a documented waiting point on Phase 7c (RUSH stamp turnaround on #1025 ~1 week out). Greg picked "proceed without RUSH" → Phase H1 absorbed the window with two surgical changes plus an unplanned-but-critical P0 fix that surfaced during the migration-planner audit.

### Commit 1 — `978392c` (mig 223/224 — session_user fix on stage + use_sld_v2 triggers)

**Critical pre-apply finding by migration-planner subagent:** my draft mig 223 used `current_user` for the DB-admin bypass in a SECURITY DEFINER trigger function. Under PostgreSQL semantics, `current_user` inside a SECURITY DEFINER returns the function OWNER ('postgres'), NOT the session role. The auditor flagged this as Medium with "verify smoke test #2 immediately post-apply."

**Live test against the existing 222b function in prod:** `SET LOCAL ROLE authenticated; UPDATE projects SET use_sld_v2 = NOT use_sld_v2 WHERE id = 'PROJ-32115'` SUCCEEDED with no exception. **222b was silently broken in prod** — the trigger has been bypassing the admin-only guard for every authenticated user since it shipped 2026-05-13 ~15:30 UTC (~6h before the catch). Cumulative R1 last session graded this Grade A; the protection it advertised didn't exist.

Filed P0 #1052 documenting the production bug. Expanded scope to fix both migrations using `session_user` (the original CONNECTION role, NOT changed by SET ROLE or SECURITY DEFINER).

- **Migration 223** — `projects_block_direct_stage_update`. Bypass A is now `session_user IN ('postgres', 'supabase_admin', 'service_role')`. Does NOT add `OR auth_is_admin()` — stage flips must go through `set_project_stage` RPC to preserve transition validation, stage_history insert, and audit_log insert.
- **Migration 224** — `projects_block_direct_use_sld_v2_update`. Same session_user pattern. KEEPS `OR auth_is_admin()` because use_sld_v2 has no governing RPC (JWT admins ARE the supported direct-UPDATE path; non-admin authenticated traffic now correctly hits 42501).

**Smoke tests (all pass live, MCP execute_sql against prod):**
- T2: SET LOCAL SESSION AUTHORIZATION authenticator + SET ROLE authenticated → UPDATE use_sld_v2 → SQLSTATE 42501 ✓
- T3: same → UPDATE stage → 42501 ✓
- T4: postgres direct UPDATE use_sld_v2 → succeeds (Bypass A) ✓
- T5: postgres direct UPDATE stage → succeeds (Bypass A) ✓
- PROJ-32115 state preserved (use_sld_v2=true, stage=evaluation).

**Blast-radius audit (R1 red-teamer):** Only PROJ-32115 has `use_sld_v2=true` in prod. Zero `audit_log` rows for use_sld_v2 changes during the 222b buggy window. No unauthorized writes occurred — the protection was theoretical but no attacker materialized.

### Commit 2 — `de73e92` (Inter Bold + Unicode-correct title block — H1 typography prep)

Pre-empts the most likely RUSH typography ding. Currently the title-block painter falls back to Helvetica Type 1 with a WinAnsi sanitizer that strips diacritics (Peña → Pena). RUSH-stamped engineering plansets typically require correctly-rendered Unicode customer names. This commit adds Inter Bold to the bundled fonts and wires it through the title block when both Regular + Bold load successfully.

- **`lib/sld-v2/fonts/Inter-Bold.ttf`** (new) — vendored from rsms/inter v4.1 release zip. SHA-256: `288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f` (411 KB).
- **`lib/sld-v2/fonts/inter-loader.ts`** — refactored to expose `loadInterBoldTtfBase64()` alongside `loadInterTtfBase64()`. Shared `loadTtf(spec)` helper. Both ttfs verified at runtime against their SHA constants; mismatch throws via `INTER_SHA_MISMATCH_PREFIX` sentinel for loud-on-deploy-bug visibility.
- **`lib/sld-v2/pdf.ts`** — atomic-pair registration. Loads Regular + Bold in parallel. If BOTH succeed: register both, fontName='Inter', pass `unicodeSafe: true` to the painter. If EITHER fails: skip Inter entirely, console.warn, fall back to Helvetica + WinAnsi. Half-registration would cause `doc.setFont('Inter','bold')` to silently misrender, so the atomic gate is critical.
- **`lib/sld-v2/title-block.ts`** — sanitizer is now threaded through `RowCtx` as a closure-bound function pointer. `paintTitleBlock` accepts new `unicodeSafe?: boolean` option. When true → identity sanitizer (Inter handles Unicode natively). When false → original `winAnsi()` (Helvetica fallback). Every `winAnsi(...)` call in `paintTitleBlock` body replaced with `sanitize(...)` (closure).

### Commit 3 — `2756a73` (R1 sweep on migrations — postcondition asserts + smoke-test evidence)

Folds R1 red-teamer findings on `978392c`:
- **M3 — postcondition asserts.** Both migration files now end with a `DO $$` block that fails the apply if `pg_get_functiondef()` body does not contain `session_user` (and for 223: also the `app.via_set_project_stage` GUC bypass). Safety net for future CREATE-OR-REPLACE drift.
- **L1 — smoke-test evidence.** Migration headers now document the SET LOCAL SESSION AUTHORIZATION pattern (vs SET LOCAL ROLE alone) and the actual test results inline. Future readers don't re-fight the "is the test pattern right?" question.
- H1 + M1 from R1 deferred to follow-up actions (#1053 audit_log gap on DB-admin bypass; #1054 PostgREST-path E2E test).

### Test count

sld-v2 suite: **64 → 67 tests passing.** +3 typography tests in `pdf.test.ts`:
- Loader spy for Bold (Inter Bold MUST be loaded when titleBlock is present)
- 2 FontDescriptor entries + 2 FontFile2 blocks present in PDF (atomic-pair embedded)
- Unicode customer name "Peña" does NOT appear as "Pena" Tj operator in PDF bytes (regression catch for sanitizer firing in unicodeSafe branch).

`title-block.test.ts` now mocks the loader to force Helvetica fallback. All 4 existing R1-H1/M1 regression tests remain valid (Peña→Pena transliteration, smart-quote → straight-quote, width-clamp, paren-escape) — they now validate the FALLBACK path explicitly.

### Lohf pilot visual diff

Re-rendered: 197 KB → 294 KB (Inter Bold subset embedded). PROJ-32115 / Charles Lohf has an ASCII name, so the typography prep is INVISIBLE on this specific pilot — the Unicode rendering matters for future customers whose names have diacritics. Greg to eyeball `~/Desktop/sld-v2-pilot-lohf.pdf` before re-mailing (the render script auto-mirrored to Desktop, overwriting the prior 197 KB version).

### Audit gates summary

- **Migration-planner pre-apply on draft 223:** A → flagged Medium on current_user/SECDEF. Expanded scope to include 222b fix.
- **R1 red-teamer on applied 223+224 (post-commit):** B (0C / 1H / 3M / 2L). H1 folded inline (smoke-test evidence clarified); M3 folded inline (postcondition asserts); M1 + H1-followup filed as P2 #1053, #1054.
- **R2 verify on migrations:** clean. Live function bodies still have session_user pattern; no current_user leaked back.
- **R1 self-audit on typography (post-commit):** A (0C / 0H / 2M / 1L). M1 + M2 awareness-only.
- **R2 verify on typography:** 67/67 tests pass, typecheck clean.

### Pre-resolved follow-ups verified this session

None. #1025 (RUSH stamp tracking) was already open and stays open until stamp returns.

---

## ✅ Previously shipped (2026-05-13 pm, Phase 7b R1-deferrals sweep + cumulative milestone R1)

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
- **PDF font behavior (post-H1):** when `titleBlock` is present, BOTH Inter Regular AND Inter Bold ttfs are registered (atomic-pair guarantee — if either fails to load, neither registers and the whole sheet falls back to Helvetica + WinAnsi sanitizer). Both ttfs SHA-256-verified on load. When `titleBlock` is absent, Inter is NOT registered; everything renders in Helvetica + WinAnsi (preserves `strings | grep NEC 690.12`).
- **PDF concurrency mutex** now covers `layoutEquipmentGraph` + `placeLabels` + `renderToStaticMarkup` (post-M3). elkjs singleton-touch seam closed.
- **inter-loader ENOENT no longer caches null** (post-M5). Per-request warn instead of silent dyno-lifetime Helvetica fallback.
- **`canvas` is a native dep** — Phase 6's route has `export const runtime = 'nodejs'`, unchanged.
- **Visual companion**: brainstorm server is live at `http://localhost:64594` (current session) — port is dynamic, NOT fixed across restarts. Content dir at `.superpowers/brainstorm/88553-1778708615/content/`. Earlier session-dir `.superpowers/brainstorm/60886-1778695837/content/` carries the source HTML; it's been copied forward. If the server is down on pickup, restart via `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/brainstorming/scripts/start-server.sh --project-dir ~/repos/MicroGRID-planset-phase1` and copy `index.html` into the new content dir.

## Open follow-ups

(Read each `python3 ~/.claude/scripts/greg_actions.py show <id>` before working on it — pre-resolution gate per chain rule.)

- **#1025 (P1)** — RUSH stamp turnaround tracking for PROJ-32115 (Charles Lohf). Greg eyeballs PDF, mails to RUSH, records turnaround + feedback when stamp returns. Closes when stamped sheet returns + decision on Phase 7c made. **Open for ~1 week (RUSH-blocked).** Re-rendered PDF now 294 KB (was 197) with Inter Bold subset embedded — visually identical for ASCII names like Charles Lohf, but the SECDEF-guard fix in 224 means use_sld_v2 is now actually admin-only as advertised.
- **#1053 (P2)** — audit_log gap for DB-admin bypass on stage + use_sld_v2 triggers. Filed during H1 R1 sweep. Need new AFTER trigger writing audit_log rows when session_user is in the DB-admin allowlist AND the gated column changed. ~30 min, low risk.
- **#1054 (P2)** — Real PostgREST-path E2E test for stage + use_sld_v2 trigger guards. Filed during H1 R1 sweep. Vitest integration test using Supabase JS client + non-admin JWT to attempt UPDATE → expect 42501. More robust than the MCP-SESSION-AUTHORIZATION pattern currently used. ~1 hour.
- ~~#1051~~ — Phase H1 itself, closed by end-of-session.
- ~~#1052~~ — P0 / 222b silent break, closed by mig 224 + smoke tests.
- ~~#1021~~, ~~#1022~~, ~~#1023~~, ~~#1024~~ — closed in earlier sessions.

### Latent / informational (not blocking, not yet filed as actions)

- **215b's `auth.role()` bypass bug** is now FIXED (mig 223 replaced the function body). Latent-bug section retired.

## Next phase to pick up

### ⬅ Phase 7c (next session) — fold RUSH stamp feedback (conditional on #1025)

Phase 7b + Phase H1 shipped end-to-end. The next phase IS the RUSH feedback loop: pick up only after #1025 closes (stamp returns with feedback). Until then the chain is at a natural waiting point.

**Decisions Greg must answer before this phase starts:**

(No decisions until RUSH feedback arrives. The shape of Phase 7c depends entirely on what RUSH dings.)

**Phase work (anticipated, narrower after H1):**

- **Already shipped, pre-empted by H1:** Inter Bold registration + Unicode-correct title block. If RUSH's main typography ding is "the customer name lost an accent" or "Helvetica looks too bare," that's now fixed. Lohf pilot was re-rendered with Inter Bold subset embedded (PROJ-32115 / Charles Lohf has an ASCII name so the change is invisible on that specific pilot — Unicode rendering matters for future non-ASCII customer names).
- **Still possible:** fold layout feedback — row sizing, sheet-number font size, NEC notes box placement.
- **Still possible:** fold NEC compliance feedback — additional `graph.notes` painting, callout placement.
- **If RUSH stamps clean:** mark v2 as the production default for new projects (separate chain — coordinate with Phase 7.x equipment kinds which gate non-Duracell topologies).

**Estimated effort:** depends on RUSH feedback. 30 min if clean stamp, 2-4 hours if substantive redraw. Lower bound vs Phase 7b because the Bold + Unicode work is already done.

### ⬅ Hardening backlog (any-time)

- **#1053** — audit_log rows for DB-admin direct UPDATEs on `stage` + `use_sld_v2`. New AFTER trigger, ~30 min.
- **#1054** — Real PostgREST-path E2E test for the trigger guards. Vitest + Supabase JS + non-admin JWT, ~1 hour.
- ~~215b NULL auth.role() bypass patch~~ — SHIPPED in mig 223 (also surfaced a worse SECDEF/current_user bug that was silently broken in prod via 222b → fixed in mig 224).

### ⬅ Phase 7.x (deferred — not blocking) — missing equipment kinds

- Fill `StringInverterBox` / `MicroInverterBox` / `EVChargerBox` when the first live non-Duracell project hits the v2 path (`isDuracellHybrid` gate at route line 134 will 422 until then).

## Specific gotchas for the next operator

- **Branch is NOT pushed** — **4 commits** ahead of origin: `978392c` (mig 223/224), `de73e92` (Inter Bold typography), `2756a73` (mig R1 doc-clarify), `5714af3` (HANDOFF refresh). Awaiting Greg's end-of-session push auth per CLAUDE.md / `feedback_no_mid_session_push.md`.
- **PROJ-32115 use_sld_v2 = true** — Lohf is live on v2. Re-render via the route → expect the title-block PDF. **Column is genuinely trigger-protected NOW** (mig 224 fixed 222b's silent break); flipping requires `session_user IN ('postgres','supabase_admin','service_role')` OR an admin/super_admin JWT. MCP execute_sql works; the Supabase JS client as a manager-role user genuinely gets 42501.
- **Inter Bold is bundled and active in the v2 title-block path.** When `titleBlock` is requested, BOTH Inter Regular + Bold register atomically. If either ttf is missing/corrupted, the pipeline falls back to Helvetica + WinAnsi sanitizer for the entire sheet (logs a warn). Lohf pilot PDF is now 294 KB (was 197 KB) with Inter Bold subset embedded. **The WinAnsi-sanitizer-strips-diacritics gotcha is now only the fallback path** — happy path renders Unicode correctly.
- **`session_user` vs `current_user` in SECURITY DEFINER.** Inside SECDEF trigger functions, `current_user` returns the function OWNER (postgres) — bypass-list checks evaluate true for every caller (this was 222b's silent prod break). `session_user` is the original CONNECTION role and survives SET ROLE + SECURITY DEFINER. If you write another SECDEF trigger guard, use `session_user`.
- **Smoke-testing SECDEF triggers via MCP requires SESSION AUTHORIZATION.** `SET LOCAL ROLE authenticated` alone does NOT change session_user (changes current_user only). Must use `SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated;` to simulate a PostgREST connection. Documented inline in mig 223 + 224 headers.
- **`?sld=v2` URL flag is a NO-OP in production** (Phase 7b cumulative-R1 H1 fix). To force v2 for a project in prod, flip `use_sld_v2 = true` via Supabase MCP. URL flag still works in test/preview/dev.
- **inter-loader throws loud on SHA-256 mismatch** for either Regular or Bold (#1023 + H1 extension). Partial Vercel deploy with a corrupted ttf → 500 on the route. SHAs: Regular `40d692fc...0c82` (line 41), Bold `28831609...947f` (line 50). Re-vendor → update the constant in the same commit as the file replacement.
- **inter-loader no longer caches null on ENOENT** (M5 fix from prior session). Every request re-attempts the read until the file is restored.
- **Visual companion content dir** (`.superpowers/brainstorm/<port>-<pid>/content/`) is gitignored implicitly and includes the Lohf pilot PDF. Don't commit it.
- **`scripts/render-sld-v2-pilot-lohf.tsx`** is a session-local script; auto-mirrors output to `~/Desktop/sld-v2-pilot-lohf.pdf`. Be aware this OVERWRITES any prior approved version on Desktop — git can't recover it (path is gitignored).
- **The two-canvas iteration loop is dead** — same as Phase 7a, don't reopen v1 hand-positioning.
- **`@react-pdf/renderer@^4.4.1`** still in active prod use for invoices / cost-basis — DO NOT remove.

## Reference

- **Plan doc (architectural)**: `~/.claude/plans/smooth-mixing-milner.md` (Greg-approved 2026-05-12)
- **Phase 7b session plan**: `~/.claude/plans/virtual-scribbling-raven.md` (Greg-approved 2026-05-13)
- **Phase H1 session plan**: `~/.claude/plans/bright-forging-hare.md` (Greg-approved 2026-05-13 evening)
- **Lohf pilot PDF**: `~/Desktop/sld-v2-pilot-lohf.pdf` (294 KB post-H1, was 197 KB pre-H1; Inter Bold subset embedded)
- **Tyson demo PDFs**: `~/.claude/tmp/sld-v2-tyson-titled.pdf` (with title block), `~/.claude/tmp/sld-v2-tyson.pdf` (without)
- **RUSH stamp tracking**: action #1025 (P1) — Greg eyeballs → email → record turnaround
- **Hardening backlog**: #1053 (audit_log gap on DB-admin bypass), #1054 (PostgREST-path E2E test)
- **HQ recap UI**: hq.gomicrogridenergy.com/recaps (Phase H1 recap = id 514)
- **HQ actions UI**: hq.gomicrogridenergy.com/actions

---

**End of handoff. Next session: Phase 7c when RUSH feedback arrives (#1025). Hardening backlog (#1053, #1054) is fair game while waiting — Phase 7.x deferred equipment kinds (StringInverter / MicroInverter / EVCharger) is the bigger forward unlock and needs a planning conversation. Pass it forward.**

## Chain state (auto)

```yaml
chain_state_auto:
  project: MicroGRID
  generated_at: 2026-05-13T22:27:47Z  # auto — do not hand-edit, run chain_state_snapshot.py
  current_branch: feat/planset-v8-layouts
  main_head: eb05170  # feat(seer): daily AI brief generator (Chain 2)
  main_head_committed: 2026-05-13T16:51:49-05:00
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
    - feat/planset-v8-layouts (2756a73): 44 ahead of main, 3 unpushed to origin/feat/planset-v8-layouts
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
    - main (0e8a067): 1 unpushed to origin/main
    - restage/atlas-canonical-p1-p2 (7ede9e7): 1 ahead of main
  open_prs:
    - #16 feat/atlas-canonical-drift-cron: feat(atlas): canonical-reports drift cron — daily snapshot replay + alerting
  # autonomy-band flags below are owned by the chain skill, not this snapshot
```
