'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { handleApiError } from '@/lib/errors'
import { loadProjectById } from '@/lib/api'
import { buildPlansetData, DURACELL_DEFAULTS } from '@/lib/planset-types'
import { autoDistributeStrings } from '@/lib/planset-calcs'
import { evaluateExportReadiness, type CutSheetStatus } from '@/lib/planset-export-readiness'
import { SheetPV1, SheetPV2, SheetPV2A, SheetPV3, SheetPV31, SheetPV4, SheetPV41, SheetPV5, SheetPV6, SheetPV7, SheetPV71, SheetPV8, SheetCutSheet, CUT_SHEETS, computeSheetTotal, UtilityBatteryLetter } from '@/components/planset'
import type { PlansetData, PlansetOverrides, PlansetString, PlansetRoofFace } from '@/lib/planset-types'
import { Loader2, Maximize2, X, AlertTriangle } from 'lucide-react'
import { ProjectSelector } from './components/ProjectSelector'
import { OverridesPanel } from './components/OverridesPanel'
import { ZoomToolbar } from './components/ZoomToolbar'

// ── PRINT CSS ───────────────────────────────────────────────────────────────

const PRINT_CSS = `
@page {
  size: 17in 11in;
  margin: 0.25in;
}
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
body { background: white; }
.sheet {
  width: 16.5in;
  height: 10.5in;
  page-break-after: always;
  page-break-inside: avoid;
  display: grid;
  grid-template-columns: 1fr 2.5in;
  border: 2px solid #000;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 8pt;
  position: relative;
  overflow: hidden;
}
.sheet:last-child { page-break-after: auto; }
.sheet.sld-sheet { grid-template-columns: 1fr; }
.utility-letter {
  page-break-after: always;
  page-break-inside: avoid;
  width: 8.5in;
  height: 10.5in;
}
.sheet-content {
  padding: 0.15in 0.2in;
  overflow: hidden;
}
.sheet-sidebar {
  border-left: 1px solid #000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.stamp-box {
  border: 1.5px solid #000;
  height: 0.8in;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 7pt;
  color: #999;
  margin: 0.05in 0.05in;
}
.title-block {
  border-top: 1px solid #000;
  padding: 0.08in;
  font-size: 6.5pt;
  line-height: 1.5;
}
.title-block .contractor-line { font-weight: bold; font-size: 7pt; }
.title-block .project-line { font-weight: bold; margin-top: 3pt; }
.title-block .sheet-name { font-weight: bold; font-size: 8pt; margin-top: 4pt; }
.title-block .sheet-number { font-weight: bold; font-size: 14pt; }
.title-block .sheet-of { font-size: 7pt; color: #333; }

/* Tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 7pt;
}
.data-table th {
  background: #111;
  color: white;
  padding: 3px 4px;
  text-align: left;
  font-weight: bold;
  font-size: 6pt;
  text-transform: uppercase;
}
.data-table td {
  padding: 2px 4px;
  border-bottom: 1px solid #ddd;
}
.data-table tr:nth-child(even) td {
  background: #f5f5f5;
}
.data-table .label-cell {
  font-weight: bold;
  color: #999;
  width: 35%;
}
.data-table .value-cell {
  color: #111;
}

/* Section headers */
.section-header {
  background: #111;
  color: white;
  padding: 4px 6px;
  font-size: 8pt;
  font-weight: bold;
  text-transform: uppercase;
  text-align: center;
}
.section-header-alt {
  background: #555;
  color: white;
  padding: 4px 6px;
  font-size: 8pt;
  font-weight: bold;
  text-align: center;
}
.section-header-green {
  background: #1D9E75;
  color: white;
  padding: 4px 6px;
  font-size: 8pt;
  font-weight: bold;
  text-align: center;
}

/* Section box */
.section-box {
  border: 1px solid #111;
  margin-bottom: 6px;
  overflow: hidden;
}

/* Sheet title */
.sheet-title {
  font-size: 14pt;
  font-weight: bold;
  color: #111;
  margin-bottom: 2pt;
}
.sheet-subtitle {
  font-size: 8pt;
  color: #555;
  margin-bottom: 8pt;
}

/* Multi-column layouts */
.cols-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cols-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

/* Label boxes for PV-7 */
.label-box {
  border: 1.5px solid #111;
  overflow: hidden;
}
.label-box.red { border-color: #cc0000; border-width: 2px; }
.label-box.yellow { border-color: #cc9900; border-width: 2px; }
.label-box-header {
  background: #111;
  color: white;
  padding: 3px 6px;
  font-size: 8pt;
  font-weight: bold;
  text-align: center;
  position: relative;
}
.label-box.red .label-box-header { background: #cc0000; }
.label-box.yellow .label-box-header { background: #cc9900; }
.label-box-nec {
  position: absolute;
  right: 5px;
  top: 3px;
  font-size: 6pt;
  color: #ddd;
  font-weight: normal;
}
.label-box-content {
  padding: 5px 8px;
  font-size: 6.5pt;
  line-height: 1.6;
}
.label-box-content .warn-text { color: #cc0000; font-weight: bold; }
.label-box-content .bold-text { font-weight: bold; }

/* Warning label outer border for PV-7 */
.warning-outer {
  border: 3px solid #111;
  padding: 3px;
}
.warning-outer.red { border-color: #cc0000; }
.warning-outer.yellow { border-color: #cc9900; }

/* Placard for PV-7.1 */
.placard {
  border: 1.5px solid #111;
  overflow: hidden;
}
.placard-header {
  background: #111;
  color: white;
  padding: 4px 8px;
  font-size: 8pt;
  font-weight: bold;
  text-align: center;
}
.placard-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 6.5pt;
}
.placard-table td {
  padding: 2px 6px;
  border-bottom: 1px solid #eee;
}
.placard-table tr:nth-child(even) td { background: #f5f5f5; }
.placard-table .p-label { font-weight: bold; color: #111; width: 30%; }
.placard-table .p-value { color: #333; }

/* Small font table for conductor schedule */
.small-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 5.5pt;
}
.small-table th {
  background: #111;
  color: white;
  padding: 2px 3px;
  text-align: left;
  font-weight: bold;
  font-size: 5pt;
  text-transform: uppercase;
  white-space: nowrap;
}
.small-table td {
  padding: 1px 3px;
  border-bottom: 1px solid #ddd;
  white-space: nowrap;
}
.small-table tr:nth-child(even) td { background: #f5f5f5; }

/* BOM table */
.bom-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 7pt;
}
.bom-table th {
  background: #111;
  color: white;
  padding: 3px 6px;
  text-align: left;
  font-weight: bold;
  font-size: 6.5pt;
}
.bom-table td {
  padding: 2px 6px;
  border-bottom: 1px solid #ddd;
}
.bom-table tr:nth-child(even) td { background: #f5f5f5; }
.bom-table .bom-label { font-weight: bold; color: #111; }

/* Status colors */
.pass { color: #006600; font-weight: bold; }
.fail { color: #cc0000; font-weight: bold; }

/* Notes */
.notes-list {
  font-size: 5.5pt;
  line-height: 1.8;
  color: #333;
  padding: 4px;
}
.notes-list li { margin-bottom: 1px; }

/* Sheet index / unit index */
.index-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 6.5pt;
}
.index-table td { padding: 1px 4px; }
.index-table .idx-key { font-weight: bold; color: #111; width: 50px; }
.index-table .idx-val { color: #333; }

/* SLD sheet — SVG fills the content area */
.sld-content svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Site plan image — fit within sheet */
.sheet img { max-width: 100%; max-height: 100%; object-fit: contain; }

/* Installation notes at bottom of sheets */
.install-notes {
  font-size: 6.5pt;
  color: #333;
  margin-top: 6px;
  line-height: 1.6;
}
.install-notes strong { color: #111; }

/* Formula note */
.formula-note {
  font-size: 6.5pt;
  color: #555;
  margin-top: 4px;
  line-height: 1.5;
}
.formula-note strong { color: #111; }

@media print {
  .sheet { break-after: page; break-inside: avoid; }
  .sheet:last-child { break-after: auto; }
  /* Tailwind utility used by SheetCutSheet's screen-only print warning */
  .print\\:hidden { display: none !important; }
}
`

