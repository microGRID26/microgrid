'use client'

import { useState } from 'react'
import { Nav } from '@/components/Nav'
import { cn } from '@/lib/utils'
import { Calculator, ArrowRight, AlertTriangle, Sun, Zap, Battery, ChevronDown, ChevronUp, FileDown } from 'lucide-react'
import { generateSingleLineDxf } from '@/lib/sld-template'

// ── TYPES ────────────────────────────────────────────────────────────────────

interface RoofFace {
  panelCount: number
  azimuth: number
  tilt: number
  roofArea: number
}

interface ExistingSystem {
  projectName: string
  address: string
  panelModel: string
  panelWattage: number
  panelCount: number
  panelVoc: number
  panelVmp: number
  panelIsc: number
  panelImp: number
  inverterModel: string
  inverterCount: number
  inverterAcPower: number
  batteryModel: string
  batteryCount: number
  batteryCapacity: number
  rackingType: string
  roofFaceCount: number
  roofFaces: RoofFace[]
}

interface TargetSystem {
  panelModel: string
  panelWattage: number
  panelVoc: number
  panelVmp: number
  panelIsc: number
  panelImp: number
  panelLengthMm: number
  panelWidthMm: number
  inverterModel: string
  inverterCount: number
  maxPvPower: number
  maxVoc: number
  mpptMin: number
  mpptMax: number
  mpptsPerInverter: number
  stringsPerMppt: number
  maxCurrentPerMppt: number
  batteryModel: string
  batteryCount: number
  batteryCapacity: number
  batteriesPerStack: number
  rackingModel: string
  designTempLow: number
  vocTempCoeff: number
}

interface StringConfig {
  mppt: number
  string: number
  modules: number
  vocCold: number
  vmpNominal: number
  current: number
  roofFaceIndex: number
}

interface Results {
  vocCorrected: number
  maxModulesPerString: number
  minModulesPerString: number
  recommendedStringSize: number
  totalStringInputs: number
  vmpHot: number
  panelFitEstimates: { roofIndex: number; oldCount: number; newCount: number; method: string }[]
  stringConfigs: StringConfig[]
  engineeringNotes: string[]
  newTotalPanels: number
  newSystemDc: number
  existingSystemDc: number
  newTotalAc: number
  existingTotalAc: number
  newTotalStorage: number
  existingTotalStorage: number
}

// ── DEFAULTS (PROJ-29857) ────────────────────────────────────────────────────

const DEFAULT_EXISTING: ExistingSystem = {
  projectName: 'PROJ-29857 Miguel Aguilera',
  address: '7822 Brooks Crossing Dr, Baytown TX 77521',
  panelModel: 'Seraphim SRP-440-BTD-BG',
  panelWattage: 440,
  panelCount: 53,
  panelVoc: 41.5,
  panelVmp: 34.8,
  panelIsc: 13.5,
  panelImp: 12.65,
  inverterModel: 'EcoFlow OCEAN Pro',
  inverterCount: 1,
  inverterAcPower: 24,
  batteryModel: 'EcoFlow OCEAN Pro 10kWh',
  batteryCount: 8,
  batteryCapacity: 10,
  rackingType: 'EcoFasten Clickfit SmartFoot',
  roofFaceCount: 3,
  roofFaces: [
    { panelCount: 30, azimuth: 351, tilt: 26, roofArea: 645 },
    { panelCount: 10, azimuth: 81, tilt: 27, roofArea: 216 },
    { panelCount: 13, azimuth: 171, tilt: 26, roofArea: 280 },
  ],
}

const DEFAULT_TARGET: TargetSystem = {
  panelModel: 'AMP 410W Domestic',
  panelWattage: 410,
  panelVoc: 37.4,
  panelVmp: 31.3,
  panelIsc: 14.0,
  panelImp: 13.1,
  panelLengthMm: 1722,
  panelWidthMm: 1134,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterCount: 2,
  maxPvPower: 19500,
  maxVoc: 500,
  mpptMin: 125,
  mpptMax: 425,
  mpptsPerInverter: 3,
  stringsPerMppt: 2,
  maxCurrentPerMppt: 26,
  batteryModel: 'Duracell 5kWh LFP',
  batteryCount: 16,
  batteryCapacity: 5,
  batteriesPerStack: 8,
  rackingModel: 'IronRidge XR100',
  designTempLow: -5,
  vocTempCoeff: -0.28,
}

// ── SINGLE-LINE DIAGRAM (Engineering Plan Set Style) ────────────────────────

