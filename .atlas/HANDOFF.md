# Chain handoff — planset

**Topic:** planset
**Last updated:** 2026-05-13 ~11:20 UTC (sld-v2 Phase 7a shipped — per-project use_sld_v2 column + 3-arg flag + SheetPV5 inline v2 swap, R1 B → R2 A)
**Project:** MicroGRID
**Worktree:** `~/repos/MicroGRID-planset-phase1`
**Branch:** `feat/planset-v8-layouts` — **HEAD = `56ceba2` (origin matches; 0 commits ahead).** All Phase 7a work + the 2 stranded prior-session commits pushed in one batch at session end (Greg pre-authorized at plan-mode + AskUserQuestion). 4 new commits this session: `c7e1c3a` → `8b6cfc4` → `62eaff7` → `56ceba2`.
**Latest commit (HEAD = origin):** `56ceba2` docs(planset): refresh handoff after Phase 7a ships
**Phase 7a feature commit:** `62eaff7` feat(sld-v2): Phase 7a — per-project use_sld_v2 column + 3-arg flag + SheetPV5 inline v2 swap (7 files, +245 / -41)
**Migration applied to prod:** 221 (`projects.use_sld_v2 boolean NOT NULL DEFAULT false`) — applied via MCP after migration-planner GO Grade A.

## Chain instruction (read this first, every session)

Pickup ritual:

1. **Chain audit (~5 min).** Read this doc's `✅ Shipped this session` block and run every verification command. For commit SHAs: `cd ~/repos/MicroGRID-planset-phase1 && git log --oneline <sha> -1`. For tests: `npx vitest run __tests__/sld-v2/`. For renders: re-run the named harness, run the collision validator, eyeball the staged PNG.

2. **Walk the open follow-ups** (`## Open follow-ups` section) — for any action ID listed, run `python3 ~/.claude/scripts/greg_actions.py show <id>` and grep the cited file. If the bug no longer reproduces, close the action via `greg_actions.py close <id> "verified shipped in <sha>"` and document under "Pre-resolved follow-ups verified this session" in the chain-history entry. Don't ship duplicates.

3. **Enter plan mode (`EnterPlanMode`).** Read the `### ⬅ Phase X (next session)` block. Surface its `Decisions Greg must answer before this phase starts` numbered list verbatim — DO NOT pre-answer them. Wait for "do it" before exiting plan mode.

4. **Claim the action** (parallel-session coordination). If the phase has a `greg_actions` row, `python3 ~/.claude/scripts/greg_actions.py claim <id>`. If no row exists, file one + claim.

5. **Plain-English session brief** (front bookend, mandatory). Post a 3-4 bullet brief in chat AFTER plan-mode approval but BEFORE first execution tool call. Lead with what this session will deliver in outcome terms. See the chain skill for the standard format.

6. **Ship.** Build → typecheck → test → R1 audit if applicable → fix → R2 → commit (no push without explicit auth per CLAUDE.md).

7. **Handoff back at end** — update this file's `✅ Shipped this session` + `### ⬅ Phase X` blocks + `## Open follow-ups` + 4-section in-chat digest. Write a session recap via `atlas_add_session_recap`.

## The chain in one paragraph

Started as a multi-session, multi-canvas effort to bring the MicroGRID planset generator output from "10 pages of mostly-empty placeholders" to RUSH-Engineering-stamp-ready drafting quality. Reference benchmark = `PROJ-26922 Corey Tyson Rev1.pdf` (36 pages, RUSH-stamped). Forward equipment baseline = Seraphim SRP-440-BTD-BG + Duracell PC Max Hybrid 15kW × 2 + 16× Duracell 5kWh LFP (80 kWh).

**As of 2026-05-12 the chain pivoted.** After 8 rounds of canvas iteration on `lib/sld-layouts/rush-spatial.json` (r5 → r12, hand-positioning ~260 absolute (x, y) text/rect/line elements via Claude Design canvas patches), Greg called out that the round-trip was a hand-positioning problem dressed up as data-driven design — every fix surfaced new collisions and the asset-internal labels were structurally unreachable from JSON patches. We dropped into plan mode, dispatched parallel research agents, designed a real layout-engine refactor, and shipped Phases 0–4 of the rebuild. The remaining v1 hand-positioned generator stays operational for PROJ-26922 unblock (PDF-edit path); the v2 generator becomes the production path for all future projects.

## Architectural pivot — what changed

**Old (v1)**: `lib/sld-layouts/*.json` files carry ~260 absolute-positioned elements per layout. The renderer (`renderSldFromSpec` in `lib/sld-from-spec.ts`) walks them and paints. Asset SVG components in `components/planset/sld-assets/*.tsx` (48 files) have their own hardcoded text labels INSIDE their viewBox. Both layers fight; collisions are inevitable; canvas iteration patches them one at a time without ever fixing the cause.

**New (v2)**: declarative equipment list → elkjs layout engine → React/SVG renderer with prop-driven label slots. Code lives in `lib/sld-v2/` + `components/planset-v2/`. v1 stays untouched and operational behind the existing routing in `lib/sld-layout.ts`.

**Plan doc**: `~/.claude/plans/smooth-mixing-milner.md` (Greg approved 2026-05-12)

## ✅ Shipped this session (2026-05-13, Phase 7a — per-project use_sld_v2 + 3-arg flag + SheetPV5 inline v2 swap)

### Phase 7a — production cutover infrastructure

