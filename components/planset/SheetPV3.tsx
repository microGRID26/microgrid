// ── SheetPV3-SitePlan.tsx — diff-ready patch ───────────────────────────────
// Existing file at: components/planset/SheetPV3-SitePlan.tsx (uploaded
// as MG-SheetPV3-SitePlan.tsx).
//
// Changes:
//   1. HeaderBoxes: add a THIRD box ("BATTERY SCOPE" / project-specific note)
//      to match the Tyson sheet header strip.
//   2. RoofPlanDiagram: render `data.equipmentCallouts` as numbered red
//      circles + leader lines pointing into the schematic. Coordinates are
//      in the same 0–1 normalized space as `roofFaces[i].polygon`, mapped
//      onto the schematic's 500×450 viewBox.
//   3. RoofPlaneSvg branch: equipment callouts also render in the polygon
//      renderer when polygons are populated (separate prop pass-through).
//   4. Schematic now reflects equipment callouts when present even though
//      it's the fallback path — designer can populate callouts before
//      polygons land.
//
// All other lines unchanged from the existing file. Marked diff regions
// with `// PATCH START` / `// PATCH END` for clarity.

import { memo } from 'react'
import type { PlansetData, PlansetEquipmentCallout } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'
import { RoofPlaneSvg } from './RoofPlaneSvg'