// Sheet + TitleBlockHtml components imported from @/components/planset/

// ── PRINT HANDLER ───────────────────────────────────────────────────────────
//
// Always go through `evaluateExportReadiness(data, cutSheetStatus)` from the
// caller before invoking this function. The caller is responsible for the
// gate; this function only handles the actual print mechanics. Bypassing the
// gate is a P0 audit-violation surface — the whole point of the readiness
// chokepoint is that a noncompliant planset can't be exported without an
// explicit, justified override.

function handlePrintAll(data: PlansetData) {
  const sheetsContainer = document.getElementById('planset-sheets')
  if (!sheetsContainer) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    const t = document.createElement('div')
    t.textContent = 'Please allow popups to print.'
    t.className = 'fixed bottom-4 right-4 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm font-medium bg-red-600 text-white'
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 3000)
    return
  }

  // Extract .sheet + .utility-letter (UtilityBatteryLetter uses its own class; skip CRM chrome)
  const sheetElements = sheetsContainer.querySelectorAll('.sheet, .utility-letter')
  console.log('[planset print] extracted', sheetElements.length, 'sheets:',
    Array.from(sheetElements).map(el => el.className.split(' ')[0]))
  let sheetsHtml = ''
  sheetElements.forEach(el => {
    sheetsHtml += el.outerHTML
  })

  // Collect all image URLs from sheets for preloading
  const imgUrls: string[] = []
  sheetElements.forEach(el => {
    el.querySelectorAll('img').forEach(img => {
      if (img.src) imgUrls.push(img.src)
    })
  })
  const preloadLinks = imgUrls.map(url => `<link rel="preload" href="${url}" as="image" />`).join('\n')

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Plan Set — ${data.projectId} ${data.owner}</title>
  <base href="${window.location.origin}/" />
  ${preloadLinks}
  <style>${PRINT_CSS}</style>
</head>
<body>${sheetsHtml}
<script>
  // Wait for fonts + all images to load before printing
  Promise.all([
    document.fonts.ready,
    ...Array.from(document.images).map(img =>
      img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
    ),
  ]).then(() => {
    // Extra 200ms buffer for layout settle
    setTimeout(() => window.print(), 200);
  });
  // Safety fallback: print after 3s regardless
  setTimeout(() => window.print(), 3000);
