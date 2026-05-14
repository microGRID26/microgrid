# Chain handoff — planset

**Topic:** planset
**Last updated:** 2026-05-14 ~17:05 UTC (Phase H5 — tightened cross-file SECDEF REVOKE scan to same-or-later file order, closes #1073; hardening backlog now empty; chain in stasis until 2026-05-28 RUSH stamp unblock)
**Project:** MicroGRID
**Worktree:** `~/repos/MicroGRID-planset-phase1`
**Branch:** `feat/planset-v8-layouts` — **HEAD = `0d6f63b` (8 commits ahead of origin `211ede7`; not pushed per no-mid-session-push rule).** This session shipped (on top of prior session's `4b717f5`):
  - `a17d602` — feat(mig 226): audit_log append-only seal — BEFORE UPDATE/DELETE trigger + purge GUC (Phase H3)
  - `b291a0f` — feat(tests/integration): scaffold + close #1054 PostgREST-path trigger-guards (Phase H3)
  - `b754478` — docs(planset/.atlas): handoff refresh — Phase H3
  - `cc7787c` — feat(mig 227): REVOKE EXECUTE backport on mig 222b/223/224/225 SECDEF trigger functions (Phase H4)
  - `8d4a8b7` — docs(planset/.atlas): handoff refresh — Phase H4
  - `0d6f63b` — test(secdef): tighten cross-file REVOKE scan to same-or-later file order (Phase H5)
**Latest commit:** `0d6f63b` test(secdef): tighten cross-file REVOKE scan to same-or-later file order

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

## ✅ Shipped this session (2026-05-14 — Phase H5: SECDEF cross-file scan tightened to same-or-later file order)

After Phase H4 wrapped, Greg said "keep going" again. Picked up the only remaining hardening item (#1073) from the H4 migration-planner M1 finding. ~10 min execution: test-only change to `__tests__/security-definer-grants.test.ts`, no new migration.

### Commit `0d6f63b` — test(secdef): tighten cross-file REVOKE scan

Phase H4 added a cross-file scan that accepted name-bound REVOKEs from any .sql file in the migrations dir. This correctly handles back-fix paths (mig 227 covering mig 222b/223/224/225) but introduced a false-pass surface: a future SECDEF function redefining an existing name (e.g. another `projects_block_direct_stage_update` via CREATE OR REPLACE in mig 250) could free-ride on mig 227's historic REVOKE even though the new mig has no REVOKE of its own.

Tighten: REVOKE must appear in the same file (preferred — fresh-migration hygiene) OR in a LATER migration in lex order. Earlier-file REVOKEs no longer count.

- Replaced `allContent` union-string with a per-file walk over `files[i+1..]` until match or exhaustion.
- Memoized file reads in a `fileContent` cache so each .sql is loaded at most once.
- Live coverage: same-file (mig 226) + later-file (mig 222b/223/224/225 → mig 227) both exercised by existing live tests. Earlier-file path has no production case by definition.

### Audit gate summary

- Test-only change. No migration touched. Default protocol-guard gate satisfied by typecheck + test pass earlier in the turn.

### Verification

- `npx vitest run __tests__/security-definer-grants.test.ts` → 3/3 pass.
- `npx tsc --noEmit` → exit 0.

---

## ✅ Previously shipped (2026-05-14 ~16:30 UTC — Phase H4: REVOKE EXECUTE backport on the four SECDEF trigger functions)

After Phase H3 wrapped, Greg said "keep going." Picked up the only remaining hardening item (#1069) from the H3 R1 sister-finding.

### Commit `cc7787c` — feat(mig 227): REVOKE EXECUTE backport on mig 222b/223/224/225 SECDEF trigger functions

Closes #1069. Three REVOKE statements covering the three distinct SECURITY DEFINER trigger functions across the four migrations (`projects_block_direct_use_sld_v2_update` is one pg_proc row shared by mig 222b + 224 via CREATE OR REPLACE). Postcondition DO block asserts each ACL no longer contains PUBLIC / anon / authenticated.

**Live ACL after apply (all four SECDEF trigger fns now `{postgres, service_role}` only):**
- `audit_log_block_admin_tamper` — was already clean from mig 226 (Phase H3).
- `projects_block_direct_stage_update` — was `{postgres, anon, authenticated, service_role}`.
- `projects_block_direct_use_sld_v2_update` — same transition.
- `projects_log_db_admin_bypass` — was `{public, postgres, anon, authenticated, service_role}` (also had bare PUBLIC).

**Test changes — `__tests__/security-definer-grants.test.ts` cross-file scan.** Previously the test required the REVOKE in the SAME migration file. Now `buildRevokeRe(fnName)` matches against the union of all .sql content — back-fix migrations close the gap for historic offenders without requiring file mutation. Removed mig 222b/223/224/225 from `KNOWN_OFFENDERS`; `KNOWN_OFFENDERS_MAX` back to 16 (was 20 in H3 as a temporary punch-list).

### Audit gate summary

- **migration-planner retro-sign-off on mig 227** (apply-then-commit pattern for low-risk REVOKEs): A (0C / 0H / 1M / 2L). **M1 (cross-file scan name-collision false-pass — future SECDEF fn redefining an existing name could free-ride on the historic REVOKE)** filed as P2 #1073, non-urgent. L1 (regex shapes) confirmed exhaustive. L2 (no GRANT after REVOKE) intentional.

### Verification

- `npx vitest run __tests__/security-definer-grants.test.ts` → 3/3 pass after cross-file change.
- `npx tsc --noEmit` → exit 0.
- `chain_test_baseline.py diff vs 8a5df3949028` → NEW_FAIL=0, STILL_FAIL=16.
- Live ACL via `mcp__claude_ai_Supabase__execute_sql` on all four functions: postgres + service_role only.

---

## ✅ Previously shipped (2026-05-14 ~15:05 UTC — Phase H3: audit_log append-only seal + integration-test scaffolding)

Greg picked option (γ) of plan `~/.claude/plans/lexical-roaming-toast.md` — ship #1059 first (cheap, self-contained), then start #1058 (which absorbed #1054 in the same commit). RUSH stamp feedback (#1025) snoozed to 2026-05-28 per Greg's "defer RUSH two weeks" call at session start.

### Commit `a17d602` — feat(mig 226): audit_log append-only seal

Closes greg_actions #1059 (R1 red-teamer Low on mig 225, 2026-05-13 evening). Mig 225 added an AFTER trigger on `public.projects` that writes audit_log rows when DB-admin trust principals (postgres / supabase_admin / service_role) directly UPDATE stage/stage_date/use_sld_v2 — closes the silent-paper-trail gap. **Mig 226 closes the tamper-the-trail gap**: same DB-admin principals could `UPDATE audit_log SET reason='innocuous'` or `DELETE FROM audit_log WHERE …` because audit_log has `rls_forced=false`, `owner=postgres`, no UPDATE/DELETE policies — RLS doesn't block the owner and service_role bypasses RLS by design.

**Function design (`public.audit_log_block_admin_tamper`, SECURITY DEFINER, search_path=public,pg_temp):**
- BEFORE UPDATE OR DELETE trigger on `public.audit_log`.
- GUC gate: `current_setting('app.audit_log_admin_purge', true) IS NOT DISTINCT FROM 'true'` (NULL-safe; mig 222b's `auth.role() <> 'authenticated'` NULL-trap is the cautionary tale).
- Authorized path: TG_OP discriminator returns OLD on DELETE, NEW on UPDATE (correct BEFORE-trigger contract).
- Unauthorized path: `RAISE EXCEPTION ... USING ERRCODE = '42501'` — same SQLSTATE the mig 223/224 BEFORE triggers raise.
- R1 fold M1: `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated` blocks the discoverable `SELECT public.audit_log_block_admin_tamper()` surface. (Mig 223/224/225 share the same gap; backport tracked as P2 #1069.)
- R1 fold M2: postcondition DO block now asserts `(tgtype & 2) <> 0 AND tgenabled = 'O'` — ad-hoc `ALTER TABLE audit_log DISABLE TRIGGER` no longer silently neuters the seal at the apply gate.

**Trigger:** `BEFORE UPDATE OR DELETE ON public.audit_log FOR EACH ROW`.

**Postcondition `DO $$` block** asserts function existence + body contains `app.audit_log_admin_purge` + `IS NOT DISTINCT FROM` + `42501` + trigger attached as BEFORE+enabled. Apply-time gate against future CREATE OR REPLACE drift.

**Static test (`__tests__/migrations/audit-log-block-admin-tamper.test.ts`)** — 9 tests mirroring `projects-log-db-admin-bypass.test.ts` (mig 225): SECDEF + search_path, GUC name pin, NULL-safe IS NOT DISTINCT FROM (negative-assert no `=`), 42501 SQLSTATE, TG_OP RETURN correctness, BEFORE UPDATE OR DELETE (negative-assert NOT INSERT), neutralize-bypass detector (DROP/DISABLE/RENAME/GRANT), REVOKE present, postcondition-asserts-tgtype-and-tgenabled.

### Commit `b291a0f` — feat(tests/integration): scaffold + close #1054 PostgREST-path trigger-guards

Closes greg_actions #1058 (integration-test scaffolding) AND #1054 (PostgREST-path E2E test for mig 223 + 224 trigger guards) in one commit. Prior trigger-guard coverage was static-inspection .sql tests + MCP BEGIN/ROLLBACK smoke; neither exercises the actual authenticated-user → API gateway → DB path. **First real client → JWT → PostgREST → DB test in the repo.**

**Files (new):**
- `vitest.integration.config.ts` — sister to `vitest.eval.config.ts`. `pool: 'forks'`, `fileParallelism: false`, `environment: 'node'`, separate setupFiles from `vitest.setup.ts` (so the `@/lib/supabase/*` global mocks don't fire).
- `__tests__/integration/setup.ts` — `.env.local` loader; `beforeAll` provisions ONE org (`org_type='engineering'` to avoid the `organizations_grant_staff_on_new_epc` trigger), ONE auth.user + public.user (role='user'), ONE org_membership (member), ONE test project (with `pm_id=userId` — load-bearing for `projects_update_v2` RLS, without it the user gets 0 rows from RLS pre-filter and the trigger never fires). `afterAll` teardown deletes everything in dep order with slug/email/id guards. `scrubSecrets()` covers JWT (eyJ…), service-role (sbp_…), AND literal env-var values.
- `__tests__/integration/clients.ts` — `serviceClient()` + `userClient(email, password)`, cloned from `evals/helpers/clients.ts`. Direct `@supabase/supabase-js` import bypasses the global mocks.
- `__tests__/integration/fixtures.ts` — **per-run namespacing (R1 H1 fold).** `RUN_ID` from env (`GITHUB_RUN_ID` / `BUILDKITE_BUILD_NUMBER` / `VITEST_INTEGRATION_RUN_ID`) or `randomUUID().slice(0,8)`. Concurrent CI runners no longer race on the shared fixture user.
- `__tests__/integration/trigger-guards.test.ts` — 3 tests:
  1. SELECT precondition (catches RLS pre-filter regression that would silently pass-on-null).
  2. UPDATE stage as non-admin user → `isPermissionDeniedError(error)` AND server-side re-read confirms unchanged.
  3. UPDATE use_sld_v2 as non-admin user → same shape.
  The `isPermissionDeniedError` helper (R1 H2 fold) checks code + details + message + hint for `42501` or `/permission denied/` — defends against supabase-js version drift in where SQLSTATE surfaces.
- `__tests__/integration/README.md` — env-var requirements, cleanup grep (with `ESCAPE '\\'` so `_` doesn't wildcard-match unrelated orphans), how to run.

**Files (modified):**
- `vitest.config.ts` — exclude `__tests__/integration/**` from default suite.
- `package.json` — `test:integration` script.
- `__tests__/security-definer-grants.test.ts` — punch-list mig 222b/223/224/225 (sister SECDEF functions still lack name-bound REVOKEs); `KNOWN_OFFENDERS_MAX` 16 → 20. Backport tracked as P2 #1069 (new this session).

### Audit gates summary

- **migration-planner pre-apply on draft 226:** A (0C / 0H / 1M / 1L). M1 = COALESCE dead code (cosmetic), L1 = SECURITY DEFINER unnecessary (kept for pattern consistency with mig 223/224/225). Both acknowledged not folded.
- **R1 red-teamer post-apply on mig 226:** A (0C / 0H / 2M / 2L initially → A 0/0/0/2 after fold). **M1 (REVOKE EXECUTE from PUBLIC/anon/authenticated)** folded inline; **M2 (postcondition pin BEFORE+enabled)** folded inline. Lows acknowledged (message-divulges-GUC = operator help, dead COALESCE = cosmetic).
- **R1 red-teamer on integration scaffold:** B (0C / 2H / 4M / 2L initially → A 0/0/2/2 after fold). **H1 (concurrent-CI namespacing)** folded via per-run suffix in `fixtures.ts`; **H2 (42501 assertion brittle)** folded via `isPermissionDeniedError` helper. **M3 (auth.admin.listUsers page-1 cap, blocks at 200 users — MG is past 200)** folded via create-then-lookup-via-public.users pattern. **M4 (scrubSecrets sbp_ + literal env)** folded. M1 (FK teardown for future child-row tests), M2 (test-body errors not scrubbed) acknowledged not folded.
- **R2 verify:** mig 226 + mig 225 tests 17/17 pass; integration tests 3/3 pass against real PostgREST; `npm test` unit suite 3899 pass / 16 fail (no regression vs Phase 5 baseline `8a5df3949028`, `chain_test_baseline.py diff` returns NEW_FAIL=0); `npx tsc --noEmit` exit 0.

### Live smoke tests for mig 226 (all BEGIN/ROLLBACK against prod, no state mutation)

- **T1** — postgres direct `UPDATE audit_log SET reason='tamper-T1' WHERE id=1466` → 42501 raised. ✅
- **T2** — postgres direct `DELETE FROM audit_log WHERE id=1466` → 42501 raised. ✅
- **T3** — postgres `SET LOCAL app.audit_log_admin_purge='true'; UPDATE audit_log SET reason='retention-T3' WHERE id=1466` → succeeds; reason updated within txn. ✅
- **T4** — postgres `INSERT INTO audit_log (...)` → succeeds; BEFORE UPDATE/DELETE trigger correctly does not fire on INSERT. ✅

Live audit of trigger state post-apply: `tgtype` BEFORE+UPDATE+DELETE (NOT INSERT), `tgenabled='O'`. Live ACL on function: `{postgres=X/postgres, service_role=X/postgres}` — PUBLIC/anon/authenticated stripped.

### Pre-resolved follow-ups verified this session

- **#1025 snoozed**, not closed. Greg deferred RUSH stamp watch by two weeks at session start (`greg_actions.py snooze 1025 2026-05-28`).
- Other open follow-ups walked at pickup: #1054 (closed in this session), #1058 (closed in this session), #1059 (closed in this session). All premise-checks against current code confirmed open.

---

## ✅ Previously shipped (2026-05-13 late — Phase H2: audit_log AFTER trigger on DB-admin bypass)

Greg picked option (γ) from plan `~/.claude/plans/twinkly-herding-narwhal.md` (file integration-test scaffolding as prereq + ship #1053 in this session). The chain audit found Phase H1's commits already pushed (`211ede7`) and the pointer file stale at `ca7c990` — no drift in code, just the pointer's one-line state was behind.

### Commit `600f5c0` — feat(mig 225): audit_log AFTER trigger on DB-admin bypass

Closes greg_actions #1053 (R1 finding from mig 223 + 224 evening session). The Bypass A escape hatch (`session_user IN ('postgres','supabase_admin','service_role')`) on the stage + use_sld_v2 BEFORE UPDATE triggers let DB-admin operators fix project state outside the `set_project_stage` RPC with zero paper trail. Mig 225 adds an AFTER UPDATE trigger that logs to `audit_log` when the bypass path is taken.

**Function design (`public.projects_log_db_admin_bypass`, SECURITY DEFINER, search_path=public,pg_temp):**
- Discriminator: `session_user IN ('postgres','supabase_admin','service_role')`. NOT `current_user` (would resolve to function-owner=postgres for every caller — same SECDEF trap that broke 222b silently). The static-inspection test enforces this with positive AND negative regex.
- Double-log guard: reads `current_setting('app.via_set_project_stage', true) IS NOT DISTINCT FROM 'true'` into `v_via_rpc`. Stage / stage_date INSERTs gated on `NOT v_via_rpc` so the `set_project_stage` RPC's own audit_log row isn't duplicated.
- **GUC consumed by trigger fire** (R1 M1 fold from red-teamer): `PERFORM set_config('app.via_set_project_stage', '', true)` after reading, before the IF blocks. Closes the in-transaction silent-bypass where a DB-admin batch calls the RPC then does a direct UPDATE — second UPDATE in same txn now logs correctly. T6 smoke verified.
- use_sld_v2 INSERT is unconditional on value change (no governing RPC).
- Attribution: `changed_by='db-admin'`, `changed_by_id=session_user::text`, hardcoded reason strings citing the originating migration. `audit_log_resolve_actor` (mig 214 BEFORE INSERT) preserves attribution because DB-admin sessions have no JWT → `auth.uid() IS NULL` → that trigger returns NEW unchanged.

**Trigger:** `AFTER UPDATE OF stage, stage_date, use_sld_v2 ON public.projects FOR EACH ROW`.

**Postcondition `DO $$` block** at end of migration asserts function existence + body contains session_user + via_set_project_stage + use_sld_v2 references + trigger attached. Matches the R1-sweep pattern from mig 223/224 commit 3.

### Audit gates summary

- **Migration-planner pre-apply on draft 225:** A (0C / 0H / 2M / 2L). Walked all 5 execution paths (Greg direct stage, Jen RPC, postgres RPC, Greg direct use_sld_v2, JWT admin use_sld_v2 — last acknowledged out of scope). Verdict: GO. Mediums + Lows were cosmetic.
- **R1 red-teamer post-apply:** B (0C / 0H / 1M / 4L). **M1 (GUC not consumed)** was real and FOLDED INLINE via `PERFORM set_config(...,'',true)`. L3 (negative SECURITY INVOKER assert) + L4 (column-order brittleness in test) folded into the test file. L5 (header doc for self-bypass scope) folded into migration header. **L2 filed as #1059 P2** — audit_log itself has no UPDATE/DELETE policies, so service_role/postgres can post-mutate rows; pre-existing schema gap, append-only seal warranted but out of scope for #1053.
- **R2 verify:** 8/8 mig 225 tests pass; sld-v2 suite 67/67 pass; `npx tsc --noEmit` exit 0.

### Live smoke tests (all BEGIN/ROLLBACK against prod, no state mutation)

- **T2** — use_sld_v2 toggle on PROJ-32115 → 1 audit row, field=`use_sld_v2`, changed_by=`db-admin`, changed_by_id=`postgres`, reason=`direct UPDATE bypass (mig 224 bypass A)`. ✅
- **T5** — direct stage UPDATE on PROJ-32115 (no GUC) → 1 audit row, field=`stage`, old=`evaluation`, new=`survey`. ✅
- **T4** — GUC-gated stage UPDATE (RPC-path simulation) → 0 new audit rows. Double-log guard verified. ✅
- **T6** (R1 M1 regression) — set GUC + UPDATE stage (skip log) + UPDATE stage again (must log) → exactly 1 audit row from the second UPDATE. GUC consumption verified. ✅

### Pre-resolved follow-ups verified this session

None. #1025 (RUSH stamp) still open. New session pickup verified that all the Phase H1 commits (5 commits up through `211ede7`) shipped clean and the BEFORE triggers from mig 223+224 are correctly attached.

---

## ✅ Previously shipped (2026-05-13 evening — Phase H1: RUSH-blocked window hygiene + typography prep)

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
- ✅ **Phase H1 — RUSH-blocked window hygiene: mig 223 + 224 (session_user fix) + Inter Bold typography prep — 2026-05-13 ~22:30 UTC**
- ✅ **Phase H2 — mig 225 audit_log AFTER trigger on DB-admin bypass (closes #1053) — 2026-05-13 ~23:35 UTC**
- ✅ **Phase H3 — mig 226 audit_log append-only seal (closes #1059) + integration-test scaffolding (closes #1058 + #1054) — 2026-05-14 ~15:05 UTC**
- ✅ **Phase H4 — mig 227 REVOKE EXECUTE backport on four SECDEF trigger fns (closes #1069) + cross-file SECDEF static-test — 2026-05-14 ~16:30 UTC**
- ✅ **Phase H5 — tightened cross-file SECDEF scan to same-or-later file order (closes #1073) — 2026-05-14 ~17:05 UTC**
- 💤 RUSH stamp turnaround on Lohf pilot (#1025) — snoozed to 2026-05-28
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

- **#1025 (P1, SNOOZED to 2026-05-28)** — RUSH stamp turnaround tracking for PROJ-32115 (Charles Lohf). Greg deferred this two weeks at Phase H3 start; resumes 2026-05-28. Re-rendered PDF stays at 294 KB (Inter Bold subset). Closes when stamped sheet returns + decision on Phase 7c made.
- **(none)** — hardening backlog is empty. The only remaining open row is #1025 (RUSH stamp, snoozed to 2026-05-28).
- ~~#1073~~ — closed this session by commit `0d6f63b`. SECDEF cross-file scan now requires REVOKE in same-or-later file order.
- ~~#1069~~ — closed this session by mig 227 + commit `cc7787c`. Live ACL on all four SECDEF trigger fns now `{postgres, service_role}` only.
- ~~#1054~~ — closed this session by integration scaffold + `__tests__/integration/trigger-guards.test.ts` (commit `b291a0f`); 3/3 pass against real PostgREST.
- ~~#1058~~ — closed this session by `__tests__/integration/` scaffold (commit `b291a0f`).
- ~~#1059~~ — closed this session by mig 226 + commit `a17d602`.
- ~~#1053~~ — closed in Phase H2 by mig 225.
- ~~#1051~~, ~~#1052~~ — closed earlier sessions.
- ~~#1021~~, ~~#1022~~, ~~#1023~~, ~~#1024~~ — closed in earlier sessions.

### Latent / informational (not blocking, not yet filed as actions)

- **215b's `auth.role()` bypass bug** is now FIXED (mig 223 replaced the function body). Latent-bug section retired.

## Next phase to pick up

### ⬅ Phase 7c (next session) — fold RUSH stamp feedback (conditional on #1025)

#1025 is **SNOOZED to 2026-05-28**. Phase 7c remains the next forward-progress phase but does not pick up until RUSH feedback arrives.

**Decisions Greg must answer before this phase starts:**

(No decisions until RUSH feedback arrives. The shape of Phase 7c depends entirely on what RUSH dings. Until then sessions can pick up the hardening backlog OR start Phase 7.x — see below.)

**Phase work (anticipated, narrower after H1):**

- **Already shipped, pre-empted by H1:** Inter Bold registration + Unicode-correct title block. If RUSH's main typography ding is "the customer name lost an accent" or "Helvetica looks too bare," that's now fixed.
- **Already shipped, pre-empted by H2 + H3:** silent-paper-trail closed (mig 225 AFTER trigger writes audit_log on DB-admin direct UPDATE) + tamper-the-paper-trail closed (mig 226 BEFORE UPDATE/DELETE seal). Real PostgREST-path test coverage on the trigger guards (mig 223/224) shipped via the integration scaffold. Any RUSH ding that surfaces a regression in stage/use_sld_v2 state will be loud, not silent.
- **Still possible:** fold layout feedback — row sizing, sheet-number font size, NEC notes box placement.
- **Still possible:** fold NEC compliance feedback — additional `graph.notes` painting, callout placement.
- **If RUSH stamps clean:** mark v2 as the production default for new projects (separate chain — coordinate with Phase 7.x equipment kinds which gate non-Duracell topologies).

**Estimated effort:** depends on RUSH feedback. 30 min if clean stamp, 2-4 hours if substantive redraw.

### ⬅ Hardening backlog (any-time)

- **(empty)** — every R1 deferral from Phase 7b through Phase H4 is now shipped. Next forward-progress phase is either Phase 7c (RUSH-gated) or Phase 7.x (needs a planning conversation).
- ~~#1054~~, ~~#1058~~, ~~#1059~~, ~~#1069~~, ~~#1073~~ — SHIPPED this session.
- ~~#1053~~ — SHIPPED in Phase H2 (mig 225).
- ~~215b NULL auth.role() bypass patch~~ — SHIPPED in mig 223 (also surfaced a worse SECDEF/current_user bug that was silently broken in prod via 222b → fixed in mig 224).

### ⬅ Phase 7.x (deferred — not blocking) — missing equipment kinds

- Fill `StringInverterBox` / `MicroInverterBox` / `EVChargerBox` when the first live non-Duracell project hits the v2 path (`isDuracellHybrid` gate at route line 134 will 422 until then).

## Specific gotchas for the next operator

- **Branch is NOT pushed** — **4 commits** ahead of origin `211ede7`: `4b717f5` (Phase H2 handoff-refresh) → `600f5c0` (Phase H2 feat mig 225, pushed status applies on top of `4b717f5`) → `a17d602` (Phase H3 feat mig 226) → `b291a0f` (Phase H3 feat integration scaffold). Awaiting end-of-session push auth per CLAUDE.md / `feedback_no_mid_session_push.md`.
- **`mig 226` is APPLIED to prod** (this session, two apply_migration calls — initial + R1-fold REVOKE+postcondition-tighten). Trigger is live: `audit_log_block_admin_tamper_trg` BEFORE UPDATE OR DELETE on public.audit_log, `tgenabled='O'`, NOT on INSERT. Live ACL on the function: `{postgres=X/postgres, service_role=X/postgres}` — PUBLIC/anon/authenticated stripped. Any direct UPDATE/DELETE on audit_log now raises 42501 unless the txn has `SET LOCAL app.audit_log_admin_purge='true'`. Heads-up to future operators: legitimate retention pruning of audit_log MUST set the GUC first.
- **`mig 225` is APPLIED to prod** (Phase H2) — postcondition asserts ran during apply, trigger is live. Any subsequent direct MCP UPDATE to projects.stage / stage_date / use_sld_v2 will now write an audit_log row attributed to `'db-admin'` / session_user; PLUS that audit_log row is now tamper-protected by mig 226.
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
- **Integration test suite now exists.** Real client → JWT → PostgREST → DB. Lives at `__tests__/integration/` under its own vitest config (`vitest.integration.config.ts`). Run via `npm run test:integration`. Fixture identifiers are per-run (`E2E_TEST_PREFIX = 'e2e_test_'` + suffix from env or randomUUID). To add a new trigger/RLS/RPC E2E test: drop a `*.test.ts` in that dir, import `serviceClient` / `userClient` from `./clients`, import `getIntegrationContext()` from `./setup`, write the test. NO new setup/teardown plumbing needed for the basic shape. Heads-up: if your test writes any FK-child row against the fixture project (work_orders, change_orders, invoices, etc.), the existing teardown will FK-fail — extend `setup.ts:teardown()` to delete the child in dep order first (see the comment block on `evals/cleanup.ts` for the 19-FK-child enumeration pattern).
- **mig 226 GUC name:** `app.audit_log_admin_purge`. Any future retention/purge tool MUST `SET LOCAL app.audit_log_admin_purge = 'true'` at txn start or every UPDATE/DELETE will raise 42501.

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
  project: planset
  generated_at: 2026-05-14T16:07:46Z  # auto — do not hand-edit, run chain_state_snapshot.py
  current_branch: feat/planset-v8-layouts
  main_head: 8abcb4a  # feat(seer): mig 326+327 + seer-curriculum-ingest agent (Chain 7 Phase 5)
  main_head_committed: 2026-05-14T10:01:45-05:00
  recent_recaps: []  # recaps unreachable (creds missing or RPC down)
  branches_with_work:
    - feat/atlas-canonical-pipeline-installs (cba5a83): 1 ahead of main
    - feat/atlas-canonical-subhub-signed-vwc (8a1590a): 3 ahead of main
    - feat/customer-documents-rls (60374c8): 1 ahead of main
    - feat/employee-mobile-F0-foundation (698537c): 5 ahead of main, never pushed
    - feat/mobile-2026-05-07-production-ready (96b1577): 8 ahead of main
    - feat/mobile-project-activity (15beb0f): 6 ahead of main, 4 unpushed to origin/feat/mobile-project-activity
    - feat/partner-fanout-dlq (a4b6db7): 11 ahead of main
    - feat/phase-2-prod-readiness (3fad16b): 23 ahead of main
    - feat/planset-v8-layouts (0d6f63b): 55 ahead of main, 8 unpushed to origin/feat/planset-v8-layouts
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
