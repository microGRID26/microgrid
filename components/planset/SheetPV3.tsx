import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV3({ data }: { data: PlansetData }) {
  // Auto-generated roof plan with panels — shows house outline + module placement
  function RoofPlanDiagram({ data: d }: { data: PlansetData }) {
    // House dimensions (schematic, not to scale)
    // House fills most of the drawing area
    const houseW = 380, houseH = 260
    const houseX = 50, houseY = 80
    const roofPeakY = houseY - 40

    // Panel sizing — larger for readability
    const panelW = 14, panelH = 22, panelGap = 2
    const maxPanelsPerRow = Math.floor((houseW - 30) / (panelW + panelGap))

    return (
      <svg viewBox="0 0 500 450" style={{ width: '100%', height: '100%' }}>
        {/* Title */}
        <text x="250" y="20" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#111">ROOF PLAN WITH MODULES</text>
        <text x="250" y="32" textAnchor="middle" fontSize="6" fill="#666">SCALE: NTS</text>

        {/* Property line (dashed) */}
        <rect x="20" y="40" width="460" height="380" fill="none" stroke="#999" strokeWidth="0.5" strokeDasharray="8,4" />
        <text x="250" y="55" textAnchor="middle" fontSize="5" fill="#999">PROPERTY LINE</text>

        {/* Street label */}
        <text x="250" y="430" textAnchor="middle" fontSize="7" fill="#666" fontWeight="bold">{d.address.split(',')[0]?.toUpperCase() || 'STREET'}</text>

        {/* Fence indication */}
        <line x1="30" y1="60" x2="30" y2="410" stroke="#999" strokeWidth="0.5" strokeDasharray="6,3" />
        <line x1="470" y1="60" x2="470" y2="410" stroke="#999" strokeWidth="0.5" strokeDasharray="6,3" />
        <line x1="30" y1="60" x2="470" y2="60" stroke="#999" strokeWidth="0.5" strokeDasharray="6,3" />
        <text x="40" y="72" fontSize="4" fill="#bbb">FENCE</text>

        {/* House outline with garage */}
        <rect x={houseX} y={houseY} width={houseW} height={houseH} fill="#f5f5f0" stroke="#333" strokeWidth="1.5" />
        {/* Garage extension */}
        <rect x={houseX + houseW - 90} y={houseY + houseH} width={90} height={45} fill="#eee" stroke="#333" strokeWidth="1" />
        <text x={houseX + houseW - 45} y={houseY + houseH + 25} textAnchor="middle" fontSize="6" fill="#999">GARAGE</text>
        {/* Driveway */}
        <rect x={houseX + houseW - 70} y={houseY + houseH + 45} width={50} height={40} fill="#e8e8e8" stroke="#aaa" strokeWidth="0.5" strokeDasharray="3,2" />
        <text x={houseX + houseW - 45} y={houseY + houseH + 70} textAnchor="middle" fontSize="5" fill="#bbb">DRIVEWAY</text>
        {/* Front door */}
        <rect x={houseX + 40} y={houseY + houseH - 2} width={22} height={5} fill="#999" stroke="#333" strokeWidth="0.5" />
        {/* Building type label */}
        <text x={houseX + houseW / 2} y={houseY + houseH - 8} textAnchor="middle" fontSize="4" fill="#999">
          {d.stories === 1 ? 'ONE' : 'TWO'} STORY {d.buildingType?.toUpperCase() || 'BUILDING'}
        </text>

        {/* Roof ridge line */}
        <line x1={houseX} y1={roofPeakY} x2={houseX + houseW / 2} y2={roofPeakY - 20} stroke="#333" strokeWidth="1" />
        <line x1={houseX + houseW} y1={roofPeakY} x2={houseX + houseW / 2} y2={roofPeakY - 20} stroke="#333" strokeWidth="1" />
        <line x1={houseX} y1={roofPeakY} x2={houseX} y2={houseY} stroke="#333" strokeWidth="1" />
        <line x1={houseX + houseW} y1={roofPeakY} x2={houseX + houseW} y2={houseY} stroke="#333" strokeWidth="1" />
        {/* Roof label — inside house to avoid overlap */}
        <text x={houseX + houseW / 2} y={houseY + houseH - 20} textAnchor="middle" fontSize="4.5" fill="#aaa">{d.roofType?.toUpperCase() || 'COMP SHINGLE'}</text>

        {/* Setback lines */}
        <rect x={houseX + 8} y={roofPeakY + 5} width={houseW - 16} height={houseH - 15} fill="none" stroke="#cc0000" strokeWidth="0.5" strokeDasharray="4,2" />
        <text x={houseX + houseW - 10} y={roofPeakY + 12} textAnchor="end" fontSize="4" fill="#cc0000">18&quot; SETBACK</text>

        {/* PV Modules on roof — green rectangles */}
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

          // Find strings assigned to this roof face
          const stringsOnFace = d.strings.filter(s => s.roofFace === rf.id)
          let panelIdx = 0

          return (
            <g key={faceIdx}>
              {/* Roof face label */}
              <text x={houseX + houseW - 15} y={startY + 8} textAnchor="end" fontSize="5" fill="#1a7a4c" fontWeight="bold">
                ROOF #{rf.id}
              </text>
              {/* Panel rectangles */}
              {panels.map((p, i) => (
                <rect key={i} x={p.x} y={p.y} width={panelW} height={panelH} fill="#1a7a4c" fillOpacity="0.7" stroke="#0d5c36" strokeWidth="0.5" />
              ))}
              {/* String labels overlaid on panel groups with inverter assignment */}
              {stringsOnFace.map((s) => {
                const sStartIdx = panelIdx
                panelIdx += s.modules
                const midIdx = sStartIdx + Math.floor(s.modules / 2)
                const labelPanel = panels[Math.min(midIdx, panels.length - 1)]
                if (!labelPanel) return null
                // Find which inverter this string belongs to
                const stringGlobalIdx = d.strings.findIndex(st => st.id === s.id)
                const invIdx = d.stringsPerInverter?.findIndex(inv => inv.includes(stringGlobalIdx)) ?? -1
                return (
                  <g key={s.id}>
                    <rect x={labelPanel.x - 1} y={labelPanel.y - 1} width={panelW + 2} height={panelH + 2} fill="none" stroke="#fff" strokeWidth="1.5" />
                    <text x={labelPanel.x + panelW / 2} y={labelPanel.y + panelH / 2 + 3} textAnchor="middle" fontSize="7" fill="#fff" fontWeight="bold">
                      S{s.id}
                    </text>
                    {/* Inverter assignment label below string label */}
                    {invIdx >= 0 && (
                      <text x={labelPanel.x + panelW / 2} y={labelPanel.y + panelH + 8} textAnchor="middle" fontSize="4.5" fill="#0d5c36" fontWeight="bold">
                        INV {invIdx + 1}
                      </text>
                    )}
                  </g>
                )
              })}
              {/* Face detail */}
              <text x={startX} y={startY + rows * (panelH + panelGap) + 8} fontSize="4" fill="#1a7a4c">
                {modulesOnFace} MODULES ({stringsOnFace.length} STRINGS), TILT {rf.tilt}&deg;, AZ {rf.azimuth}&deg;
              </text>
            </g>
          )
        })}

        {/* Module count summary */}
        <text x={houseX + houseW / 2} y={houseY + houseH + 18} textAnchor="middle" fontSize="6" fill="#333" fontWeight="bold">
          ({d.panelCount}) {d.panelModel}
        </text>
        <text x={houseX + houseW / 2} y={houseY + houseH + 28} textAnchor="middle" fontSize="5" fill="#666">
          {d.systemDcKw.toFixed(2)} kW DC
        </text>

        {/* Compass rose */}
        <g transform="translate(460, 65)">
          <line x1="0" y1="15" x2="0" y2="-15" stroke="#333" strokeWidth="1.5" />
          <polygon points="0,-15 -4,-5 4,-5" fill="#333" />
          <text x="0" y="-19" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#333">N</text>
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#333" strokeWidth="0.5" />
        </g>

        {/* Attachment spacing note */}
        <text x="250" y={houseY + houseH + 44} textAnchor="middle" fontSize="5" fill="#333">
          MAX ATTACHMENT SPACING IS 45&quot;
        </text>

        {/* Racking label */}
        <text x="250" y={houseY + houseH + 54} textAnchor="middle" fontSize="4.5" fill="#666">
          {d.rackingModel} | {d.racking.attachmentModel}
        </text>

        {/* Junction box location */}
        <rect x={houseX + houseW + 10} y={houseY + houseH / 2 - 12} width="45" height="24" fill="none" stroke="#333" strokeWidth="1" />
        <text x={houseX + houseW + 32} y={houseY + houseH / 2 + 3} textAnchor="middle" fontSize="5" fill="#333">(N) JB</text>
        <line x1={houseX + houseW} y1={houseY + houseH / 2} x2={houseX + houseW + 10} y2={houseY + houseH / 2} stroke="#333" strokeWidth="1" />
        {/* Conduit run from JB to equipment */}
        <line x1={houseX + houseW + 32} y1={houseY + houseH / 2 + 12} x2={houseX + houseW + 32} y2={houseY + houseH + 20} stroke="#333" strokeWidth="0.5" strokeDasharray="4,2" />
        <text x={houseX + houseW + 36} y={houseY + houseH + 10} fontSize="3.5" fill="#666">CONDUIT RUN</text>
      </svg>
    )
  }

  // Equipment wall layout — auto-generated Detail-A matching RUSH format
  // Shows physical arrangement of electrical equipment on exterior wall
  function DetailA() {
    return (
      <svg viewBox="0 0 700 400" style={{ width: '100%', height: '100%' }}>
        {/* Title */}
        <text x="350" y="18" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#111">DETAIL-A</text>
        <text x="350" y="30" textAnchor="middle" fontSize="7" fill="#666">SCALE: NTS</text>

        {/* Ground line */}
        <line x1="20" y1="340" x2="680" y2="340" stroke="#555" strokeWidth="1.5" />

        {/* ── Left side: PV Load Center + PV Disconnect ── */}
        {/* PV Load Center */}
        <rect x="40" y="180" width="80" height="100" fill="none" stroke="#333" strokeWidth="1.5" />
        <text x="80" y="220" textAnchor="middle" fontSize="6" fill="#333" fontWeight="bold">(N) PV LOAD CENTER</text>
        <text x="80" y="232" textAnchor="middle" fontSize="5" fill="#666">BRP12L125R 125A</text>
        <text x="80" y="242" textAnchor="middle" fontSize="5" fill="#666">RATED 100A MAIN</text>
        <text x="80" y="252" textAnchor="middle" fontSize="5" fill="#666">NEMA3R, UL LISTED</text>

        {/* Conduit from PV Load Center to main flow */}
        <line x1="80" y1="280" x2="80" y2="310" stroke="#333" strokeWidth="1" />
        <line x1="80" y1="310" x2="200" y2="310" stroke="#333" strokeWidth="1" strokeDasharray="4,2" />
        <text x="140" y="305" textAnchor="middle" fontSize="4" fill="#666">CONDUIT TO EQUIPMENT</text>

        {/* 1" EMT conduit run label */}
        <text x="20" y="170" fontSize="6" fill="#444">1&quot; EMT CONDUIT RUN</text>
        <line x1="80" y1="175" x2="80" y2="180" stroke="#333" strokeWidth="1" strokeDasharray="3,2" />

        {/* ── Center: Main Breaker / Rapid Shutdown ── */}
        <rect x="200" y="180" width="90" height="50" fill="none" stroke="#333" strokeWidth="1.5" />
        <text x="245" y="200" textAnchor="middle" fontSize="6" fill="#333" fontWeight="bold">(N) MAIN BREAKER</text>
        <text x="245" y="212" textAnchor="middle" fontSize="5" fill="#666">RAPID SHUTDOWN</text>
        <text x="245" y="222" textAnchor="middle" fontSize="5" fill="#666">DEVICE</text>

        {/* Conduit from main breaker down */}
        <line x1="245" y1="230" x2="245" y2="260" stroke="#333" strokeWidth="1" />
        <text x="300" y="244" fontSize="4" fill="#444">1-1/4&quot; EMT</text>
        <text x="300" y="252" fontSize="4" fill="#444">#3 AWG CU THWN-2</text>

        {/* ── PV Disconnect / Non-Fused ── */}
        <rect x="200" y="260" width="90" height="50" fill="none" stroke="#333" strokeWidth="1.5" />
        <text x="245" y="278" textAnchor="middle" fontSize="5.5" fill="#333" fontWeight="bold">(N) PV DISCONNECT /</text>
        <text x="245" y="288" textAnchor="middle" fontSize="5.5" fill="#333" fontWeight="bold">NON-FUSIBLE</text>
        <text x="245" y="300" textAnchor="middle" fontSize="5" fill="#666">200A, 2P, 240V (N)</text>
        <text x="245" y="316" textAnchor="middle" fontSize="4" fill="#999">VISIBLE, LOCKABLE</text>

        {/* ── Right-center: Main Service Panel ── */}
        <rect x="380" y="140" width="100" height="120" fill="none" stroke="#333" strokeWidth="2" />
        <text x="430" y="170" textAnchor="middle" fontSize="6" fill="#333" fontWeight="bold">(E) MAIN SERVICE PANEL</text>
        <text x="430" y="182" textAnchor="middle" fontSize="5" fill="#666">200A RATED, 240V,</text>
        <text x="430" y="192" textAnchor="middle" fontSize="5" fill="#666">200A MAIN</text>
        <text x="430" y="210" textAnchor="middle" fontSize="5" fill="#555">(EXTERIOR MOUNTED)</text>

        {/* Service Disconnect */}
        <rect x="380" y="280" width="100" height="50" fill="none" stroke="#333" strokeWidth="1.5" />
        <text x="430" y="298" textAnchor="middle" fontSize="5.5" fill="#333" fontWeight="bold">(N) SERVICE DISCONNECT</text>
        <text x="430" y="310" textAnchor="middle" fontSize="5" fill="#666">VISIBLE, LOCKABLE,</text>
        <text x="430" y="320" textAnchor="middle" fontSize="5" fill="#666">LABELED DISCONNECT</text>

        {/* Wire from MSP to Service Disc */}
        <line x1="430" y1="260" x2="430" y2="280" stroke="#333" strokeWidth="1" />

        {/* Conduit from PV Disc to MSP */}
        <line x1="290" y1="285" x2="380" y2="200" stroke="#333" strokeWidth="1" />

        {/* ── Far right: Utility Meter ── */}
        <circle cx="580" cy="230" r="25" fill="none" stroke="#333" strokeWidth="2" />
        <text x="580" y="226" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#333">M</text>
        <text x="580" y="237" textAnchor="middle" fontSize="6" fill="#333">kWh</text>
        <text x="580" y="200" textAnchor="middle" fontSize="6" fill="#666">(E) {data.utility?.toUpperCase() || 'UTILITY'} METER</text>
        <text x="580" y="270" textAnchor="middle" fontSize="5" fill="#666">ESID NUMBER:</text>
        <text x="580" y="280" textAnchor="middle" fontSize="5" fill="#666">{data.esid || 'N/A'}</text>

        {/* Conduit from service disc to meter */}
        <line x1="480" y1="305" x2="555" y2="235" stroke="#333" strokeWidth="1" />

        {/* Trenching annotation */}
        <text x="500" y="310" fontSize="5" fill="#444">{data.acConduit} TYPE CONDUIT</text>
        <text x="500" y="320" fontSize="5" fill="#444">ROUGHLY {data.acRunLengthFt} FEET</text>
        <text x="500" y="330" fontSize="5" fill="#444">(DIRT/ROCK) TRENCHING</text>
        <text x="500" y="340" fontSize="5" fill="#444">FROM UTILITY POLE TO</text>
        <text x="500" y="350" fontSize="5" fill="#444">HOME WALL</text>

        {/* IMO Rapid Shutdown */}
        <rect x="530" y="130" width="80" height="35" fill="none" stroke="#333" strokeWidth="1" />
        <text x="570" y="148" textAnchor="middle" fontSize="5.5" fill="#333" fontWeight="bold">(N) IMO RAPID</text>
        <text x="570" y="158" textAnchor="middle" fontSize="5.5" fill="#333" fontWeight="bold">SHUTDOWN DEVICE</text>

        {/* Surge Protector */}
        <rect x="530" y="85" width="80" height="30" fill="none" stroke="#333" strokeWidth="1" />
        <text x="570" y="103" textAnchor="middle" fontSize="5.5" fill="#333" fontWeight="bold">(N) SURGE PROTECTOR</text>

        {/* Expansion fittings callout */}
        <text x="430" y="360" textAnchor="middle" fontSize="5.5" fill="#333" fontWeight="bold">(N) EXPANSION FITTINGS</text>
        <text x="430" y="370" textAnchor="middle" fontSize="5" fill="#666">REQUIRED ON BOTH ENDS OF THE {data.acConduit} PIPE</text>

        {/* Within 10 feet label */}
        <text x="430" y="385" textAnchor="middle" fontSize="5" fill="#666">WITHIN 10 FEET FROM THE {data.utility?.toUpperCase() || 'UTILITY'} METER</text>

        {/* Sub Panel (if applicable) */}
        <rect x="380" y="50" width="100" height="70" fill="none" stroke="#333" strokeWidth="1" strokeDasharray="4,2" />
        <text x="430" y="75" textAnchor="middle" fontSize="6" fill="#666">(E) SUB PANEL</text>
        <text x="430" y="87" textAnchor="middle" fontSize="5" fill="#999">200A RATED, 240V,</text>
        <text x="430" y="97" textAnchor="middle" fontSize="5" fill="#999">200A MAIN</text>
        <text x="430" y="110" textAnchor="middle" fontSize="5" fill="#999">(INTERIOR MOUNTED)</text>

        {/* Conduit from MSP up to Sub Panel */}
        <line x1="430" y1="120" x2="430" y2="140" stroke="#333" strokeWidth="1" strokeDasharray="3,2" />

        {/* Junction Box */}
        <rect x="40" y="80" width="80" height="30" fill="none" stroke="#333" strokeWidth="1" />
        <text x="80" y="98" textAnchor="middle" fontSize="6" fill="#333" fontWeight="bold">(N) JUNCTION BOX</text>

        {/* Roof array wiring from JB up */}
        <line x1="80" y1="80" x2="80" y2="50" stroke="#333" strokeWidth="1" strokeDasharray="3,2" />
        <text x="80" y="45" textAnchor="middle" fontSize="5" fill="#444">ROOF ARRAY WIRING</text>
        <text x="80" y="55" textAnchor="middle" fontSize="5" fill="#444">#10 AWG, PV TRUNK CABLE</text>
        <text x="80" y="65" textAnchor="middle" fontSize="5" fill="#444">INSTALLED IN CONDUIT</text>

        {/* Wire from JB down to PV LC */}
        <line x1="80" y1="110" x2="80" y2="180" stroke="#333" strokeWidth="1" />
      </svg>
    )
  }

  // Header boxes (STC, meter, ESID)
  function HeaderBoxes() {
    return (
      <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
        <div style={{ border: '1px solid #111', padding: '4px 8px', fontSize: '6pt', flex: 1 }}>
          <div style={{ fontWeight: 'bold', fontSize: '7pt', textAlign: 'center', borderBottom: '1px solid #ddd', paddingBottom: '2px', marginBottom: '2px' }}>STC</div>
          <div>MODULES: {data.panelCount} x {data.panelWattage} = {data.systemDcKw.toFixed(3)} kW DC</div>
          <div>{data.inverterModel}: {data.inverterCount} x {data.inverterAcPower} = {data.systemAcKw} kW AC</div>
          <div>TOTAL kW AC = {data.systemAcKw} kW AC</div>
        </div>
        <div style={{ border: '1px solid #111', padding: '4px 8px', fontSize: '6pt' }}>
          <div>METER NUMBER: {data.meter || 'N/A'}</div>
          <div>ESID NUMBER: {data.esid || 'N/A'}</div>
        </div>
      </div>
    )
  }

  // Legend
  function Legend() {
    return (
      <div style={{ display: 'flex', gap: '12px', fontSize: '5.5pt', color: '#555', marginBottom: '4px', border: '1px solid #ddd', padding: '3px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '20px', borderTop: '2px solid #333' }} /> 18&quot; Setback
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '20px', borderTop: '2px dashed #333' }} /> 6&quot; Setback
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '20px', borderTop: '2px dotted #333' }} /> 36&quot; Setback
        </div>
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

        {/* Main content: site plan image OR placeholder + Detail-A */}
        <div style={{ flex: 1, display: 'flex', gap: '8px', overflow: 'hidden' }}>
          {/* Left: Site plan image or property outline placeholder */}
          <div style={{ flex: 1, border: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
            {data.sitePlanImageUrl ? (
              <img src={data.sitePlanImageUrl} alt="Site Plan" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <RoofPlanDiagram data={data} />
            )}
            {/* Scale label */}
            <div style={{ position: 'absolute', bottom: '4px', left: '8px', fontSize: '7pt', fontWeight: 'bold' }}>
              <div style={{ display: 'inline-block', border: '2px solid #333', borderRadius: '50%', width: '14px', height: '14px', lineHeight: '14px', textAlign: 'center', fontSize: '9pt', marginRight: '4px' }}>1</div>
              SITE PLAN WITH ROOF PLAN
              <div style={{ fontSize: '6pt', color: '#666' }}>SCALE: 1&quot; = 15&apos;</div>
            </div>
          </div>

          {/* Right: Detail-A equipment wall layout (always generated) */}
          <div style={{ flex: 1, border: '1px solid #ddd', overflow: 'hidden' }}>
            <DetailA />
          </div>
        </div>

        {/* Roof description table */}
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
