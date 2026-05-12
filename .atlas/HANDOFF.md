# Chain handoff — planset

**Topic:** planset
**Last updated:** 2026-05-12 ~15:30 UTC (PV-5 stamp-ready, r6–r8 complete, LOCAL commit pending push auth)
**Project:** MicroGRID
**Worktree:** `~/repos/MicroGRID-planset-phase1`
**Branch:** `feat/planset-v8-layouts` (pushed to origin through `a6a2e88`; new local commit pending)
**Latest pushed commit:** `a6a2e88` chore(planset): chain handoff + atomic patcher helper for cross-session pickup
**Latest local commit:** (filed this session — see "Where we are right now" below)

## The chain in one paragraph

Multi-session, multi-canvas effort to bring the MicroGRID planset generator output from "10 pages of mostly-empty placeholders" to RUSH-Engineering-stamp-ready drafting quality. Reference benchmark = `PROJ-26922 Corey Tyson Rev1.pdf` (36 pages, RUSH-stamped). Forward equipment baseline = Seraphim SRP-440-BTD-BG + Duracell PC Max Hybrid 15kW × 2 + 16× Duracell 5kWh LFP (80 kWh) — NOT the legacy Sonnen+micro topology in the Tyson PDF. Tyson PDF is the drafting-quality reference, not the equipment reference.

## Operating model (don't relitigate)

Greg's CC max usage is running low — this two-canvas autonomous loop was designed so iteration can continue without Greg in the middle of every round.

Two Claude Design canvases (one per account) iterate autonomously on JSON spec patches against `lib/sld-layouts/*.json` and individual sheet TSX components. Atlas (Claude Code) serves as render-eyes:
1. Canvas emits `=== JSON PATCHES: <file> ===` block in chat
2. Greg pastes patches to Atlas
3. Atlas applies via Python script (atomic, no index-drift bugs) — see "Patch application pattern" below
4. Atlas re-renders to PNG via chrome-devtools MCP, stages on `~/Desktop/duracell-pv5-r<N>.png`
5. Greg drags PNG into canvas
6. Canvas eyeballs visual diff, emits next round
7. Loop until canvas declares done with `=== HANDOFF TO NEXT CANVAS ===` block

## Chain-mode discipline rule

**Stay on PV-5 polish only until Greg signs off.** No drift to PV-2 / PV-4 / PV-6 / PV-7 / PV-8 polish. No "while I'm in here" cleanup. Other sheets are queued behind PV-5 in the brief but explicitly paused.

## Patch application pattern (the load-bearing detail)

Sequential text-Edit calls against the JSON file drift indices after each insert/remove and corrupt syntax. **Always use the atomic Python helper at `scripts/spec-patcher.py`** (in this worktree, written 2026-05-12 for chain pickup).

Each patch round = one Python block, run via `python3 << 'PYEOF' ... PYEOF` from the worktree root. Pattern:

```python
import sys; sys.path.insert(0, 'scripts')
from spec_patcher import load_spec, save_spec, find_idx_by_text, find_idx_by_asset, find_idx_by_line_label

spec, elements = load_spec('lib/sld-layouts/rush-spatial.json')

# text edit by exact-match
i = find_idx_by_text(elements, '(N) PROTECTED LOAD PANEL')
elements[i]['text'] = '(N) BACKUP LOADS PANEL'

# remove cluster (anchor + count)
i = find_idx_by_asset(elements, 'eaton-dg221urb', x=680, y=430)
to_drop = set(range(i, i + 6))
elements = [e for j, e in enumerate(elements) if j not in to_drop]

# insert after anchor
anchor = find_idx_by_text(elements, 'NEMA 3R · INDOOR/OUTDOOR')
new_block = [{"type": "svg-asset", "assetId": "...", ...}, ...]
elements = elements[:anchor+1] + new_block + elements[anchor+1:]

save_spec('lib/sld-layouts/rush-spatial.json', spec, elements)
```

The helper exposes: `find_idx_by_text`, `find_idx_by_text_contains`, `find_idx_by_asset`, `find_idx_by_line_label`, `find_all(predicate)`, `section_bounds(label)`, `list_sections()`, `dump_section(label_contains)`. **Match by content, never by hardcoded index** — indices drift after every round.

## Render → screenshot pipeline (exact sequence)

