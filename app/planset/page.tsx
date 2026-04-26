'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { handleApiError } from '@/lib/errors'
import { loadProjectById } from '@/lib/api'
import { buildPlansetData, DURACELL_DEFAULTS } from '@/lib/planset-types'
import { autoDistributeStrings } from '@/lib/planset-calcs'
import { SheetPV1, SheetPV2, SheetPV2A, SheetPV3, SheetPV31, SheetPV4, SheetPV41, SheetPV5, SheetPV6, SheetPV7, SheetPV71, SheetPV8, SheetCutSheet, CUT_SHEETS, UtilityBatteryLetter } from '@/components/planset'
import type { PlansetData, PlansetOverrides, PlansetString, PlansetRoofFace } from '@/lib/planset-types'
import { Loader2, Maximize2, X } from 'lucide-react'
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
}
`

// Sheet + TitleBlockHtml components imported from @/components/planset/

// ── PRINT HANDLER ───────────────────────────────────────────────────────────

function handlePrintAll(data: PlansetData) {
  const sheetsContainer = document.getElementById('planset-sheets')
  if (!sheetsContainer) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    const t = document.createElement('div')
    t.textContent = 'Please allow popups to print.'
    t.className = 'fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium bg-red-600 text-white'
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

  const enhanced = searchParams.get('enhanced') === '1'
  const [projectId, setProjectId] = useState<string>('')
  const [data, setData] = useState<PlansetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [strings, setStrings] = useState<PlansetString[]>([])
  const [roofFaces, setRoofFaces] = useState<PlansetRoofFace[]>([])
  const [overrides, setOverrides] = useState<PlansetOverrides>({})
  const [images, setImages] = useState<{ sitePlanImageUrl: string | null, roofPlanImageUrl: string | null, aerialPhotoUrl: string | null, housePhotoUrl: string | null, equipmentPhotos: (string | null)[] }>({
    sitePlanImageUrl: null, roofPlanImageUrl: null, aerialPhotoUrl: null, housePhotoUrl: null, equipmentPhotos: [null, null, null, null],
  })
  const [driveStatus, setDriveStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error', matched?: number, message?: string } | null>(null)

  const loadProject = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const project = await loadProjectById(id)
      if (!project) {
        setToast({ message: `Project ${id} not found`, type: 'error' })
        setTimeout(() => setToast(null), 3000)
        return
      }

      const panelCount = overrides.panelCount ?? project.module_qty ?? 0
      const d = DURACELL_DEFAULTS
      const panelVoc = overrides.panelVoc ?? d.panelVoc
      const absCoeff = Math.abs(d.vocTempCoeff / 100)
      const vocCorrected = panelVoc * (1 + absCoeff * (25 - d.designTempLow))
      const panelVmp = overrides.panelVmp ?? d.panelVmp
      const panelImp = overrides.panelImp ?? d.panelImp
      const inverterCount = overrides.inverterCount ?? project.inverter_qty ?? d.inverterCount
      const mpptsPerInverter = overrides.mpptsPerInverter ?? d.mpptsPerInverter
      const stringsPerMppt = overrides.stringsPerMppt ?? d.stringsPerMppt
      const maxVoc = d.maxVoc // Duracell Max Hybrid: 500V max input voltage

      const autoStrings = autoDistributeStrings(
        panelCount, vocCorrected, panelVmp, panelImp,
        inverterCount, mpptsPerInverter, stringsPerMppt, maxVoc
      )

      const finalStrings = overrides.strings ?? autoStrings
      setStrings(finalStrings)

      const plansetData = buildPlansetData(project, { ...overrides, strings: finalStrings, roofFaces: roofFaces.length > 0 ? roofFaces : undefined, sitePlanImageUrl: images.sitePlanImageUrl ?? undefined })
      plansetData.sheetTotal = (enhanced ? 13 : 10) + CUT_SHEETS.length  // base + cut sheets; enhanced adds UTIL + PV-3.1 + PV-4.1
      setRoofFaces(plansetData.roofFaces)
      setData(plansetData)
      setProjectId(id)
    } catch (err) {
      handleApiError(err, '[planset] loadProject')
      setToast({ message: 'Failed to load project', type: 'error' })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setLoading(false)
    }
  }, [overrides, roofFaces, images.sitePlanImageUrl])

  useEffect(() => {
    const urlProject = searchParams.get('project')
    if (urlProject && !projectId) {
      loadProject(urlProject)
    }
  }, [searchParams, projectId, loadProject])

  const rebuildData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const project = await loadProjectById(projectId)
      if (!project) return
      const plansetData = buildPlansetData(project, { ...overrides, strings, roofFaces: roofFaces.length > 0 ? roofFaces : undefined, sitePlanImageUrl: images.sitePlanImageUrl ?? undefined })
      plansetData.sheetTotal = (enhanced ? 13 : 10) + CUT_SHEETS.length  // base + cut sheets; enhanced adds UTIL + PV-3.1 + PV-4.1
      setData(plansetData)
    } finally {
      setLoading(false)
    }
  }, [projectId, strings, overrides, roofFaces, images.sitePlanImageUrl])

  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!projectId) return
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current)
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
                  <a href={`/planset?project=${projectId}`}
                    className="px-3 py-1.5 text-xs rounded-md bg-amber-600/20 text-amber-400 border border-amber-600/30">
                    Enhanced Mode &mdash; click for Classic
                  </a>
                ) : (
                  <a href={`/planset?project=${projectId}&enhanced=1`}
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
                  onClick={() => handlePrintAll(data)}
                  className="px-5 py-2 text-sm font-medium rounded-md bg-green-600 hover:bg-green-500 text-white transition-colors">
                  Download as PDF
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

            {/* Sheets — rendered at print size, scaled down for screen */}
            {(() => {
              const sheetList = [
                ...(enhanced ? [{ id: 'UTIL', label: 'Utility Battery Letter', component: <UtilityBatteryLetter data={data} />, portrait: true }] : []),
                { id: 'PV-1', label: 'Cover Page & General Notes', component: <SheetPV1 data={data} aerialPhotoUrl={images.aerialPhotoUrl} housePhotoUrl={images.housePhotoUrl} enhanced={enhanced} /> },
                { id: 'PV-2', label: 'Project Data', component: <SheetPV2 data={data} /> },
                { id: 'PV-2A', label: 'Unit Index / Legend', component: <SheetPV2A data={data} /> },
                { id: 'PV-3', label: 'Site Plan', component: <SheetPV3 data={data} /> },
                { id: 'PV-4', label: 'Equipment Detail', component: <SheetPV4 data={data} /> },
                ...(enhanced ? [
                  { id: 'PV-3.1', label: 'Equipment Elevation', component: <SheetPV31 data={data} equipmentPhotos={images.equipmentPhotos} /> },
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
                  component: <SheetCutSheet entry={cs} data={data} />,
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
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
        }`}>{toast.message}</div>
      )}
    </div>
  )
}
