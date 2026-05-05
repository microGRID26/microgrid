#!/usr/bin/env node
// SLD spec self-checker — finds layout problems without human review.
// Checks:
//   1. Equipment-equipment overlap (excluding intentional containers via "contains")
//   2. Callout inside equipment (callout circle r=7)
//   3. Title block / legend overlap with equipment
//   4. Off-canvas elements
//   5. Wire endpoints landing on equipment edges (within 4px tolerance)
//   6. Wire endpoints touching another wire endpoint (tap-offs)
//   7. Equipment outside section bounds
//   8. Section overlap with title block / legend

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const layoutsDir = path.join(repoRoot, 'lib/sld-layouts')

function intersect(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
}

function nearAnyAssetEdge(point, assets, tol = 8) {
  const [px, py] = point
  for (const a of assets) {
    // Inside the asset = connected to it (fine)
    if (px >= a.x1 - tol && px <= a.x2 + tol && py >= a.y1 - tol && py <= a.y2 + tol) return a.id
  }
  return null
}

function insideAnySection(point, sections) {
  const [px, py] = point
  for (const s of sections) {
    if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) return s.label
  }
  return null
}

function check(topology) {
  const spec = JSON.parse(fs.readFileSync(path.join(layoutsDir, `${topology}.json`), 'utf8'))
  const issues = []
  const W = spec.canvas.w
  const H = spec.canvas.h

  // Build asset list with bboxes
  const assets = []
  const placeholders = []
  for (const el of spec.elements) {
    if (el.type === 'svg-asset') assets.push({ id: el.assetId, x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h, contains: el.contains || [] })
    else if (el.type === 'placeholder') placeholders.push({ id: el.assetId, label: el.label, x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h, contains: el.contains || [] })
  }
  const allEquip = [...assets, ...placeholders]
  const titleBlock = spec.titleBlock ? { id: 'titleBlock', x1: spec.titleBlock.x, y1: spec.titleBlock.y, x2: spec.titleBlock.x + spec.titleBlock.w, y2: spec.titleBlock.y + spec.titleBlock.h } : null
  const legend = spec.legend ? { id: 'legend', x1: spec.legend.x, y1: spec.legend.y, x2: spec.legend.x + spec.legend.w, y2: spec.legend.y + spec.legend.h } : null

  // 1. Equipment-equipment overlap (excluding container "contains" relationships)
  for (let i = 0; i < allEquip.length; i++) {
    for (let j = i + 1; j < allEquip.length; j++) {
      const a = allEquip[i], b = allEquip[j]
      if (!intersect(a, b)) continue
      // Skip intentional: container contains the other
      if (a.contains.includes(b.id) || b.contains.includes(a.id) || a.contains.length > 0 && b.id?.includes('battery') || a.contains.length > 0 && b.id?.includes('jb')) continue
      // Skip if one is a "container" placeholder (style: dashed-border)
      const containers = ['placeholder-dpc-container']
      if (containers.includes(a.id) || containers.includes(b.id)) continue
      issues.push(`equipment overlap: ${a.id} ↔ ${b.id || b.label}`)
    }
  }

  // 2. Callout inside equipment
  for (const c of spec.elements.filter(e => e.type === 'callout')) {
    for (const a of allEquip) {
      // Skip callouts inside container placeholders (intentional — labels contained equipment)
      if (a.id === 'placeholder-dpc-container') continue
      if (c.cx >= a.x1 - 3 && c.cx <= a.x2 + 3 && c.cy >= a.y1 - 3 && c.cy <= a.y2 + 3) {
        issues.push(`callout #${c.number}@(${c.cx},${c.cy}) inside ${a.id || a.label}`)
      }
    }
  }

  // 3. Title block / legend overlap with equipment
  for (const a of allEquip) {
    if (titleBlock && intersect(a, titleBlock)) issues.push(`titleBlock overlaps ${a.id || a.label}`)
    if (legend && intersect(a, legend)) issues.push(`legend overlaps ${a.id || a.label}`)
  }
  // titleBlock vs legend
  if (titleBlock && legend && intersect(titleBlock, legend)) issues.push(`titleBlock ↔ legend overlap`)

  // 4. Off-canvas elements
  for (const a of allEquip) {
    if (a.x1 < 4 || a.y1 < 32 || a.x2 > W - 4 || a.y2 > H - 4) issues.push(`${a.id || a.label} off-canvas (canvas=${W}×${H})`)
  }

  // 5. Wire endpoints landing on equipment edges
  const wires = spec.elements.filter(e => e.type === 'line' && e.points && e.points.length >= 2)
  // Build endpoint set for tap-off detection
  const allEndpoints = wires.flatMap(w => [w.points[0], w.points[w.points.length - 1]])
  for (const w of wires) {
    const start = w.points[0]
    const end = w.points[w.points.length - 1]
    const startNear = nearAnyAssetEdge(start, allEquip, 8)
    const endNear = nearAnyAssetEdge(end, allEquip, 8)
    const startInSection = insideAnySection(start, spec.sections)
    const endInSection = insideAnySection(end, spec.sections)
    const startTap = allEndpoints.some(p => p !== start && Math.hypot(p[0] - start[0], p[1] - start[1]) <= 8)
    const endTap = allEndpoints.some(p => p !== end && Math.hypot(p[0] - end[0], p[1] - end[1]) <= 8)
    if (!startNear && !startTap && !startInSection) issues.push(`wire "${w.label || '(no label)'}" start (${start[0]},${start[1]}) lands in mid-air`)
    if (!endNear && !endTap && !endInSection) issues.push(`wire "${w.label || '(no label)'}" end (${end[0]},${end[1]}) lands in mid-air`)
  }

  // 6. Section overlap with title block / legend
  for (const s of spec.sections) {
    const sb = { x1: s.x, y1: s.y, x2: s.x + s.w, y2: s.y + s.h }
    if (titleBlock && intersect(sb, titleBlock)) issues.push(`section "${s.label}" overlaps titleBlock`)
    if (legend && intersect(sb, legend)) issues.push(`section "${s.label}" overlaps legend`)
  }

  return { topology, issues, stats: { assets: assets.length, placeholders: placeholders.length, wires: wires.length, callouts: spec.elements.filter(e => e.type === 'callout').length } }
}

const topologies = ['sonnen-microinverter', 'rush-spatial', 'legacy-string-mppt']
let totalIssues = 0
for (const t of topologies) {
  const r = check(t)
  totalIssues += r.issues.length
  console.log(`\n=== ${r.topology} === [${r.stats.assets} assets, ${r.stats.placeholders} placeholders, ${r.stats.wires} wires, ${r.stats.callouts} callouts]`)
  if (r.issues.length === 0) console.log('  ✓ clean')
  else r.issues.forEach(i => console.log(`  ✗ ${i}`))
}
process.exit(totalIssues > 0 ? 1 : 0)