function SingleLineDiagram({ existing, target, results }: {
  existing: ExistingSystem; target: TargetSystem; results: Results
}) {
  // Group strings by inverter
  const stringsByInverter: StringConfig[][] = []
  for (const sc of results.stringConfigs) {
    const invIdx = Math.ceil(sc.mppt / target.mpptsPerInverter) - 1
    if (!stringsByInverter[invIdx]) stringsByInverter[invIdx] = []
    stringsByInverter[invIdx].push(sc)
  }
  const battsPerStack = target.batteriesPerStack
  const W = 1200
  const H = 900

  // Wire annotation helper
  const WireLabel = ({ x, y, text, rotate }: { x: number; y: number; text: string; rotate?: number }) => (
    <text x={x} y={y} fontSize="5.5" fill="#444" fontStyle="italic"
      transform={rotate ? `rotate(${rotate},${x},${y})` : undefined}>{text}</text>
  )

  // Breaker symbol: two angled lines meeting at contact point
  const Breaker = ({ x, y, label, amps }: { x: number; y: number; label?: string; amps?: string }) => (
    <g>
      <line x1={x} y1={y - 8} x2={x} y2={y - 2} stroke="#111" strokeWidth="1.5" />
      <line x1={x} y1={y - 2} x2={x + 5} y2={y + 6} stroke="#111" strokeWidth="1.5" />
      <line x1={x} y1={y + 8} x2={x} y2={y + 14} stroke="#111" strokeWidth="1.5" />
      <circle cx={x} cy={y - 2} r="1.5" fill="#111" />
      {label && <text x={x + 10} y={y + 2} fontSize="5.5" fill="#111">{label}</text>}
      {amps && <text x={x + 10} y={y + 9} fontSize="5" fill="#666">{amps}</text>}
    </g>
  )

  // Disconnect symbol
  const Disconnect = ({ x, y, label }: { x: number; y: number; label: string }) => (
    <g>
      <line x1={x} y1={y - 6} x2={x} y2={y} stroke="#111" strokeWidth="1.5" />
      <line x1={x} y1={y} x2={x + 6} y2={y - 8} stroke="#111" strokeWidth="2" />
      <circle cx={x} cy={y} r="2" fill="none" stroke="#111" strokeWidth="1" />
      <line x1={x} y1={y + 2} x2={x} y2={y + 8} stroke="#111" strokeWidth="1.5" />
      <text x={x + 10} y={y + 2} fontSize="5.5" fill="#111">{label}</text>
    </g>
  )

  return (
    <svg id="sld-svg" viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 900, fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={W} height={H} fill="white" />

      {/* ── DRAWING BORDER ── */}
      <rect x="4" y="4" width={W - 8} height={H - 8} fill="none" stroke="#111" strokeWidth="2" />
      <rect x="8" y="8" width={W - 16} height={H - 16} fill="none" stroke="#111" strokeWidth="0.5" />

      {/* ── TITLE BLOCK (bottom right) ── */}
      <rect x={W - 300} y={H - 100} width={290} height={90} fill="none" stroke="#111" strokeWidth="1" />
      <line x1={W - 300} y1={H - 80} x2={W - 10} y2={H - 80} stroke="#111" strokeWidth="0.5" />
      <line x1={W - 300} y1={H - 60} x2={W - 10} y2={H - 60} stroke="#111" strokeWidth="0.5" />
      <line x1={W - 300} y1={H - 40} x2={W - 10} y2={H - 40} stroke="#111" strokeWidth="0.5" />
      <text x={W - 155} y={H - 85} textAnchor="middle" fontSize="10" fontWeight="bold">ELECTRICAL SINGLE LINE DIAGRAM</text>
      <text x={W - 280} y={H - 67} fontSize="6" fill="#666">PROJECT:</text>
      <text x={W - 240} y={H - 67} fontSize="7" fontWeight="bold">{existing.projectName.toUpperCase()}</text>
      <text x={W - 280} y={H - 48} fontSize="6" fill="#666">ADDRESS:</text>
      <text x={W - 240} y={H - 48} fontSize="7">{existing.address.toUpperCase()}</text>
      <text x={W - 280} y={H - 28} fontSize="6" fill="#666">SYSTEM:</text>
      <text x={W - 240} y={H - 28} fontSize="6">{results.newTotalPanels} x {target.panelWattage}W = {results.newSystemDc} kW DC / {target.inverterCount} x 15kW INV / {results.newTotalStorage} kWh BESS</text>
      <text x={W - 280} y={H - 15} fontSize="5" fill="#999">GENERATED BY NOVA CRM — FOR PE REVIEW ONLY — NOT FOR CONSTRUCTION</text>

      {/* ── STC BOX (top left) ── */}
      <rect x="20" y="16" width="200" height="45" fill="none" stroke="#111" strokeWidth="1" />
      <text x="30" y="30" fontSize="7" fontWeight="bold">STC</text>
      <text x="30" y="41" fontSize="6">MODULES: {results.newTotalPanels} x {target.panelWattage} = {results.newSystemDc} kW DC</text>
      <text x="30" y="51" fontSize="6">INVERTER(S): {target.inverterCount} x 15000 = {target.inverterCount * 15}.000 kW AC</text>

      {/* ── METER / ESID BOX (top center) ── */}
      <rect x="240" y="16" width="220" height="35" fill="none" stroke="#111" strokeWidth="1" />
      <text x="250" y="30" fontSize="6">METER NUMBER: 88 353 523</text>
      <text x="250" y="42" fontSize="6">ESID NUMBER: 1008901020901254810117</text>

      {/* ── PV ARRAYS (top, y=80-200) ── */}
      {Array.from({ length: target.inverterCount }, (_, inv) => {
        const strings = stringsByInverter[inv] ?? []
        const baseX = inv === 0 ? 40 : 620
        const moduleW = 8
        const moduleH = 14

        return (
          <g key={`arr-${inv}`}>
            {strings.map((sc, si) => {
              const sy = 90 + si * 55
              const roofLabel = sc.roofFaceIndex >= 0 ? `ROOF #${sc.roofFaceIndex + 1}` : ''

              return (
                <g key={si}>
                  {/* Module array - individual panel rectangles */}
                  {Array.from({ length: Math.min(sc.modules, 14) }, (_, mi) => (
                    <rect key={mi} x={baseX + mi * (moduleW + 1)} y={sy}
                      width={moduleW} height={moduleH} fill="none" stroke="#111" strokeWidth="0.7" />
                  ))}
                  {/* Series connection line through panels */}
                  <line x1={baseX} y1={sy + moduleH / 2}
                    x2={baseX + Math.min(sc.modules, 14) * (moduleW + 1) - 1} y2={sy + moduleH / 2}
                    stroke="#111" strokeWidth="0.3" strokeDasharray="1,2" />

                  {/* String label */}
                  <text x={baseX} y={sy - 4} fontSize="6" fontWeight="bold">
                    STRING {si + 1}: ({sc.modules}) {target.panelModel.toUpperCase()}
                  </text>
                  <text x={baseX + 200} y={sy - 4} fontSize="5.5" fill="#666">
                    {roofLabel}
                  </text>

                  {/* RSD label */}
                  <text x={baseX} y={sy + moduleH + 10} fontSize="5" fill="#444">
                    (N) RSD-D-20 ROOFTOP MODULE LEVEL RAPID SHUTDOWN DEVICE
                  </text>

                  {/* Wire from string down */}
                  <line x1={baseX + Math.min(sc.modules, 14) * (moduleW + 1) + 10} y1={sy + moduleH / 2}
                    x2={baseX + Math.min(sc.modules, 14) * (moduleW + 1) + 30} y2={sy + moduleH / 2}
                    stroke="#111" strokeWidth="1" />

                  {/* Voltage/current annotation */}
                  <text x={baseX + Math.min(sc.modules, 14) * (moduleW + 1) + 35} y={sy + moduleH / 2 - 2}
                    fontSize="5" fill="#444">{sc.vocCold}V</text>
                  <text x={baseX + Math.min(sc.modules, 14) * (moduleW + 1) + 35} y={sy + moduleH / 2 + 6}
                    fontSize="5" fill="#444">{sc.current}A</text>
                </g>
              )
            })}

            {/* Roof array wiring label */}
            <text x={baseX} y={90 + strings.length * 55 + 5} fontSize="5.5" fill="#444" fontStyle="italic">
              ROOF ARRAY WIRING
            </text>

            {/* Junction box */}
            <rect x={baseX + 180} y={90 + strings.length * 55 + 12} width={55} height={22}
              fill="none" stroke="#111" strokeWidth="1" />
            <text x={baseX + 207} y={90 + strings.length * 55 + 25} textAnchor="middle" fontSize="5.5">
              (N) JUNCTION BOX
            </text>
            <text x={baseX + 207} y={90 + strings.length * 55 + 32} textAnchor="middle" fontSize="5" fill="#666">
              600V, NEMA 3
            </text>

            {/* Wire gauge callout from array to JB */}
            <WireLabel x={baseX + 60} y={90 + strings.length * 55 + 10}
              text="#10 AWG CU PV WIRE, 3/4&quot; EMT TYPE CONDUIT" />
          </g>
        )
      })}

      {/* ── INVERTERS (center, y=350-440) ── */}
      {Array.from({ length: target.inverterCount }, (_, inv) => {
        const cx = inv === 0 ? 200 : 820
        const strings = stringsByInverter[inv] ?? []
        const invY = 370
        const invW = 180
        const invH = 70

        return (
          <g key={`inv-${inv}`}>
            {/* Wire from JB to inverter */}
            <line x1={cx} y1={320} x2={cx} y2={invY} stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx + 8} y={345}
              text={`(2) #10 AWG CU THWN-2, (1) #6 AWG BARE CU EGC`} />
            <WireLabel x={cx + 8} y={352}
              text={`3/4" EMT TYPE CONDUIT`} />

            {/* DC Disconnect */}
            <Disconnect x={cx} y={340} label="(N) DC DISCONNECT" />

            {/* Inverter box */}
            <rect x={cx - invW / 2} y={invY} width={invW} height={invH}
              fill="none" stroke="#111" strokeWidth="2" />
            <text x={cx} y={invY + 14} textAnchor="middle" fontSize="7" fontWeight="bold">
              (N) {target.inverterModel.toUpperCase().slice(0, 30)}
            </text>
            <text x={cx} y={invY + 24} textAnchor="middle" fontSize="6">
              INVERTER {inv + 1}, 15KW AC OUTPUT, {(target.maxPvPower / 1000).toFixed(0)}KW DC INPUT,
            </text>
            <text x={cx} y={invY + 33} textAnchor="middle" fontSize="6">
              100A RATED, 240V, NEMA 3R
            </text>
            <text x={cx} y={invY + 43} textAnchor="middle" fontSize="5.5" fill="#666">
              {strings.reduce((s, sc) => s + sc.modules, 0)} MODULES = {(strings.reduce((s, sc) => s + sc.modules, 0) * target.panelWattage / 1000).toFixed(2)} kW DC
            </text>
            <text x={cx} y={invY + 52} textAnchor="middle" fontSize="5.5" fill="#666">
              {target.mpptsPerInverter} MPPT, {target.stringsPerMppt} STRINGS/MPPT, MAX {target.maxCurrentPerMppt}A/MPPT
            </text>
            <text x={cx} y={invY + 62} textAnchor="middle" fontSize="5" fill="#999">
              CEC EFFICIENCY: 96.5% | PEAK: 97.5%
            </text>

            {/* Battery stack (below-left of inverter) */}
            <line x1={cx - invW / 2} y1={invY + invH / 2}
              x2={cx - invW / 2 - 80} y2={invY + invH / 2}
              stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx - invW / 2 - 78} y={invY + invH / 2 - 5}
              text={`(2) #8 AWG CU THWN-2`} />
            <WireLabel x={cx - invW / 2 - 78} y={invY + invH / 2 + 16}
              text={`1" EMT TYPE CONDUIT`} />

            {/* Individual battery cells */}
            {Array.from({ length: battsPerStack }, (_, bi) => (
              <g key={bi}>
                <rect x={cx - invW / 2 - 80 - 35 * (bi < 4 ? 1 : 0) - (bi >= 4 ? 35 : 0)}
                  y={invY + (bi < 4 ? bi * 18 : (bi - 4) * 18)}
                  width={30} height={15} fill="none" stroke="#111" strokeWidth="0.8" rx="1" />
              </g>
            ))}
            {/* Simplified: draw as single stack */}
            <rect x={cx - invW / 2 - 150} y={invY - 5} width={60} height={invH + 10}
              fill="none" stroke="#111" strokeWidth="1.5" />
            <text x={cx - invW / 2 - 120} y={invY + 15} textAnchor="middle" fontSize="6" fontWeight="bold">
              (N)({battsPerStack})
            </text>
            <text x={cx - invW / 2 - 120} y={invY + 25} textAnchor="middle" fontSize="5.5">
              {target.batteryModel.toUpperCase()}
            </text>
            <text x={cx - invW / 2 - 120} y={invY + 35} textAnchor="middle" fontSize="5.5">
              {target.batteryCapacity}KWH, 380VDC
            </text>
            <text x={cx - invW / 2 - 120} y={invY + 45} textAnchor="middle" fontSize="5.5">
              IP67, NEMA 3R
            </text>
            <text x={cx - invW / 2 - 120} y={invY + 55} textAnchor="middle" fontSize="5" fill="#666">
              STACK OF {battsPerStack}
            </text>
            <text x={cx - invW / 2 - 120} y={invY + 65} textAnchor="middle" fontSize="5" fill="#666">
              {battsPerStack * target.batteryCapacity} kWh TOTAL
            </text>

            {/* AC Output from inverter */}
            <line x1={cx} y1={invY + invH} x2={cx} y2={invY + invH + 20}
              stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx + 8} y={invY + invH + 10}
              text={`#6 AWG CU THWN-2`} />

            {/* AC Disconnect */}
            <Disconnect x={cx} y={invY + invH + 25} label="(N) AC DISCONNECT, 200A/2P, 240V" />

            {/* Wire down to bus */}
            <line x1={cx} y1={invY + invH + 35} x2={cx} y2={540}
              stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx + 8} y={invY + invH + 50}
              text={`(2) #4 AWG CU THWN-2, (1) #8 AWG CU EGC`} />
            <WireLabel x={cx + 8} y={invY + invH + 57}
              text={`1-1/4" EMT TYPE CONDUIT`} />

            {/* PV Breaker on bus */}
            <Breaker x={cx} y={545} label={`(N) 125A PV`} amps="BREAKER" />
          </g>
        )
      })}

      {/* ── SMART PANEL BUS BAR (y=560) ── */}
      <line x1="80" y1={565} x2={W - 200} y2={565} stroke="#111" strokeWidth="3" />
      <text x={(W - 120) / 2} y={558} textAnchor="middle" fontSize="7" fontWeight="bold">
        (N) SMART ELECTRICAL PANEL, BUSBAR RATING: 260A
      </text>
      <text x={(W - 120) / 2} y={578} textAnchor="middle" fontSize="6" fill="#666">
        260A RATED, 240V, NEMA 3R (EXTERIOR MOUNTED)
      </text>

      {/* Main breaker (left end of bus) */}
      <line x1="60" y1={565} x2="60" y2={610} stroke="#111" strokeWidth="1.5" />
      <Breaker x={60} y={590} label="(N) MAIN" amps="125A" />
      <text x="60" y={630} textAnchor="middle" fontSize="5.5">TO LOADS</text>

      {/* Existing PV breaker */}
      <line x1="500" y1={565} x2="500" y2={610} stroke="#111" strokeWidth="1" strokeDasharray="4,3" />
      <Breaker x={500} y={590} label="(E) 40A PV" amps="BREAKER" />
      <text x="500" y={630} textAnchor="middle" fontSize="5" fill="#666">(E) EXISTING ENPHASE</text>
      <text x="500" y={638} textAnchor="middle" fontSize="5" fill="#666">IQ7PLUS SYSTEM</text>

      {/* ── GENERATION DISCONNECT → METER → GRID (right side) ── */}
      <line x1={W - 200} y1={565} x2={W - 150} y2={565} stroke="#111" strokeWidth="1.5" />

      {/* Generation Disconnect */}
      <rect x={W - 160} y={550} width={60} height={28} fill="none" stroke="#111" strokeWidth="1" />
      <text x={W - 130} y={562} textAnchor="middle" fontSize="5.5">(N) GENERATION</text>
      <text x={W - 130} y={570} textAnchor="middle" fontSize="5.5">DISCONNECT</text>

      {/* Wire to utility meter */}
      <line x1={W - 100} y1={565} x2={W - 60} y2={565} stroke="#111" strokeWidth="1.5" />

      {/* Utility Meter circle */}
      <circle cx={W - 45} cy={565} r="18" fill="none" stroke="#111" strokeWidth="1.5" />
      <text x={W - 45} y={562} textAnchor="middle" fontSize="6" fontWeight="bold">M</text>
      <text x={W - 45} y={570} textAnchor="middle" fontSize="5">kWh</text>

      {/* Labels for meter */}
      <text x={W - 45} y={545} textAnchor="middle" fontSize="5.5" fill="#666">
        (E) BIDIRECTIONAL
      </text>
      <text x={W - 45} y={538} textAnchor="middle" fontSize="5.5" fill="#666">
        UTILITY METER
      </text>

      {/* Wire to grid */}
      <line x1={W - 27} y1={565} x2={W - 15} y2={565} stroke="#111" strokeWidth="1.5" />
      <text x={W - 12} y={562} fontSize="6" fill="#666">TO UTILITY</text>
      <text x={W - 12} y={570} fontSize="6" fill="#666">GRID</text>
      <text x={W - 12} y={580} fontSize="5" fill="#999">CENTERPOINT</text>
      <text x={W - 12} y={588} fontSize="5" fill="#999">ENERGY</text>

      {/* 10 FT MAX notation */}
      <line x1={W - 180} y1={530} x2={W - 30} y2={530} stroke="#111" strokeWidth="0.5" />
      <text x={W - 105} y={527} textAnchor="middle" fontSize="6" fontWeight="bold">10&apos; MAX</text>
      <line x1={W - 180} y1={528} x2={W - 180} y2={535} stroke="#111" strokeWidth="0.5" />
      <line x1={W - 30} y1={528} x2={W - 30} y2={535} stroke="#111" strokeWidth="0.5" />

      {/* ── GROUND SYSTEM ── */}
      <line x1="120" y1={565} x2="120" y2={640} stroke="#111" strokeWidth="1" />
      <line x1="112" y1={640} x2="128" y2={640} stroke="#111" strokeWidth="1.5" />
      <line x1="114" y1={644} x2="126" y2={644} stroke="#111" strokeWidth="1.5" />
      <line x1="116" y1={648} x2="124" y2={648} stroke="#111" strokeWidth="1.5" />
      <text x="135" y={640} fontSize="5.5">EXISTING GROUNDING</text>
      <text x="135" y={648} fontSize="5.5">ELECTRODE SYSTEM</text>
      <text x="135" y={656} fontSize="5" fill="#666">NEC 250.50, 250.52(A)</text>

      {/* ── NOTES SECTION (bottom left) ── */}
      <rect x="20" y={H - 190} width={W - 340} height={178} fill="none" stroke="#111" strokeWidth="0.5" />
      <text x="30" y={H - 175} fontSize="7" fontWeight="bold">NOTES:</text>
      {[
        '1. ALL ELECTRICAL MATERIALS SHALL BE NEW AND LISTED BY RECOGNIZED TESTING LABORATORY.',
        '2. OUTDOOR EQUIPMENT SHALL BE AT LEAST NEMA 3R RATED.',
        '3. ALL METALLIC EQUIPMENT SHALL BE GROUNDED.',
        '4. ALL SPECIFIC WIRING IS BASED ON THE USE OF COPPER.',
        `5. PV SYSTEM SIZE: ${results.newSystemDc} kW DC / ${target.inverterCount * 15} kW AC.`,
        '6. INVERTER IS EQUIPPED W/ INTEGRATED GFDI, PROVIDING GROUND FAULT PROTECTION.',
        '7. ALL CONDUITS SHALL BE COPPER AND 90 DEG RATED.',
        `8. BATTERY SYSTEM: (${target.batteryCount}) ${target.batteryModel.toUpperCase()}, ${results.newTotalStorage} kWh TOTAL.`,
        '9. REQUIRES AC SOFT STARTER KITS.',
        '10. REQUIRES RIGID RACK FOR BATTERY MOUNTING.',
        `11. RACKING: ${target.rackingModel.toUpperCase()}`,
        '12. ALL WORK SHALL BE IN ACCORD WITH THE 2020 NEC WITH SPECIAL EMPHASIS ON ARTICLE 690.',
        'NOTE: PCS CONTROLLED CURRENT SETTING: 200A.',
        'NOTE: STRING CALCULATIONS REQUIRE PE REVIEW BEFORE PERMITTING.',
      ].map((note, i) => (
        <text key={i} x="30" y={H - 163 + i * 11} fontSize="5.5" fill="#333">{note}</text>
      ))}

      {/* ── BATTERY SCOPE BOX (top right) ── */}
      <rect x={W - 280} y="16" width="265" height="55" fill="none" stroke="#111" strokeWidth="1" />
      <text x={W - 270} y="29" fontSize="6" fontWeight="bold">BATTERY SCOPE</text>
      <text x={W - 270} y="39" fontSize="5.5">(N)({target.batteryCount}) {target.batteryModel.toUpperCase()}</text>
      <text x={W - 270} y="49" fontSize="5.5">{target.batteryCapacity}KWH, 380VDC, IP67, NEMA 3R</text>
      <text x={W - 270} y="59" fontSize="5.5">TOTAL STORAGE: {results.newTotalStorage} kWh | STACKS: {Math.ceil(target.batteryCount / battsPerStack)} x {battsPerStack}</text>

      {/* ── EXISTING SYSTEM NOTE ── */}
      <rect x="480" y={660} width="180" height="30" fill="none" stroke="#111" strokeWidth="0.5" strokeDasharray="4,3" />
      <text x="490" y={674} fontSize="5.5" fill="#666">(E)(20) SILFAB SOLAR SIL-370 HC (370W)</text>
      <text x="490" y={683} fontSize="5.5" fill="#666">(E)(20) ENPHASE IQ7PLUS-72-2-US (240V)</text>

      {/* ── SHEET INFO ── */}
      <text x={W - 30} y={H - 105} textAnchor="end" fontSize="6" fill="#666">SHEET PV-5</text>
      <text x={W - 30} y={H - 96} textAnchor="end" fontSize="5" fill="#999">SCALE: NTS</text>
    </svg>
  )
}

