#!/usr/bin/env node
// Render the v8 SLD spec to a standalone SVG file with real assets embedded.
// Usage: node scripts/render-sld-svg.mjs <topology>
//   topology: sonnen-microinverter | rush-spatial | legacy-string-mppt
// Output: ~/Desktop/sld-<topology>.svg

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const topology = process.argv[2] || 'sonnen-microinverter'
const specPath = path.join(repoRoot, 'lib/sld-layouts', `${topology}.json`)
const assetsDir = path.join(repoRoot, 'components/planset/sld-assets')
const outPath = path.join(process.env.HOME, 'Desktop', `sld-${topology}.svg`)

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))

const COLOR = { pv: '#2a8a2a', ac: '#1a4ca8', batt: '#0aa3b8', gec: '#2a8a2a', comm: '#888' }

const W = spec.canvas.w
const H = spec.canvas.h
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`]

// Outer border
parts.push(`<rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="white" stroke="black" stroke-width="1.5"/>`)
// v11+ specs render their own sheet header; v8 needs the auto-strip
const v11Like = spec.titleBlock && spec.titleBlock.fields && spec.titleBlock.fields._layout
if (!v11Like) {
  parts.push(`<rect x="4" y="4" width="${W - 8}" height="28" fill="#f0f0f0" stroke="black" stroke-width="1"/>`)
  parts.push(`<text x="16" y="22" font-size="11" font-weight="bold" fill="#111">ELECTRICAL SINGLE LINE DIAGRAM</text>`)
  parts.push(`<text x="${W - 16}" y="22" font-size="9" text-anchor="end" fill="#666">${spec.topology.toUpperCase()}</text>`)
}

// Sections
for (const s of spec.sections) {
  parts.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="none" stroke="#bbb" stroke-width="0.6" stroke-dasharray="4 3"/>`)
  parts.push(`<text x="${s.x + 8}" y="${s.y + 14}" font-size="7" font-weight="bold" fill="#777">${s.label}</text>`)
}