</script>
</body>
</html>`)

  printWindow.document.close()
}


// ── PAGE COMPONENT ──────────────────────────────────────────────────────────

export default function PlanSetPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-900"><Nav active="Redesign" /></div>}>
      <PlanSetPageInner />
    </Suspense>
  )
}

function PlanSetPageInner() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const searchParams = useSearchParams()
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'|'info'} | null>(null)

  // Enhanced mode is now the default — designers shouldn't have to click in to
  // get the canonical 13-sheet planset. ?enhanced=0 opts back into the legacy
  // 10-sheet "classic" output for projects that need only the minimum.
  const enhanced = searchParams.get('enhanced') !== '0'
  const [projectId, setProjectId] = useState<string>('')
  const [data, setData] = useState<PlansetData | null>(null)
  const [loading, setLoading] = useState(false)
  // P1-13 (R1 audit 2026-04-28) — true between an OverridesPanel edit and the
  // debounced rebuild that re-computes compliance flags. Without this gate,
  // a designer who edits a string and immediately clicks "Download as PDF"
  // would have their click evaluated against pre-edit data — defeating the
  // export readiness chokepoint. Cleared when the rebuild finishes.
  const [editsPending, setEditsPending] = useState(false)
  const [strings, setStrings] = useState<PlansetString[]>([])
  const [roofFaces, setRoofFaces] = useState<PlansetRoofFace[]>([])
  const [overrides, setOverrides] = useState<PlansetOverrides>({})
  const [images, setImages] = useState<{ sitePlanImageUrl: string | null, roofPlanImageUrl: string | null, aerialPhotoUrl: string | null, housePhotoUrl: string | null, equipmentPhotos: (string | null)[] }>({
    sitePlanImageUrl: null, roofPlanImageUrl: null, aerialPhotoUrl: null, housePhotoUrl: null, equipmentPhotos: [null, null, null, null],
  })
  const [driveStatus, setDriveStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error', matched?: number, message?: string } | null>(null)

  // Snapshot of the last persisted (or just-loaded) planset state. Used by
  // the debounced save effect to skip POSTs when nothing actually changed
  // — without this guard, every loadProject would fire a no-op save that
  // re-writes what was just hydrated. (#446)
  const savedSnapshotRef = useRef<string>('')

  // Refs that mirror the latest planset state. loadProject reads these for
  // its fallback paths so the useCallback deps can stay narrow; without the
  // ref indirection, loadProject closes over stale state slices and either
  // (a) misuses old fallbacks or (b) needs the slices in its dep list, which
  // would re-create loadProject on every edit and cause the mount-effect to
  // re-run with the same urlProject — a re-load loop. R2 audit Medium-2 fix.
  const overridesRef = useRef(overrides)
  const roofFacesRef = useRef(roofFaces)
  const imagesRef = useRef(images)
  useEffect(() => { overridesRef.current = overrides }, [overrides])
  useEffect(() => { roofFacesRef.current = roofFaces }, [roofFaces])
  useEffect(() => { imagesRef.current = images }, [images])

  // Stable stringify (recursive key sort) so snapshot equality doesn't false-
  // negative when React-batched setOverrides/setStrings/etc emit the same
  // logical state with different key insertion order. R2 audit Medium-3 fix.
  const stableStringify = useCallback((v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v)
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
  }, [])

  const loadProject = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const project = await loadProjectById(id)
      if (!project) {
        setToast({ message: `Project ${id} not found`, type: 'error' })
        setTimeout(() => setToast(null), 3000)
        return
      }

      // Hydrate persisted overrides from projects.planset_overrides (#446).
      // Seed runtime state BEFORE building plansetData so the buildPlansetData
      // call below sees the saved polygons / strings / overrides instead of
      // the empty-default state. Each branch falls through to defaults when
      // the persisted blob is missing or malformed.
      const saved = project.planset_overrides ?? null
      const savedOverrides = (saved?.overrides ?? null) as PlansetOverrides | null
      const savedStrings = (saved?.strings ?? null) as PlansetString[] | null
      const savedRoofFaces = (saved?.roofFaces ?? null) as PlansetRoofFace[] | null
      const savedImages = saved?.images ?? null

      // Apply saved state to React state up-front. Subsequent reloads of the
      // same project see the same polygons/strings; new projects start clean.
      if (savedOverrides) setOverrides(savedOverrides)
      if (savedImages) {
        setImages({
          sitePlanImageUrl: savedImages.sitePlanImageUrl ?? null,
          roofPlanImageUrl: savedImages.roofPlanImageUrl ?? null,
          aerialPhotoUrl: savedImages.aerialPhotoUrl ?? null,
          housePhotoUrl: savedImages.housePhotoUrl ?? null,
          equipmentPhotos: savedImages.equipmentPhotos ?? [null, null, null, null],
        })
      }

      const effectiveOverrides = savedOverrides ?? overridesRef.current
      const panelCount = effectiveOverrides.panelCount ?? project.module_qty ?? 0
      const d = DURACELL_DEFAULTS
      const panelVoc = effectiveOverrides.panelVoc ?? d.panelVoc
      const absCoeff = Math.abs(d.vocTempCoeff / 100)
      const vocCorrected = panelVoc * (1 + absCoeff * (25 - d.designTempLow))
      const panelVmp = effectiveOverrides.panelVmp ?? d.panelVmp
      const panelImp = effectiveOverrides.panelImp ?? d.panelImp
      const inverterCount = effectiveOverrides.inverterCount ?? project.inverter_qty ?? d.inverterCount
      const mpptsPerInverter = effectiveOverrides.mpptsPerInverter ?? d.mpptsPerInverter
      const stringsPerMppt = effectiveOverrides.stringsPerMppt ?? d.stringsPerMppt
      const maxVoc = d.maxVoc // Duracell Max Hybrid: 500V max input voltage

      const autoStrings = autoDistributeStrings(
        panelCount, vocCorrected, panelVmp, panelImp,
        inverterCount, mpptsPerInverter, stringsPerMppt, maxVoc
      )

      // Saved strings override auto-distributed; saved roof faces override
      // auto-derived. Falls through to defaults when nothing is saved yet.
      const finalStrings = savedStrings ?? effectiveOverrides.strings ?? autoStrings
      setStrings(finalStrings)

      const effectiveRoofFaces = savedRoofFaces ?? (roofFacesRef.current.length > 0 ? roofFacesRef.current : undefined)
      const effectiveSitePlan =
        savedImages?.sitePlanImageUrl ?? imagesRef.current.sitePlanImageUrl ?? undefined

      const plansetData = buildPlansetData(project, {
        ...effectiveOverrides,
        strings: finalStrings,
        roofFaces: effectiveRoofFaces,
        sitePlanImageUrl: effectiveSitePlan,
      })
      plansetData.sheetTotal = computeSheetTotal(enhanced)
      // If we have saved polygons, prefer them; otherwise let buildPlansetData's
      // auto-derivation seed roofFaces from string assignments.
      const finalRoofFaces = savedRoofFaces ?? plansetData.roofFaces
      setRoofFaces(finalRoofFaces)
      setData(plansetData)
      setProjectId(id)
      // Seed the save-effect's snapshot guard to the state we just hydrated
      // so the next state batch doesn't trigger a redundant POST that re-saves
      // exactly what we just loaded. stableStringify so key-order changes
      // across React batches don't false-trigger the effect.
      savedSnapshotRef.current = stableStringify({
        overrides: savedOverrides ?? overridesRef.current,
        strings: finalStrings,
        roofFaces: finalRoofFaces,
        images: savedImages
          ? {
              sitePlanImageUrl: savedImages.sitePlanImageUrl ?? null,
              roofPlanImageUrl: savedImages.roofPlanImageUrl ?? null,
              aerialPhotoUrl: savedImages.aerialPhotoUrl ?? null,
              housePhotoUrl: savedImages.housePhotoUrl ?? null,
              equipmentPhotos: savedImages.equipmentPhotos ?? [null, null, null, null],
            }
          : imagesRef.current,
      })
    } catch (err) {
      handleApiError(err, '[planset] loadProject')
      setToast({ message: 'Failed to load project', type: 'error' })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setLoading(false)
    }
    // Deps narrowed: loadProject reads overrides / roofFaces / images via
    // their refs, so the function identity stays stable even when those
    // slices change. enhanced + stableStringify are the only true reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enhanced, stableStringify])

  useEffect(() => {
    const urlProject = searchParams.get('project')
    if (urlProject && !projectId) {
      loadProject(urlProject)
    }
  }, [searchParams, projectId, loadProject])

  // Persist planset state to projects.planset_overrides on edit (#446).
  // Debounced 1.5s so a polygon-drawing session doesn't fire 60 writes; the
  // 60/min/user rate limit still gives a wide ceiling. Skip the save when
  // there's no projectId (initial mount before loadProject), and skip the
  // first effect after loadProject (the state we just set IS the saved
  // state — re-saving it is wasted writes). savedSnapshotRef is seeded
  // synchronously inside loadProject so the rehydration pass doesn't POST.
  useEffect(() => {
    if (!projectId) return
    const snapshot = stableStringify({ overrides, strings, roofFaces, images })
    if (snapshot === savedSnapshotRef.current) return
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/planset/save-overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, payload: { overrides, strings, roofFaces, images } }),
        })
        if (res.ok) {
          savedSnapshotRef.current = snapshot
        } else {
          // Surface failure to the user — silent persistence loss is the bug
          // this whole feature is fixing. Generic message so we don't leak
          // server error text to the UI; full body to the console for debug.
          const body = await res.json().catch(() => ({}))
          console.error('[planset] save-overrides failed', res.status, body)
          setToast({ message: 'Failed to save planset edits — try again', type: 'error' })
          setTimeout(() => setToast(null), 4000)
        }
      } catch (err) {
        handleApiError(err, '[planset] save-overrides')
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [projectId, overrides, strings, roofFaces, images, stableStringify])

  const rebuildData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const project = await loadProjectById(projectId)
      if (!project) return
      const plansetData = buildPlansetData(project, { ...overrides, strings, roofFaces: roofFaces.length > 0 ? roofFaces : undefined, sitePlanImageUrl: images.sitePlanImageUrl ?? undefined })
      plansetData.sheetTotal = computeSheetTotal(enhanced)
      setData(plansetData)
    } finally {
      setLoading(false)
      setEditsPending(false)
    }
  }, [projectId, strings, overrides, roofFaces, images.sitePlanImageUrl])

  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!projectId) return
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current)
    setEditsPending(true)
    rebuildTimerRef.current = setTimeout(() => rebuildData(), 500)
    return () => { if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current) }
  }, [projectId, strings, overrides, roofFaces, images.sitePlanImageUrl, rebuildData])

  // Phase 6: auto-pull photos from the project's Google Drive folder when a new
  // project is loaded. Fires ONCE per projectId — does not re-run on manual
  // uploads (which don't change projectId) so user uploads aren't clobbered.
  // Missing photos (null slots) fall through to the existing manual upload UI.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const controller = new AbortController()
    setDriveStatus({ state: 'loading' })
    fetch(`/api/planset/drive-photos?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{
          aerialPhotoUrl: string | null
          housePhotoUrl: string | null
          sitePlanImageUrl: string | null
          roofPlanImageUrl: string | null
          equipmentPhotos: (string | null)[]
          meta: { imagesMatched: number; fallbackReason?: string; subfoldersSearched: string[] }
        }>
      })
      .then(photos => {
        if (cancelled) return
        if (photos.meta?.fallbackReason) {
          setDriveStatus({ state: 'error', message: photos.meta.fallbackReason })
          return
        }
        const matched = photos.meta?.imagesMatched ?? 0
        if (matched === 0) {
          setDriveStatus({ state: 'success', matched: 0, message: 'No photos found in 07 Site Survey or 08 Design — upload manually below' })
          return
        }
        setImages(prev => {
          // Revoke any existing blob URLs for slots we are about to overwrite.
          const revokeBlob = (u: string | null) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u) }
          if (photos.aerialPhotoUrl) revokeBlob(prev.aerialPhotoUrl)
          if (photos.housePhotoUrl) revokeBlob(prev.housePhotoUrl)
          if (photos.sitePlanImageUrl) revokeBlob(prev.sitePlanImageUrl)
          if (photos.roofPlanImageUrl) revokeBlob(prev.roofPlanImageUrl)
          const newEquipment = [...prev.equipmentPhotos]
          for (let i = 0; i < 4; i++) {
            const incoming = photos.equipmentPhotos?.[i] ?? null
            if (incoming) { revokeBlob(newEquipment[i]); newEquipment[i] = incoming }
          }
          return {
            sitePlanImageUrl: photos.sitePlanImageUrl ?? prev.sitePlanImageUrl,
            roofPlanImageUrl: photos.roofPlanImageUrl ?? prev.roofPlanImageUrl,
            aerialPhotoUrl: photos.aerialPhotoUrl ?? prev.aerialPhotoUrl,
            housePhotoUrl: photos.housePhotoUrl ?? prev.housePhotoUrl,
            equipmentPhotos: newEquipment,
          }
        })
        setDriveStatus({ state: 'success', matched })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof Error && err.name === 'AbortError') return
        const msg = err instanceof Error ? err.message : 'drive fetch failed'
        setDriveStatus({ state: 'error', message: msg })
      })
    return () => { cancelled = true; controller.abort() }
  }, [projectId])

  // Screen-mode scale for 11x17 sheets to fit in a browser window
  // NOTE: these must live ABOVE the early-return for non-managers to avoid Rules of Hooks violation
  const [screenScale, setScreenScale] = useState(0.55)
  const [fullscreenSheetId, setFullscreenSheetId] = useState<string | null>(null)
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 2.0

  // ── Export readiness — single chokepoint for "can this planset go to AHJ?"
  // Cut-sheet HEAD preflight runs once per page-load, in parallel with sheet
  // rendering. The same status map drives (a) the page-level readiness gate
  // and (b) the per-sheet "PDF UNAVAILABLE" placard inside SheetCutSheet —
  // making it impossible for the cover-sheet warning to disagree with what
  // the export button thinks. Re-runs when CUT_SHEETS list changes (dev/HMR
  // rebuild only — the array is module-scoped at runtime).
  const [cutSheetStatus, setCutSheetStatus] = useState<Map<string, CutSheetStatus>>(
    () => new Map(CUT_SHEETS.map((cs) => [cs.sheetId, 'pending' as CutSheetStatus]))
  )
  useEffect(() => {
    let cancelled = false
    Promise.all(
      CUT_SHEETS.map(async (cs): Promise<[string, CutSheetStatus]> => {
        try {
          const res = await fetch(cs.src, { method: 'HEAD' })
          return [cs.sheetId, res.ok ? 'ok' : 'missing']
        } catch {
          return [cs.sheetId, 'missing']
        }
      })
    ).then((results) => {
      if (cancelled) return
      setCutSheetStatus(new Map(results))
    })
    return () => { cancelled = true }
  }, [])

  // Readiness eval is pure + cheap — recomputes whenever data or cut-sheet
  // statuses change. The button-disabled state during `editsPending` (P1-13)
  // is wired separately so the readiness panel doesn't flash a confusing
  // "edits pending" placeholder during the 500ms post-load/post-edit window.
  const exportReadiness = useMemo(() => {
    if (!data) return { canExport: false, failures: [], allOverridable: false }
    return evaluateExportReadiness({ data, cutSheetStatus })
  }, [data, cutSheetStatus])

  // True while the export button should refuse clicks: either the readiness
  // gate is failing OR an edit is mid-debounce-and-rebuild. Click-time check
  // in `requestExport` re-validates against the latest readiness, so the
  // editsPending guard is purely defensive — closes the race where a fast
  // click within the 500ms window would have read stale compliance flags.
  const exportBlockedDuringRecompute = editsPending && data !== null

  // Override modal state — typed-OVERRIDE confirmation pattern. Persists only
  // for the current export attempt; resets to null after print fires or modal
  // dismisses. Reason text is captured + console-logged so the override is at
  // least diagnostically traceable. (TODO: persist to an audit table when the
  // ATLAS HQ planset_export_overrides surface lands — out of scope for this PR.)
  const [overrideModal, setOverrideModal] = useState<{ confirmText: string; reason: string } | null>(null)

  const requestExport = useCallback(() => {
    if (!data) return
    if (editsPending) return  // wait for the recompute; button is also disabled in this state
    if (exportReadiness.canExport) {
      handlePrintAll(data)
      return
    }
    if (exportReadiness.allOverridable) {
      setOverrideModal({ confirmText: '', reason: '' })
      return
    }
    // Non-overridable failure (cut-sheet missing / pending) — refuse outright.
    setToast({
      message: `Cannot export: ${exportReadiness.failures.length} blocking issue${exportReadiness.failures.length === 1 ? '' : 's'} — see warning panel above the cover sheet.`,
      type: 'error',
    })
    setTimeout(() => setToast(null), 5000)
  }, [data, editsPending, exportReadiness])

  const confirmOverride = useCallback(() => {
    if (!data || !overrideModal) return
    if (overrideModal.confirmText.trim().toUpperCase() !== 'OVERRIDE') return
    if (overrideModal.reason.trim().length < 10) return
    // Diagnostic log — captured in browser console + Vercel runtime logs if a
    // designer ever needs to reconstruct who exported what under override.
    console.warn('[planset export OVERRIDE]', {
      projectId: data.projectId,
      owner: data.owner,
      reason: overrideModal.reason.trim(),
      failures: exportReadiness.failures.map((f) => f.rule),
      timestamp: new Date().toISOString(),
    })
    setOverrideModal(null)
    handlePrintAll(data)
  }, [data, overrideModal, exportReadiness.failures])

  // Escape key + backdrop-click close for fullscreen modal
  useEffect(() => {
    if (!fullscreenSheetId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreenSheetId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreenSheetId])

  const clearProject = () => {
    setProjectId('')
    setData(null)
    setStrings([])
    setRoofFaces([])
    setOverrides({})
    // Only revoke manually-uploaded blob URLs — auto-pulled /api/planset/drive-image URLs
    // are remote references and must not be passed to revokeObjectURL.
    const revokeBlob = (u: string | null) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u) }
    revokeBlob(images.sitePlanImageUrl)
    revokeBlob(images.roofPlanImageUrl)
    revokeBlob(images.aerialPhotoUrl)
    revokeBlob(images.housePhotoUrl)
    images.equipmentPhotos.forEach(revokeBlob)
    setImages({ sitePlanImageUrl: null, roofPlanImageUrl: null, aerialPhotoUrl: null, housePhotoUrl: null, equipmentPhotos: [null, null, null, null] })
    setDriveStatus(null)
  }

  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <>
        <Nav active="Redesign" />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">Plan sets are available to Managers and above.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <Nav active="Redesign" />

      <div className="max-w-[1200px] mx-auto px-4 py-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-green-400 animate-spin mr-3" />
            <span className="text-gray-400 text-sm">Loading project data...</span>
          </div>
        )}

        {!loading && !data && (
          <ProjectSelector onSelect={loadProject} />
        )}

        {!loading && data && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-white">
                  Plan Set: {data.projectId} {data.owner}
                </h1>
                <p className="text-gray-400 text-sm mt-1">
                  {data.address} &mdash; {data.systemDcKw.toFixed(2)} kW DC / {data.totalStorageKwh} kWh ESS
                </p>
              </div>
              <div className="flex items-center gap-3">
                {enhanced ? (
                  <a href={`/planset?project=${projectId}&enhanced=0`}
                    className="px-3 py-1.5 text-xs rounded-md bg-amber-600/20 text-amber-400 border border-amber-600/30">
                    Enhanced Mode &mdash; click for Classic
                  </a>
                ) : (
                  <a href={`/planset?project=${projectId}`}
                    className="px-3 py-1.5 text-xs rounded-md bg-gray-800 text-gray-400 hover:text-green-400 hover:bg-gray-700 transition-colors">
                    Enable Enhanced Mode
                  </a>
                )}
                <button
                  onClick={clearProject}
                  className="px-4 py-2 text-sm rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  Change Project
                </button>
                <a href="/redesign"
                  className="px-4 py-2 text-sm rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  Back to Redesign
                </a>
                <ZoomToolbar
                  scale={screenScale}
                  onScaleChange={setScreenScale}
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                />
                <button
                  onClick={requestExport}
                  data-testid="export-pdf-button"
                  disabled={exportBlockedDuringRecompute || (!exportReadiness.canExport && !exportReadiness.allOverridable)}
                  className={`px-5 py-2 text-sm font-medium rounded-md text-white transition-colors ${
                    exportBlockedDuringRecompute
                      ? 'bg-gray-700 cursor-wait opacity-60'
                      : exportReadiness.canExport
                        ? 'bg-green-600 hover:bg-green-500'
                        : exportReadiness.allOverridable
                          ? 'bg-amber-600 hover:bg-amber-500'
                          : 'bg-gray-700 cursor-not-allowed opacity-60'
                  }`}>
                  {exportBlockedDuringRecompute
                    ? 'Recomputing…'
                    : exportReadiness.canExport
                      ? 'Download as PDF'
                      : exportReadiness.allOverridable
                        ? `Download — ${exportReadiness.failures.length} compliance issue${exportReadiness.failures.length === 1 ? '' : 's'}`
                        : 'Download blocked — fix issues above'}
                </button>
                <span className="text-xs text-gray-500">Select &quot;Save as PDF&quot; in the print dialog</span>
              </div>
            </div>

            {driveStatus && driveStatus.state !== 'idle' && (
              <div className={`mb-4 px-3 py-2 rounded-md text-xs border ${
                driveStatus.state === 'loading' ? 'bg-blue-900/20 border-blue-800 text-blue-300' :
                driveStatus.state === 'success' && (driveStatus.matched ?? 0) > 0 ? 'bg-green-900/20 border-green-800 text-green-300' :
                driveStatus.state === 'success' ? 'bg-gray-800 border-gray-700 text-gray-400' :
                'bg-amber-900/20 border-amber-800 text-amber-300'
              }`}>
                {driveStatus.state === 'loading' && 'Fetching photos from Google Drive...'}
                {driveStatus.state === 'success' && (driveStatus.matched ?? 0) > 0 && `Auto-pulled ${driveStatus.matched} photo${driveStatus.matched === 1 ? '' : 's'} from Drive.`}
                {driveStatus.state === 'success' && (driveStatus.matched ?? 0) === 0 && (driveStatus.message ?? 'No photos matched.')}
                {driveStatus.state === 'error' && `Drive auto-pull: ${driveStatus.message ?? 'failed'} — upload photos manually below.`}
              </div>
            )}

            {/* Export-readiness panel — chokepoint for "this planset is not
                ship-ready" (NEC compliance + asset availability + battery
                DC unverified). Renders only when there's something to fix.
                Mirrors what `requestExport` checks at click time, so the
                designer can see the same list before/after pressing the
                button. P0 fix from R1 audit 2026-04-28. */}
            {!exportBlockedDuringRecompute && !exportReadiness.canExport && exportReadiness.failures.length > 0 && (
              <div
                data-testid="export-readiness-panel"
                className={`mb-4 rounded-md border p-4 ${
                  exportReadiness.allOverridable
                    ? 'border-amber-700 bg-amber-900/20'
                    : 'border-red-700 bg-red-900/20'
                }`}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${exportReadiness.allOverridable ? 'text-amber-400' : 'text-red-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold text-sm mb-1 ${exportReadiness.allOverridable ? 'text-amber-300' : 'text-red-300'}`}>
                      {exportReadiness.failures.length} {exportReadiness.failures.length === 1 ? 'issue blocks' : 'issues block'} export to PDF
                      {exportReadiness.allOverridable && ' (designer override available)'}
                    </div>
                    <ul className="space-y-2 mt-2">
                      {exportReadiness.failures.map((f, i) => (
                        <li key={i} className="text-xs text-gray-200">
                          <div className={`font-bold ${exportReadiness.allOverridable ? 'text-amber-200' : 'text-red-200'}`}>
                            {f.title}
                            {!f.overridable && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-red-800 text-red-100 rounded">CANNOT OVERRIDE</span>}
                          </div>
                          <div className="text-gray-400 mt-0.5 leading-relaxed">{f.detail}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <OverridesPanel
              data={data}
              strings={strings}
              onStringsChange={setStrings}
              overrides={overrides}
              onOverridesChange={setOverrides}
              roofFaces={roofFaces}
              onRoofFacesChange={setRoofFaces}
              images={images}
              onImagesChange={setImages}
              enhanced={enhanced}
            />

            {/* Typed-OVERRIDE confirmation modal. Designer must (a) type
                "OVERRIDE" verbatim, (b) provide a reason ≥10 chars, before
                the export proceeds. Reason is console-logged for diagnostic
                traceability. Only reachable when allOverridable=true (so
                non-overridable failures like missing cut sheets cannot be
                bypassed by clicking through). */}
            {overrideModal && (
              <div
                data-testid="override-modal"
                className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
                onClick={(e) => { if (e.target === e.currentTarget) setOverrideModal(null) }}
              >
                <div className="bg-gray-900 border border-amber-700 rounded-lg max-w-2xl w-full p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <AlertTriangle className="w-6 h-6 text-amber-400" />
                    <h2 className="text-lg font-bold text-amber-300">Override compliance gate?</h2>
                  </div>
                  <p className="text-sm text-gray-300 mb-2">
                    This planset has {exportReadiness.failures.length} unresolved compliance {exportReadiness.failures.length === 1 ? 'issue' : 'issues'}. Exporting under override means you accept responsibility for resolving the {exportReadiness.failures.length === 1 ? 'issue' : 'issues'} before submitting to the AHJ — typically by attaching a line-side tap drawing, an alternate-method approval letter, or a manufacturer spec sheet that confirms the rendered values.
                  </p>
                  <ul className="text-xs text-amber-200 mb-4 space-y-1 list-disc pl-5">
                    {exportReadiness.failures.map((f, i) => (
                      <li key={i}>{f.title}</li>
                    ))}
                  </ul>
                  <label className="block text-sm text-gray-300 mb-1">
                    Reason (visible in browser console + future audit log) — minimum 10 chars
                  </label>
                  <textarea
                    value={overrideModal.reason}
                    onChange={(e) => setOverrideModal({ ...overrideModal, reason: e.target.value })}
                    placeholder="e.g. CenterPoint approved line-side tap; drawing attached separately."
                    className="w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded p-2 mb-3"
                    rows={3}
                  />
                  <label className="block text-sm text-gray-300 mb-1">
                    Type <span className="font-mono font-bold text-amber-300">OVERRIDE</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={overrideModal.confirmText}
                    onChange={(e) => setOverrideModal({ ...overrideModal, confirmText: e.target.value })}
                    placeholder="OVERRIDE"
                    className="w-full bg-gray-800 border border-gray-700 text-gray-100 font-mono text-sm rounded p-2 mb-4"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setOverrideModal(null)}
                      className="px-4 py-2 text-sm rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700">
                      Cancel
                    </button>
                    <button
                      onClick={confirmOverride}
                      data-testid="override-confirm-button"
                      disabled={
                        overrideModal.confirmText.trim().toUpperCase() !== 'OVERRIDE' ||
                        overrideModal.reason.trim().length < 10
                      }
                      className="px-4 py-2 text-sm rounded-md bg-amber-600 hover:bg-amber-500 text-white disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50">
                      Override and download
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Sheets — rendered at print size, scaled down for screen */}
            {(() => {
              const sheetList = [
                ...(enhanced ? [{ id: 'UTIL', label: 'Utility Battery Letter', component: <UtilityBatteryLetter data={data} />, portrait: true }] : []),
                { id: 'PV-1', label: 'Cover Page & General Notes', component: <SheetPV1 data={data} aerialPhotoUrl={images.aerialPhotoUrl} housePhotoUrl={images.housePhotoUrl} enhanced={enhanced} /> },
                { id: 'PV-2', label: 'Project Data', component: <SheetPV2 data={data} /> },
                { id: 'PV-2A', label: 'Unit Index / Legend', component: <SheetPV2A data={data} /> },
                { id: 'PV-3', label: 'Site Plan', component: <SheetPV3 data={data} /> },
                // Natural numerical order: PV-3 → PV-3.1 → PV-4 → PV-4.1
                ...(enhanced ? [
                  { id: 'PV-3.1', label: 'Equipment Elevation', component: <SheetPV31 data={data} equipmentPhotos={images.equipmentPhotos} /> },
                ] : []),
                { id: 'PV-4', label: 'Equipment Detail', component: <SheetPV4 data={data} /> },
                ...(enhanced ? [
                  { id: 'PV-4.1', label: 'Attachment Detail', component: <SheetPV41 data={data} /> },
                ] : []),
                { id: 'PV-5', label: 'Single Line Diagram', component: <SheetPV5 data={data} /> },
                { id: 'PV-6', label: 'Wiring Calculations', component: <SheetPV6 data={data} /> },
                { id: 'PV-7', label: 'Warning Labels', component: <SheetPV7 data={data} /> },
                { id: 'PV-7.1', label: 'Equipment Placards', component: <SheetPV71 data={data} /> },
                { id: 'PV-8', label: 'Conductor Schedule & BOM', component: <SheetPV8 data={data} /> },
                ...CUT_SHEETS.map(cs => ({
                  id: cs.sheetId,
                  label: cs.title,
                  component: <SheetCutSheet entry={cs} />,
                })),
              ]

              const fullscreenSheet = fullscreenSheetId ? sheetList.find(s => s.id === fullscreenSheetId) : null

              return (
                <>
                  <div id="planset-sheets" className="space-y-8">
                    {sheetList.map(sheet => {
                      const isPortrait = 'portrait' in sheet && sheet.portrait
                      const sheetW = isPortrait ? 8.5 : 16.5
                      const sheetH = isPortrait ? 11 : 10.5
                      return (
                        <div key={sheet.id}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">{sheet.id}</span>
                            <span className="text-sm text-gray-400">{sheet.label}</span>
                            <button
                              onClick={() => setFullscreenSheetId(sheet.id)}
                              aria-label={`Fullscreen ${sheet.id}`}
                              className="ml-auto bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white p-1 rounded"
                            >
                              <Maximize2 size={14} />
                            </button>
                          </div>
                          <div className="border border-gray-700 rounded-lg overflow-hidden relative" style={{
                            width: `${sheetW * 96 * screenScale}px`,
                            height: `${sheetH * 96 * screenScale}px`,
                          }}>
                            <div style={{
                              transform: `scale(${screenScale})`,
                              transformOrigin: 'top left',
                              width: `${sheetW}in`,
                              height: `${sheetH}in`,
                              background: 'white',
                            }}>
                              {sheet.component}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {fullscreenSheet && (() => {
                    const isPortrait = 'portrait' in fullscreenSheet && fullscreenSheet.portrait
                    const sheetW = isPortrait ? 8.5 : 16.5
                    const sheetH = isPortrait ? 11 : 10.5
                    return (
                      <div
                        data-testid="fullscreen-modal"
                        className="fixed inset-0 z-50 bg-black/95 flex flex-col p-4"
                        onClick={(e) => { if (e.target === e.currentTarget) setFullscreenSheetId(null) }}
                      >
                        <div className="flex items-center justify-between text-white mb-2 flex-shrink-0">
                          <span className="text-sm font-medium">{fullscreenSheet.id} — {fullscreenSheet.label}</span>
                          <button
                            onClick={() => setFullscreenSheetId(null)}
                            aria-label="Close fullscreen"
                            className="text-gray-300 hover:text-white"
                          >
                            <X size={20} />
                          </button>
                        </div>
                        <div className="flex-1 flex items-center justify-center overflow-auto">
                          <div style={{
                            width: `${sheetW}in`,
                            height: `${sheetH}in`,
                            maxWidth: '100%',
                            maxHeight: '100%',
                            background: 'white',
                            flexShrink: 0,
                          }}>
                            {fullscreenSheet.component}
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )
            })()}

            <div className="mt-8 mb-4 text-center text-xs text-gray-600">
              Generated by MicroGRID &mdash; {data.drawnDate} &mdash; For PE Review Only
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-4 right-4 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
        }`}>{toast.message}</div>
      )}
    </div>
  )
}
