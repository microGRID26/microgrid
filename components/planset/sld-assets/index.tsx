'use client'

import type React from 'react'
import { BatteryCombiner } from './battery-combiner'
import { DpcContainerFrame } from './dpc-container-frame'
import { DpcrgmCell } from './dpcrgm-cell'
import { DuracellBatteryStack } from './duracell-battery-stack'
import { DuracellHybridInverter } from './duracell-hybrid-inverter'
import { EStopButton } from './e-stop-button'
import { EatonBrp12l125r } from './eaton-brp12l125r'
import { EatonBrp20b125r } from './eaton-brp20b125r'
import { EatonDg221Urb } from './eaton-dg221urb'
import { EatonDg222Nrb } from './eaton-dg222nrb'
import { EatonDg222Urb } from './eaton-dg222urb'
import { EthernetSwitch } from './ethernet-switch'
import { HomeownerRouter } from './homeowner-router'
import { ImoRsd } from './imo-rsd'
import { JbNema3600v } from './jb-nema3-600v'
import { JbNema3600vLs } from './jb-nema3-600v-ls'
import { Msp225a } from './msp-225a'
import { ProductionCt } from './production-ct'
import { SeraphimPvModule } from './seraphim-pv-module'
import { ServiceDisc200a } from './service-disc-200a'
import { SonnenScoreP20 } from './sonnen-score-p20'
import { SurgeProtectorSpd } from './surge-protector-spd'
import { UtilityMeter200a } from './utility-meter-200a'

// AssetProps is the shape every SLD asset component receives. See README.md.
export interface AssetProps {
  x: number
  y: number
  w: number
  h: number
  props?: Record<string, string | number>
}

// ASSET_REGISTRY maps assetId → React component. Phase 1+ populates this
// as Claude Design ships individual SVG assets.
//
// Lookup happens in components/SldRenderer.tsx for elements of type 'svg-asset'.
// Unknown assetIds render as a fallback placeholder rect with the missing id
// so visual debugging is obvious.
export const ASSET_REGISTRY: Record<string, React.FC<AssetProps>> = {
  'sonnen-score-p20': SonnenScoreP20,
  'eaton-dg222urb': EatonDg222Urb,
  'eaton-dg221urb': EatonDg221Urb,
  'eaton-dg222nrb': EatonDg222Nrb,
  'eaton-brp12l125r': EatonBrp12l125r,
  'eaton-brp20b125r': EatonBrp20b125r,
  'msp-225a': Msp225a,
  'jb-nema3-600v': JbNema3600v,
  'jb-nema3-600v-ls': JbNema3600vLs,
  'utility-meter-200a': UtilityMeter200a,
  'service-disc-200a': ServiceDisc200a,
  'surge-protector-spd': SurgeProtectorSpd,
  'imo-rsd': ImoRsd,
  'battery-combiner': BatteryCombiner,
  'dpcrgm-cell': DpcrgmCell,
  // Duracell-hybrid + Seraphim topology (v11 rush-spatial.json) — Claude Design 2026-05-11
  'seraphim-pv-module': SeraphimPvModule,
  'duracell-hybrid-inverter': DuracellHybridInverter,
  'duracell-battery-stack': DuracellBatteryStack,
  'dpc-container-frame': DpcContainerFrame,
  'production-ct': ProductionCt,
  'e-stop-button': EStopButton,
  'ethernet-switch': EthernetSwitch,
  'homeowner-router': HomeownerRouter,
}
