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

// ── SINGLE-LINE DIAGRAM ──────────────────────────────────────────────────────

function SingleLineDiagram({ existing, target, results }: {
  existing: ExistingSystem; target: TargetSystem; results: Results
}) {
  const inverterCount = target.inverterCount
  const batteriesPerStack = target.batteriesPerStack
  const batteryStacks = Math.ceil(target.batteryCount / batteriesPerStack)

  // Group strings by inverter
  const stringsByInverter: StringConfig[][] = []
  for (const sc of results.stringConfigs) {
    const invIdx = Math.ceil(sc.mppt / target.mpptsPerInverter) - 1
    if (!stringsByInverter[invIdx]) stringsByInverter[invIdx] = []
    stringsByInverter[invIdx].push(sc)
  }

  // Layout constants
  const invWidth = 160
  const invHeight = 80
  const invSpacing = 420
  const startX = 60
  const invY = 280
  const svgWidth = Math.max(startX + inverterCount * invSpacing + 200, 900)
  const svgHeight = 650

  // Colors
  const c = {
    wire: '#333', wirePv: '#d97706', wireBatt: '#059669', wireAc: '#2563eb',
    box: '#f3f4f6', boxStroke: '#6b7280', text: '#111827', textSm: '#6b7280',
    panel: '#fbbf24', batt: '#10b981', inv: '#3b82f6', meter: '#8b5cf6',
    grid: '#ef4444',
  }

  return (
    <svg id="sld-svg" viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ minWidth: 800 }}>
      {/* Title block */}
      <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="white" />
      <text x={svgWidth / 2} y="24" textAnchor="middle" fontSize="16" fontWeight="bold" fill={c.text}>
        ELECTRICAL SINGLE-LINE DIAGRAM
      </text>
      <text x={svgWidth / 2} y="42" textAnchor="middle" fontSize="11" fill={c.textSm}>
        {existing.projectName} — {existing.address}
      </text>
      <text x={svgWidth / 2} y="56" textAnchor="middle" fontSize="10" fill={c.textSm}>
        {results.newTotalPanels} x {target.panelModel} ({target.panelWattage}W) = {results.newSystemDc} kW DC | {inverterCount} x {target.inverterModel}
      </text>

      {/* Per-inverter sections */}
      {Array.from({ length: inverterCount }, (_, inv) => {
        const cx = startX + inv * invSpacing + invSpacing / 2
        const strings = stringsByInverter[inv] ?? []
        const stackIdx = inv < batteryStacks ? inv : -1
        const battsInStack = stackIdx >= 0 ? Math.min(batteriesPerStack, target.batteryCount - stackIdx * batteriesPerStack) : 0

        return (
          <g key={inv}>
            {/* Section label */}
            <text x={cx} y="78" textAnchor="middle" fontSize="12" fontWeight="bold" fill={c.text}>
              INVERTER {inv + 1}
            </text>

            {/* PV Array strings */}
            {strings.map((sc, si) => {
              const sx = cx - ((strings.length - 1) * 50) / 2 + si * 50
              const panelY = 100
              const panelH = 30
              const panelW = 40
              return (
                <g key={si}>
                  {/* Panel box */}
                  <rect x={sx - panelW / 2} y={panelY} width={panelW} height={panelH} rx="3"
                    fill="none" stroke={c.panel} strokeWidth="2" />
                  <text x={sx} y={panelY + 12} textAnchor="middle" fontSize="7" fontWeight="bold" fill={c.panel}>PV</text>
                  <text x={sx} y={panelY + 22} textAnchor="middle" fontSize="6" fill={c.text}>{sc.modules}x</text>
                  {/* String label */}
                  <text x={sx} y={panelY - 4} textAnchor="middle" fontSize="6" fill={c.textSm}>
                    S{si + 1}
                  </text>
                  {/* Wire down to RSD */}
                  <line x1={sx} y1={panelY + panelH} x2={sx} y2={panelY + panelH + 20}
                    stroke={c.wirePv} strokeWidth="1.5" />
                  {/* RSD box */}
                  <rect x={sx - 12} y={panelY + panelH + 20} width={24} height={16} rx="2"
                    fill="none" stroke={c.wirePv} strokeWidth="1" />
                  <text x={sx} y={panelY + panelH + 31} textAnchor="middle" fontSize="5.5" fill={c.text}>RSD</text>
                  {/* Wire from RSD to combiner line */}
                  <line x1={sx} y1={panelY + panelH + 36} x2={sx} y2={invY - 60}
                    stroke={c.wirePv} strokeWidth="1.5" />
                  {/* Voltage label */}
                  <text x={sx + 22} y={panelY + panelH + 55} fontSize="5" fill={c.textSm}>
                    {sc.vocCold}V
                  </text>
                </g>
              )
            })}

            {/* DC bus / combiner line */}
            {strings.length > 0 && (
              <>
                <line
                  x1={cx - ((strings.length - 1) * 50) / 2}
                  y1={invY - 60}
                  x2={cx + ((strings.length - 1) * 50) / 2}
                  y2={invY - 60}
                  stroke={c.wirePv} strokeWidth="2"
                />
                <text x={cx} y={invY - 65} textAnchor="middle" fontSize="7" fill={c.wirePv}>
                  DC BUS
                </text>
                {/* Wire from bus to inverter */}
                <line x1={cx} y1={invY - 60} x2={cx} y2={invY} stroke={c.wirePv} strokeWidth="2" />
              </>
            )}

            {/* DC Disconnect */}
            <rect x={cx - 20} y={invY - 30} width={40} height={16} rx="2"
              fill="none" stroke={c.boxStroke} strokeWidth="1.5" />
            <text x={cx} y={invY - 19} textAnchor="middle" fontSize="6" fill={c.text}>DC DISC</text>

            {/* Inverter box */}
            <rect x={cx - invWidth / 2} y={invY} width={invWidth} height={invHeight} rx="6"
              fill="none" stroke={c.inv} strokeWidth="2.5" />
            <text x={cx} y={invY + 20} textAnchor="middle" fontSize="9" fontWeight="bold" fill={c.inv}>
              {target.inverterModel.split(' ').slice(0, 3).join(' ')}
            </text>
            <text x={cx} y={invY + 33} textAnchor="middle" fontSize="8" fill={c.text}>
              15kW / {target.mpptsPerInverter} MPPT
            </text>
            <text x={cx} y={invY + 46} textAnchor="middle" fontSize="7" fill={c.textSm}>
              {strings.reduce((s, sc2) => s + sc2.modules, 0)} modules / {(strings.reduce((s, sc2) => s + sc2.modules, 0) * target.panelWattage / 1000).toFixed(1)} kW
            </text>
            <text x={cx} y={invY + 58} textAnchor="middle" fontSize="7" fill={c.textSm}>
              200A Backup / 96.5% CEC
            </text>

            {/* Battery stack (left side of inverter) */}
            {stackIdx >= 0 && (
              <g>
                <line x1={cx - invWidth / 2} y1={invY + invHeight / 2}
                  x2={cx - invWidth / 2 - 60} y2={invY + invHeight / 2}
                  stroke={c.wireBatt} strokeWidth="2" />
                {/* Battery stack */}
                <rect x={cx - invWidth / 2 - 120} y={invY + 5} width={55} height={invHeight - 10} rx="4"
                  fill="none" stroke={c.batt} strokeWidth="2" />
                <text x={cx - invWidth / 2 - 92} y={invY + 28} textAnchor="middle" fontSize="8" fontWeight="bold" fill={c.batt}>
                  BATT
                </text>
                <text x={cx - invWidth / 2 - 92} y={invY + 40} textAnchor="middle" fontSize="7" fill={c.text}>
                  {battsInStack}x {target.batteryCapacity}kWh
                </text>
                <text x={cx - invWidth / 2 - 92} y={invY + 52} textAnchor="middle" fontSize="7" fill={c.textSm}>
                  {battsInStack * target.batteryCapacity}kWh
                </text>
                <text x={cx - invWidth / 2 - 92} y={invY + 63} textAnchor="middle" fontSize="6" fill={c.textSm}>
                  Stack of {battsInStack}
                </text>
              </g>
            )}

            {/* AC output (below inverter) */}
            <line x1={cx} y1={invY + invHeight} x2={cx} y2={invY + invHeight + 30}
              stroke={c.wireAc} strokeWidth="2" />
            {/* AC Disconnect */}
            <rect x={cx - 22} y={invY + invHeight + 30} width={44} height={16} rx="2"
              fill="none" stroke={c.boxStroke} strokeWidth="1.5" />
            <text x={cx} y={invY + invHeight + 41} textAnchor="middle" fontSize="6" fill={c.text}>AC DISC</text>

            {/* Wire to smart panel bus */}
            <line x1={cx} y1={invY + invHeight + 46} x2={cx} y2={invY + invHeight + 90}
              stroke={c.wireAc} strokeWidth="2" />
            <text x={cx + 25} y={invY + invHeight + 65} fontSize="6" fill={c.wireAc}>
              240V / 125A
            </text>
          </g>
        )
      })}

      {/* Smart Panel / Main Bus */}
      {(() => {
        const busY = invY + invHeight + 90
        const busLeft = startX + invSpacing / 2 - 40
        const busRight = startX + (inverterCount - 1) * invSpacing + invSpacing / 2 + 40
        const busMid = (busLeft + busRight) / 2

        return (
          <g>
            {/* Bus bar */}
            <line x1={busLeft} y1={busY} x2={busRight} y2={busY}
              stroke={c.wireAc} strokeWidth="3" />
            <text x={busMid} y={busY - 6} textAnchor="middle" fontSize="9" fontWeight="bold" fill={c.wireAc}>
              SMART ELECTRICAL PANEL — 260A RATED, 240V
            </text>

            {/* Main breaker (left) */}
            <line x1={busLeft - 20} y1={busY} x2={busLeft - 20} y2={busY + 50}
              stroke={c.wireAc} strokeWidth="2" />
            <rect x={busLeft - 44} y={busY + 50} width={48} height={20} rx="3"
              fill="none" stroke={c.boxStroke} strokeWidth="1.5" />
            <text x={busLeft - 20} y={busY + 63} textAnchor="middle" fontSize="7" fill={c.text}>
              MAIN 125A
            </text>

            {/* Utility meter + grid (right) */}
            <line x1={busRight + 20} y1={busY} x2={busRight + 20} y2={busY + 30}
              stroke={c.wireAc} strokeWidth="2" />
            {/* Gen disconnect */}
            <rect x={busRight - 2} y={busY + 30} width={44} height={16} rx="2"
              fill="none" stroke={c.boxStroke} strokeWidth="1.5" />
            <text x={busRight + 20} y={busY + 41} textAnchor="middle" fontSize="6" fill={c.text}>GEN DISC</text>
            <line x1={busRight + 20} y1={busY + 46} x2={busRight + 20} y2={busY + 70}
              stroke={c.wireAc} strokeWidth="2" />
            {/* Utility meter */}
            <circle cx={busRight + 20} cy={busY + 82} r="14"
              fill="none" stroke={c.meter} strokeWidth="2" />
            <text x={busRight + 20} y={busY + 85} textAnchor="middle" fontSize="7" fontWeight="bold" fill={c.meter}>
              METER
            </text>
            <line x1={busRight + 20} y1={busY + 96} x2={busRight + 20} y2={busY + 116}
              stroke={c.grid} strokeWidth="2" />
            {/* Grid */}
            <text x={busRight + 20} y={busY + 128} textAnchor="middle" fontSize="8" fontWeight="bold" fill={c.grid}>
              UTILITY GRID
            </text>
            <text x={busRight + 20} y={busY + 140} textAnchor="middle" fontSize="6" fill={c.textSm}>
              CenterPoint Energy
            </text>

            {/* Existing system (if applicable) */}
            <line x1={busMid + 60} y1={busY} x2={busMid + 60} y2={busY + 40}
              stroke={c.textSm} strokeWidth="1.5" strokeDasharray="4,3" />
            <rect x={busMid + 32} y={busY + 40} width={56} height={30} rx="3"
              fill="none" stroke={c.textSm} strokeWidth="1" strokeDasharray="3,2" />
            <text x={busMid + 60} y={busY + 55} textAnchor="middle" fontSize="6" fill={c.textSm}>
              (E) EXISTING
            </text>
            <text x={busMid + 60} y={busY + 65} textAnchor="middle" fontSize="5" fill={c.textSm}>
              Enphase/Silfab
            </text>
          </g>
        )
      })()}

      {/* Border */}
      <rect x="1" y="1" width={svgWidth - 2} height={svgHeight - 2}
        fill="none" stroke={c.boxStroke} strokeWidth="1" />

      {/* Title block bottom right */}
      <rect x={svgWidth - 220} y={svgHeight - 60} width={218} height={58}
        fill="none" stroke={c.boxStroke} strokeWidth="1" />
      <text x={svgWidth - 110} y={svgHeight - 42} textAnchor="middle" fontSize="8" fontWeight="bold" fill={c.text}>
        {existing.projectName}
      </text>
      <text x={svgWidth - 110} y={svgHeight - 30} textAnchor="middle" fontSize="7" fill={c.textSm}>
        {existing.address}
      </text>
      <text x={svgWidth - 110} y={svgHeight - 18} textAnchor="middle" fontSize="6" fill={c.textSm}>
        REDESIGN — {target.panelModel} / {target.inverterModel.split(' ').slice(0, 3).join(' ')}
      </text>
      <text x={svgWidth - 110} y={svgHeight - 8} textAnchor="middle" fontSize="6" fill={c.textSm}>
        GENERATED {new Date().toLocaleDateString('en-US')} — FOR PE REVIEW ONLY
      </text>
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
