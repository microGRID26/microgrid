# Chain handoff — planset

**Topic:** planset
**Last updated:** 2026-05-12 ~17:15 UTC (sld-v2 Phases 0–4 shipped + test fix, architectural pivot complete)
**Project:** MicroGRID
**Worktree:** `~/repos/MicroGRID-planset-phase1`
**Branch:** `feat/planset-v8-layouts` — **10 local commits ahead of origin**, NONE pushed (per Greg's per-push auth rule)
**Latest pushed commit:** `a6a2e88` chore(planset): chain handoff + atomic patcher helper for cross-session pickup
**Latest local commit:** `4acf3a9` test(sld-v2): update quadPorts test to dot-format ids (Phase 2 convention)

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

## ✅ Shipped this session (2026-05-12, ~6 hours)

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

# Commit history check — should see Phases 0–4 + r6-r12 v1 history
git log --oneline -12

# Typecheck the whole worktree (v1 + v2 must coexist clean)
npx tsc --noEmit

# Run v2 test suites — 38 tests pass total
npx vitest run __tests__/sld-v2/

# Chain test baseline diff — confirm no new regressions vs this session's state
python3.12 ~/.claude/scripts/chain_test_baseline.py diff --repo $(pwd) --sha 4acf3a9
# Expected: NEW_FAIL = 0 (16 pre-existing failures stay 16)

# Phase 0 — collision validator against r12 baseline
python3.12 scripts/sld-collision-check.py ~/.claude/tmp/duracell-pv5-r12.html --mode text --top 10
# Expected: 42 overlaps, exit 1

# Phase 1.3 — render all 10 equipment-kind components
npx tsx scripts/render-sld-v2-all-kinds.tsx > ~/.claude/tmp/sld-v2-all-kinds.html
python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-all-kinds.html
# Expected: 0 overlaps, exit 0

# Phase 2/3 — Tyson topology via elkjs + slot picker
npx tsx scripts/render-sld-v2-tyson.tsx > ~/.claude/tmp/sld-v2-tyson.html
python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-tyson.html
# Expected: 119 texts, 92 rects, 0 overlaps, exit 0

# Phase 4 — full pipeline from PlansetData
npx tsx scripts/render-sld-v2-from-planset.tsx > ~/.claude/tmp/sld-v2-from-planset.html
python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-from-planset.html
# Expected: 131 texts, 90 rects, 0 overlaps, exit 0
```

Staged screenshots on Desktop:
- `~/Desktop/sld-v2-mspbox.png` — MspBox standalone (clean + debug)
- `~/Desktop/sld-v2-all-kinds.png` — 10 equipment-kind components side-by-side
- `~/Desktop/sld-v2-tyson-phase3.png` — Tyson via elkjs with slot picker
- `~/Desktop/sld-v2-from-planset.png` — End-to-end PlansetData pipeline
- `~/Desktop/duracell-pv5-r12.png` — v1 final hand-positioned baseline (for PROJ-26922 PDF-edit path)

## Spec deltas discovered this session

(none — Phases 0–4 followed the plan exactly; no scope corrections needed)

## Test baseline

Captured via `chain_test_baseline.py capture` against this session's final commit `4acf3a9`:
- **3853 tests pass, 16 fail, 0 skipped** (163 test files)
- Cached at `~/.claude/data/chain_test_baselines/MicroGRID-planset-phase1-4acf3a978089-vitest.json`

The 16 failing tests are PRE-EXISTING v1 sheet/layout failures NOT introduced by this session:
- `__tests__/lib/sld-layout.test.ts` — 13 failures in v1 SLD renderer (touches `renderSldFromSpec` and topology gating, not touched this session)
- `__tests__/components/planset/SheetPV1-120pct-banner.test.tsx` — 1 failure
- `__tests__/components/planset/SheetPV3-roof-plane.test.tsx` — 1 failure
- Plus 1 known-broken sld-v2 test that was caught + fixed in commit `4acf3a9` BEFORE baseline capture (the quadPorts dash→dot convention)

**At baseline capture vs pre-session (commit `a6a2e88`)**: 161 files / 3815 pass / 16 fail → 163 files / 3853 pass / 16 fail. **+38 passing tests (the new sld-v2 suites), 0 net regressions.**

To verify next session: `python3.12 ~/.claude/scripts/chain_test_baseline.py diff --repo $(pwd) --sha 4acf3a9` — should report `NEW_FAIL = 0`.

The collision-check r12 baseline at 42 overlaps / 5390 sq px is the OTHER objective baseline — the visual-regression number for Phase 7 RUSH-stamping comparison.

## Status table

- ✅ Phase 0 — Collision validator
- ✅ Phase 1.1 — Equipment model (27 tests)
- ✅ Phase 1.2 — MspBox PoC
- ✅ Phase 1.3 — 9 more components + all-kinds harness
- ✅ Phase 2 — elkjs adapter + SldRenderer
- ✅ Phase 3 — Label slot picker + leader callouts + bbox-aware wire labels
- ✅ Phase 4 — PlansetData adapter (11 tests)
- ☐ Phase 5 — SVG → PDF export (`lib/sld-v2/pdf.ts`)
- ☐ Phase 6 — `nodeOverrides` JSON spec + v1/v2 feature flag routing
- ☐ Phase 7 — Migrate PV-5 production path to v2 + RUSH stamp validation
- ☐ Phase 7.x — Fill `StringInverterBox` / `MicroInverterBox` / `EVChargerBox` (deferred kinds)
- ☐ PROJ-26922 stamp unblock — PDF-edit r12 hand-tweak (Atlas-side, not blocked by v2)

## Live state worth knowing

- **Branch status**: `feat/planset-v8-layouts` **10 commits ahead of origin**, NONE pushed. Greg authorizes each push explicitly per CLAUDE.md. The 10 are: r6-r8 v1 cleanup (7fc76c2), r9-r12 cleanup (883c0ee), Phase 0 (3a6772f), Phase 1.1 (45fc446), Phase 1.2 (ac9a49f), Phase 1.3 (e354536), Phase 2 (5211656), Phase 3 (4a0602e), Phase 4 (b599231), test fix (4acf3a9).
- **Python**: scripts/sld-collision-check.py REQUIRES `/opt/homebrew/bin/python3.12`. System `python3.14` has a broken `pyexpat` binding from a libexpat ABI mismatch. Don't waste time debugging that.
- **Port id convention (v2 only)**: `quadPorts(prefix)` now emits dot-format ids — `pv.N`, `pv.S`, `pv.E`, `pv.W`. Connections reference them directly: `Connection.from = "pv.E"`, `Connection.to = "rsd.W"`. ELK consumes these untouched.
- **Routing path**: `lib/sld-layout.ts` still routes everything to v1 specs (`rush-spatial.json`, `legacy-string-mppt.json`, `sonnen-microinverter.json`). v2 path is reachable ONLY via the standalone harnesses (`scripts/render-sld-v2-*.tsx`). Phase 6 adds the production feature flag.
- **NEC warnings**: Phase 4 adapter surfaces `graph.notes` for non-compliance. SldRenderer doesn't yet PAINT these notes — Phase 5 or Phase 7 work.
- **PROJ-26922 stamping path** (per Greg's plan-approval decisions): r12 SLD ships to RUSH via PDF hand-edit (Affinity/Illustrator). v2 builds in parallel; doesn't block stamping revenue.

## Open follow-ups

(Read each `python3 ~/.claude/scripts/greg_actions.py show <id>` before working on it — pre-resolution gate per chain rule.)

- (none filed against this session — Phase 5/6/7 are queued in the plan doc, not as `greg_actions` rows yet. File one when claiming a phase.)

## Next phase to pick up

### ⬅ Phase 5 (next session) — SVG → PDF export

**Decisions Greg must answer before this phase starts:**

1. **PDF library choice — confirm or override the plan default.**
   - (a) `svg2pdf.js` + `jsPDF` (plan default) — vector-preserving SVG to PDF, text remains selectable, lightweight. Worked well in research.
   - (b) Switch to `@react-pdf/renderer` — full PDF primitives, no SVG, but reimplementing the renderer in Page/View/Svg primitives is heavy.
   - (c) Server-side render via headless Chrome + print-to-PDF — production-grade, slower, more infrastructure.
   - **Default: (a)** unless you want hard pages with header/footer chrome generated by a dedicated PDF lib.

2. **Page size — sticking with ANSI B?**
   - Plan default: 11×17 landscape (1224×792 pt @ 72 DPI). Matches the v1 layout intent + RUSH's typical sheet size.
   - Alternative: ANSI D (22×34) for projects with denser SLDs. Defer to Phase 7+ if needed.
   - **Default: (a) ANSI B**.

3. **Font embedding strategy.**
   - (a) Subset Inter or Helvetica — RUSH plan-checkers grep PDF text, so a known font matters.
   - (b) Embed full Roboto — adds ~150KB to the PDF.
   - **Default: (a)** with Inter as the choice (free, modern, geometric).

4. **Should the renderer surface graph.notes (NEC warnings) on the sheet now, or wait for Phase 7?**
   - (a) Add a notes box bottom-left of every PDF — visible to RUSH at stamp review.
   - (b) Wait for Phase 7 and add it to the sheet template alongside the title block.
   - **Default: (b)** — keep Phase 5 narrow to PDF mechanics; sheet template work belongs in Phase 7.

**Phase work:**

- New: `lib/sld-v2/pdf.ts`
  - Function signature: `renderSldToPdf(graph: EquipmentGraph, options?): Promise<Uint8Array>`
  - Internally: runs `layoutEquipmentGraph` + `placeLabels`, builds SVG via `renderToStaticMarkup(<SldRenderer …/>)`, parses SVG into a DOM (jsdom or browser), feeds to `svg2pdf.js` → `jsPDF` instance → exports Uint8Array.
  - Page setup: ANSI B landscape, 72 DPI, viewBox 1224×792 → 1:1 pt mapping.
  - Title block: paint title-block strip from `graph.sheet.titleBlock` after the SLD is drawn (separate pass — title block is a fixed-position template, not part of the auto-layout).
- New: `scripts/render-sld-v2-pdf.tsx` — harness that takes a PlansetData stub → produces `~/.claude/tmp/sld-v2-test.pdf`.
- Tests in `__tests__/sld-v2/pdf.test.ts`: PDF byte signature check (`%PDF-1.`), page count = 1, page dimensions = 1224×792 pt. Skip strict pixel-equivalence — that's a Phase 7 visual regression concern.

**Verification end-state:**
- `open ~/.claude/tmp/sld-v2-test.pdf` opens cleanly in Preview / Acrobat
- `pdfgrep "NEC 705.13" ~/.claude/tmp/sld-v2-test.pdf` returns a hit (text-selectable)
- Vector zoom at 400% is crisp (not raster)
- File size < 200 KB for a single-page SLD

**Estimated effort:** 1 day focused work.

### ⬅ Phase 6 (after Phase 5) — nodeOverrides + v1/v2 feature flag routing

**Decisions Greg must answer before this phase starts:**

1. **Per-project or per-sheet feature flag?**
   - (a) Per-project field on the DB row (`use_sld_v2: boolean`).
   - (b) Per-sheet env flag or URL query param (`?sld=v2`).
   - **Default: (b) initially** for testing; promote to (a) once Phase 7 has 10+ projects validated.

2. **nodeOverrides JSON spec — where does it live?**
   - (a) Inline on the EquipmentGraph spec file (when one exists per-project).
   - (b) Separate `<project-id>-overrides.json` in `lib/sld-v2/overrides/`.
   - (c) DB column (`sld_v2_node_overrides jsonb`).
   - **Default: (b)** for now; promote to (c) once 10+ projects need overrides.

**Phase work:**

- Extend `lib/sld-layout.ts` with a v2 path that routes based on the feature flag.
- New spec format: declarative `EquipmentGraph` JSON (much smaller than the 270-element hand-positioned spec — just equipment list + connections + nodeOverrides).
- Migration: keep v1 generator running for backward compat. Cut over per sheet via flag.

**Estimated effort:** 1-2 days.

### ⬅ Phase 7 (after Phase 6) — PV-5 production migration

Migrate PV-5 SLD to the v2 path for live projects. Send v2-generated PV-5 PDF to RUSH for stamp. If they stamp without redraw → migrate PV-3 (site plan), PV-3.1 (equipment elevation), PV-6+. If they redraw → diff their redraw against our output, fold deltas into v2 conventions, re-submit.

**Also in Phase 7:** fill the 3 deferred equipment kinds (`StringInverterBox`, `MicroInverterBox`, `EVChargerBox`) when their first project hits.

**Estimated effort:** 3-5 days.

## Specific gotchas for the next operator

- **DO NOT push** the local commits without Greg's explicit auth per CLAUDE.md / `feedback_no_mid_session_push.md`. The 9 ahead include the architectural pivot — Greg may want to review before publish.
- **Python 3.14 is broken** for `scripts/sld-collision-check.py` because of the libexpat ABI mismatch. Always use `/opt/homebrew/bin/python3.12`. Don't be tempted to "fix" Python 3.14 — that's a system-level pyexpat rebuild and not what you're here for.
- **Port id format is dot-separated** in v2 (`pv.N`) but `eq-N` in some asset-internal anchor manifests. If you write a new equipment component, keep the asset-internal anchors using the EQUIPMENT id format (e.g. `<g id="${msp.id}-N">`) — those are for human/debug inspection only; ELK reads the dot-format port ids you declared in `equipment.ports[]`.
- **The `placeLabels` slot picker assumes default slot priorities N>S>E>W.** If you customize `labelSlots[]` per equipment kind in Phase 7, keep the convention so the same equipment-priority logic in the picker keeps making sense.
- **`graph.notes` are emitted but not rendered.** Phase 5 or 7 needs to paint them in a notes box. Until then, they're invisible — only `console.log` or the renderer footer will surface them.
- **r12 PV-5 SLD has known residuals** (MSP internal collisions are in the SVG component, not the spec) — those are intentionally out of scope for r12 cleanup. If you reopen v1 hand-positioning work, you're walking back the architectural pivot — don't.
- **The two-canvas iteration loop is dead.** If a future session brings in canvas patches against `rush-spatial.json`, REDIRECT to the v2 path. The r12 commit + PDF-edit unblock is the v1 final state.

## Reference

- **Plan doc**: `~/.claude/plans/smooth-mixing-milner.md` (Greg-approved 2026-05-12)
- **Tyson reference PDF**: `~/Desktop/PROJ-26922 Corey Tyson Rev1.pdf` (drafting-quality reference, not equipment reference)
- **Recent recap**: `~/.claude/projects/-Users-gregkelsch/memory/session_recaps.md` (Recap 402)
- **HQ recap UI**: hq.gomicrogridenergy.com/recaps
- **HQ actions UI**: hq.gomicrogridenergy.com/actions

---

**End of handoff. Next session: chain audit, then plan-mode, then ship Phase 5. Update this file. Pass it forward.**
