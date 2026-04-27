import type { PlansetData } from '@/lib/planset-types'
import { DURACELL_DEFAULTS } from '@/lib/planset-types'
import { autoDistributeStrings } from '@/lib/planset-calcs'
import { calculateSldLayout } from '@/lib/sld-layout'
import { SldRenderer } from '@/components/SldRenderer'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV5({ data }: { data: PlansetData }) {
  let sldStrings = data.strings
  let sldStringsPerInverter = data.stringsPerInverter
  const effectivePanelCount = data.panelCount > 0 ? data.panelCount : (data.existingPanelCount ?? 0)

  if (sldStrings.length === 0 && effectivePanelCount > 0) {
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

  const config = {
    projectName: data.owner,
    address: data.address,
    panelModel: data.panelModel,
    panelWattage: data.panelWattage,
    panelCount: data.panelCount,
    inverterModel: data.inverterModel,
    inverterCount: data.inverterCount,
    inverterAcKw: data.inverterAcPower,
    maxPvPower: data.maxPvPower,
    mpptsPerInverter: data.mpptsPerInverter,
    stringsPerMppt: data.stringsPerMppt,
    maxCurrentPerMppt: data.maxCurrentPerMppt,
    batteryModel: data.batteryModel,
    batteryCount: data.batteryCount,
    batteryCapacity: data.batteryCapacity,
    batteriesPerStack: data.batteriesPerStack,
    rackingModel: data.rackingModel,
    strings: sldStrings.map(s => ({
      id: s.id, modules: s.modules, roofFace: s.roofFace,
      vocCold: s.vocCold, vmp: s.vmpNominal, imp: s.current,
    })),
    stringsPerInverter: sldStringsPerInverter,
    meter: data.meter, esid: data.esid, utility: data.utility,
    systemDcKw: data.systemDcKw, systemAcKw: data.systemAcKw, totalStorageKwh: data.totalStorageKwh,
    existingPanels: data.existingPanelModel
      ? `(${data.existingPanelCount ?? 0}) ${data.existingPanelModel} (${data.existingPanelWattage ?? 0}W)` : undefined,
    existingInverters: data.existingInverterModel
      ? `(${data.existingInverterCount ?? 0}) ${data.existingInverterModel} (240V)` : undefined,
    existingDcKw: data.existingPanelCount && data.existingPanelWattage
      ? (data.existingPanelCount * data.existingPanelWattage) / 1000 : undefined,
    contractor: data.contractor.name,
    contractorAddress: `${data.contractor.address}, ${data.contractor.city}`,
    contractorPhone: data.contractor.phone,
    contractorLicense: data.contractor.license,
    contractorEmail: data.contractor.email,
    // Wire specs — pass overrides to SLD so diagram labels match PV-6/PV-8
    dcStringWire: data.dcStringWire,
    dcConduit: data.dcConduit,
    // Homerun specs piped from PlansetData. SldConfig expects strings with
    // count prefix (e.g. '(10) #10 AWG…') and conduit with 'TYPE CONDUIT'
    // suffix; PlansetData stores bare values. Compose them here so PV-5 SLD
    // matches what PV-6 wire chart + PV-8 conductor schedule render.
    dcHomerunWire: `(${sldStrings.length * 2}) ${data.dcHomerunWire}`,
    dcEgc: `(1) ${data.dcHomerunEgc}`,
    dcHomerunConduit: `${data.dcHomerunConduit} TYPE CONDUIT`,
    acInverterWire: data.acWireInverter,
    acToPanelWire: data.acWireToPanel,
    acConduit: data.acConduit,
    batteryWire: data.batteryWire,
    batteryConduit: data.batteryConduit,
    pcsCurrentSetting: data.pcsCurrentSetting,
    acRunLengthFt: data.acRunLengthFt,
    backfeedBreakerA: data.backfeedBreakerA,
    systemTopology: data.systemTopology,
    rapidShutdownModel: data.rapidShutdownModel,
    hasCantexBar: data.hasCantexBar,
    hasRgm: data.hasRgm,
    // 120% rule status — surfaces a designer warning in the SLD notes when fails
    loadSideBackfeedCompliant: data.loadSideBackfeedCompliant,
    totalBackfeedA: data.totalBackfeedA,
    maxAllowableBackfeedA: data.maxAllowableBackfeedA,
    mainBreakerA: parseInt(data.mainBreaker) || 200,
  }

  const layout = calculateSldLayout(config)

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sld-content" style={{ overflow: 'hidden' }}>
        <SldRenderer layout={layout} />
      </div>
      <TitleBlockHtml sheetName="ELECTRICAL SINGLE LINE DIAGRAM" sheetNumber="PV-5" data={data} />
    </div>
  )
}
