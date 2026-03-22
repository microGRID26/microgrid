'use client'

import { useState, useCallback, useRef } from 'react'
import { Nav } from '@/components/Nav'
import { cn } from '@/lib/utils'
import {
  Layers, Upload, Plus, Play, Download, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, XCircle, Clock, Trash2, FileText,
  Sun, Zap, Battery, ArrowRight, Settings,
} from 'lucide-react'

// ── TYPES ────────────────────────────────────────────────────────────────────

interface RoofFace {
  panelCount: number
  azimuth: number
  tilt: number
  roofArea: number
}

interface ProjectInput {
  id: string
  fileName: string
  projectName: string
  address: string
  // Existing system
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
  // Processing state
  status: 'pending' | 'editing' | 'processing' | 'complete' | 'error'
  results?: ProcessedResults
  error?: string
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

interface PanelFitEstimate {
  roofIndex: number
  oldCount: number
  newCount: number
  method: string
}

interface ProcessedResults {
  vocCorrected: number
  maxModulesPerString: number
  minModulesPerString: number
  recommendedStringSize: number
  totalStringInputs: number
  vmpHot: number
  panelFitEstimates: PanelFitEstimate[]
  stringConfigs: StringConfig[]
  engineeringNotes: string[]
  newTotalPanels: number
  newSystemDc: number
  oldSystemDc: number
  newTotalAc: number
  oldTotalAc: number
  newTotalStorage: number
  oldTotalStorage: number
  warnings: string[]
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

// ── DEFAULTS ─────────────────────────────────────────────────────────────────

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

const SAMPLE_PROJECT: Omit<ProjectInput, 'id'> = {
  fileName: 'PROJ-29857_Aguilera_PlanSet.pdf',
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
  status: 'editing',
  results: undefined,
  error: undefined,
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

let _nextId = 1
function genId() { return `batch-${Date.now()}-${_nextId++}` }

function NumField({ label, value, onChange, unit, step, className }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; className?: string
}) {
  return (
    <div className={className}>
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

function TextField({ label, value, onChange, className }: {
  label: string; value: string; onChange: (v: string) => void; className?: string
}) {
  return (
    <div className={className}>
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

function StatusBadge({ status }: { status: ProjectInput['status'] }) {
  const config = {
    pending: { icon: Clock, text: 'Pending', cls: 'text-gray-400 bg-gray-700' },
    editing: { icon: FileText, text: 'Editing', cls: 'text-blue-400 bg-blue-900/30' },
    processing: { icon: Settings, text: 'Processing', cls: 'text-amber-400 bg-amber-900/30 animate-pulse' },
    complete: { icon: CheckCircle2, text: 'Complete', cls: 'text-green-400 bg-green-900/30' },
    error: { icon: XCircle, text: 'Error', cls: 'text-red-400 bg-red-900/30' },
  }[status]
  const Icon = config.icon
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', config.cls)}>
      <Icon className="w-3 h-3" />
      {config.text}
    </span>
  )
}

// ── CALCULATION (duplicated from redesign page) ──────────────────────────────

function calculateRedesign(project: ProjectInput, target: TargetSystem): ProcessedResults {
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

  const panelFitEstimates = project.roofFaces.slice(0, project.roofFaceCount).map((rf, i) => {
    let newCount: number
    let method: string
    if (panelAreaSqFt > 0 && rf.roofArea > 0) {
      newCount = Math.floor(rf.roofArea / panelAreaSqFt)
      method = 'area-based'
    } else {
      newCount = Math.floor(rf.panelCount * (project.panelWattage / target.panelWattage) * 1.05)
      method = 'ratio-based'
    }
    return { roofIndex: i, oldCount: rf.panelCount, newCount, method }
  })

  const newTotalPanels = panelFitEstimates.reduce((s, e) => s + e.newCount, 0)

  // Auto string configuration
  const stringConfigs: StringConfig[] = []
  const maxStrings = totalStringInputs
  const neededStrings = Math.min(Math.ceil(newTotalPanels / recommendedStringSize), maxStrings)
  const baseSize = Math.floor(newTotalPanels / neededStrings)
  const extraPanels = newTotalPanels % neededStrings

  const stringSizes: number[] = []
  for (let i = 0; i < neededStrings; i++) {
    let size = baseSize + (i < extraPanels ? 1 : 0)
    if (size > maxModulesPerString) size = maxModulesPerString
    stringSizes.push(size)
  }

  // Assign strings to roof faces proportionally
  const roofFaceAssignments: number[] = []
  let stringIdx = 0
  for (let ri = 0; ri < panelFitEstimates.length && stringIdx < stringSizes.length; ri++) {
    let roofRemaining = panelFitEstimates[ri].newCount
    while (roofRemaining > 0 && stringIdx < stringSizes.length) {
      const take = Math.min(stringSizes[stringIdx], roofRemaining)
      if (take < minModulesPerString && roofRemaining < minModulesPerString) break
      roofFaceAssignments[stringIdx] = ri
      roofRemaining -= stringSizes[stringIdx]
      stringIdx++
    }
  }
  while (stringIdx < stringSizes.length) {
    roofFaceAssignments[stringIdx] = -1
    stringIdx++
  }

  // Build string configs with inverter/MPPT assignment
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

  // Warnings / engineering notes
  const warnings: string[] = []
  const engineeringNotes: string[] = []
  const newSystemDc = parseFloat(((newTotalPanels * target.panelWattage) / 1000).toFixed(2))
  const totalMaxPv = (target.inverterCount * target.maxPvPower) / 1000

  if (newSystemDc > totalMaxPv) {
    warnings.push(`System DC (${newSystemDc} kW) exceeds inverter PV capacity (${totalMaxPv.toFixed(1)} kW)`)
  }

  for (const sc of stringConfigs) {
    if (sc.vocCold > target.maxVoc) {
      warnings.push(`MPPT ${sc.mppt} Str ${sc.string}: Voc_cold (${sc.vocCold}V) > max Voc (${target.maxVoc}V)`)
    }
    if (sc.vmpNominal < target.mpptMin) {
      warnings.push(`MPPT ${sc.mppt} Str ${sc.string}: Vmp (${sc.vmpNominal}V) < MPPT min (${target.mpptMin}V)`)
    }
  }

  if (newTotalPanels !== project.panelCount) {
    engineeringNotes.push('Structural letter may need update — panel count changed')
  }
  engineeringNotes.push('String calculations require PE review before permitting')

  const oldSystemDc = parseFloat(((project.panelCount * project.panelWattage) / 1000).toFixed(2))
  const oldTotalAc = project.inverterCount * project.inverterAcPower
  const newTotalAc = target.inverterCount * 15
  const oldTotalStorage = project.batteryCount * project.batteryCapacity
  const newTotalStorage = target.batteryCount * target.batteryCapacity

  return {
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
    newSystemDc,
    oldSystemDc,
    newTotalAc,
    oldTotalAc,
    newTotalStorage,
    oldTotalStorage,
    warnings,
  }
}

// ── PROJECT EDIT FORM ────────────────────────────────────────────────────────

function ProjectEditForm({ project, onChange }: {
  project: ProjectInput
  onChange: (updated: ProjectInput) => void
}) {
  function update<K extends keyof ProjectInput>(key: K, val: ProjectInput[K]) {
    onChange({ ...project, [key]: val })
  }

  function updateRoofFace(idx: number, key: keyof RoofFace, val: number) {
    const faces = [...project.roofFaces]
    faces[idx] = { ...faces[idx], [key]: val }
    onChange({ ...project, roofFaces: faces })
  }

  function handleRoofFaceCountChange(count: number) {
    const clamped = Math.max(1, Math.min(8, count))
    const faces = [...project.roofFaces]
    while (faces.length < clamped) faces.push({ panelCount: 0, azimuth: 180, tilt: 20, roofArea: 0 })
    onChange({ ...project, roofFaceCount: clamped, roofFaces: faces.slice(0, clamped) })
  }

  return (
    <div className="space-y-4 p-4 bg-gray-900/50 rounded-lg">
      {/* Project info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="Project Name" value={project.projectName} onChange={v => update('projectName', v)} />
        <TextField label="Address" value={project.address} onChange={v => update('address', v)} />
      </div>

      {/* Panels */}
      <div className="border-t border-gray-700 pt-3">
        <p className="text-xs text-green-400 font-semibold mb-2">Existing Panels</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <TextField label="Panel Model" value={project.panelModel} onChange={v => update('panelModel', v)} />
          <NumField label="Wattage" value={project.panelWattage} onChange={v => update('panelWattage', v)} unit="W" />
          <NumField label="Count" value={project.panelCount} onChange={v => update('panelCount', v)} step={1} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
          <NumField label="Voc" value={project.panelVoc} onChange={v => update('panelVoc', v)} unit="V" />
          <NumField label="Vmp" value={project.panelVmp} onChange={v => update('panelVmp', v)} unit="V" />
          <NumField label="Isc" value={project.panelIsc} onChange={v => update('panelIsc', v)} unit="A" />
          <NumField label="Imp" value={project.panelImp} onChange={v => update('panelImp', v)} unit="A" />
        </div>
      </div>

      {/* Inverter */}
      <div className="border-t border-gray-700 pt-3">
        <p className="text-xs text-green-400 font-semibold mb-2">Existing Inverter</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <TextField label="Model" value={project.inverterModel} onChange={v => update('inverterModel', v)} />
          <NumField label="Count" value={project.inverterCount} onChange={v => update('inverterCount', v)} step={1} />
          <NumField label="AC Power" value={project.inverterAcPower} onChange={v => update('inverterAcPower', v)} unit="kW" />
        </div>
      </div>

      {/* Battery */}
      <div className="border-t border-gray-700 pt-3">
        <p className="text-xs text-green-400 font-semibold mb-2">Existing Battery</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <TextField label="Model" value={project.batteryModel} onChange={v => update('batteryModel', v)} />
          <NumField label="Count" value={project.batteryCount} onChange={v => update('batteryCount', v)} step={1} />
          <NumField label="Capacity" value={project.batteryCapacity} onChange={v => update('batteryCapacity', v)} unit="kWh" />
        </div>
      </div>

      {/* Racking */}
      <div className="border-t border-gray-700 pt-3">
        <p className="text-xs text-green-400 font-semibold mb-2">Racking</p>
        <TextField label="Racking Type" value={project.rackingType} onChange={v => update('rackingType', v)} />
      </div>

      {/* Roof Faces */}
      <div className="border-t border-gray-700 pt-3">
        <div className="flex items-center gap-3 mb-2">
          <p className="text-xs text-green-400 font-semibold">Roof Faces</p>
          <input
            type="number"
            min={1}
            max={8}
            value={project.roofFaceCount}
            onChange={e => handleRoofFaceCountChange(parseInt(e.target.value) || 1)}
            className="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:border-green-500 focus:outline-none"
          />
        </div>
        {project.roofFaces.slice(0, project.roofFaceCount).map((rf, i) => (
          <div key={i} className="bg-gray-800/50 rounded p-3 mb-2">
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
  )
}

// ── PROJECT RESULTS DETAIL ───────────────────────────────────────────────────

function ProjectResultsDetail({ project, target }: { project: ProjectInput; target: TargetSystem }) {
  const r = project.results
  if (!r) return null

  return (
    <div className="space-y-4 p-4 bg-gray-900/50 rounded-lg">
      {/* Warnings */}
      {r.warnings.length > 0 && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
          <p className="text-xs font-semibold text-red-400 mb-1">Warnings</p>
          {r.warnings.map((w, i) => (
            <p key={i} className="text-xs text-red-300 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      {/* String Sizing Summary */}
      <div>
        <p className="text-xs font-semibold text-green-400 mb-2">String Sizing</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <div>
            <p className="text-[10px] text-gray-400">Voc Corrected</p>
            <p className="text-sm font-semibold">{r.vocCorrected} V</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Vmp Hot</p>
            <p className="text-sm font-semibold">{r.vmpHot} V</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Max Mod/Str</p>
            <p className="text-sm font-semibold">{r.maxModulesPerString}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Min Mod/Str</p>
            <p className="text-sm font-semibold">{r.minModulesPerString}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Recommended</p>
            <p className="text-sm font-semibold text-green-400">{r.recommendedStringSize}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">String Inputs</p>
            <p className="text-sm font-semibold">{r.totalStringInputs}</p>
          </div>
        </div>
      </div>

      {/* Panel Fit */}
      <div>
        <p className="text-xs font-semibold text-green-400 mb-2">Panel Fit Estimate</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left py-1.5">Roof</th>
              <th className="text-right py-1.5">Old</th>
              <th className="text-right py-1.5">New</th>
              <th className="text-right py-1.5">Delta</th>
              <th className="text-left py-1.5 pl-3">Method</th>
            </tr>
          </thead>
          <tbody>
            {r.panelFitEstimates.map(e => (
              <tr key={e.roofIndex} className="border-b border-gray-700/50">
                <td className="py-1.5">Face {e.roofIndex + 1}</td>
                <td className="text-right py-1.5">{e.oldCount}</td>
                <td className="text-right py-1.5 font-semibold">{e.newCount}</td>
                <td className={cn('text-right py-1.5 font-semibold', e.newCount - e.oldCount >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {e.newCount - e.oldCount >= 0 ? '+' : ''}{e.newCount - e.oldCount}
                </td>
                <td className="py-1.5 pl-3 text-gray-400">{e.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* String Configs */}
      <div>
        <p className="text-xs font-semibold text-green-400 mb-2">String Configuration</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left py-1.5">MPPT</th>
              <th className="text-left py-1.5">String</th>
              <th className="text-right py-1.5">Modules</th>
              <th className="text-right py-1.5">Voc Cold</th>
              <th className="text-right py-1.5">Vmp</th>
              <th className="text-right py-1.5">Current</th>
              <th className="text-left py-1.5 pl-3">Roof</th>
            </tr>
          </thead>
          <tbody>
            {r.stringConfigs.map((sc, i) => (
              <tr key={i} className="border-b border-gray-700/50">
                <td className="py-1.5">{sc.mppt}</td>
                <td className="py-1.5">{sc.string}</td>
                <td className="text-right py-1.5 font-semibold">{sc.modules}</td>
                <td className={cn('text-right py-1.5', sc.vocCold > target.maxVoc ? 'text-red-400 font-semibold' : '')}>
                  {sc.vocCold} V
                </td>
                <td className={cn('text-right py-1.5', sc.vmpNominal < target.mpptMin ? 'text-red-400 font-semibold' : '')}>
                  {sc.vmpNominal} V
                </td>
                <td className="text-right py-1.5">{sc.current} A</td>
                <td className="py-1.5 pl-3 text-gray-400">
                  {sc.roofFaceIndex >= 0 ? `Face ${sc.roofFaceIndex + 1}` : 'Overflow'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Engineering Notes */}
      {r.engineeringNotes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-400 mb-2">Engineering Notes</p>
          {r.engineeringNotes.map((note, i) => (
            <p key={i} className="text-xs text-gray-300 mb-0.5">- {note}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── PAGE ─────────────────────────────────────────────────────────────────────

export default function BatchPage() {
  const [target, setTarget] = useState<TargetSystem>(DEFAULT_TARGET)
  const [projects, setProjects] = useState<ProjectInput[]>([])
  const [showTarget, setShowTarget] = useState(false)
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Target updater ──────────────────────────────────────────────────────────
  function updateTarget<K extends keyof TargetSystem>(key: K, val: TargetSystem[K]) {
    setTarget(prev => ({ ...prev, [key]: val }))
  }

  // ── Project management ──────────────────────────────────────────────────────
  function addProject(partial?: Partial<ProjectInput>) {
    const id = genId()
    const newProject: ProjectInput = {
      id,
      fileName: '',
      projectName: '',
      address: '',
      panelModel: '',
      panelWattage: 0,
      panelCount: 0,
      panelVoc: 0,
      panelVmp: 0,
      panelIsc: 0,
      panelImp: 0,
      inverterModel: '',
      inverterCount: 0,
      inverterAcPower: 0,
      batteryModel: '',
      batteryCount: 0,
      batteryCapacity: 0,
      rackingType: '',
      roofFaceCount: 1,
      roofFaces: [{ panelCount: 0, azimuth: 180, tilt: 20, roofArea: 0 }],
      status: 'editing',
      ...partial,
    }
    setProjects(prev => [...prev, newProject])
    setExpandedProject(id)
  }

  function addSampleProject() {
    const id = genId()
    setProjects(prev => [...prev, { ...SAMPLE_PROJECT, id }])
    setExpandedProject(id)
  }

  function updateProject(id: string, updated: ProjectInput) {
    setProjects(prev => prev.map(p => p.id === id ? updated : p))
  }

  function removeProject(id: string) {
    setProjects(prev => prev.filter(p => p.id !== id))
    if (expandedProject === id) setExpandedProject(null)
  }

  // ── File upload handler ─────────────────────────────────────────────────────
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) continue
      const id = genId()
      const newProject: ProjectInput = {
        id,
        fileName: file.name,
        projectName: file.name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
        address: '',
        panelModel: '',
        panelWattage: 0,
        panelCount: 0,
        panelVoc: 0,
        panelVmp: 0,
        panelIsc: 0,
        panelImp: 0,
        inverterModel: '',
        inverterCount: 0,
        inverterAcPower: 0,
        batteryModel: '',
        batteryCount: 0,
        batteryCapacity: 0,
        rackingType: '',
        roofFaceCount: 1,
        roofFaces: [{ panelCount: 0, azimuth: 180, tilt: 20, roofArea: 0 }],
        status: 'editing',
      }
      setProjects(prev => [...prev, newProject])
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // ── Process all ─────────────────────────────────────────────────────────────
  async function processAll() {
    setProcessing(true)

    // Process each project sequentially with a small delay for UI updates
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]
      if (p.status === 'complete') continue
      if (p.panelCount === 0 || p.panelWattage === 0) {
        setProjects(prev => prev.map(proj =>
          proj.id === p.id ? { ...proj, status: 'error', error: 'Missing required specs (panel wattage and count)' } : proj
        ))
        continue
      }

      // Mark as processing
      setProjects(prev => prev.map(proj =>
        proj.id === p.id ? { ...proj, status: 'processing' } : proj
      ))

      // Small delay so the UI renders the processing state
      await new Promise(resolve => setTimeout(resolve, 150))

      try {
        const results = calculateRedesign(p, target)
        setProjects(prev => prev.map(proj =>
          proj.id === p.id ? { ...proj, status: 'complete', results, error: undefined } : proj
        ))
      } catch (err) {
        setProjects(prev => prev.map(proj =>
          proj.id === p.id ? { ...proj, status: 'error', error: err instanceof Error ? err.message : String(err) } : proj
        ))
      }
    }

    setProcessing(false)
  }

  // ── Download CSV summary ────────────────────────────────────────────────────
  function downloadSummary() {
    const completed = projects.filter(p => p.status === 'complete' && p.results)
    if (completed.length === 0) return

    const headers = [
      'Project Name', 'Address', 'Old Panel Model', 'Old Wattage', 'Old Count',
      'Old DC (kW)', 'New Panel Model', 'New Wattage', 'New Count', 'New DC (kW)',
      'Panel Delta', 'DC Delta (kW)', 'Strings', 'String Config', 'Warnings',
    ]

    const rows = completed.map(p => {
      const r = p.results!
      const stringConfig = r.stringConfigs.map(sc => `${sc.modules}mod`).join(', ')
      return [
        p.projectName,
        p.address,
        p.panelModel,
        p.panelWattage,
        p.panelCount,
        r.oldSystemDc,
        target.panelModel,
        target.panelWattage,
        r.newTotalPanels,
        r.newSystemDc,
        r.newTotalPanels - p.panelCount,
        (r.newSystemDc - r.oldSystemDc).toFixed(2),
        r.stringConfigs.length,
        stringConfig,
        r.warnings.join('; ') || 'None',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    })

    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-redesign-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Stats ───────────────────────────────────────────────────────────────────
  const completedCount = projects.filter(p => p.status === 'complete').length
  const errorCount = projects.filter(p => p.status === 'error').length
  const pendingCount = projects.filter(p => p.status === 'pending' || p.status === 'editing').length
  const totalWarnings = projects.reduce((s, p) => s + (p.results?.warnings.length ?? 0), 0)

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Nav active="Redesign" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-green-400" />
            <div>
              <h1 className="text-xl font-bold">Batch Redesign Processor</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                Upload plan sets and batch-process equipment swaps across multiple projects
              </p>
            </div>
          </div>
          {projects.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-400">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
              {completedCount > 0 && <span className="text-green-400">{completedCount} complete</span>}
              {errorCount > 0 && <span className="text-red-400">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>}
              {pendingCount > 0 && <span className="text-gray-400">{pendingCount} pending</span>}
            </div>
          )}
        </div>

        {/* ── Section 1: Target Equipment ──────────────────────────────────── */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 mb-6">
          <button
            onClick={() => setShowTarget(!showTarget)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-green-400" />
              <h2 className="text-sm font-semibold">Target Equipment</h2>
              <span className="text-xs text-gray-400 ml-2">
                {target.panelModel} / {target.inverterModel} / {target.batteryModel}
              </span>
            </div>
            {showTarget ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showTarget && (
            <div className="px-4 pb-4 space-y-4">
              {/* Panels */}
              <div>
                <p className="text-xs text-green-400 font-semibold mb-2">
                  <Sun className="w-3 h-3 inline mr-1" />
                  Panels
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <TextField label="Panel Model" value={target.panelModel} onChange={v => updateTarget('panelModel', v)} />
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
                <p className="text-xs text-green-400 font-semibold mb-2">
                  <Zap className="w-3 h-3 inline mr-1" />
                  Inverter
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <TextField label="Model" value={target.inverterModel} onChange={v => updateTarget('inverterModel', v)} />
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
                <p className="text-xs text-green-400 font-semibold mb-2">
                  <Battery className="w-3 h-3 inline mr-1" />
                  Battery
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <TextField label="Model" value={target.batteryModel} onChange={v => updateTarget('batteryModel', v)} />
                  <NumField label="Count" value={target.batteryCount} onChange={v => updateTarget('batteryCount', v)} step={1} />
                  <NumField label="Capacity" value={target.batteryCapacity} onChange={v => updateTarget('batteryCapacity', v)} unit="kWh" />
                  <NumField label="Per Stack" value={target.batteriesPerStack} onChange={v => updateTarget('batteriesPerStack', v)} step={1} />
                </div>
              </div>

              {/* Racking + Design Conditions */}
              <div className="border-t border-gray-700 pt-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <TextField label="Racking Model" value={target.rackingModel} onChange={v => updateTarget('rackingModel', v)} />
                  <NumField label="Design Temp Low" value={target.designTempLow} onChange={v => updateTarget('designTempLow', v)} unit="C" />
                  <NumField label="Voc Temp Coefficient" value={target.vocTempCoeff} onChange={v => updateTarget('vocTempCoeff', v)} unit="%/C" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 2: Upload Queue ──────────────────────────────────────── */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 mb-6 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-green-400" />
              Project Queue
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={addSampleProject}
                className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Sample Project
              </button>
              <button
                onClick={() => addProject()}
                className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Blank Project
              </button>
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-600 hover:border-green-500/50 rounded-lg p-8 text-center cursor-pointer transition-colors mb-4"
          >
            <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              Drag & drop PDF plan sets here, or click to browse
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Specs will need to be entered manually for now — AI extraction coming soon
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
          </div>

          {/* Project list */}
          {projects.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              No projects in queue. Add a sample project or upload PDFs to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map(project => {
                const isExpanded = expandedProject === project.id

                return (
                  <div key={project.id} className="bg-gray-900/50 border border-gray-700 rounded-lg overflow-hidden">
                    {/* Project header row */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button
                        onClick={() => setExpandedProject(isExpanded ? null : project.id)}
                        className="text-gray-400 hover:text-white transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>

                      <FileText className="w-4 h-4 text-gray-500 shrink-0" />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {project.projectName || project.fileName || 'Untitled Project'}
                        </p>
                        {project.address && (
                          <p className="text-xs text-gray-400 truncate">{project.address}</p>
                        )}
                      </div>

                      {/* Extracted specs summary */}
                      {project.panelCount > 0 && (
                        <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400">
                          <span>{project.panelCount}x {project.panelWattage}W</span>
                          <span>{(project.panelCount * project.panelWattage / 1000).toFixed(1)} kW</span>
                        </div>
                      )}

                      {/* Results summary when complete */}
                      {project.results && (
                        <div className="hidden md:flex items-center gap-3 text-xs">
                          <span className="text-gray-400">
                            {project.results.oldSystemDc} kW
                            <ArrowRight className="w-3 h-3 inline mx-1" />
                            <span className="text-green-400 font-semibold">{project.results.newSystemDc} kW</span>
                          </span>
                          <span className="text-gray-400">
                            {project.results.stringConfigs.length} strings
                          </span>
                          {project.results.warnings.length > 0 && (
                            <span className="text-red-400 flex items-center gap-0.5">
                              <AlertTriangle className="w-3 h-3" />
                              {project.results.warnings.length}
                            </span>
                          )}
                        </div>
                      )}

                      <StatusBadge status={project.status} />

                      {/* Error message */}
                      {project.error && (
                        <span className="text-xs text-red-400 max-w-[200px] truncate" title={project.error}>
                          {project.error}
                        </span>
                      )}

                      <button
                        onClick={() => removeProject(project.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1"
                        title="Remove project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t border-gray-700 px-4 py-3">
                        {project.status === 'complete' && project.results ? (
                          <ProjectResultsDetail project={project} target={target} />
                        ) : (
                          <ProjectEditForm
                            project={project}
                            onChange={updated => updateProject(project.id, updated)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Action Bar ───────────────────────────────────────────────────── */}
        {projects.length > 0 && (
          <div className="flex items-center justify-center gap-4 mb-8">
            <button
              onClick={processAll}
              disabled={processing || projects.every(p => p.status === 'complete')}
              className={cn(
                'flex items-center gap-2 font-semibold px-8 py-3 rounded-lg text-base transition-colors shadow-lg',
                processing || projects.every(p => p.status === 'complete')
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/30'
              )}
            >
              <Play className="w-5 h-5" />
              {processing ? 'Processing...' : 'Process All'}
            </button>

            {completedCount > 0 && (
              <button
                onClick={downloadSummary}
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold px-6 py-3 rounded-lg text-base transition-colors"
              >
                <Download className="w-5 h-5" />
                Download Summary CSV
              </button>
            )}
          </div>
        )}

        {/* ── Section 4: Results Table ─────────────────────────────────────── */}
        {completedCount > 0 && (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                Results Summary
                <span className="text-xs text-gray-400 font-normal ml-2">
                  {completedCount} of {projects.length} processed
                  {totalWarnings > 0 && (
                    <span className="text-amber-400 ml-2">{totalWarnings} warning{totalWarnings !== 1 ? 's' : ''}</span>
                  )}
                </span>
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-700">
                    <th className="text-left py-2 pr-3">Project</th>
                    <th className="text-right py-2 px-3">Old DC (kW)</th>
                    <th className="text-right py-2 px-3">New DC (kW)</th>
                    <th className="text-right py-2 px-3">Delta</th>
                    <th className="text-right py-2 px-3">Old Panels</th>
                    <th className="text-right py-2 px-3">New Panels</th>
                    <th className="text-left py-2 px-3">String Config</th>
                    <th className="text-center py-2 px-3">Status</th>
                    <th className="text-right py-2 pl-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.filter(p => p.status === 'complete' && p.results).map(project => {
                    const r = project.results!
                    const dcDelta = r.newSystemDc - r.oldSystemDc
                    const panelDelta = r.newTotalPanels - project.panelCount
                    const hasWarnings = r.warnings.length > 0
                    const stringSummary = r.stringConfigs.map(sc => sc.modules).join('/')

                    return (
                      <tr key={project.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                        <td className="py-2.5 pr-3">
                          <p className="font-medium text-sm">{project.projectName}</p>
                          <p className="text-xs text-gray-500 truncate max-w-[200px]">{project.address}</p>
                        </td>
                        <td className="text-right py-2.5 px-3 text-gray-400">{r.oldSystemDc}</td>
                        <td className="text-right py-2.5 px-3 font-semibold text-green-400">{r.newSystemDc}</td>
                        <td className={cn(
                          'text-right py-2.5 px-3 font-semibold',
                          dcDelta >= 0 ? 'text-green-400' : 'text-red-400'
                        )}>
                          {dcDelta >= 0 ? '+' : ''}{dcDelta.toFixed(2)}
                        </td>
                        <td className="text-right py-2.5 px-3 text-gray-400">{project.panelCount}</td>
                        <td className={cn(
                          'text-right py-2.5 px-3 font-semibold',
                          panelDelta >= 0 ? 'text-green-400' : 'text-red-400'
                        )}>
                          {r.newTotalPanels}
                          <span className="text-xs ml-1">({panelDelta >= 0 ? '+' : ''}{panelDelta})</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-xs font-mono text-gray-300">
                            {r.stringConfigs.length}s: {stringSummary}
                          </span>
                        </td>
                        <td className="text-center py-2.5 px-3">
                          {hasWarnings ? (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                              <AlertTriangle className="w-3 h-3" />
                              {r.warnings.length}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-green-400">
                              <CheckCircle2 className="w-3 h-3" />
                              OK
                            </span>
                          )}
                        </td>
                        <td className="text-right py-2.5 pl-3">
                          <button
                            onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}
                            className="text-xs text-green-400 hover:text-green-300 transition-colors"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>

                {/* Totals row */}
                <tfoot>
                  <tr className="border-t border-gray-600 font-semibold text-sm">
                    <td className="py-2.5 pr-3 text-gray-400">Totals ({completedCount} projects)</td>
                    <td className="text-right py-2.5 px-3 text-gray-400">
                      {projects.filter(p => p.results).reduce((s, p) => s + p.results!.oldSystemDc, 0).toFixed(2)}
                    </td>
                    <td className="text-right py-2.5 px-3 text-green-400">
                      {projects.filter(p => p.results).reduce((s, p) => s + p.results!.newSystemDc, 0).toFixed(2)}
                    </td>
                    <td className="text-right py-2.5 px-3 text-green-400">
                      {(() => {
                        const delta = projects.filter(p => p.results).reduce((s, p) => s + p.results!.newSystemDc - p.results!.oldSystemDc, 0)
                        return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`
                      })()}
                    </td>
                    <td className="text-right py-2.5 px-3 text-gray-400">
                      {projects.filter(p => p.results).reduce((s, p) => s + p.panelCount, 0)}
                    </td>
                    <td className="text-right py-2.5 px-3 text-green-400">
                      {projects.filter(p => p.results).reduce((s, p) => s + p.results!.newTotalPanels, 0)}
                    </td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs">
                      {projects.filter(p => p.results).reduce((s, p) => s + p.results!.stringConfigs.length, 0)} total strings
                    </td>
                    <td className="text-center py-2.5 px-3">
                      {totalWarnings > 0 ? (
                        <span className="text-xs text-amber-400">{totalWarnings} warnings</span>
                      ) : (
                        <span className="text-xs text-green-400">All clear</span>
                      )}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