```bash
# 1. Re-render after patches
cd ~/repos/MicroGRID-planset-phase1
npx tsx scripts/render-duracell-sld.tsx > ~/.claude/tmp/duracell-pv5-r<N>.html

# 2. Open in chrome via chrome-devtools MCP (do NOT use Playwright — local OK either way but the convention is chrome-devtools)
#    mcp__chrome-devtools__new_page  url="file:///Users/gregkelsch/.claude/tmp/duracell-pv5-r<N>.html"
#    OR if a tab already open:
#    mcp__chrome-devtools__navigate_page  type="url"  url="..."

# 3. Take full-page screenshot
#    mcp__chrome-devtools__take_screenshot  filePath="/Users/gregkelsch/.claude/tmp/duracell-pv5-r<N>.png"  fullPage=true

# 4. Stage for Greg to drag into canvas
cp ~/.claude/tmp/duracell-pv5-r<N>.png ~/Desktop/duracell-pv5-r<N>.png
```

Greg drags the staged PNG from `~/Desktop/` into the Claude Design canvas chat. Without that drag, the canvas iterates blind against the prior render.

**Account A** (`greg@gomicrogridenergy.com`) — owns the SLD line. Spent ~85% budget on PV-5 across 5 rounds. **DONE** for PV-5. Canvas A's handoff at `~/.claude/plans/planset-canvas-handoff.md`.

**Account B** (`gregkelsch@gmail.com`) — fresh budget, picking up r6 polish on PV-5. Brief paste + r6 critique drafted as of 2026-05-12 14:45 UTC. Greg starts a new chat in the gmail-account browser tab, drags 3 files from desktop (brief .md, Tyson PDF, r5 render PNG), pastes the r6 message, sends.

## Locked decisions (no relitigation)

- Equipment baseline: 20× Seraphim 440W, 2× Duracell PC Max Hybrid 15kW, 16× Duracell 5kWh LFP (80 kWh), IronRidge XR100, RSD-D-20 module-level
- Topology on SLD: ONLY new Duracell hybrid system (Q2=(a)). Existing micro-inverter arrays are decommissioned, never drawn.
- Tyson rev1 = drafting-quality reference, NOT equipment reference
- Target JSON file: `lib/sld-layouts/rush-spatial.json` (currently at v13, 265 elements). The route in `lib/sld-layout.ts`: `inverterCount <= 2 && systemTopology != 'micro-inverter'` → rush-spatial.json
- HQ address: `600 Northpark Central Dr Suite 140, Houston TX 77073` (NOT old Hardy Rd)
- Cyan `#22d3ee` only in title block + TAG callouts + sheet index. Never in drawing lines.
- PCS-limited output per NEC 705.13 — aggregate 145A export cap (72.5A/hybrid). UL 1741-SB grid-support listed.
- Customer: RUSH Engineering reads first, stamps, forwards to AHJ. CAD-trained, picky. Optimize for stamp without redraw.

## What shipped this chain so far

**Commit `95923cf`** — 8 SVG assets for Duracell-hybrid topology (Seraphim module, Duracell hybrid inverter, Duracell battery stack, DPC cabinet frame, production CT, e-stop, ethernet switch, homeowner router). Wires into ASSET_REGISTRY — 22 of 22 v11-spec assetIds now resolve.

**Commit `19ee391`** — 4 sheet redrafts. PV-1 (cover, 3-column dense), PV-3 (drafted site survey + roof plan), PV-3.1 (drafted equipment elevation), PV-3.2 (new garage floor plan, 4 ortho views, NFPA 855). PlansetData type extended with 4 optional fields. Legacy props kept as backward-compat.

**Commit `fd5d17b`** — PV-5 SLD v13. 64 JSON patches across 5 iteration rounds. Header strip equipment text corrected (Seraphim 440 + dual Duracell hybrid + 80 kWh). PV array re-laid 12→20 modules in 2×10 grid. Sonnen residuals deleted (ESS Disc, DC JB-LS, Battery Combiner, PV Load Center — 17 elements). 2nd hybrid inverter + 2nd battery stack added. NEC 705.13 PCS-limit margin box. Inline title block (30 elements, x=1300 right column). 3 asset face edits (msp-225a, eaton-dg222nrb, eaton-dg222urb). New render harness `scripts/render-duracell-sld.tsx`.

## Where we are right now (chain pickup state)

