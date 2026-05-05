'use client'

import type React from 'react'
import { EatonBrp12l125r } from './eaton-brp12l125r'
import { EatonBrp20b125r } from './eaton-brp20b125r'
import { EatonDg221Urb } from './eaton-dg221urb'
import { EatonDg222Nrb } from './eaton-dg222nrb'
import { EatonDg222Urb } from './eaton-dg222urb'
import { SonnenScoreP20 } from './sonnen-score-p20'

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
}
