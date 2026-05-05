'use client'

import type React from 'react'
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
}
