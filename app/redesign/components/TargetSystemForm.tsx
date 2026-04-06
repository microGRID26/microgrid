import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'
import { NumField, TextField } from './FormFields'
import type { TargetSystem } from './types'

interface TargetSystemFormProps {
  target: TargetSystem
  showTarget: boolean
  setShowTarget: (v: boolean) => void
  updateTarget: <K extends keyof TargetSystem>(key: K, val: TargetSystem[K]) => void
}

export function TargetSystemForm({ target, showTarget, setShowTarget, updateTarget }: TargetSystemFormProps) {
  return (
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

          {/* Racking & RSD */}
          <div className="border-t border-gray-700 pt-3">
            <p className="text-xs text-green-400 font-semibold mb-2">Racking & RSD</p>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Racking Model" value={target.rackingModel} onChange={v => updateTarget('rackingModel', v)} />
              <TextField label="RSD Model (Rapid Shutdown)" value={target.rsdModel} onChange={v => updateTarget('rsdModel', v)} />
            </div>
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
  )
}
