# Planset asset library — status tracking

> Live status of every SVG asset in the SLD asset library. Updated as Claude Design ships drafts and Atlas integrates.

See `notes/planset-ahj-standard.md` for the architecture and per-asset workflow. See `~/.claude/plans/cozy-herding-quilt.md` for the master phase plan.

## Status legend

- **spec** — Atlas has written the spec, not yet sent to Claude Design
- **drafting** — Sent to Claude Design, awaiting SVG deliverable
- **integrating** — SVG received, Atlas wiring it into the asset registry
- **integrated** — Live in registry, rendering on Tyson PV-5
- **verified** — Compared against Tyson reference at print scale, matches
- **blocked** — Iteration needed; describe in notes column

## Tyson PV-5 catalog (Phase 1 + 2)

| # | assetId | Equipment | Native size | Iter# | Status | File path | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `sonnen-score-p20` | SonnenCore+ SCORE-P20 battery | 360×280 | 1 | verified | `components/planset/sld-assets/sonnen-score-p20.tsx` | 2026-05-05: round-1 integration + PDF compare complete. Proportions, cell layout, 102V label, anchor wire exits all match Tyson PROJ-26922 Rev1 PV-5 reference. |
| 2 | `eaton-dg222urb` | Eaton DG222URB 60A PV Disconnect | 100×130 | 0 | spec | — | 2026-05-05: spec written to ~/Desktop/asset-spec-eaton-dg222urb.md. Sent to Claude Design for Phase 2. Note: DG221URB (row 3) is same layout, diff rating — may arrive as pair. |
| 3 | `eaton-dg221urb` | Eaton DG221URB 30A ESS Disconnect | 100×130 | 0 | spec | — | 2026-05-05: see DG222URB spec note — same asset with 30A label. Pending Claude Design delivery. |
| 4 | `eaton-dg222nrb-fused` | Eaton DG222NRB 60A Customer Gen Disc, 2×45A fuses | 120×130 | 0 | not started | — | |
| 5 | `brp12l125r` | Eaton BRP12L125R PV Load Center | 130×140 | 0 | not started | — | Internal: 20A/2P + 15A/2P branch breakers + 40A/2P main |
| 6 | `brp20b125r` | Eaton BRP20B125R Protected Load Panel | 140×160 | 0 | not started | — | Internal: 35A/2P PV + 40A/2P main on opposite bus ends |
| 7 | `msp-225a-residential` | 225A residential MSP | 150×170 | 0 | not started | — | Internal: 125A/2P main + 45A PV breaker + surge protector |
| 8 | `nema3-junction-box` | 600V NEMA 3 junction box | 80×70 | 0 | not started | — | |
| 9 | `bidirectional-meter` | (E) bi-directional utility meter | 90×120 | 0 | not started | — | M-circle + utility annotation |
| 10 | `gec-ground-assembly` | GEC + grounding electrode | 140×100 | 0 | not started | — | Includes NEC 250.52/250.53(A) annotation |
| 11 | `dpcrgm-cell` | Duracell DTU PC-PRO-C with 4 numbered taps | 130×80 | 0 | not started | — | |
| 12 | `ethernet-switch` | 5-port ethernet switch | 100×40 | 0 | not started | — | |
| 13 | `homeowner-router` | Generic home router | 100×40 | 0 | not started | — | |
| 14 | `sonnen-production-ct` | Sonnen production CT (dashed-tap glyph) | 30×30 | 0 | not started | — | |
| 15 | `dpc-rgm-cts` | DPC RGM CTs (dashed-tap glyph) | 30×30 | 0 | not started | — | |

## Patricia (string-MPPT) catalog (Phase 5)

To be inventoried after Phase 4 ships. Tentative list:

| assetId | Equipment | Note |
|---|---|---|
| `duracell-power-center-max` | Duracell Power Center Max Hybrid 15kW Inverter | New |
| `duracell-5plus-battery` | Duracell 5+ Battery (LiFePO4) stack | New |
| `dc-combiner` | DC string combiner | New |

(Many other components from Phase 1+2 are reused: MSP, meter, GEC, junction box, PV LC, PLP.)

## Other-sheet catalogs (Phase 6+)

Tracked here as each sheet redesign begins:

- **PV-3 Site Plan** — equipment placement callouts, roof-outline assets
- **PV-3.1 Equipment Elevation** — reuses Phase 2 equipment assets
- **PV-7 Warning Labels** — NEC sticker catalog (HTML/CSS sub-components, separate pattern from SVG asset library)
- **PV-8 Conductor Schedule** — table redesign, no SVG assets