// Elements — render in z-order: rect (background) → lines/wires → svg-assets → placeholders → callouts → text → legend-item
const zOrder = { rect: -1, line: 0, 'svg-asset': 1, placeholder: 1, callout: 2, text: 3, 'legend-item': 4 }
// Filter out _ comment markers (objects with `_` key, no `type`)
const sorted = [...spec.elements.filter(e => e.type)].sort((a, b) => (zOrder[a.type] ?? 1) - (zOrder[b.type] ?? 1))
for (const el of sorted) {
  if (el.type === 'svg-asset') {
    const file = path.join(assetsDir, `${el.assetId}.svg`)
    if (!fs.existsSync(file)) {
      parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="none" stroke="red"/>`)
      parts.push(`<text x="${el.x + el.w / 2}" y="${el.y + el.h / 2}" text-anchor="middle" font-size="6" fill="red">missing: ${el.assetId}</text>`)
      continue
    }
    let raw = fs.readFileSync(file, 'utf8')
    // Extract viewBox (assume 0 0 NATIVE_W NATIVE_H)
    const vb = raw.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    const nativeW = vb ? parseFloat(vb[1]) : el.w
    const nativeH = vb ? parseFloat(vb[2]) : el.h
    const sx = el.w / nativeW
    const sy = el.h / nativeH
    // Strip outer <svg ... > and </svg>
    const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    parts.push(`<g transform="translate(${el.x},${el.y}) scale(${sx},${sy})">${inner}</g>`)
  } else if (el.type === 'placeholder') {
    const dashed = el.style === 'dashed-border'
    parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="white" stroke="#333" stroke-width="${dashed ? 1 : 1.2}" ${dashed ? 'stroke-dasharray="6 4"' : ''}/>`)
    parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="14" fill="#f5f5f5"/>`)
    parts.push(`<text x="${el.x + el.w / 2}" y="${el.y + 10}" text-anchor="middle" font-size="6" font-weight="bold" fill="#222">${el.label || ''}</text>`)
    if (el.model) parts.push(`<text x="${el.x + el.w / 2}" y="${el.y + 25}" text-anchor="middle" font-size="4.5" fill="#666">${el.model}</text>`)
    if (el.ports && !dashed) el.ports.forEach((p, i) => parts.push(`<text x="${el.x + 6}" y="${el.y + 40 + i * 11}" font-size="4" fill="#666">· ${p}</text>`))
  } else if (el.type === 'line' && el.points && el.points.length >= 2) {
    const stroke = el.color ? COLOR[el.color] : '#333'
    const dash = (el.color === 'comm' || el.color === 'gec') ? 'stroke-dasharray="4 3"' : ''
    const pts = el.points.map(p => p.join(',')).join(' ')
    parts.push(`<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.1" ${dash}/>`)
    if (el.label) {
      let tx, ty
      if (el.labelX != null && el.labelY != null) {
        // v11+ provides explicit label position
        tx = el.labelX; ty = el.labelY
      } else {
        // v8/v9 fallback: midpoint of longest segment
        let bestSeg = 0, bestLen = 0
        for (let i = 0; i < el.points.length - 1; i++) {
          const dx = el.points[i + 1][0] - el.points[i][0]
          const dy = el.points[i + 1][1] - el.points[i][1]
          const len = Math.hypot(dx, dy)
          if (len > bestLen) { bestLen = len; bestSeg = i }
        }
        const a = el.points[bestSeg], b = el.points[bestSeg + 1]
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        const isVertical = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0])
        tx = isVertical ? mx + 4 : mx - (el.label.length * 0.9)
        ty = my - 3
      }
      parts.push(`<text x="${tx}" y="${ty}" font-size="3.5" fill="#444" font-style="italic">${el.label}</text>`)
    }
  } else if (el.type === 'callout') {
    parts.push(`<g><circle cx="${el.cx}" cy="${el.cy}" r="7" fill="white" stroke="black" stroke-width="1.2"/><text x="${el.cx}" y="${el.cy + 2.5}" text-anchor="middle" font-size="7" font-weight="bold">${el.number}</text></g>`)
  } else if (el.type === 'text' && el.text) {
    const fs = el.fontSize ?? 5
    const fw = el.bold ? 'font-weight="bold"' : ''
    const fi = el.italic ? 'font-style="italic"' : ''
    const fill = el.fill || '#222'
    const anchor = el.anchor === 'middle' ? 'text-anchor="middle"' : el.anchor === 'end' ? 'text-anchor="end"' : ''
    parts.push(`<text x="${el.x}" y="${el.y}" font-size="${fs}" fill="${fill}" ${fw} ${fi} ${anchor}>${(el.text + '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`)
  } else if (el.type === 'rect') {
    const stroke = el.stroke || 'black'
    const sw = el.strokeWidth ?? 1
    const fill = el.fill || 'none'
    const dash = el.dash ? 'stroke-dasharray="4 3"' : ''
    parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dash}/>`)
  } else if (el.type === 'legend-item') {
    const stroke = el.color ? COLOR[el.color] : '#333'
    const dash = (el.color === 'comm' || el.color === 'gec') ? 'stroke-dasharray="4 3"' : ''
    parts.push(`<line x1="${el.x}" y1="${el.y}" x2="${el.x + 24}" y2="${el.y}" stroke="${stroke}" stroke-width="2" ${dash}/>`)
    parts.push(`<text x="${el.x + 28}" y="${el.y + 3}" font-size="5">${el.label || ''}</text>`)
  }
}

// Title block — only auto-render if v8 format (flat string fields). v11+ renders inline via text elements.
if (spec.titleBlock && spec.titleBlock.fields && !spec.titleBlock.fields._layout) {
  const tb = spec.titleBlock
  const f = tb.fields
  parts.push(`<rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${tb.h}" fill="white" stroke="black" stroke-width="1.5"/>`)
  parts.push(`<rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="16" fill="#1a1a1a"/>`)
  parts.push(`<text x="${tb.x + 10}" y="${tb.y + 12}" font-size="7" font-weight="bold" fill="white">MicroGRID ENERGY · PLANSET</text>`)
  parts.push(`<text x="${tb.x + tb.w - 10}" y="${tb.y + 12}" font-size="6" text-anchor="end" fill="#bbb">${f.projectId || ''}</text>`)
  const colX = tb.x + 10, col2X = tb.x + tb.w / 2 + 10
  let row = tb.y + 28
  parts.push(`<text x="${colX}" y="${row}" font-size="7" font-weight="bold">${f.project || ''}</text>`)
  parts.push(`<text x="${col2X}" y="${row}" font-size="6">Sheet: ${f.sheet || 'PV-5'}</text>`); row += 11
  parts.push(`<text x="${colX}" y="${row}" font-size="5.5" fill="#444">${f.address || ''}</text>`)
  parts.push(`<text x="${col2X}" y="${row}" font-size="6">Scale: ${f.scale || 'N.T.S.'}</text>`); row += 11
  parts.push(`<text x="${colX}" y="${row}" font-size="5.5" fill="#444">Drawn: ${f.drawnBy || 'MicroGRID Design'}</text>`)
  parts.push(`<text x="${col2X}" y="${row}" font-size="6">Rev: ${f.rev || '1'}</text>`); row += 11
  parts.push(`<text x="${colX}" y="${row}" font-size="5.5" fill="#444">Date: ${f.date || ''}</text>`)
  parts.push(`<text x="${col2X}" y="${row}" font-size="6" font-weight="bold">${f.title || ''}</text>`); row += 11
  parts.push(`<text x="${colX}" y="${row}" font-size="5.5" fill="#888" font-style="italic">PE Stamp: ${f.stamp || '[ pending review ]'}</text>`)
}

// Legend
if (spec.legend) {
  const lg = spec.legend
  parts.push(`<rect x="${lg.x}" y="${lg.y}" width="${lg.w}" height="${lg.h}" fill="white" stroke="black" stroke-width="1"/>`)
  parts.push(`<rect x="${lg.x}" y="${lg.y}" width="${lg.w}" height="16" fill="#f0f0f0"/>`)
  parts.push(`<text x="${lg.x + 10}" y="${lg.y + 12}" font-size="7" font-weight="bold">CONDUCTOR LEGEND</text>`)
  const keys = [
    { c: 'ac', l: 'AC POWER · L1/L2/N' },
    { c: 'pv', l: 'PV DC STRING' },
    { c: 'batt', l: 'BATTERY DC' },
    { c: 'gec', l: 'GROUND ELECTRODE (GEC)', dash: true },
    { c: 'comm', l: 'COMMUNICATION (RS-485 / CAN)', dash: true },
  ]
  keys.forEach((k, i) => {
    const y = lg.y + 30 + i * 13
    const dash = k.dash ? 'stroke-dasharray="4 3"' : ''
    parts.push(`<line x1="${lg.x + 14}" y1="${y}" x2="${lg.x + 60}" y2="${y}" stroke="${COLOR[k.c]}" stroke-width="2" ${dash}/>`)
    parts.push(`<text x="${lg.x + 70}" y="${y + 3}" font-size="5.5">${k.l}</text>`)
  })
}

parts.push('</svg>')
fs.writeFileSync(outPath, parts.join('\n'))
console.log(`Wrote: ${outPath} (${(parts.join('\n').length / 1024).toFixed(1)} KB)`)