**Status:** PV-5 SLD **stamp-ready per Account B canvas** (subject to Greg final eyeball on r8 render). Rounds r6/r7/r8 ran cleanly with Atlas as render-eyes; Account B at ~25% budget used (closed canvas anyway — work is done). v14 spec, 273 elements (was 265 at start of r6). All 10 of Greg's r5 critique points + all 5 Account A polish items resolved.

**Active task:** Greg eyeballs `~/Desktop/duracell-pv5-r8.png` against `~/Desktop/PROJ-26922 Corey Tyson Rev1.pdf` for drafting parity. Approve → push `feat/planset-v8-layouts` to origin (already pushed through `a6a2e88`; this session's commit needs explicit auth) → optional merge to main for Vercel deploy. Reject → file specific critique as JSON-patch-shaped feedback; reopen with a fresh canvas (don't rehydrate Account B's thread).

**r6–r8 work shipped (full inventory):**
1. ✅ PCS callout block relocated AC-SERVICE-interior → AC-SERVICE-bottom strip with dashed red rect (376, 344) w=340 h=24
2. ✅ MSP rated-plate labels pushed below asset (y=320/330/340)
3. ✅ Customer Gen Disc + PV Disc clusters staggered/trimmed; redundant rows deleted
4. ✅ MSP breaker-face labels shrunk 6.5pt → 5.5pt, x −4
5. ⚠️ Section-header label ghosting — element-level occluders no-op (labels render from `spec.sections[]` config upstream of element array). Filed P2 `#965` for renderer-side fix (planset-v9 sprint).
6. ✅ Header strip extended x=1250 → x=1490 (flush with title-block right column)
7. ✅ Callout #10 lifted (130, 580) → (130, 560), clears HYBRID #1 PC MAX header
8. ✅ T-junction dot added at (425, 380) r=1.8
9. ✅ Production CT relocated (540, 510/522/534) — out of Stack #2 AND PLP/BLP zones, short vertical leader stub (555, 540)→(555, 575)
10. ✅ Hybrid #1 BACKUP AC wire rerouted: y=370 corridor → y=460 corridor, clears AC SERVICE column

**Bonus housekeeping:**
- Version stamps synced v13 → v14 in 3 locations (idx=237 topology line, idx=258 REV row, idx=267 footer)
- Service Disc collapsed 4 rows → 2
- PV Disc trailing label trimmed "VISIBLE, LOCKABLE, LABELED 'AC DISCONNECT'" → "VISIBLE, LOCKABLE, LABELED — AC DISC"

**Open follow-ups filed (planset-v9 sprint):**
- `#965` P2 — Renderer: hug section labels to top frame edge (kill ghost-text). One-line `section.y + 14` → `section.y + 8` change. Addresses all 9 sections across every layout JSON.
- `#966` P2 — Harden `spec-patcher.py`: accept `expected_old` param, surface WARN when actual pre-state diverges. Anchor: r8 apply log showed `(540,510) -> (540,510)` for all 4 patches; render confirmed correct end state, but a real drift bug could land silently the same way.

## Files modified by this chain

```
components/planset/sld-assets/index.tsx                 # +8 new assetIds
components/planset/sld-assets/seraphim-pv-module.tsx    # NEW
components/planset/sld-assets/duracell-hybrid-inverter.tsx # NEW
components/planset/sld-assets/duracell-battery-stack.tsx # NEW
components/planset/sld-assets/dpc-container-frame.tsx   # NEW
components/planset/sld-assets/production-ct.tsx         # NEW
components/planset/sld-assets/e-stop-button.tsx         # NEW
components/planset/sld-assets/ethernet-switch.tsx       # NEW
components/planset/sld-assets/homeowner-router.tsx      # NEW
components/planset/sld-assets/msp-225a.tsx              # face label 45A→100A · HYBRID #1
components/planset/sld-assets/eaton-dg222nrb.tsx        # face 60A→45A
components/planset/sld-assets/eaton-dg222urb.tsx        # face DG222URB/60A→DG223URB/100A
components/planset/SheetPV1.tsx                         # 3-col dense cover redraft
components/planset/SheetPV3.tsx                         # drafted site survey + roof plan
components/planset/SheetPV31.tsx                        # drafted equipment elevation
components/planset/SheetPV32GarageFloorPlan.tsx         # NEW 4-view garage detail
components/planset/index.ts                             # +SheetPV32 export
lib/planset-types.ts                                    # +4 optional PlansetData fields
lib/sld-layouts/rush-spatial.json                       # v11 → v13 (265 elements)
scripts/render-duracell-sld.tsx                         # NEW render harness
```

## Known unknowns / unaudited shipped work

- **PV-1, PV-3, PV-3.1, PV-3.2 are FIRST-PASS DONE but UNAUDITED by Greg.** Shipped in commit `19ee391`. Greg only eyeballed PV-5. Don't assume the other 4 sheets are stamp-ready — they're not even confirmed visually-correct, only typecheck-passing.
- **PCS-limit math** (145A aggregate / 72.5A per hybrid) was canvas-confirmed against NEC 705.12(B)(3)(2) but **not verified against the actual Duracell Power Center Max Hybrid 15kW datasheet**. The assumption is that the inverter firmware supports curtailment to 72.5A continuous. If the cut sheet doesn't allow it, the busbar story falls apart and we'd need supply-side tap or main-breaker derate instead. Log a `greg_actions` row to confirm with Duracell tech support before stamping.
- **Print-CSS not validated.** The render harness `scripts/render-duracell-sld.tsx` writes a generic HTML wrapper for SVG inspection — NOT print-PDF. Brief says every sheet must render at ANSI B 11×17 landscape via browser print-to-PDF. The SLD has not been print-tested. Future Atlas should `mcp__chrome-devtools__new_page` to `/planset?project=PROJ-26922&enhanced=1` (production URL, Google OAuth) and trigger print to verify, or build a separate print-test harness.

## Deferred (not part of the chain right now)

- **PV-3.2 sheet registration in `app/planset/page.tsx`** enhanced sheet list — Atlas-side wire-up, not Claude Design's
- **PV-4.1 attachment detail re-emit** — Account A drop truncated at the 50K-char chat cap mid-FastenerSpec.structural-cert paragraph. **Exact cutoff text:** `"SEAL: CHEMLINK E-CURB ELASTOMERIC SEALANT, FACTORY-PRE-APPLIED TO QBASE."` Future Atlas needs to ask the canvas (or write it directly) for everything after that string through end-of-file including closing brackets, memo wrapper, export.
- **Branch merge to main** — held until Greg explicitly authorizes. Vercel won't deploy until merged.
- **Other sheets in the brief queue** — PV-2, PV-4, PV-5.1, PV-6, PV-7, PV-7.1, PV-8 (cover→cut-sheets). Order: do PV-5 polish first, then move down. **No drift while PV-5 is open.**

## How to resume this chain in a new session

```
/chain planset
```

That picks up this doc. Decision tree:

1. **If Greg approved r8 PV-5 and authorized push** — push `feat/planset-v8-layouts`, optionally merge to main, then start a fresh canvas chat for the next sheet (PV-1/PV-2/PV-3/PV-4/PV-6+ per brief queue). PV-5 is DONE.
2. **If Greg approved r8 but is holding the push** — work on the next sheet's brief instead. PV-5 commit waits.
3. **If Greg's eyeball turned up new PV-5 issues** — open a FRESH canvas chat (don't rehydrate Account B's thread per their handoff note), paste the r8 spec + just the new critique, iterate r9+.
4. **If next session is picking up a different sheet entirely (PV-1/PV-3 redrafts unaudited from prior chain)** — see "Known unknowns" above; PV-1/PV-3/PV-3.1/PV-3.2 are first-pass DONE but UNAUDITED.

**Render the latest state any time:**
```bash
cd ~/repos/MicroGRID-planset-phase1 && npx tsx scripts/render-duracell-sld.tsx > ~/.claude/tmp/duracell-pv5-latest.html
```
Then `mcp__chrome-devtools__new_page` with file:// URL, `take_screenshot` with fullPage=true.

## Reference

- Canvas A handoff: `~/.claude/plans/planset-canvas-handoff.md`
- Brief (the canvas's operating manual): `~/.claude/plans/planset-claude-design-autonomous-brief.md` + `~/Desktop/planset-claude-design-autonomous-brief.md`
- Tyson reference PDF: `~/Desktop/PROJ-26922 Corey Tyson Rev1.pdf`
- Latest render: `~/Desktop/duracell-pv5-r5.png`
- Latest recap: see `~/.claude/projects/-Users-gregkelsch/memory/session_recaps.md` Recap 401