Commit `62eaff7` (pushed in this session's batch to `origin/feat/planset-v8-layouts`). 7 files changed, +245 / -41. Migration applied via MCP.

**New / changed:**
- `supabase/migrations/221-projects-use-sld-v2-column.sql` — `ALTER TABLE projects ADD COLUMN use_sld_v2 boolean NOT NULL DEFAULT false`. migration-planner GO Grade A; PG17 metadata-only path on 3,297 rows; RLS column-agnostic; rollback clean.
- `types/database.ts` — `Project.use_sld_v2?: boolean` added to the hand-written interface (line 76-83). Generated `Tables.projects.Row` aliases to `Project`, so the field propagates without re-running `generate_typescript_types`.
- `lib/sld-v2/feature-flag.ts` — `shouldUseSldV2(searchParams, project?)` 2-arg promotion. Eval order: URL `?sld=v2` (testing) → env `SLD_V2_DEFAULT=1` (preview/dev) → `project?.use_sld_v2 === true` (production rollout). Strict-equality on the project check means null/undefined/missing column all fall through to false — safe-by-default on type drift.
- `app/api/sld/v2/[projectId]/route.ts` — reordered: auth → role → rate-limit → load project → 3-arg flag check. `respond404OrAuthError` helper does dual-response on auth/role failures: 404 when URL+env both off (preserves Phase 6 invisibility), 401/403 when URL or env on (caller is intentionally probing). Stripped the hardcoded `{ inverterCount: 2, inverterModel: 'Duracell Power Center Max Hybrid 15kW', ... }` — verified byte-identical to `DURACELL_DEFAULTS` in `lib/planset-types.ts:121`, so `buildPlansetData(proj)` produces the same output.
- `components/planset/SheetPV5.tsx` — props expanded to `{data, useSldV2?, layoutV2?}`. Early-return v2 path renders `<SldRendererV2 layout={layoutV2} />` instead of the v1 `calculateSldLayout` → `<SldRenderer>` chain. V1 path identical to Phase 6. Still wrapped in `memo()`.
- `app/planset/page.tsx` — new state `useSldV2` (boolean) + `layoutV2` (LayoutResult | undefined). `loadProject` + `rebuildData` both call `setUseSldV2(Boolean(project.use_sld_v2))`. New `useEffect([data, useSldV2])` computes `layoutEquipmentGraph(equipmentGraphFromPlansetData(data))` async; **R1-H1 fix:** `lastSldV2GraphHashRef` short-circuits the elkjs call when the graph stringify is unchanged, preserving SheetPV5's memo() on autosave/debounce/no-op edits. Cancelled-flag handles races. Error path falls back to v1 silently (console.error only).
- `__tests__/sld-v2/feature-flag.test.ts` — 3 → 9 tests (+6 net). Coverage: project flag on/off/null/undefined/{}, URL-wins-over-project, env-wins-over-project, uppercase `?sld=V2` (R1-M4), trailing-space `?sld=v2 ` (false, documents no-trim).

### R1 (red-teamer) — Phase 7a surface
**Grade B (0C / 1H / 3M / 2L).** All folded inline before R2. No deferrals beyond M3 type-regen note (current runtime is safe-by-default).
- H1 — memo break: `layoutV2` ref churned on every `data` rebuild because elkjs returns a fresh object. Fix: JSON-stringify hash of the equipment graph short-circuits the call when semantically unchanged.
- M1 — Phase 5 R1-M6 topology-gate comment misleading post-override-strip. Re-worded to point at `DURACELL_DEFAULTS`.
- M2 — R1-M4 case-insensitive contract not exercised by tests. Added `?sld=V2` (true) + `?sld=v2 ` (false) cases.
- M3 — `as Project` cast at route line 104 will hide future regression if types regenerated without the column. Current runtime is safe (strict `=== true` check). Documented in Open follow-ups as a Phase 7b-or-later type-safety hardening item.
- L1 — RLS posture verified clean (no SECURITY DEFINER RPC + no anon path leaks the column). Informational.
- L2 — cancelled-flag race verified sound. Informational.

### R2 (verify) — Phase 7a
**Grade A.** typecheck exit=0; sld-v2 tests **50 → 56 pass (+6)**; chain test baseline diff vs `8a5df3949028` returns `NEW_FAIL=0 STILL_FAIL=16` (pre-existing v1 failures unchanged).

### Pre-Phase-7a housekeeping (Greg authorized at pickup)
- `c7e1c3a` (close #998 cost-basis 500-leak + #1006 wire-label overdrawn) and `8b6cfc4` (handoff refresh) committed by the prior session were stranded local-only. Pushed alongside Phase 7a at session end (override marker; Greg authorized via AskUserQuestion at plan-mode pickup).
- Greg actions #996 closed ("Phase 6 fully shipped, housekeeping complete pre-Phase-7a"). #1012 filed for Phase 7a coordination, claimed, will close at session end.

### Older history below (Phase 6 — feature flag + nodeOverrides + v2 PDF route)
## ✅ Shipped 2026-05-13 ~10:15 UTC, Phase 6 — feature flag + nodeOverrides + v2 PDF route

### Phase 6 — wire v2 to a real route, behind a flag

Commit `2d826cb` (pushed by prior session via `8ae865e` at 09:50 UTC; now part of `origin/feat/planset-v8-layouts` history). 8 files changed, +328 / -11.

**New:**
- `lib/sld-v2/feature-flag.ts` — `shouldUseSldV2(searchParams)`. URL `?sld=v2` (case-insensitive value) OR env `SLD_V2_DEFAULT=1` flips it on. Off-by-default.
- `lib/sld-v2/overrides/loader.ts` — `loadNodeOverrides(projectId): Promise<NodeOverrides | undefined>`. Reads `lib/sld-v2/overrides/<id>.json`. Defenses: `SAFE_ID = /^[A-Za-z0-9_-]+$/` regex, `path.resolve` + prefix re-check (R1-M1), schema validation rejects `__proto__`/`constructor`/`prototype` keys + non-finite coords (R1-M2). Returns null-proto object.
- `lib/sld-v2/overrides/PROJ-DEMO.json` — example overrides file. Shape: `{ version: 1, nodes: { "<id>": { x, y } } }`.
- `app/api/sld/v2/[projectId]/route.ts` — GET handler. Mirrors `app/api/projects/[id]/cost-basis/pdf/route.ts` exactly: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `INTERNAL_ROLES = {admin, super_admin, manager, finance}`, `rateLimit('sld-v2-pdf:<email>', { windowMs: 60_000, max: 20, prefix: 'sld-v2' })`. Pipeline: feature flag → auth → role → rate-limit → load project (RLS-scoped via SSR client) → `buildPlansetData(proj, {Duracell-hybrid defaults})` → `equipmentGraphFromPlansetData(data)` → `loadNodeOverrides(projectId)` (splice into `graph.nodeOverrides` if present) → `renderSldToPdf(graph)` → return bytes with `Content-Type: application/pdf`. 500 catch returns opaque message + correlation id (R1-H1).
- `__tests__/sld-v2/feature-flag.test.ts` — 3 tests (URL flag, env flag, default off).
- `__tests__/sld-v2/overrides-loader.test.ts` — 3 tests (loads PROJ-DEMO, missing file → undefined, unsafe ids → undefined).

**Modified:**
- `__tests__/sld-v2/pdf.test.ts` — page-count regex anchored to `>>` dict close (R1-M3); NEC regex requires ≥1 whitespace/paren separator (R1-L4 tighten).
- `lib/sld-v2/pdf.ts` — header comment refresh (R1-L1) + JSDoc `@internal` tag on `renderSldToPdf` (R1-L1). No behavior change.

### R1 (red-teamer) — Phase 6 surface
**Grade B (0C / 1H / 4M / 4L).** All folded inline before R2. No deferrals.
- H1 — opaque 500 error + correlation id (route.ts catch block).
- M1 — `path.resolve` + prefix re-check in loader (defense vs symlinks + future regex relaxation).
- M2 — schema validation: forbidden keys (`__proto__`/`constructor`/`prototype`) + finite-number coords. Returns null-proto.
- M3 — page-count regex stiffened to anchor on dict close (`>>`).
- M4 — `?sld=v2` value compare lowercased.
- L4 — NEC regex requires `[\s(]+` separator (jsPDF never emits zero-separator).

Multi-tenancy verified via Supabase MCP: `projects` RLS policy `projects_select_v2` enforces `org_id = ANY (auth_user_org_ids()) OR auth_is_platform_user()`. `auth_is_platform_user()` is super_admin-only post-#354 (2026-04-29). Internal users (admin/manager/finance) in OrgA cannot read OrgB projects via this route.

### R2 (verify) — Phase 6
**Grade A.** typecheck exit=0; sld-v2 tests **40 → 46 pass (+6)**; chain test baseline diff vs `8a5df3949028` returns `NEW_FAIL=0 STILL_FAIL=16` (documented pre-existing v1 failures unchanged).

### Out-of-scope follow-ups filed
- **#998 (P2)** — `app/api/projects/[id]/cost-basis/pdf/route.ts:93-97` has the same `err.message` 500 leak. Pre-Phase-5 code, outside Phase 6 audit scope. Mirror the route.ts fix; one-line edit.

### Older history below (Phase 5 — SVG → PDF export)
## ✅ Shipped 2026-05-13 ~09:35 UTC, Phase 5 — SVG → PDF export

### Phase 5 — SVG → PDF export
New files:
- `lib/sld-v2/pdf.ts` (218 LOC) — `renderSldToPdf(graph, options?): Promise<Uint8Array>`. Pipeline: `layoutEquipmentGraph` → `placeLabels` → `renderToStaticMarkup(<SldRenderer/>)` → JSDOM parse → `rewriteFontFamily` → `svg2pdf.js` → `jsPDF` → bytes. Title block + NEC notes box deferred to Phase 7.
- `scripts/render-sld-v2-pdf.tsx` — Tyson-topology harness; writes `~/.claude/tmp/sld-v2-tyson.pdf`. Reuses the same stub `Project` as `scripts/render-sld-v2-from-planset.tsx` (M4 fix).
- `scripts/sld-v2-pdf-concurrency-smoke.tsx` — 3-parallel-renders smoke; verifies the R1-H1 mutex serializes the global-window swap without corruption.
- `__tests__/sld-v2/pdf.test.ts` (2 tests) — render-and-assert: PDF signature `%PDF-1.`, MediaBox `[0 0 1224. 792.]` (jsPDF's float pretty-print), exactly 1 `/Type /Page`, byteLength ∈ [8 KB, 200 KB], `NEC 690.12` ASCII match (C1 fix — was `NEC 705.13`, doesn't exist in the codebase); plus a module-load smoke test.
- Modified `vitest.setup.ts` — guarded `window` / `URL` references with `typeof !== 'undefined'` so node-env test files don't error during setup.

Pre-flight reviewer caught **2 Critical + 6 High** in the original plan BEFORE any code touched disk — folded inline before execution. Critical fixes: C1 (NEC text target was `705.13`, doesn't exist anywhere — switched to `690.12`), C2 (plan assumed 1:1 viewBox→page mapping but `SldRenderer` outputs elkjs-sized variable canvas — switched to aspect-preserved scale-to-fit). High fixes: H1 (dropped fragile jsdom-getBBox assumption, added prototype shim), H2 (jsdom's getBBox stub returns zero, swap to JSDOM lazy-import + shim), H3 (test timeout + byteLength positive-content invariant), H5 (`@react-pdf/renderer` is in active production use for invoices/cost-basis — DO NOT remove), H6 (server-only marker via comment + naming convention since literal `import 'server-only'` errors under tsx).

**R1 audit (red-teamer):** Grade C, 0C / 4H / 6M / 3L. Four High fixed inline:
- **H1 fixed** — module-level `renderMutex` promise chain serializes concurrent renders that swap globalThis.window/document. Smoke test confirms 3 parallel calls produce byte-identical PDFs without state corruption.
- **H2 fixed** — `doc.body.removeChild(svgElement)` moved into `finally` with `parentNode` guard; appended SVG no longer leaks if svg2pdf throws.
- **H3 documented** — getBBox prototype shim persists across the vitest jsdom run; grep confirms no other test asserts on `getBBox`, so leak is benign today; comment in code names the future-refactor path.
- **H4 fixed** — `rewriteFontFamily` no longer gates on `hasAttribute`; unconditionally writes `'Inter, Helvetica, sans-serif'` on every walked `<text>`/`<g>`/`<tspan>` so Phase 7's Inter ttf registration will actually take effect.

Six Medium / three Low findings: documented; non-blocking; M3/M4 (test-regex stiffening) and M6 (Vercel runtime=nodejs declaration for the future API route) flagged for Phase 6.

**R2 verify:** typecheck clean; 40/40 sld-v2 tests pass; harness still produces 67,538-byte PDF (identical to pre-R1-fix output); 3-parallel-renders smoke completes in 3065 ms with byte-identical PDFs.

### Deps added
- `svg2pdf.js@^2.7.0` (deps)
- `jspdf@latest` (deps; was already a transitive)
- `svgdom@^0.1.23` (deps — installed during exploration; not currently imported by pdf.ts but retained as a fallback path for Phase 7)
- `canvas@^3.2.3` (deps — provides text-measurement context to svg2pdf via jsdom; required at runtime in the API route)
- `server-only@^0.0.1` (deps — present but NOT imported; comment in pdf.ts documents why)
- `@types/svgdom@^0.1.2` (devDeps)
- `@types/jsdom@latest` (devDeps)

### Older history below (Phases 0–4, 2026-05-12)
## ✅ Shipped 2026-05-12 (sld-v2 Phases 0–4, ~6 hours)

### Phase 0 — Collision validator
Commit `3a6772f` · `scripts/sld-collision-check.py` (329 LOC, Python 3.12)
- Bbox-overlap detector. Parses rendered SVG/HTML, walks `<text>` + `<rect>` accumulating `<g transform>` chain, reports text↔text and text↔geometry overlaps with overlap-area in sq px.
- Skips white-fill rects (occluders/backgrounds) and fully-containing rects (asset frames).
- Exit 0 = clean, 1 = collisions, 2 = parse error.
- **r12 baseline captured**: 335 texts, 103 rects, **42 text↔text overlaps, 5390 sq px aggregate** — objective ground truth for every v2 round to beat.
- Note: requires `/opt/homebrew/bin/python3.12` (system python3.14 has broken pyexpat binding).

### Phase 1.1 — Equipment model
Commit `45fc446` · `lib/sld-v2/equipment.ts` (355 LOC) + `__tests__/sld-v2/equipment.test.ts` (27 tests pass)
- Discriminated TS union across 13 equipment kinds: `PVArray`, `StringInverter`, `MicroInverter`, `HybridInverter`, `BatteryStack`, `MSP`, `Disconnect` (role discriminator: pv/gen/service/ess), `RapidShutdown`, `JunctionBox`, `Meter`, `BackupPanel`, `EVCharger`, `ProductionCT`.
- Each kind carries `{ id, width, height, ports: Port[], labelSlots: LabelSlot[], labels: LabelLine[], props, overrideXY? }`.
- `EquipmentGraph { equipment, connections, sheet, nodeOverrides?, notes? }` is the v2 spec format.
- Helpers: `defaultLabelSlots(w, h)` (N=p8, S=p7, E=p6, W=p5), `quadPorts(prefix)` (emits dot-format ids: `pv.N`, `pv.S`, etc.), `isInverter`/`isDisconnect`/`isHybrid` guards.

### Phase 1.2 — MspBox proof-of-concept
Commit `ac9a49f` · `components/planset-v2/assets/MspBox.tsx` + `scripts/render-sld-v2-mspbox.tsx`
- Demonstrates the equipment-kind component pattern: receives `{ msp, x, y, debug? }`, scales to `msp.width × msp.height`, paints symbol + prop-driven amp/voltage labels INSIDE the asset only, exposes port anchor manifest via `<g id="${msp.id}-N/S/E/W">` for elkjs.
- Validator clean (0 overlaps).

### Phase 1.3 — 9 more equipment-kind components + all-kinds harness
Commit `e354536` · 9 files in `components/planset-v2/assets/` + `scripts/render-sld-v2-all-kinds.tsx`
- `DisconnectBox`, `HybridInverterBox`, `BatteryStackBox`, `MeterBox`, `PVArrayBox`, `RapidShutdownBox`, `JunctionBoxBox`, `BackupPanelBox`, `ProductionCtBox`. All prop-driven, port-exposed, NO hardcoded amp/model duplicates.
- All-kinds harness paints all 10 components on a 1200×650 canvas. Validator: 73 texts, 69 rects, **0 overlaps**.
- **Deferred to Phase 7** (not in Tyson topology): `StringInverterBox`, `MicroInverterBox`, `EVChargerBox`.

### Phase 2 — elkjs layout adapter + SldRenderer
Commit `5211656` · `lib/sld-v2/layout.ts` + `components/planset-v2/SldRenderer.tsx` + `scripts/render-sld-v2-tyson.tsx`
- Added `elkjs@^0.11.1` to `package.json`.
- `layoutEquipmentGraph(graph)` adapter — converts `EquipmentGraph` → ELK JSON → runs elkjs (algorithm=layered, direction=RIGHT, edgeRouting=ORTHOGONAL, portConstraints=FIXED_SIDE per port, spacing tuned for SLD density) → returns `{ laidOut: LaidOutEquipment[], edges: RoutedEdge[], width, height, margin }`.
- `applyOverrides()` respects `equipment.overrideXY` AND `graph.nodeOverrides[id]` — the escape hatch.
- `SldRenderer` consumes `LayoutResult`, dispatches per `equipment.kind` to the Phase 1.3 components, paints conductor polylines color-coded by category (dc-string=green, dc-battery=orange, ac-inverter=teal, ac-service=black, comm=purple dashed, ground/gec=lime).
- Tyson topology (13 equipment, 13 connections) renders end-to-end via ELK. **Score: 1 overlap, 16.5 sq px** (326× cleaner than r12 hand-positioned).
- The single overlap was `#10 AWG · DC string` label crossing the IMO RSD asset — fixed in Phase 3.

### Phase 3 — Label slot picker + leader callouts + bbox-aware wire labels
Commit `4a0602e` · `lib/sld-v2/labels.ts` (345 LOC) + SldRenderer/Tyson harness updates
- `placeLabels(laidOut, edges, options)` — greedy 4-slot assignment. For each equipment in label-priority order, walks its slots N→W in priority order, fits labels by `maxLines`/`maxLineWidth`, checks each combined-slot bbox against cumulative occupied set (other equipment + edge segments + already-placed labels). Slot rejected if any line exceeds `maxLineWidth` OR combined bbox overlaps occupied.
- Orphan labels (no slot accepts them) → ONE grouped leader callout per equipment (numbered cyan circle anchored on equipment + dashed leader line + multi-line label in `freeZone`). Earlier draft created one callout per orphan and stacked numbered circles on the equipment center — fixed before commit.
- `SldRenderer.midpoint()` upgraded to **bbox-aware**: iterates segments longest-first, picks first one whose LABEL bbox (not just midpoint) doesn't overlap any equipment. Returns null when no segment works; caller skips the label.
- Tyson rerun: 119 texts, 92 rects, **0 text-text overlaps**, 5 label slots filled, 2 leader callouts.

### Phase 4 — PlansetData → EquipmentGraph adapter
Commit `b599231` · `lib/sld-v2/from-planset-data.ts` (548 LOC) + 11-test contract suite + `scripts/render-sld-v2-from-planset.tsx`
- `equipmentGraphFromPlansetData(data, options?)` — main entry point.
- Topology dispatch: `isDuracellHybrid(data)` (matches `inverterModel` against /duracell.*(hybrid|pc.max)/i) → full hybrid graph. Other topologies (string-MPPT, micro-inverter) → empty graph + warn note (Phase 7 fills).
- Builders: `pvArrayFromData`, `rsdFromData` (elided when `rapidShutdownModel = 'INTEGRATED'`), `dcJunctionBox`, `hybridInvertersFromData` (one per `data.inverterCount`), `batteryStacksFromData` (split by `batteriesPerStack`), `pvDisconnect`, `genDisconnect`, `mspFromData`, `serviceDisc`, `meterFromData`, `backupPanel`.
- Connection graph: PV → RSD → DC JB → each hybrid (PV-DC) ; each hybrid → its battery stack (battery-DC fused) ; each hybrid → PV Disc (AC out) ; hybrid #1 → Backup Loads Panel (backup AC) ; PV Disc + Gen Disc → MSP → Service Disc → Meter.
- NEC compliance warnings (705.12(B)(2)(b)(2) backfeed compliance, 690.7 max system voltage) surface as `graph.notes` for renderer/operator visibility.
- 11 tests covering full equipment cast, per-inverter hybrid emission, per-stack battery split, 3-disconnect role coverage, MSP busbar+main+backfeed math, port id validity across connections, non-Duracell graph + warn note, INTEGRATED RSD elision, NEC warning emission.

### Post-Phase-4 test fix
Commit `4acf3a9` · `__tests__/sld-v2/equipment.test.ts`
- Pre-existing test `quadPorts() prefixes ids when prefix provided` was asserting the OLD dash-separator port id format. Phase 2 changed it to dot-format (`msp-1.N` not `msp-1-N`) but the test didn't move with the convention. Caught by running the full repo vitest suite during handoff review.
- Updated assertion to dot-format + added side-specific id checks. Zero net regressions introduced by the session after this fix.

## Cumulative scorecard

| Stage | Texts | Rects | Overlaps | Aggregate sq px |
|-------|-------|-------|----------|------------------|
| r12 PV-5 (hand-positioned) | 335 | 103 | **42** | **5390** |
| sld-v2 Phase 2 (elkjs alone) | 106 | 96 | 1 | 16.5 |
| sld-v2 Phase 3 (+ slot picker) | 119 | 92 | **0** | **0** |
| sld-v2 Phase 4 (+ adapter, end-to-end) | 131 | 90 | **0** | **0** |

## Verification commands for the next operator

```bash
cd ~/repos/MicroGRID-planset-phase1

# Commit history check — should see 56ceba2 (Phase 7a handoff) at HEAD on origin
git log --oneline -14
git log origin/feat/planset-v8-layouts --oneline -1   # should match 56ceba2

# Typecheck the whole worktree (v1 + v2 must coexist clean)
npx tsc --noEmit

# Run v2 test suites — 40 tests pass total (Phases 0–4 = 38, Phase 5 = 2 new)
npx vitest run __tests__/sld-v2/

# Chain test baseline diff — confirm no new regressions vs this session's state
/opt/homebrew/bin/python3.12 ~/.claude/scripts/chain_test_baseline.py diff --repo $(pwd) --sha 8a5df39
# Expected: NEW_FAIL = 0 (16 pre-existing v1 sld-layout + SheetPV failures stay 16)

# Phase 0 — collision validator against r12 baseline (v1 hand-positioned)
/opt/homebrew/bin/python3.12 scripts/sld-collision-check.py ~/.claude/tmp/duracell-pv5-r12.html --mode text --top 10
# Expected: 42 overlaps, exit 1

# Phase 1.3 — render all 10 equipment-kind components
npx tsx scripts/render-sld-v2-all-kinds.tsx > ~/.claude/tmp/sld-v2-all-kinds.html
/opt/homebrew/bin/python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-all-kinds.html
# Expected: 0 overlaps, exit 0

# Phase 2/3 — Tyson topology via elkjs + slot picker
npx tsx scripts/render-sld-v2-tyson.tsx > ~/.claude/tmp/sld-v2-tyson.html
/opt/homebrew/bin/python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-tyson.html
# Expected: 119 texts, 92 rects, 0 overlaps, exit 0

# Phase 4 — full HTML pipeline from PlansetData
npx tsx scripts/render-sld-v2-from-planset.tsx > ~/.claude/tmp/sld-v2-from-planset.html
/opt/homebrew/bin/python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-from-planset.html
# Expected: 131 texts, 90 rects, 0 overlaps, exit 0

# Phase 5 — PDF pipeline (the new one this chain version shipped)
npx tsx scripts/render-sld-v2-pdf.tsx
# Expected: wrote ~/.claude/tmp/sld-v2-tyson.pdf (67,538 bytes)
strings ~/.claude/tmp/sld-v2-tyson.pdf | grep -c 'NEC 690.12'   # Expected: 4
strings ~/.claude/tmp/sld-v2-tyson.pdf | grep -c '/MediaBox \[0 0 1224. 792.\]'  # Expected: 1
open ~/.claude/tmp/sld-v2-tyson.pdf   # opens cleanly in Preview, vector zoom crisp

# Phase 5 — concurrency invariant (mutex serializes 3 parallel renders)
npx tsx scripts/sld-v2-pdf-concurrency-smoke.tsx
# Expected: "3-concurrent renders OK in ~3000ms — sizes 67538, 67538, 67538"
```

Staged screenshots on Desktop:
- `~/Desktop/sld-v2-mspbox.png` — MspBox standalone (clean + debug)
- `~/Desktop/sld-v2-all-kinds.png` — 10 equipment-kind components side-by-side
- `~/Desktop/sld-v2-tyson-phase3.png` — Tyson via elkjs with slot picker
- `~/Desktop/sld-v2-from-planset.png` — End-to-end PlansetData pipeline
- `~/Desktop/duracell-pv5-r12.png` — v1 final hand-positioned baseline (for PROJ-26922 PDF-edit path)

## Spec deltas discovered this session (Phase 7a)

One delta — the planset page's async-lift constraint:

- **`app/planset/page.tsx` is `'use client'`.** The plan assumed the parent could be a server component and `await` the elkjs layout inline. Reality is the parent is client-side (because of ZoomToolbar / OverridesPanel / interactive editing), so the async lift had to use `useEffect` + `useState<LayoutResult>` instead of server-await. Phase 7a's implementation does this with a graph-hash short-circuit (R1-H1 fix) so the memo() contract on SheetPV5 holds. Phase 7b should be aware: if a future renderer or shape needs to be computed async + passed down to a sheet, the `useEffect([data, useSldV2])` + `lastSldV2GraphHashRef` pattern is the established shape on this page.

## Older spec deltas — Phase 5

Four deltas, all caught by the pre-flight reviewer BEFORE code shipped and folded into the plan inline:

- **NEC text target** — original plan said `pdfgrep "NEC 705.13"` for the selectable-text verification; that string is **not emitted anywhere** in the v2 codebase. Live code emits `NEC 690.12(A)` (RSD label) and `NEC 705.12(B)` (MSP busbar). Phase 5 + Phase 6 + Phase 7 verifications should target `NEC 690.12`.
- **viewBox math** — original plan said "viewBox 1224×792 → 1:1 px:pt mapping". `SldRenderer.tsx` actually emits viewBox sized by elkjs's auto-layout output (variable per graph). Phase 5 pivoted to **aspect-preserved scale-to-fit** via `svg2pdf(svg, doc, {x, y, width, height})`. Phase 7 may upgrade to a fixed-canvas renderer when the title block lands.
- **Font path** — original plan said "bundle Inter ttf + register with jsPDF.addFont() in Phase 5". Inter bundling is moved to Phase 7. Phase 5 ships with the SVG declaring `font-family: 'Inter, Helvetica, sans-serif'` (via `rewriteFontFamily`) and jsPDF falls back to its built-in Helvetica (selectable, plan-checker-grep-able). When Phase 7 calls `jsPDF.addFont('Inter')`, the font automatically picks up — no other Phase 7 code change needed for typography.
- **`server-only` directive** — original plan said `import 'server-only'` at the top of `lib/sld-v2/pdf.ts` for SSR safety. The literal import errors under `npx tsx` harness execution outside Next.js. Phase 5 ships with a comment + naming-convention defense instead; Phase 6 should re-add the directive with a tsx loader shim or document the bundle-leak risk explicitly (R1-L1).

## Test baseline

Captured via `chain_test_baseline.py capture` against this session's final commit `62eaff7`:
- **3871 tests pass, 16 fail, 0 skipped** (Phase 7a HEAD)
- Cached at `~/.claude/data/chain_test_baselines/MicroGRID-planset-phase1-62eaff70109f-vitest.json`

Phase 7a diff vs the Phase 5 baseline (`8a5df3949028`): NEW_FAIL=0, STILL_FAIL=16, all 6 new sld-v2 tests pass. Phase 6 added ~10 tests (sld-v2 grew 46 → 50 + others), Phase 7a added 6 (sld-v2 50 → 56), for a cumulative +16 since the Phase 5 baseline.

### Older baseline — Phase 5

Captured against Phase 5's final commit `8a5df39`:
- **3855 tests pass, 16 fail, 0 skipped** (164 test files)
- Cached at `~/.claude/data/chain_test_baselines/MicroGRID-planset-phase1-8a5df3949028-vitest.json`

The 16 failing tests are PRE-EXISTING v1 sheet/layout failures NOT introduced by this session:
- `__tests__/lib/sld-layout.test.ts` — 13 failures in v1 SLD renderer (touches `renderSldFromSpec` and topology gating, not touched this session)
- `__tests__/components/planset/SheetPV1-120pct-banner.test.tsx` — 1 failure
- `__tests__/components/planset/SheetPV3-roof-plane.test.tsx` — 1 failure
- Plus 1 known-broken sld-v2 test that was caught + fixed in Phase-4 commit `4acf3a9` BEFORE baseline capture (the `quadPorts` dash→dot convention)

**At baseline capture vs pre-Phase-5 (commit `772b19d`)**: 163 files / 3853 pass / 16 fail → 164 files / 3855 pass / 16 fail. **+2 passing tests (the new `pdf.test.ts`), 0 net regressions.** Full chain history vs pre-pivot (commit `a6a2e88`): +40 passing tests (38 sld-v2 + 2 pdf).

To verify next session: `python3.12 ~/.claude/scripts/chain_test_baseline.py diff --repo $(pwd) --sha 8a5df39` — should report `NEW_FAIL = 0`.

The collision-check r12 baseline at 42 overlaps / 5390 sq px is the OTHER objective baseline — the visual-regression number for Phase 7 RUSH-stamping comparison.

## Status table

- ✅ Phase 0 — Collision validator
- ✅ Phase 1.1 — Equipment model (27 tests)
- ✅ Phase 1.2 — MspBox PoC
- ✅ Phase 1.3 — 9 more components + all-kinds harness
- ✅ Phase 2 — elkjs adapter + SldRenderer
- ✅ Phase 3 — Label slot picker + leader callouts + bbox-aware wire labels
- ✅ Phase 4 — PlansetData adapter (11 tests)
- ✅ Phase 5 — SVG → PDF export (`lib/sld-v2/pdf.ts`) — 2026-05-13 09:35 UTC
- ✅ Phase 6 — feature-flag + nodeOverrides + `/api/sld/v2/[projectId]` route — 2026-05-13 10:15 UTC
- ✅ **Phase 7a — per-project use_sld_v2 column + 3-arg flag + SheetPV5 inline v2 swap — 2026-05-13 11:20 UTC**
- ☐ Phase 7b — Title block + Inter ttf + ESLint no-restricted-imports rule + Tyson-temp cleanup + RUSH stamp pilot pick
- ☐ Phase 7.x — Fill `StringInverterBox` / `MicroInverterBox` / `EVChargerBox` (deferred kinds)
- ☐ PROJ-26922 stamp unblock — PDF-edit r12 hand-tweak (Atlas-side, not blocked by v2)

## Audit gates (Phase 7a)
- Pre-apply (migration-planner, migration 221): **GO Grade A** (0C / 0H / 0M / 1L) — 1 Low was a planning-accuracy note (brief overstated row count: said 50k, actual 3,297). PG17 metadata-only path; RLS column-agnostic; rollback clean. Applied via Supabase MCP after GO.
- R1 (red-teamer, shipped code): **B** (0C / 1H / 3M / 2L) — all folded inline (H1: memo break via graph-hash short-circuit; M1: stale topology-gate comment; M2: case-insensitive contract tests; M3: type-regen safety documented in Open follow-ups; L1/L2: informational). Deferred: M3 type-regen hardening → Phase 7b.
- R2 (verify, post-fix): **A** (typecheck=0 + 56/56 sld-v2 vitest + baseline diff NEW_FAIL=0)

## Audit gates (Phase 6)
- R1 (red-teamer, shipped code): **B** (0C / 1H / 4M / 4L) — all folded inline (H1: opaque 500; M1: resolve+prefix check; M2: schema validation incl. null-proto + finite-number coords; M3: page-count regex anchored to `>>`; M4: lowercase URL value compare; L4 tighten: NEC ≥1 separator). Deferred: L1/L2/L3 (ESLint enforcement → Phase 7), cost-basis sibling 500-leak → action #998.
- R2 (verify, post-fix): **A** (typecheck=0 + 46/46 sld-v2 vitest + baseline diff NEW_FAIL=0)
- R3 (self-audit, requested by Greg post-R2): **2 catches** — (M) missed Phase 5 R1-M6 topology gate (`isDuracellHybrid` check before `renderSldToPdf`), (M) no tests for R1-M2 schema-validation rejection paths. Both fixed inline in commit `9b39826`. Red-teamer on R3 delta: **A** (0/0/0/2 — gitignored TEST-*.json fixtures inline, 422-detail-string Low deferred as cosmetic). Test count 46 → 50.

## Audit gates (Phase 5)
- Pre-flight (general-purpose, plan vs live state): GO-WITH-EDITS (0C+0H+0M+0L after fixes; original 2C+6H+6M+5L all folded inline)
- R1 (red-teamer, shipped code): **C** (0C / 4H / 6M / 3L) — deferred: M3, M4, M6, L1, L2, L3 (Phase 6 hygiene — M3/M4/M6/L1 folded in Phase 6 commit `2d826cb`)
- R2 (self-verify, fixes): **A** (typecheck + 40/40 vitest + concurrency smoke confirm no regression)

## Live state worth knowing

- **Branch status**: `feat/planset-v8-layouts` HEAD = `56ceba2`, **origin matches (0 commits ahead)**. The chain has now landed Phases 0 → 7a inclusive. Key SHAs by phase: Phase 0 (`3a6772f`), Phase 1.1 (`45fc446`), Phase 1.2 (`ac9a49f`), Phase 1.3 (`e354536`), Phase 2 (`5211656`), Phase 3 (`4a0602e`), Phase 4 (`b599231`), Phase 5 (`8a5df39`), Phase 6 (`2d826cb`), Phase 6 R3 fix (`9b39826`), Phase 6 close-out (`c7e1c3a`), **Phase 7a (`62eaff7`)**. Each phase has at least one trailing docs commit refreshing this handoff.
- **Python**: `scripts/sld-collision-check.py` REQUIRES `/opt/homebrew/bin/python3.12`. System `python3.14` has a broken `pyexpat` binding from a libexpat ABI mismatch. Don't waste time debugging that.
- **Port id convention (v2 only)**: `quadPorts(prefix)` now emits dot-format ids — `pv.N`, `pv.S`, `pv.E`, `pv.W`. Connections reference them directly: `Connection.from = "pv.E"`, `Connection.to = "rsd.W"`. ELK consumes these untouched.
- **Routing path**: `lib/sld-layout.ts` still routes everything to v1 specs (`rush-spatial.json`, `legacy-string-mppt.json`, `sonnen-microinverter.json`). v2 path is reachable ONLY via the standalone harnesses (`scripts/render-sld-v2-*.tsx`) and the new Phase 5 `renderSldToPdf()` API. Phase 6 adds the production feature flag + the first real Next.js API route.
- **NEC warnings**: Phase 4 adapter surfaces `graph.notes` for non-compliance. Renderer doesn't yet PAINT these notes — **deferred to Phase 7** alongside the title block + Inter ttf registration.
- **PDF font behavior** (Phase 5): every `<text>`/`<g>`/`<tspan>` carries `font-family="Inter, Helvetica, sans-serif"`. Inter ttf is NOT yet registered with jsPDF, so the actual rendered font is jsPDF's built-in Helvetica (Type 1 standard, no embed). When Phase 7 calls `jsPDF.addFont('Inter')`, the font automatically switches — no other code change required.
- **PDF concurrency** (Phase 5): `renderSldToPdf` uses a module-level promise-chain mutex to serialize concurrent calls that swap `globalThis.window` / `document`. Test env (jsdom present) bypasses the mutex. Concurrency smoke at `scripts/sld-v2-pdf-concurrency-smoke.tsx` verifies 3 parallel renders → byte-identical PDFs.
- **`canvas` is a native dep** added in Phase 5 — Phase 6's Next.js API route MUST declare `export const runtime = 'nodejs'` (NOT edge) or `canvas` won't load. Cold-start cost ~200-500ms on Vercel; warm calls are fast.
- **PROJ-26922 stamping path** (per Greg's plan-approval decisions): r12 SLD ships to RUSH via PDF hand-edit (Affinity/Illustrator). v2 builds in parallel; doesn't block stamping revenue.
- **Visual companion**: brainstorm server live at `http://localhost:58479` while this session was active (boots from `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/brainstorming/scripts/start-server.sh --project-dir <repo> --background`). Auto-killed when host reboots; re-boot at session start for any iterative visual work.

## Open follow-ups

(Read each `python3 ~/.claude/scripts/greg_actions.py show <id>` before working on it — pre-resolution gate per chain rule.)

- ~~#1012 (P2)~~ — closed 2026-05-13 16:21 UTC ("Phase 7a shipped, commits pushed, audits A/B/A").
- **R1-M3 deferral (no action ID yet) — type-regen safety on `as Project` cast.** `route.ts:104` casts the Supabase row to `Project`. If `types/database.ts` is ever regenerated via `mcp__claude_ai_Supabase__generate_typescript_types` and the regeneration drops the hand-written `use_sld_v2` field, the route silently breaks. Current runtime is safe-by-default (strict `=== true` check), but the type-system regression is invisible. Phase 7b should either (a) add a runtime guard before the cast, (b) migrate to the fully-generated `Database['public']['Tables']['projects']['Row']` type, or (c) add a vitest fixture that asserts `Project` has `use_sld_v2`.
- ~~#996 (P2)~~ — closed at Phase 7a pickup ("Phase 6 fully shipped, housekeeping complete pre-Phase-7a").
- ~~#998 (P2)~~ — closed by prior session's `c7e1c3a` (cost-basis 500-leak now returns opaque message + correlation id).
- ~~#1006 (P2)~~ — closed by prior session's `c7e1c3a` (`midpoint()` avoidance + two-pass renderer eliminates cross-edge label overdraw).

## Next phase to pick up

### ⬅ Phase 7b (next session) — drafting-quality polish + RUSH stamp pilot

Phase 7a shipped the per-project cutover infrastructure. Phase 7b finishes the v2 PDF into RUSH-stamp-ready shape and sends the first one for stamp.

**Decisions Greg must answer before this phase starts:**

1. **RUSH stamp pilot project — pick one.**
   - The deferred decision from Phase 7. v2 is now wired end-to-end (PDF route + inline SheetPV5 render); Phase 7b will flip `use_sld_v2=true` on a live project, regenerate, and ship to RUSH.
   - Candidates: pick any active project that needs a stamp soon. PROJ-26922 (Tyson) is reserved for the v1 PDF-edit path so RUSH doesn't see two outputs for the same job — don't pick Tyson.
   - **No default** — Greg picks.

2. **Title block — match v1 `TitleBlockHtml` exactly, or new design?**
   - v1 renders a 2.5"×10.5" right-column title block per `SheetPV5.tsx:170`. v2 currently inherits it (the v2 early-return in Phase 7a keeps the same outer chrome).
   - For the PDF route (`renderSldToPdf` in `lib/sld-v2/pdf.ts`), there's no title block today — the PDF is single-page SLD-only. Phase 7b should paint one inside `renderSldToPdf` using jsPDF text() calls.
   - (a) Mirror `TitleBlockHtml` layout in the PDF — same fields, same proportions. Predictable for RUSH.
   - (b) Design a new title block tuned for the v2 PDF page (1224×792 pt, landscape) — extra room for NEC notes box.
   - **Default: (a)** — match v1 first; iterate after RUSH feedback.

3. **Inter ttf bundling — single weight or family?**
   - Phase 5's `rewriteFontFamily` declares `font-family: 'Inter, Helvetica, sans-serif'` in every text element. Phase 7b registers Inter with jsPDF via `addFont()`.
   - (a) Bundle Inter Regular only (~340 KB ttf). Bold/italic fall back to Helvetica.
   - (b) Bundle Inter Regular + Bold (~680 KB). Title block can use Bold for headings.
   - **Default: (a)** — Regular only; revisit if RUSH dings the typography hierarchy.

4. **ESLint `no-restricted-imports` rule on `renderSldToPdf` — strict or warn?**
   - Phase 6 R1-L3 deferral: prevent `renderSldToPdf` import from anywhere except `app/api/sld/v2/**/route.ts`. Prevents accidental bundle-leak (server-only + jsdom + canvas drag-in to client).
   - (a) `error` severity — block the build.
   - (b) `warn` severity — surface but don't gate.
   - **Default: (a)** error — server-only invariant is load-bearing for bundle size.

**Phase work:**

- Land Decision 1 — pick pilot project, flip `use_sld_v2=true` in the dashboard.
- Land Decision 2/3 — title block paint inside `renderSldToPdf`; Inter ttf at `lib/sld-v2/fonts/Inter-Regular.ttf` (+ Bold if 3b chosen); `jsPDF.addFont()` registration.
- Land Decision 4 — ESLint rule at `.eslintrc.json` (or `eslint.config.js`).
- Paint `graph.notes` (NEC compliance warnings emitted by Phase 4 adapter) into the notes box alongside the title block.
- Remove `__TYSON_OVERRIDES_TEMP` from `lib/planset-types.ts:589-591` if PROJ-26922's v1 path is no longer needed.
- Run the pilot through RUSH stamp. Iterate on redraw deltas.
- Handle R1-M3 type-regen safety (above) — pick (a)/(b)/(c) and ship.

**Estimated effort:** 2-3 days, mostly typography iteration + RUSH-feedback round.

### ⬅ Phase 7.x (deferred — not blocking) — missing equipment kinds

- Fill `StringInverterBox` / `MicroInverterBox` / `EVChargerBox` when the first live non-Duracell project hits the v2 path (`isDuracellHybrid` gate at route line 108 will 422 until then).

## Specific gotchas for the next operator

- **Branch is pushed.** 12 commits live on `origin/feat/planset-v8-layouts` as of 2026-05-13 09:50 UTC. Any new commits in Phase 6 still need Greg's per-push auth per CLAUDE.md / `feedback_no_mid_session_push.md`. No mid-session pushes.
- **Boot the visual companion at session start.** Standing rule from 2026-05-08 (`feedback_visual_companion_for_phased_builds.md`). Run `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/brainstorming/scripts/start-server.sh --project-dir ~/repos/MicroGRID-planset-phase1 --background` and push HTML + PDF artifacts to its content dir. Phase 5 missed this at start; don't repeat.
- **Python 3.14 is broken** for `scripts/sld-collision-check.py` because of the libexpat ABI mismatch. Always use `/opt/homebrew/bin/python3.12`. Don't be tempted to "fix" Python 3.14 — that's a system-level pyexpat rebuild and not what you're here for.
- **Port id format is dot-separated** in v2 (`pv.N`) but `eq-N` in some asset-internal anchor manifests. If you write a new equipment component, keep the asset-internal anchors using the EQUIPMENT id format (e.g. `<g id="${msp.id}-N">`) — those are for human/debug inspection only; ELK reads the dot-format port ids you declared in `equipment.ports[]`.
- **The `placeLabels` slot picker assumes default slot priorities N>S>E>W.** If you customize `labelSlots[]` per equipment kind in Phase 7, keep the convention so the same equipment-priority logic in the picker keeps making sense.
- **`graph.notes` are emitted but not rendered.** Phase 7 paints them in a notes box alongside the title block. Until then, they're invisible — only `console.log` or the renderer footer will surface them. Phase 6's API route should still return them in a response header or sidecar JSON if Phase 6 needs them surfaced earlier.
- **`canvas` is a native dep.** Phase 6's API route MUST declare `export const runtime = 'nodejs'`. Edge runtime won't load `canvas`. Cold-start cost ~200-500ms on Vercel.
- **`renderSldToPdf` is server-only by convention, not by directive.** Comment in `lib/sld-v2/pdf.ts` documents why; Phase 6 should either re-add `import 'server-only'` with a tsx loader shim or accept the bundle-leak risk explicitly.
- **r12 PV-5 SLD has known residuals** (MSP internal collisions are in the SVG component, not the spec) — those are intentionally out of scope for r12 cleanup. If you reopen v1 hand-positioning work, you're walking back the architectural pivot — don't.
- **The two-canvas iteration loop is dead.** If a future session brings in canvas patches against `rush-spatial.json`, REDIRECT to the v2 path. The r12 commit + PDF-edit unblock is the v1 final state.
- **`@react-pdf/renderer@^4.4.1` is in active production use** for `app/api/invoices/[id]/send/route.ts` and `app/api/projects/[id]/cost-basis/pdf/route.ts`. DO NOT remove it. It's the financial-PDF code path, intentionally decoupled from the SLD PDF pipeline (`renderSldToPdf` uses jsPDF + svg2pdf.js).
- **Untracked-but-fine files in the worktree:** `scripts/__pycache__/` (Python compile cache) and `.superpowers/brainstorm/<port>-<pid>/` (visual companion runtime). Both should probably be added to `.gitignore` in Phase 6's first commit but neither is load-bearing today.

## Reference

- **Plan doc**: `~/.claude/plans/smooth-mixing-milner.md` (Greg-approved 2026-05-12)
- **Phase 5 session plan**: `~/.claude/plans/humming-tumbling-wozniak.md`
- **Phase 5 pre-flight review**: `/tmp/planset-phase-5-plan-review.md`
- **Tyson reference PDF**: `~/Desktop/PROJ-26922 Corey Tyson Rev1.pdf` (drafting-quality reference, not equipment reference)
- **Phase 5 PDF output**: `~/.claude/tmp/sld-v2-tyson.pdf` (67,538 bytes, 1 page, 4× NEC 690.12 hits)
- **Recap (Phase 5)**: HQ `atlas_session_recaps` id 482; local fallback at `~/.claude/projects/-Users-gregkelsch/memory/session_recaps.md` (newest first)
- **HQ recap UI**: hq.gomicrogridenergy.com/recaps
- **HQ actions UI**: hq.gomicrogridenergy.com/actions

---

**End of handoff. Next session: chain audit (verify Phase 5), boot visual companion, plan-mode on Phase 6 decisions, ship Phase 6. Update this file. Pass it forward.**
