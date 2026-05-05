// SLD layout renderer — translates v8 JSON specs (from Claude Design)
// into SldElement[] consumed by SldRenderer.tsx.
//
// Specs live in ./sld-layouts/*.json. Each spec has:
//   canvas: { w, h }
//   sections: [{ label, x, y, w, h }]
//   elements: [{ type: 'svg-asset' | 'line' | 'callout' | 'placeholder' | 'text', ... }]
//   titleBlock: { x, y, w, h, fields: { project, address, sheet, ... } }
//   legend: { x, y, w, h }

import type { SldConfig, SldElement, SldLayout } from './sld-layout'

export interface SldSpecSection { label: string; x: number; y: number; w: number; h: number }

export interface SldSpecElement {
  type: 'svg-asset' | 'line' | 'callout' | 'placeholder' | 'text'
  // svg-asset / placeholder: x, y, w, h, assetId, label?, model?, style?
  x?: number; y?: number; w?: number; h?: number
  assetId?: string
  label?: string
  model?: string
  style?: string
  ports?: string[]
  // line: color, points, label
  color?: 'pv' | 'ac' | 'batt' | 'gec' | 'comm'
  points?: [number, number][]
  // callout: cx, cy, number
  cx?: number; cy?: number; number?: number
  // text: x, y, text, fontSize?, bold?, fill?
  text?: string; fontSize?: number; bold?: boolean; fill?: string
}

export interface SldSpec {
  topology: string
  canvas: { w: number; h: number }
  sections: SldSpecSection[]
  elements: SldSpecElement[]
  titleBlock?: {
    x: number; y: number; w: number; h: number
    fields: Record<string, string>
  }
  legend?: { x: number; y: number; w: number; h: number }
}

const COLOR_MAP: Record<string, string> = {
  pv: '#2a8a2a',
  ac: '#1a4ca8',
  batt: '#0aa3b8',
  gec: '#2a8a2a',
  comm: '#888',
}

