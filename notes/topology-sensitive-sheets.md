# Topology-sensitive sheets

`PlansetData.systemTopology: 'string-mppt' | 'micro-inverter'` is the discriminator that determines how several sheets render. The current MicroGRID DURACELL_DEFAULT pipeline assumes string-MPPT everywhere; legacy installs (Hyperion, APTOS, pre-2026 TriSMART) and any new micro-inverter projects break under that assumption.

This note tracks **every sheet** that needs topology branching, what specifically changes per branch, and the current implementation status. New sheets added in the future should follow this same pattern.

## Pattern

```tsx
// Top of every topology-sensitive sheet component:
const isMicroInverter = data.systemTopology === 'micro-inverter'

// Then either:
//   (a) Conditional rendering for blocks that differ
//   (b) Conditional data for shared blocks (e.g. AC current values)
//   (c) Both
```

The branch is **always** explicit — never reach for `data.inverterCount > 5` or `data.batteryModel.includes('Sonnen')` as a topology proxy. `systemTopology` is the source of truth.

## Sheet matrix

| Sheet | Topology-sensitive? | What changes | v1 status | v2 status | v3 status |
|---|---|---|---|---|---|
| **PV-1 Cover** | Yes (low priority) | "Existing System" reference table + System Topology label in Project Data block. Currently shows generic "(N) ARRAY" / "(E) INVERTERS"; for micro-inverter, should call out per-microinverter count/model. SCOPE OF WORK row count differs by topology. | not branched | not branched | **deferred** |
| **PV-3 Site Plan** | No directly, but… | Equipment callouts list differs (no DC disconnect for micro-inverter; AC J-BOX present). Currently fixed via per-project `equipmentCallouts` overrides. | data-driven OK | data-driven OK | data-driven OK |
| **PV-5 Single-Line** | **Yes — critical** | Entire SLD shape (DC strings → combiner → power center vs AC trunk → AC J-box → load center). | broken | **fixed** (v1 + v2 layout scale) | **fixed** |
| **PV-7 Warning Labels** | **Yes** | DC disconnect block + DC voltage aggregate table must be suppressed for micro-inverter. AC disconnect rated current calculated differently. | broken | broken | **fixed (v3)** |
| **PV-8 Conductor Schedule** | Yes (low priority) | Row set differs: micro-inverter has NO "DC STRING (HOMERUN)" row and NO "DC DISCONNECT" row. Adds "AC TRUNK" row + "AC J-BOX TO LOAD CENTER" row. Today the rows are auto-generated from `data.strings[]` which is empty for micro-inverter installs, so the row gets dropped silently — visually OK but the AC trunk row is missing. | partially correct (lucky) | partially correct (lucky) | **deferred** |
| **PV-2 Project Data** | No | All values are scalar / topology-agnostic. | OK | OK | OK |
| **PV-2A Unit Index** | No | Symbol table is universal. | OK | OK | OK |
| **PV-3.1 Equipment Elev.** | No (data-driven) | Equipment list comes from data; rendering is the same. | OK | OK | OK |
| **PV-4 Attachment Detail** | No | Roof attachment / racking is topology-agnostic. | OK | OK | OK |
| **PV-6 Specs** | No (data-driven) | Datasheet pulls — micro-inverter installs include µinv datasheet automatically when `inverterModel` matches. | OK | OK | OK |

## Open work after v3

**PV-8 conductor schedule** is the next priority. It's "lucky correct" today because the auto-generation hides the DC homerun row when `data.strings = []`. But:
1. There's no AC TRUNK row when there should be (NEC 690.8(A)(2) requires it on the schedule)
2. The order of remaining rows isn't right (AC J-BOX should precede AC LOAD CENTER)
3. Conductor sizing for AC trunk is calculated against full inverter sum, but micro-inverter trunks have specific Q-Cable conductor specs that override

**PV-1 cover** topology-aware existing-system block is a paperwork win, not an AHJ-blocking issue. Defer until production has a non-Tyson micro-inverter project.

## Validation sentinel

Whenever `calculateSldLayoutMicroInverter()` is called but the produced PlansetData is then rendered through a sheet that **doesn't** branch on topology, log a dev-mode warning. This catches future sheets being added without topology awareness.

```ts
// lib/planset-validate.ts
export function validateTopologyAwareSheets(data: PlansetData): string[] {
  const warnings: string[] = []
  if (data.systemTopology === 'micro-inverter') {
    // The 4 sheets that should reflect this discriminator
    if (sheetEmitsDcDisconnectLabel(data)) {
      warnings.push('PV-7: DC disconnect label rendered for micro-inverter system — should be suppressed')
    }
    if (sheetEmitsDcStringRow(data)) {
      warnings.push('PV-8: DC string row rendered for micro-inverter system — no DC strings exist')
    }
    // ...etc
  }
  return warnings
}
```

Wire into the dev-build planset render path so missed cases surface without manual review.