// ── HELPER: number input ─────────────────────────────────────────────────────

function NumField({ label, value, onChange, unit, step }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}{unit ? ` (${unit})` : ''}</label>
      <input
        type="number"
        step={step ?? 'any'}
        value={value || ''}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
      />
    </div>
  )
}

function TextField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
      />
    </div>
  )
}

// ── PAGE ─────────────────────────────────────────────────────────────────────

export default function RedesignPage() {
  const [existing, setExisting] = useState<ExistingSystem>(DEFAULT_EXISTING)
  const [target, setTarget] = useState<TargetSystem>(DEFAULT_TARGET)
  const [results, setResults] = useState<Results | null>(null)
  const [showExisting, setShowExisting] = useState(true)
  const [showTarget, setShowTarget] = useState(true)

  // ── Updaters ───────────────────────────────────────────────────────────────
  function updateExisting<K extends keyof ExistingSystem>(key: K, val: ExistingSystem[K]) {
    setExisting(prev => ({ ...prev, [key]: val }))
  }

  function updateTarget<K extends keyof TargetSystem>(key: K, val: TargetSystem[K]) {
    setTarget(prev => ({ ...prev, [key]: val }))
  }

  function updateRoofFace(idx: number, key: keyof RoofFace, val: number) {
    setExisting(prev => {
      const faces = [...prev.roofFaces]
      faces[idx] = { ...faces[idx], [key]: val }
      return { ...prev, roofFaces: faces }
    })
  }

  function handleRoofFaceCountChange(count: number) {
    const clamped = Math.max(1, Math.min(5, count))
    setExisting(prev => {
      const faces = [...prev.roofFaces]
      while (faces.length < clamped) faces.push({ panelCount: 0, azimuth: 180, tilt: 20, roofArea: 0 })
      return { ...prev, roofFaceCount: clamped, roofFaces: faces.slice(0, clamped) }
    })
  }

  // ── Calculate ──────────────────────────────────────────────────────────────
  function calculate() {
    try {
    const absCoeff = Math.abs(target.vocTempCoeff / 100)

    // String sizing
    const vocCorrected = target.panelVoc * (1 + absCoeff * (25 - target.designTempLow))
    const maxModulesPerString = Math.floor(target.maxVoc / vocCorrected)
    const vmpHot = target.panelVmp * (1 - absCoeff * 50)
    const minModulesPerString = Math.ceil(target.mpptMin / vmpHot)

    // Recommended: highest value <= max that keeps Vmp*modules within MPPT range
    let recommendedStringSize = minModulesPerString
    for (let n = maxModulesPerString; n >= minModulesPerString; n--) {
      if (n * target.panelVmp <= target.mpptMax) {
        recommendedStringSize = n
        break
      }
    }

    const totalStringInputs = target.inverterCount * target.mpptsPerInverter * target.stringsPerMppt

    // Panel fit estimates per roof face
    const panelAreaSqFt = target.panelLengthMm > 0 && target.panelWidthMm > 0
      ? (target.panelLengthMm * target.panelWidthMm / 1_000_000) * 10.764
      : 0

    const panelFitEstimates = existing.roofFaces.slice(0, existing.roofFaceCount).map((rf, i) => {
      let newCount: number
      let method: string
      if (panelAreaSqFt > 0 && rf.roofArea > 0) {
        newCount = Math.floor(rf.roofArea / panelAreaSqFt)
        method = 'area-based'
      } else {
        newCount = Math.floor(rf.panelCount * (existing.panelWattage / target.panelWattage) * 1.05)
        method = 'ratio-based'
      }
      return { roofIndex: i, oldCount: rf.panelCount, newCount, method }
    })

    const newTotalPanels = panelFitEstimates.reduce((s, e) => s + e.newCount, 0)

    // Auto string configuration — distribute panels evenly, never below minimum
    const stringConfigs: StringConfig[] = []

    // Step 1: figure out how many strings we need and size them evenly
    const maxStrings = totalStringInputs
    const neededStrings = Math.min(Math.ceil(newTotalPanels / recommendedStringSize), maxStrings)
    const baseSize = Math.floor(newTotalPanels / neededStrings)
    const extraPanels = newTotalPanels % neededStrings

    // Build string sizes: distribute remainder across first N strings
    const stringSizes: number[] = []
    for (let i = 0; i < neededStrings; i++) {
      let size = baseSize + (i < extraPanels ? 1 : 0)
      // Clamp to max modules per string
      if (size > maxModulesPerString) size = maxModulesPerString
      stringSizes.push(size)
    }

    // Step 2: assign strings to roof faces proportionally
    const roofFaceAssignments: number[] = [] // which roof face each string belongs to
    let stringIdx = 0
    let assigned = 0
    for (let ri = 0; ri < panelFitEstimates.length && stringIdx < stringSizes.length; ri++) {
      let roofRemaining = panelFitEstimates[ri].newCount
      while (roofRemaining > 0 && stringIdx < stringSizes.length) {
        const take = Math.min(stringSizes[stringIdx], roofRemaining)
        if (take < minModulesPerString && roofRemaining < minModulesPerString) {
          // Not enough panels left on this roof for a full string — move to next roof
          break
        }
        roofFaceAssignments[stringIdx] = ri
        roofRemaining -= stringSizes[stringIdx]
        assigned += stringSizes[stringIdx]
        stringIdx++
      }
    }
    // Any unassigned strings get -1 (overflow)
    while (stringIdx < stringSizes.length) {
      roofFaceAssignments[stringIdx] = -1
      stringIdx++
    }

    // Step 3: build string configs with inverter/MPPT assignment
    for (let i = 0; i < stringSizes.length; i++) {
      const mpptGlobal = Math.floor(i / target.stringsPerMppt) + 1
      const stringInMppt = (i % target.stringsPerMppt) + 1
      const modules = stringSizes[i]

      stringConfigs.push({
        mppt: mpptGlobal,
        string: stringInMppt,
        modules,
        vocCold: parseFloat((modules * vocCorrected).toFixed(1)),
        vmpNominal: parseFloat((modules * target.panelVmp).toFixed(1)),
        current: target.panelImp,
        roofFaceIndex: roofFaceAssignments[i] ?? -1,
      })
    }

    // Engineering notes
    const engineeringNotes: string[] = []
    const newSystemDc = (newTotalPanels * target.panelWattage) / 1000
    const totalMaxPv = (target.inverterCount * target.maxPvPower) / 1000

    if (newSystemDc > totalMaxPv) {
      engineeringNotes.push(`WARNING: System DC (${newSystemDc.toFixed(1)} kW) exceeds total inverter PV capacity (${totalMaxPv.toFixed(1)} kW)`)
    }

    for (const sc of stringConfigs) {
      if (sc.vocCold > target.maxVoc) {
        engineeringNotes.push(`WARNING: MPPT ${sc.mppt} String ${sc.string} Voc_cold (${sc.vocCold}V) exceeds max Voc (${target.maxVoc}V)`)
      }
      if (sc.vmpNominal < target.mpptMin) {
        engineeringNotes.push(`WARNING: MPPT ${sc.mppt} String ${sc.string} Vmp (${sc.vmpNominal}V) below MPPT minimum (${target.mpptMin}V)`)
      }
    }

    if (newTotalPanels !== existing.panelCount) {
      engineeringNotes.push('Structural letter may need update — panel count changed')
    }

    engineeringNotes.push('String calculations require PE review before permitting')

    const existingSystemDc = (existing.panelCount * existing.panelWattage) / 1000
    const existingTotalAc = existing.inverterCount * existing.inverterAcPower
    const newTotalAc = target.inverterCount * 15 // Using model name for kW
    const existingTotalStorage = existing.batteryCount * existing.batteryCapacity
    const newTotalStorage = target.batteryCount * target.batteryCapacity

    setResults({
      vocCorrected: parseFloat(vocCorrected.toFixed(2)),
      maxModulesPerString,
      minModulesPerString,
      recommendedStringSize,
      totalStringInputs,
      vmpHot: parseFloat(vmpHot.toFixed(2)),
      panelFitEstimates,
      stringConfigs,
      engineeringNotes,
      newTotalPanels,
      newSystemDc: parseFloat(newSystemDc.toFixed(2)),
      existingSystemDc: parseFloat(existingSystemDc.toFixed(2)),
      newTotalAc,
      existingTotalAc,
      newTotalStorage,
      existingTotalStorage,
    })
    // Scroll to results after render
    setTimeout(() => {
      document.getElementById('redesign-results')?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
    } catch (err) {
      console.error('Redesign calculate error:', err)
      alert('Calculation error: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Nav active="Redesign" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Sun className="w-6 h-6 text-green-400" />
          <h1 className="text-xl font-bold">Solar System Redesign Tool</h1>
        </div>

        {/* Input Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          {/* ── Existing System ────────────────────────────────────────────── */}
          <div className="bg-gray-800 rounded-lg border border-gray-700">
            <button
              onClick={() => setShowExisting(!showExisting)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold">Existing System</h2>
              </div>
              {showExisting ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {showExisting && (
              <div className="px-4 pb-4 space-y-4">
                {/* Project info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextField label="Project Name" value={existing.projectName} onChange={v => updateExisting('projectName', v)} />
                  <TextField label="Address" value={existing.address} onChange={v => updateExisting('address', v)} />
                </div>

                {/* Panels */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Panels</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="col-span-2 sm:col-span-1">
                      <TextField label="Panel Model" value={existing.panelModel} onChange={v => updateExisting('panelModel', v)} />
                    </div>
                    <NumField label="Wattage" value={existing.panelWattage} onChange={v => updateExisting('panelWattage', v)} unit="W" />
                    <NumField label="Count" value={existing.panelCount} onChange={v => updateExisting('panelCount', v)} step={1} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                    <NumField label="Voc" value={existing.panelVoc} onChange={v => updateExisting('panelVoc', v)} unit="V" />
                    <NumField label="Vmp" value={existing.panelVmp} onChange={v => updateExisting('panelVmp', v)} unit="V" />
                    <NumField label="Isc" value={existing.panelIsc} onChange={v => updateExisting('panelIsc', v)} unit="A" />
                    <NumField label="Imp" value={existing.panelImp} onChange={v => updateExisting('panelImp', v)} unit="A" />
                  </div>
                </div>

                {/* Inverter */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Inverter</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <TextField label="Model" value={existing.inverterModel} onChange={v => updateExisting('inverterModel', v)} />
                    <NumField label="Count" value={existing.inverterCount} onChange={v => updateExisting('inverterCount', v)} step={1} />
                    <NumField label="AC Power" value={existing.inverterAcPower} onChange={v => updateExisting('inverterAcPower', v)} unit="kW" />
                  </div>
                </div>

                {/* Battery */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Battery</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <TextField label="Model" value={existing.batteryModel} onChange={v => updateExisting('batteryModel', v)} />
                    <NumField label="Count" value={existing.batteryCount} onChange={v => updateExisting('batteryCount', v)} step={1} />
                    <NumField label="Capacity" value={existing.batteryCapacity} onChange={v => updateExisting('batteryCapacity', v)} unit="kWh" />
                  </div>
                </div>

                {/* Racking */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Racking</p>
                  <TextField label="Racking Type" value={existing.rackingType} onChange={v => updateExisting('rackingType', v)} />
                </div>

                {/* Roof Faces */}
                <div className="border-t border-gray-700 pt-3">
                  <div className="flex items-center gap-3 mb-2">
                    <p className="text-xs text-green-400 font-semibold">Roof Faces</p>
                    <NumField label="" value={existing.roofFaceCount} onChange={handleRoofFaceCountChange} step={1} />
                  </div>
                  {existing.roofFaces.slice(0, existing.roofFaceCount).map((rf, i) => (
                    <div key={i} className="bg-gray-750 rounded p-3 mb-2 bg-gray-900/50">
                      <p className="text-xs text-gray-400 mb-2">Roof Face {i + 1}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <NumField label="Panels" value={rf.panelCount} onChange={v => updateRoofFace(i, 'panelCount', v)} step={1} />
                        <NumField label="Azimuth" value={rf.azimuth} onChange={v => updateRoofFace(i, 'azimuth', v)} unit="deg" />
                        <NumField label="Tilt" value={rf.tilt} onChange={v => updateRoofFace(i, 'tilt', v)} unit="deg" />
                        <NumField label="Array Area" value={rf.roofArea} onChange={v => updateRoofFace(i, 'roofArea', v)} unit="sqft" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Target Equipment ───────────────────────────────────────────── */}
          <div className="bg-gray-800 rounded-lg border border-gray-700">
            <button
              onClick={() => setShowTarget(!showTarget)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-green-400" />
                <h2 className="text-sm font-semibold">Target Equipment</h2>
              </div>
              {showTarget ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {showTarget && (
              <div className="px-4 pb-4 space-y-4">
                {/* Panels */}
                <div>
                  <p className="text-xs text-green-400 font-semibold mb-2">Panels</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="col-span-2 sm:col-span-1">
                      <TextField label="Panel Model" value={target.panelModel} onChange={v => updateTarget('panelModel', v)} />
                    </div>
                    <NumField label="Wattage" value={target.panelWattage} onChange={v => updateTarget('panelWattage', v)} unit="W" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                    <NumField label="Voc" value={target.panelVoc} onChange={v => updateTarget('panelVoc', v)} unit="V" />
                    <NumField label="Vmp" value={target.panelVmp} onChange={v => updateTarget('panelVmp', v)} unit="V" />
                    <NumField label="Isc" value={target.panelIsc} onChange={v => updateTarget('panelIsc', v)} unit="A" />
                    <NumField label="Imp" value={target.panelImp} onChange={v => updateTarget('panelImp', v)} unit="A" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <NumField label="Length" value={target.panelLengthMm} onChange={v => updateTarget('panelLengthMm', v)} unit="mm" />
                    <NumField label="Width" value={target.panelWidthMm} onChange={v => updateTarget('panelWidthMm', v)} unit="mm" />
                  </div>
                </div>

                {/* Inverter */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Inverter</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="col-span-2 sm:col-span-1">
                      <TextField label="Model" value={target.inverterModel} onChange={v => updateTarget('inverterModel', v)} />
                    </div>
                    <NumField label="Count" value={target.inverterCount} onChange={v => updateTarget('inverterCount', v)} step={1} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                    <NumField label="Max PV Power" value={target.maxPvPower} onChange={v => updateTarget('maxPvPower', v)} unit="W" />
                    <NumField label="Max Voc" value={target.maxVoc} onChange={v => updateTarget('maxVoc', v)} unit="V" />
                    <NumField label="Max Current/MPPT" value={target.maxCurrentPerMppt} onChange={v => updateTarget('maxCurrentPerMppt', v)} unit="A" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                    <NumField label="MPPT Min" value={target.mpptMin} onChange={v => updateTarget('mpptMin', v)} unit="V" />
                    <NumField label="MPPT Max" value={target.mpptMax} onChange={v => updateTarget('mpptMax', v)} unit="V" />
                    <NumField label="MPPTs/Inverter" value={target.mpptsPerInverter} onChange={v => updateTarget('mpptsPerInverter', v)} step={1} />
                    <NumField label="Strings/MPPT" value={target.stringsPerMppt} onChange={v => updateTarget('stringsPerMppt', v)} step={1} />
                  </div>
                </div>

                {/* Battery */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Battery</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="col-span-2 sm:col-span-1">
                      <TextField label="Model" value={target.batteryModel} onChange={v => updateTarget('batteryModel', v)} />
                    </div>
                    <NumField label="Count" value={target.batteryCount} onChange={v => updateTarget('batteryCount', v)} step={1} />
                    <NumField label="Capacity" value={target.batteryCapacity} onChange={v => updateTarget('batteryCapacity', v)} unit="kWh" />
                    <NumField label="Per Stack" value={target.batteriesPerStack} onChange={v => updateTarget('batteriesPerStack', v)} step={1} />
                  </div>
                </div>

                {/* Racking */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Racking</p>
                  <TextField label="Racking Model" value={target.rackingModel} onChange={v => updateTarget('rackingModel', v)} />
                </div>

                {/* Design Conditions */}
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-green-400 font-semibold mb-2">Design Conditions</p>
                  <div className="grid grid-cols-2 gap-3">
                    <NumField label="Design Temp Low" value={target.designTempLow} onChange={v => updateTarget('designTempLow', v)} unit="C" />
                    <NumField label="Voc Temp Coefficient" value={target.vocTempCoeff} onChange={v => updateTarget('vocTempCoeff', v)} unit="%/C" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Calculate Button */}
        <div className="flex justify-center mb-8">
          <button
            onClick={calculate}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors shadow-lg shadow-green-900/30"
          >
            <Calculator className="w-5 h-5" />
            Calculate Redesign
          </button>
        </div>

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {results && (
          <div id="redesign-results" className="space-y-6">

            {/* 4a. String Sizing */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-green-400 mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                String Sizing
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div>
                  <p className="text-xs text-gray-400">Voc Corrected (cold)</p>
                  <p className="text-lg font-semibold">{results.vocCorrected} V</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Vmp Hot</p>
                  <p className="text-lg font-semibold">{results.vmpHot} V</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Max Modules/String</p>
                  <p className="text-lg font-semibold">{results.maxModulesPerString}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Min Modules/String</p>
                  <p className="text-lg font-semibold">{results.minModulesPerString}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Recommended Size</p>
                  <p className="text-lg font-semibold text-green-400">{results.recommendedStringSize}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Total String Inputs</p>
                  <p className="text-lg font-semibold">{results.totalStringInputs}</p>
                </div>
              </div>
            </div>

            {/* 4b. Panel Fit Estimate */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-green-400 mb-4 flex items-center gap-2">
                <Sun className="w-4 h-4" />
                Panel Fit Estimate
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-gray-700">
                      <th className="text-left py-2 pr-4">Roof Face</th>
                      <th className="text-right py-2 px-4">Old Panels</th>
                      <th className="text-right py-2 px-4">New Panels</th>
                      <th className="text-right py-2 px-4">Delta</th>
                      <th className="text-left py-2 pl-4">Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.panelFitEstimates.map(e => (
                      <tr key={e.roofIndex} className="border-b border-gray-700/50">
                        <td className="py-2 pr-4">Roof {e.roofIndex + 1} ({existing.roofFaces[e.roofIndex]?.azimuth}° / {existing.roofFaces[e.roofIndex]?.tilt}°)</td>
                        <td className="text-right py-2 px-4">{e.oldCount}</td>
                        <td className="text-right py-2 px-4 font-semibold">{e.newCount}</td>
                        <td className={cn('text-right py-2 px-4 font-semibold', e.newCount - e.oldCount >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {e.newCount - e.oldCount >= 0 ? '+' : ''}{e.newCount - e.oldCount}
                        </td>
                        <td className="py-2 pl-4 text-gray-400">{e.method}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2 pr-4">Total</td>
                      <td className="text-right py-2 px-4">{existing.panelCount}</td>
                      <td className="text-right py-2 px-4 text-green-400">{results.newTotalPanels}</td>
                      <td className={cn('text-right py-2 px-4', results.newTotalPanels - existing.panelCount >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {results.newTotalPanels - existing.panelCount >= 0 ? '+' : ''}{results.newTotalPanels - existing.panelCount}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4c. Auto String Configuration */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-green-400 mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                String Configuration
              </h3>
              {results.stringConfigs.length === 0 ? (
                <p className="text-gray-400 text-sm">No strings configured. Check panel counts and string sizing parameters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs border-b border-gray-700">
                        <th className="text-left py-2 pr-3">Inverter</th>
                        <th className="text-left py-2 px-3">MPPT</th>
                        <th className="text-left py-2 px-3">String</th>
                        <th className="text-right py-2 px-3">Modules</th>
                        <th className="text-right py-2 px-3">Voc Cold (V)</th>
                        <th className="text-right py-2 px-3">Vmp Nom (V)</th>
                        <th className="text-right py-2 px-3">Imp (A)</th>
                        <th className="text-left py-2 pl-3">Roof Face</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.stringConfigs.map((sc, i) => {
                        const inverterId = Math.ceil((sc.mppt) / target.mpptsPerInverter)
                        const mpptInInverter = ((sc.mppt - 1) % target.mpptsPerInverter) + 1
                        return (
                          <tr key={i} className="border-b border-gray-700/50">
                            <td className="py-2 pr-3">INV-{inverterId}</td>
                            <td className="py-2 px-3">MPPT-{mpptInInverter}</td>
                            <td className="py-2 px-3">S{sc.string}</td>
                            <td className="text-right py-2 px-3 font-semibold">{sc.modules}</td>
                            <td className={cn('text-right py-2 px-3', sc.vocCold > target.maxVoc ? 'text-red-400 font-semibold' : '')}>
                              {sc.vocCold}
                            </td>
                            <td className={cn('text-right py-2 px-3',
                              sc.vmpNominal < target.mpptMin ? 'text-red-400 font-semibold' :
                              sc.vmpNominal > target.mpptMax ? 'text-amber-400 font-semibold' : ''
                            )}>
                              {sc.vmpNominal}
                            </td>
                            <td className="text-right py-2 px-3">{sc.current}</td>
                            <td className="py-2 pl-3 text-gray-400">
                              {sc.roofFaceIndex >= 0 ? `Roof ${sc.roofFaceIndex + 1}` : 'Overflow'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-500 mt-2">
                    Total modules assigned: {results.stringConfigs.reduce((s, c) => s + c.modules, 0)} of {results.newTotalPanels} estimated
                  </p>
                </div>
              )}
            </div>

            {/* 4d. BOM Comparison */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-green-400 mb-4 flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                BOM Comparison
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-gray-700">
                      <th className="text-left py-2 pr-4">Component</th>
                      <th className="text-left py-2 px-4">Existing</th>
                      <th className="text-left py-2 pl-4">New</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-700/50">
                      <td className="py-2.5 pr-4 text-gray-400">Panels</td>
                      <td className="py-2.5 px-4">{existing.panelCount} x {existing.panelModel} ({existing.panelWattage}W)</td>
                      <td className="py-2.5 pl-4 text-green-400">{results.newTotalPanels} x {target.panelModel} ({target.panelWattage}W)</td>
                    </tr>
                    <tr className="border-b border-gray-700/50">
                      <td className="py-2.5 pr-4 text-gray-400">System DC</td>
                      <td className="py-2.5 px-4">{results.existingSystemDc} kW</td>
                      <td className="py-2.5 pl-4 text-green-400">{results.newSystemDc} kW</td>
                    </tr>
                    <tr className="border-b border-gray-700/50">
                      <td className="py-2.5 pr-4 text-gray-400">Inverters</td>
                      <td className="py-2.5 px-4">{existing.inverterCount} x {existing.inverterModel}</td>
                      <td className="py-2.5 pl-4 text-green-400">{target.inverterCount} x {target.inverterModel}</td>
                    </tr>
                    <tr className="border-b border-gray-700/50">
                      <td className="py-2.5 pr-4 text-gray-400">AC Output</td>
                      <td className="py-2.5 px-4">{results.existingTotalAc} kW</td>
                      <td className="py-2.5 pl-4 text-green-400">{results.newTotalAc} kW</td>
                    </tr>
                    <tr className="border-b border-gray-700/50">
                      <td className="py-2.5 pr-4 text-gray-400">Batteries</td>
                      <td className="py-2.5 px-4">{existing.batteryCount} x {existing.batteryModel}</td>
                      <td className="py-2.5 pl-4 text-green-400">{target.batteryCount} x {target.batteryModel}</td>
                    </tr>
                    <tr className="border-b border-gray-700/50">
                      <td className="py-2.5 pr-4 text-gray-400">Storage</td>
                      <td className="py-2.5 px-4">{results.existingTotalStorage} kWh</td>
                      <td className="py-2.5 pl-4 text-green-400">{results.newTotalStorage} kWh</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-gray-400">Racking</td>
                      <td className="py-2.5 px-4">{existing.rackingType}</td>
                      <td className="py-2.5 pl-4 text-green-400">{target.rackingModel}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4e. Engineering Notes */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-amber-400 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Engineering Notes
              </h3>
              <ul className="space-y-2">
                {results.engineeringNotes.map((note, i) => {
                  const isWarning = note.startsWith('WARNING')
                  return (
                    <li key={i} className={cn(
                      'text-sm flex items-start gap-2 py-1.5 px-3 rounded',
                      isWarning ? 'bg-red-900/30 text-red-300 border border-red-800/50' : 'bg-gray-700/50 text-gray-300'
                    )}>
                      {isWarning && <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />}
                      {note}
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* 4f. Single-Line Diagram */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Electrical Single-Line Diagram
                </h3>
                <button
                  onClick={() => {
                    const svg = document.getElementById('sld-svg')
                    if (!svg) return
                    const clone = svg.cloneNode(true) as SVGElement
                    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
                    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' })
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(blob)
                    a.download = `SLD-${existing.projectName.replace(/\s+/g, '-')}.svg`
                    a.click()
                  }}
                  className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-md px-3 py-1.5 transition-colors"
                >
                  Download SVG
                </button>
                <button
                  onClick={() => {
                    const dxf = generateSingleLineDxf({
                      projectName: existing.projectName,
                      address: existing.address,
                      panelModel: target.panelModel,
                      panelWattage: target.panelWattage,
                      panelCount: results.newTotalPanels,
                      inverterModel: target.inverterModel,
                      inverterCount: target.inverterCount,
                      inverterAcPower: 15,
                      maxPvPower: target.maxPvPower,
                      mpptsPerInverter: target.mpptsPerInverter,
                      stringsPerMppt: target.stringsPerMppt,
                      batteryModel: target.batteryModel,
                      batteryCount: target.batteryCount,
                      batteryCapacity: target.batteryCapacity,
                      batteriesPerStack: target.batteriesPerStack,
                      strings: results.stringConfigs,
                      systemDcKw: results.newSystemDc,
                      totalStorageKwh: results.newTotalStorage,
                      rackingModel: target.rackingModel,
                    })
                    const blob = new Blob([dxf], { type: 'application/dxf' })
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(blob)
                    a.download = `SLD-${existing.projectName.replace(/\s+/g, '-')}.dxf`
                    a.click()
                  }}
                  className="text-xs text-green-400 hover:text-green-300 border border-green-700 hover:border-green-500 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Download DXF (AutoCAD)
                </button>
                <button
                  onClick={() => {
                    const svg = document.getElementById('sld-svg')
                    if (!svg) return
                    const clone = svg.cloneNode(true) as SVGElement
                    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
                    const win = window.open('', '_blank')
                    if (!win) return
                    win.document.write(`<!DOCTYPE html><html><head><title>SLD - ${existing.projectName}</title><style>@page{size:landscape;margin:0.25in}body{margin:0;padding:0;background:white}svg{width:100%;height:auto}</style></head><body>${clone.outerHTML}</body></html>`)
                    win.document.close()
                    setTimeout(() => win.print(), 500)
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Print / Save as PDF
                </button>
              </div>
              <div className="overflow-x-auto bg-white rounded-lg p-4">
                <SingleLineDiagram
                  existing={existing}
                  target={target}
                  results={results}
                />
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