export function renderSldFromSpec(spec: SldSpec, config: SldConfig): SldLayout {
  const elements: SldElement[] = []
  const W = spec.canvas.w
  const H = spec.canvas.h

  // Outer sheet border (thin, mostly so the SVG has a frame)
  elements.push({ type: 'rect', x: 4, y: 4, w: W - 8, h: H - 8, strokeWidth: 1.5 })

  // Sheet title strip across the top
  elements.push({ type: 'rect', x: 4, y: 4, w: W - 8, h: 28, fill: '#f0f0f0', strokeWidth: 1 })
  elements.push({ type: 'text', x: 16, y: 22, text: 'ELECTRICAL SINGLE LINE DIAGRAM', fontSize: 11, bold: true })
  elements.push({ type: 'text', x: W - 16, y: 22, text: spec.topology.toUpperCase(), fontSize: 9, anchor: 'end', fill: '#666' })

  // Section borders + labels
  for (const s of spec.sections) {
    elements.push({ type: 'rect', x: s.x, y: s.y, w: s.w, h: s.h, stroke: '#bbb', strokeWidth: 0.6, dash: true })
    elements.push({ type: 'text', x: s.x + 8, y: s.y + 14, text: s.label, fontSize: 7, bold: true, fill: '#777' })
  }

  // Spec elements
  for (const el of spec.elements) {
    if (el.type === 'svg-asset' && el.assetId && el.x != null && el.y != null && el.w != null && el.h != null) {
      elements.push({ type: 'svg-asset', x: el.x, y: el.y, w: el.w, h: el.h, assetId: el.assetId })
    } else if (el.type === 'placeholder' && el.x != null && el.y != null && el.w != null && el.h != null) {
      const dashed = el.style === 'dashed-border'
      // Outer container
      elements.push({ type: 'rect', x: el.x, y: el.y, w: el.w, h: el.h, stroke: '#333', strokeWidth: dashed ? 1 : 1.2, dash: dashed })
      // Header band
      elements.push({ type: 'rect', x: el.x, y: el.y, w: el.w, h: 14, fill: '#f5f5f5', strokeWidth: 0 })
      elements.push({ type: 'text', x: el.x + el.w / 2, y: el.y + 10, text: el.label ?? '', fontSize: 6, bold: true, anchor: 'middle' })
      if (el.model) {
        elements.push({ type: 'text', x: el.x + el.w / 2, y: el.y + 25, text: el.model, fontSize: 4.5, anchor: 'middle', fill: '#666' })
      }
      // Port labels (only meaningful for inverters)
      if (el.ports && !dashed) {
        el.ports.forEach((p, i) => {
          elements.push({ type: 'text', x: el.x! + 6, y: el.y! + 40 + i * 11, text: `· ${p}`, fontSize: 4, fill: '#666' })
        })
      }
    } else if (el.type === 'line' && el.points && el.points.length >= 2) {
      const stroke = el.color ? COLOR_MAP[el.color] : '#333'
      const dash = el.color === 'comm' || el.color === 'gec'
      for (let i = 0; i < el.points.length - 1; i++) {
        const [x1, y1] = el.points[i]
        const [x2, y2] = el.points[i + 1]
        elements.push({ type: 'line', x1, y1, x2, y2, stroke, strokeWidth: 1.1, dash })
      }
      if (el.label) {
        const mid = el.points[Math.floor(el.points.length / 2)]
        elements.push({ type: 'text', x: mid[0] + 4, y: mid[1] - 3, text: el.label, fontSize: 3.5, fill: '#444', italic: true })
      }
    } else if (el.type === 'callout' && el.cx != null && el.cy != null && el.number != null) {
      elements.push({ type: 'callout', cx: el.cx, cy: el.cy, number: el.number })
    } else if (el.type === 'text' && el.x != null && el.y != null && el.text) {
      elements.push({ type: 'text', x: el.x, y: el.y, text: el.text, fontSize: el.fontSize ?? 5, bold: el.bold, fill: el.fill })
    }
  }

  // Title block
  if (spec.titleBlock) {
    const tb = spec.titleBlock
    const f = tb.fields
    // Override generic fields with project data when available
    const project = config.projectName || f.project || 'Project'
    const address = config.address || f.address || ''
    const projectId = f.projectId || ''
    const title = f.title ?? 'PV-5 — ELECTRICAL SINGLE LINE'
    const sheet = f.sheet ?? 'PV-5'
    const drawnBy = f.drawnBy ?? 'MicroGRID Design'
    const date = f.date ?? new Date().toISOString().slice(0, 10)
    const stamp = f.stamp ?? '[ pending review ]'
    const rev = f.rev ?? '1'
    const scale = f.scale ?? 'N.T.S.'

    elements.push({ type: 'rect', x: tb.x, y: tb.y, w: tb.w, h: tb.h, strokeWidth: 1.5 })
    // Title strip across top of block
    elements.push({ type: 'rect', x: tb.x, y: tb.y, w: tb.w, h: 16, fill: '#1a1a1a', strokeWidth: 0 })
    elements.push({ type: 'text', x: tb.x + 10, y: tb.y + 12, text: 'MicroGRID ENERGY · PLANSET', fontSize: 7, bold: true, fill: 'white' })
    elements.push({ type: 'text', x: tb.x + tb.w - 10, y: tb.y + 12, text: projectId, fontSize: 6, anchor: 'end', fill: '#bbb' })

    // Two-column field grid below the strip
    const colX = tb.x + 10
    const col2X = tb.x + tb.w / 2 + 10
    let row = tb.y + 28
    elements.push({ type: 'text', x: colX, y: row, text: project, fontSize: 7, bold: true })
    elements.push({ type: 'text', x: col2X, y: row, text: `Sheet: ${sheet}`, fontSize: 6 })
    row += 11
    elements.push({ type: 'text', x: colX, y: row, text: address, fontSize: 5.5, fill: '#444' })
    elements.push({ type: 'text', x: col2X, y: row, text: `Scale: ${scale}`, fontSize: 6 })
    row += 11
    elements.push({ type: 'text', x: colX, y: row, text: `Drawn: ${drawnBy}`, fontSize: 5.5, fill: '#444' })
    elements.push({ type: 'text', x: col2X, y: row, text: `Rev: ${rev}`, fontSize: 6 })
    row += 11
    elements.push({ type: 'text', x: colX, y: row, text: `Date: ${date}`, fontSize: 5.5, fill: '#444' })
    elements.push({ type: 'text', x: col2X, y: row, text: title, fontSize: 6, bold: true })
    row += 11
    elements.push({ type: 'text', x: colX, y: row, text: `PE Stamp: ${stamp}`, fontSize: 5.5, fill: '#888', italic: true })
  }

  // Legend (conductor color key)
  if (spec.legend) {
    const lg = spec.legend
    elements.push({ type: 'rect', x: lg.x, y: lg.y, w: lg.w, h: lg.h, strokeWidth: 1 })
    elements.push({ type: 'rect', x: lg.x, y: lg.y, w: lg.w, h: 16, fill: '#f0f0f0', strokeWidth: 0 })
    elements.push({ type: 'text', x: lg.x + 10, y: lg.y + 12, text: 'CONDUCTOR LEGEND', fontSize: 7, bold: true })

    const keys: { color: keyof typeof COLOR_MAP; label: string; dash?: boolean }[] = [
      { color: 'ac', label: 'AC POWER · L1/L2/N' },
      { color: 'pv', label: 'PV DC STRING' },
      { color: 'batt', label: 'BATTERY DC' },
      { color: 'gec', label: 'GROUND ELECTRODE (GEC)', dash: true },
      { color: 'comm', label: 'COMMUNICATION (RS-485 / CAN)', dash: true },
    ]
    keys.forEach((k, i) => {
      const y = lg.y + 30 + i * 13
      elements.push({ type: 'line', x1: lg.x + 14, y1: y, x2: lg.x + 60, y2: y, stroke: COLOR_MAP[k.color], strokeWidth: 2, dash: k.dash })
      elements.push({ type: 'text', x: lg.x + 70, y: y + 3, text: k.label, fontSize: 5.5 })
    })
  }

  return { width: W, height: H, elements }
}
