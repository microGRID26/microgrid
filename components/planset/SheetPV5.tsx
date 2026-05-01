// ── SheetPV5.tsx — diff-ready patch ────────────────────────────────────────
// Existing file at: components/planset/SheetPV5.tsx (uploaded as MG-SheetPV5.tsx)
//
// Changes:
//   1. Pass `inverterMix` from PlansetData → SldConfig so the new
//      micro-inverter topology branch in sld-layout.ts can iterate per-model.
//   2. Use `dominantInverter()` helper to derive a representative single
//      model+count when sheets above the SLD (PV-1 cover) need a one-line
//      summary.
//   3. NO topology branching here — that lives entirely in sld-layout.ts.
//      This component remains the same config-marshaller it was, just with
//      one more field passed through.
//
// All other lines unchanged from the existing file.

import { memo } from 'react'
import type { PlansetData } from '@/lib/planset-types'
import { DURACELL_DEFAULTS, dominantInverter } from '@/lib/planset-types'
import { autoDistributeStrings } from '@/lib/planset-calcs'
import { calculateSldLayout } from '@/lib/sld-layout'
import { SldRenderer } from '@/components/SldRenderer'
import { TitleBlockHtml } from './TitleBlockHtml'

function SheetPV5Inner({ data }: { data: PlansetData }) {
  let sldStrings = data.strings
  let sldStringsPerInverter = data.stringsPerInverter
  const effectivePanelCount = data.panelCount > 0 ? data.panelCount : (data.existingPanelCount ?? 0)

  // ── Auto-distribute strings for string-MPPT only ──────────────────────────
  // Skip auto-distribution when topology is micro-inverter — there are no DC
  // strings in that shape. The micro-inverter branch in sld-layout.ts ignores
  // `strings` / `stringsPerInverter` entirely and reads `inverterMix` instead.
  if (data.systemTopology !== 'micro-inverter' && sldStrings.length === 0 && effectivePanelCount > 0) {
    const d = DURACELL_DEFAULTS
    sldStrings = autoDistributeStrings(
      effectivePanelCount, data.vocCorrected, data.panelVmp, data.panelImp,
      data.inverterCount, data.mpptsPerInverter, data.stringsPerMppt, d.maxVoc
    )
    sldStringsPerInverter = []
    if (sldStrings.length > 0 && data.inverterCount > 0) {
      const perInv = Math.ceil(sldStrings.length / data.inverterCount)
      for (let i = 0; i < data.inverterCount; i++) {
        const start = i * perInv
        const end = Math.min(start + perInv, sldStrings.length)
        sldStringsPerInverter.push(Array.from({ length: end - start }, (_, j) => start + j))
      }
    }
  }

  // ── Inverter mix marshalling ──────────────────────────────────────────────
  // Read the optional inverterMix off PlansetData. When present (length > 0),
  // pass through to SldConfig so the topology branch can iterate per-model.
  // When absent, sld-layout.ts falls back to the singular inverterModel +
  // inverterCount fields (existing behavior).
  const inverterMix = (data as PlansetData & {
    inverterMix?: Array<{ model: string; count: number; acKw: number }>
  }).inverterMix

  // For the legacy micro-inverter case, derive a representative single
  // model from the mix when one is present — used in cross-sheet summaries
  // (PV-1 cover, BOM grouping). Falls back to data.inverterModel when no mix.
  const dominantInv = dominantInverter(inverterMix)
  const summaryInverterModel = dominantInv?.model ?? data.inverterModel
  const summaryInverterCount = inverterMix
    ? inverterMix.reduce((a, m) => a + m.count, 0)
    : data.inverterCount

  const config = {
    projectName: data.owner,
    address: data.address,
    panelModel: data.panelModel,
    panelWattage: data.panelWattage,
    panelCount: data.panelCount,

    // Use summary fields so single-line summaries inside the SLD top-strip
    // reflect the dominant inverter when a mix is present, while the SLD
    // branch itself iterates the full inverterMix.
    inverterModel: summaryInverterModel,
    inverterCount: summaryInverterCount,
    inverterAcKw: dominantInv?.acKw ?? data.inverterAcPower,

    // NEW — pass the full mix through so the micro-inverter branch can render
    // per-model array groups
    inverterMix,

    maxPvPower: data.maxPvPower,
    mpptsPerInverter: data.mpptsPerInverter,
    stringsPerMppt: data.stringsPerMppt,
    maxCurrentPerMppt: data.maxCurrentPerMppt,
    batteryModel: data.batteryModel,
    batteryCount: data.batteryCount,
    batteryCapacity: data.batteryCapacity,
    batteriesPerStack: data.batteriesPerStack,
    rackingModel: data.rackingModel,

    strings: sldStrings.map((s) => ({
      id: s.id, modules: s.modules, roofFace: s.roofFace,
      vocCold: s.vocCold, vmp: s.vmpNominal, imp: s.current,
    })),
    stringsPerInverter: sldStringsPerInverter,

    meter: data.meter, esid: data.esid, utility: data.utility,
    systemDcKw: data.systemDcKw, systemAcKw: data.systemAcKw, totalStorageKwh: data.totalStorageKwh,

    existingPanels: data.existingPanelModel
      ? `(${data.existingPanelCount ?? 0}) ${data.existingPanelModel} (${data.existingPanelWattage ?? 0}W)`
      : undefined,
    existingInverters: data.existingInverterModel
      ? `(${data.existingInverterCount ?? 0}) ${data.existingInverterModel} (240V)`
      : undefined,
    existingDcKw: data.existingPanelCount && data.existingPanelWattage
      ? (data.existingPanelCount * data.existingPanelWattage) / 1000
      : undefined,

    contractor: data.contractor.name,
    contractorAddress: `${data.contractor.address}, ${data.contractor.city}`,
    contractorPhone: data.contractor.phone,
    contractorLicense: data.contractor.license,
    contractorEmail: data.contractor.email,

    // Wire specs unchanged
    dcStringWire: data.dcStringWire,
    dcConduit: data.dcConduit,
    dcHomerunWire: `(${sldStrings.length * 2}) ${data.dcHomerunWire}`,
    dcEgc: `(1) ${data.dcHomerunEgc}`,
    dcHomerunConduit: `${data.dcHomerunConduit} TYPE CONDUIT`,
    acInverterWire: data.acWireInverter,
    acToPanelWire: data.acWireToPanel,
    acConduit: data.acConduit,
    serviceEntranceConduit: data.serviceEntranceConduit,
    batteryWire: data.batteryWire,
    batteryConduit: data.batteryConduit,
    pcsCurrentSetting: data.pcsCurrentSetting,
    acRunLengthFt: data.acRunLengthFt,
    backfeedBreakerA: data.backfeedBreakerA,

    // Topology discriminators (Task 2.4) — these now actually branch in
    // sld-layout.ts after the sld-layout-microinverter.patch is applied.
    systemTopology: data.systemTopology,
    rapidShutdownModel: data.rapidShutdownModel,
    hasCantexBar: data.hasCantexBar,
    hasRgm: data.hasRgm,

    loadSideBackfeedCompliant: data.loadSideBackfeedCompliant,
    totalBackfeedA: data.totalBackfeedA,
    maxAllowableBackfeedA: data.maxAllowableBackfeedA,
    mainBreakerA: parseInt(data.mainBreaker) || 200,
  }

  const layout = calculateSldLayout(config)

  return (
    <div
      className="sheet"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 2.5in',
        border: '2px solid #000',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '8pt',
        width: '16.5in',
        height: '10.5in',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div className="sld-content" style={{ overflow: 'hidden' }}>
        <SldRenderer layout={layout} />
      </div>
      <TitleBlockHtml sheetName="ELECTRICAL SINGLE LINE DIAGRAM" sheetNumber="PV-5" data={data} />
    </div>
  )
}

// Heavy: full SLD layout calc + SVG renderer. Memoized so zoom-toolbar /
// fullscreen state changes don't re-run sldLayout + re-render the SVG tree.
export const SheetPV5 = memo(SheetPV5Inner)