function SheetPV3Inner({ data }: { data: PlansetData }) {
  // ── Schematic fallback for projects without polygon data ───────────────
  function RoofPlanDiagram({ data: d }: { data: PlansetData }) {
    const houseW = 380, houseH = 260
    const houseX = 50, houseY = 80
    const roofPeakY = houseY - 40
    const panelW = 14, panelH = 22, panelGap = 2
    const maxPanelsPerRow = Math.floor((houseW - 30) / (panelW + panelGap))

    // PATCH START — equipment callout coordinate mapping
    // `equipmentCallouts` use 0–1 normalized space (top-left origin) like
    // polygon coords. Map onto the schematic's 500×450 viewBox so callouts
    // land in the right spot regardless of viewport scale.
    const callouts = (d as PlansetData & { equipmentCallouts?: PlansetEquipmentCallout[] }).equipmentCallouts ?? []
    const calloutToViewBox = (c: PlansetEquipmentCallout) => ({
      cx: 20 + c.x * 460, // matches the property-line rect bounds
      cy: 40 + c.y * 380,
      leaderX: c.leaderTo ? 20 + c.leaderTo[0] * 460 : null,
      leaderY: c.leaderTo ? 40 + c.leaderTo[1] * 380 : null,
    })
    // PATCH END

    return (
      <svg viewBox="0 0 500 450" style={{ width: '100%', height: '100%' }}>
        <text x="250" y="20" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#111">ROOF PLAN WITH MODULES</text>
        <text x="250" y="32" textAnchor="middle" fontSize="6" fill="#666">SCALE: NTS</text>

        <rect x="20" y="40" width="460" height="380" fill="none" stroke="#999" strokeWidth="0.5" strokeDasharray="8,4" />
        <text x="250" y="55" textAnchor="middle" fontSize="5" fill="#999">PROPERTY LINE</text>

        <text x="250" y="430" textAnchor="middle" fontSize="7" fill="#666" fontWeight="bold">{d.address.split(',')[0]?.toUpperCase() || 'STREET'}</text>

        <line x1="30" y1="60" x2="30" y2="410" stroke="#999" strokeWidth="0.5" strokeDasharray="6,3" />
        <line x1="470" y1="60" x2="470" y2="410" stroke="#999" strokeWidth="0.5" strokeDasharray="6,3" />
        <line x1="30" y1="60" x2="470" y2="60" stroke="#999" strokeWidth="0.5" strokeDasharray="6,3" />
        <text x="40" y="72" fontSize="4" fill="#bbb">FENCE</text>

        <rect x={houseX} y={houseY} width={houseW} height={houseH} fill="#f5f5f0" stroke="#333" strokeWidth="1.5" />
        <rect x={houseX + houseW - 90} y={houseY + houseH} width={90} height={45} fill="#eee" stroke="#333" strokeWidth="1" />
        <text x={houseX + houseW - 45} y={houseY + houseH + 25} textAnchor="middle" fontSize="6" fill="#999">GARAGE</text>
        <rect x={houseX + houseW - 70} y={houseY + houseH + 45} width={50} height={40} fill="#e8e8e8" stroke="#aaa" strokeWidth="0.5" strokeDasharray="3,2" />
        <text x={houseX + houseW - 45} y={houseY + houseH + 70} textAnchor="middle" fontSize="5" fill="#bbb">DRIVEWAY</text>
        <rect x={houseX + 40} y={houseY + houseH - 2} width={22} height={5} fill="#999" stroke="#333" strokeWidth="0.5" />
        <text x={houseX + houseW / 2} y={houseY + houseH - 8} textAnchor="middle" fontSize="4" fill="#999">
          {d.stories === 1 ? 'ONE' : 'TWO'} STORY {d.buildingType?.toUpperCase() || 'BUILDING'}
        </text>

        <line x1={houseX} y1={roofPeakY} x2={houseX + houseW / 2} y2={roofPeakY - 20} stroke="#333" strokeWidth="1" />
        <line x1={houseX + houseW} y1={roofPeakY} x2={houseX + houseW / 2} y2={roofPeakY - 20} stroke="#333" strokeWidth="1" />
        <line x1={houseX} y1={roofPeakY} x2={houseX} y2={houseY} stroke="#333" strokeWidth="1" />
        <line x1={houseX + houseW} y1={roofPeakY} x2={houseX + houseW} y2={houseY} stroke="#333" strokeWidth="1" />
        <text x={houseX + houseW / 2} y={houseY + houseH - 20} textAnchor="middle" fontSize="4.5" fill="#aaa">{d.roofType?.toUpperCase() || 'COMP SHINGLE'}</text>

        <rect x={houseX + 8} y={roofPeakY + 5} width={houseW - 16} height={houseH - 15} fill="none" stroke="#cc0000" strokeWidth="0.5" strokeDasharray="4,2" />
        <text x={houseX + houseW - 10} y={roofPeakY + 12} textAnchor="end" fontSize="4" fill="#cc0000">SCHEMATIC SETBACK — SEE PV-2A</text>

        {/* PV Modules ─ unchanged from existing file */}
        {d.roofFaces.map((rf, faceIdx) => {
          const modulesOnFace = rf.modules
          const rows = Math.ceil(modulesOnFace / maxPanelsPerRow)
          const faceOffsetY = faceIdx * (rows * (panelH + panelGap) + 25)
          const startX = houseX + 20
          const startY = roofPeakY + 15 + faceOffsetY

          const panels: { x: number; y: number }[] = []
          for (let m = 0; m < modulesOnFace; m++) {
            const row = Math.floor(m / maxPanelsPerRow)
            const col = m % maxPanelsPerRow
            panels.push({
              x: startX + col * (panelW + panelGap),
              y: startY + row * (panelH + panelGap),
            })
          }

          const stringsOnFace = d.strings.filter((s) => s.roofFace === rf.id)
          let panelIdx = 0

          return (
            <g key={faceIdx}>
              <text x={houseX + houseW - 15} y={startY + 8} textAnchor="end" fontSize="5" fill="#1a7a4c" fontWeight="bold">
                ROOF #{rf.id}
              </text>
              {panels.map((p, i) => (
                <rect key={i} x={p.x} y={p.y} width={panelW} height={panelH} fill="#1a7a4c" fillOpacity="0.7" stroke="#0d5c36" strokeWidth="0.5" />
              ))}
              {stringsOnFace.map((s) => {
                const sStartIdx = panelIdx
                panelIdx += s.modules
                const midIdx = sStartIdx + Math.floor(s.modules / 2)
                const labelPanel = panels[Math.min(midIdx, panels.length - 1)]
                if (!labelPanel) return null
                const stringGlobalIdx = d.strings.findIndex((st) => st.id === s.id)
                const invIdx = d.stringsPerInverter?.findIndex((inv) => inv.includes(stringGlobalIdx)) ?? -1
                return (
                  <g key={s.id}>
                    <rect x={labelPanel.x - 1} y={labelPanel.y - 1} width={panelW + 2} height={panelH + 2} fill="none" stroke="#fff" strokeWidth="1.5" />
                    <text x={labelPanel.x + panelW / 2} y={labelPanel.y + panelH / 2 + 3} textAnchor="middle" fontSize="7" fill="#fff" fontWeight="bold">
                      S{s.id}
                    </text>
                    {invIdx >= 0 && (
                      <text x={labelPanel.x + panelW / 2} y={labelPanel.y + panelH + 8} textAnchor="middle" fontSize="4.5" fill="#0d5c36" fontWeight="bold">
                        INV {invIdx + 1}
                      </text>
                    )}
                  </g>
                )
              })}
              <text x={startX} y={startY + rows * (panelH + panelGap) + 8} fontSize="4" fill="#1a7a4c">
                {modulesOnFace} MODULES ({stringsOnFace.length} STRINGS), TILT {rf.tilt}&deg;, AZ {rf.azimuth}&deg;
              </text>
            </g>
          )
        })}

        <text x={houseX + houseW / 2} y={houseY + houseH + 18} textAnchor="middle" fontSize="6" fill="#333" fontWeight="bold">
          ({d.panelCount}) {d.panelModel}
        </text>
        <text x={houseX + houseW / 2} y={houseY + houseH + 28} textAnchor="middle" fontSize="5" fill="#666">
          {d.systemDcKw.toFixed(2)} kW DC
        </text>

        <g transform="translate(460, 65)">
          <line x1="0" y1="15" x2="0" y2="-15" stroke="#333" strokeWidth="1.5" />
          <polygon points="0,-15 -4,-5 4,-5" fill="#333" />
          <text x="0" y="-19" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#333">N</text>
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#333" strokeWidth="0.5" />
        </g>

        <text x="250" y={houseY + houseH + 44} textAnchor="middle" fontSize="5" fill="#333">
          MAX ATTACHMENT SPACING IS 45&quot;
        </text>
        <text x="250" y={houseY + houseH + 54} textAnchor="middle" fontSize="4.5" fill="#666">
          {d.rackingModel} | {d.racking.attachmentModel}
        </text>

        <rect x={houseX + houseW + 10} y={houseY + houseH / 2 - 12} width="45" height="24" fill="none" stroke="#333" strokeWidth="1" />
        <text x={houseX + houseW + 32} y={houseY + houseH / 2 + 3} textAnchor="middle" fontSize="5" fill="#333">(N) JB</text>
        <line x1={houseX + houseW} y1={houseY + houseH / 2} x2={houseX + houseW + 10} y2={houseY + houseH / 2} stroke="#333" strokeWidth="1" />
        <line x1={houseX + houseW + 32} y1={houseY + houseH / 2 + 12} x2={houseX + houseW + 32} y2={houseY + houseH + 20} stroke="#333" strokeWidth="0.5" strokeDasharray="4,2" />
        <text x={houseX + houseW + 36} y={houseY + houseH + 10} fontSize="3.5" fill="#666">CONDUIT RUN</text>

        {/* PATCH START — equipment callouts (numbered red circles + leader lines) */}
        {/* Rendered LAST so they overlay the house + panels. Cross-references
            the SLD numbered callouts (PV-5) and conductor schedule (PV-8). */}
        {callouts.map((c) => {
          const m = calloutToViewBox(c)
          return (
            <g key={c.id}>
              {m.leaderX !== null && m.leaderY !== null && (
                <line
                  x1={m.cx} y1={m.cy} x2={m.leaderX} y2={m.leaderY}
                  stroke="#cc0000" strokeWidth="0.7"
                />
              )}
              <circle cx={m.cx} cy={m.cy} r="7" fill="#cc0000" stroke="#fff" strokeWidth="0.8" />
              <text
                x={m.cx} y={m.cy + 2.5}
                textAnchor="middle"
                fontSize="6.5"
                fontWeight="bold"
                fill="#fff"
              >
                {c.id}
              </text>
              {/* Label below the circle */}
              <text
                x={m.cx} y={m.cy + 14}
                textAnchor="middle"
                fontSize="4.5"
                fontWeight="bold"
                fill="#cc0000"
              >
                {c.label}
              </text>
            </g>
          )
        })}
        {/* PATCH END */}
      </svg>
    )
  }

  // PATCH START — HeaderBoxes: equal thirds (Greg DOM measure 2026-05-01:
  // pre-fix widths were [524, 248, 524]. flex:1 on all three normalizes
  // each box to ~33% of header width).
  function HeaderBoxes() {
    return (
      <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
        <div style={{ border: '1px solid #111', padding: '4px 8px', fontSize: '6pt', flex: 1, flexBasis: 0 }}>
          <div style={{ fontWeight: 'bold', fontSize: '7pt', textAlign: 'center', borderBottom: '1px solid #ddd', paddingBottom: '2px', marginBottom: '2px' }}>STC</div>
          <div>MODULES: {data.panelCount} x {data.panelWattage} = {data.systemDcKw.toFixed(3)} kW DC</div>
          <div>{data.inverterModel}: {data.inverterCount} x {data.inverterAcPower} = {data.systemAcKw} kW AC</div>
          <div>TOTAL kW AC = {data.systemAcKw} kW AC</div>
        </div>
        <div style={{ border: '1px solid #111', padding: '4px 8px', fontSize: '6pt', flex: 1, flexBasis: 0 }}>
          <div style={{ fontWeight: 'bold', fontSize: '7pt', textAlign: 'center', borderBottom: '1px solid #ddd', paddingBottom: '2px', marginBottom: '2px' }}>METER &amp; UTILITY</div>
          <div>METER NUMBER: {data.meter || 'N/A'}</div>
          <div>ESID NUMBER: {data.esid || 'N/A'}</div>
          <div>UTILITY: {data.utility?.toUpperCase() || 'N/A'}</div>
        </div>
        {/* THIRD BOX — battery scope summary. For projects with no battery,
            shows a project-specific note instead. */}
        <div style={{ border: '1px solid #111', padding: '4px 8px', fontSize: '6pt', flex: 1, flexBasis: 0 }}>
          <div style={{ fontWeight: 'bold', fontSize: '7pt', textAlign: 'center', borderBottom: '1px solid #ddd', paddingBottom: '2px', marginBottom: '2px' }}>
            {data.batteryCount > 0 ? 'BATTERY SCOPE' : 'NOTES'}
          </div>
          {data.batteryCount > 0 ? (
            <>
              <div>({data.batteryCount}) {data.batteryModel}</div>
              <div>{data.batteryCapacity} kWh, {data.systemTopology === 'micro-inverter' ? 'AC-COUPLED' : 'DC-COUPLED'}, NEMA 3R</div>
              <div>TOTAL STORAGE: {data.totalStorageKwh} kWh · STACKS: {data.batteriesPerStack > 0 ? Math.ceil(data.batteryCount / data.batteriesPerStack) : 1}</div>
              <div style={{ marginTop: '2pt', fontWeight: 'bold' }}>
                SERVICE DISCONNECT&nbsp;&nbsp;{data.mspBusRating}A&nbsp;·&nbsp;{data.mainBreaker} MAIN
              </div>
            </>
          ) : (
            <div style={{ color: '#666' }}>NO BATTERY ON THIS PROJECT.</div>
          )}
        </div>
      </div>
    )
  }
  // PATCH END

  function Legend() {
    return (
      <div style={{ display: 'flex', gap: '12px', fontSize: '5.5pt', color: '#555', marginBottom: '4px', border: '1px solid #ddd', padding: '3px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '20px', borderTop: '2px dashed #cc0000' }} /> 36&quot; Ridge Setback
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '20px', borderTop: '2px solid #ff8800' }} /> 18&quot; Eave Setback
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '20px', borderTop: '2px dotted #888' }} /> 18&quot; Rake Setback
        </div>
        {/* PATCH START — callout legend, only when callouts present */}
        {((data as PlansetData & { equipmentCallouts?: PlansetEquipmentCallout[] }).equipmentCallouts?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
            <div style={{
              width: '12px', height: '12px', borderRadius: '50%', background: '#cc0000',
              color: '#fff', fontSize: '7px', fontWeight: 'bold',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>#</div>
            Equipment callouts → see PV-5 / PV-8
          </div>
        )}
        {/* PATCH END */}
      </div>
    )
  }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.1in 0.15in', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', color: '#111', marginBottom: '2px' }}>
          PHOTOVOLTAIC ROOF MOUNT SYSTEM
        </div>
        <div style={{ fontSize: '7pt', color: '#555', marginBottom: '4px' }}>
          {data.panelCount} MODULES-ROOF MOUNTED - {data.systemDcKw.toFixed(3)} kW DC, {data.systemAcKw} kW AC
        </div>
        <div style={{ fontSize: '7pt', color: '#555', marginBottom: '6px' }}>
          {[data.address, data.city, `${data.state}${data.zip ? ` ${data.zip}` : ''}`].filter(Boolean).join(', ')}
        </div>

        <HeaderBoxes />
        <Legend />

        <div style={{ flex: 1, display: 'flex', gap: '8px', overflow: 'hidden' }}>
          <div style={{ flex: 1, border: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
            {data.sitePlanImageUrl ? (
              <img src={data.sitePlanImageUrl} alt="Site Plan" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : data.roofFaces.some((f) => f.polygon && f.polygon.length >= 3) ? (
              // PATCH START — pass equipmentCallouts through to RoofPlaneSvg
              <RoofPlaneSvg
                faces={data.roofFaces}
                strings={data.strings}
                width={900}
                height={580}
                {...{
                  equipmentCallouts:
                    (data as PlansetData & { equipmentCallouts?: PlansetEquipmentCallout[] }).equipmentCallouts ?? [],
                }}
              />
              // PATCH END
            ) : (
              <RoofPlanDiagram data={data} />
            )}
            <div style={{ position: 'absolute', bottom: '4px', left: '8px', fontSize: '7pt', fontWeight: 'bold' }}>
              <div style={{ display: 'inline-block', border: '2px solid #333', borderRadius: '50%', width: '14px', height: '14px', lineHeight: '14px', textAlign: 'center', fontSize: '9pt', marginRight: '4px' }}>1</div>
              SITE PLAN WITH ROOF PLAN
              <div style={{ fontSize: '6pt', color: '#666' }}>SCALE: NTS</div>
            </div>
          </div>
        </div>

        {/* Roof description table — unchanged */}
        <div style={{ marginTop: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '5.5pt', border: '1px solid #333' }}>
            <thead>
              <tr style={{ background: '#111' }}>
                <th style={{ color: 'white', padding: '2px 4px', fontSize: '5pt' }}>DETAILS</th>
                {data.roofFaces.map((rf, i) => (
                  <th key={i} style={{ color: 'white', padding: '2px 4px', fontSize: '5pt' }}>ROOF #{rf.id}</th>
                ))}
                <th style={{ color: 'white', padding: '2px 4px', fontSize: '5pt' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '2px 4px', fontWeight: 'bold', borderRight: '1px solid #ddd' }}>MODULE COUNT</td>
                {data.roofFaces.map((rf, i) => (
                  <td key={i} style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ddd' }}>{rf.modules}</td>
                ))}
                <td style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 'bold' }}>{data.panelCount}</td>
              </tr>
              <tr style={{ background: '#f5f5f5' }}>
                <td style={{ padding: '2px 4px', fontWeight: 'bold', borderRight: '1px solid #ddd' }}>ARRAY TILT</td>
                {data.roofFaces.map((rf, i) => (
                  <td key={i} style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ddd' }}>{rf.tilt}&deg;</td>
                ))}
                <td style={{ padding: '2px 4px', textAlign: 'center' }}>&mdash;</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 4px', fontWeight: 'bold', borderRight: '1px solid #ddd' }}>AZIMUTH</td>
                {data.roofFaces.map((rf, i) => (
                  <td key={i} style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ddd' }}>{rf.azimuth}&deg;</td>
                ))}
                <td style={{ padding: '2px 4px', textAlign: 'center' }}>&mdash;</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <TitleBlockHtml sheetName="SITE PLAN WITH ROOF PLAN" sheetNumber="PV-3" data={data} />
    </div>
  )
}

export const SheetPV3 = memo(SheetPV3Inner)
