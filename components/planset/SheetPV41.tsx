import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV41({ data }: { data: PlansetData }) {
  const isMetalRoof = data.roofType?.toLowerCase().includes('metal')
  const attachmentModel = data.racking.attachmentModel

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        {/* ── ATTACHMENT DETAIL (top half) ── */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '10px' }}>
          {/* Main cross-section */}
          <div style={{ flex: 2 }}>
            <svg viewBox="0 0 600 320" style={{ width: '100%', height: '320px' }}>
              {/* Roof structure */}
              <line x1="50" y1="200" x2="550" y2="200" stroke="#444" strokeWidth="3" />
              <text x="300" y="218" textAnchor="middle" fontSize="9" fill="#666" fontWeight="bold">
                {isMetalRoof ? 'METAL ROOF' : 'COMP SHINGLE / DECKING'}
              </text>

              {/* Framing members */}
              <rect x="140" y="200" width="30" height="80" fill="none" stroke="#555" strokeWidth="1.5" />
              <rect x="350" y="200" width="30" height="80" fill="none" stroke="#555" strokeWidth="1.5" />
              <text x="155" y="250" textAnchor="middle" fontSize="7" fill="#666" transform="rotate(-90 155 250)">RAFTER/TRUSS</text>
              <text x="365" y="250" textAnchor="middle" fontSize="7" fill="#666" transform="rotate(-90 365 250)">RAFTER/TRUSS</text>

              {/* Spacing dimension */}
              <line x1="155" y1="290" x2="365" y2="290" stroke="#333" strokeWidth="0.5" />
              <line x1="155" y1="285" x2="155" y2="295" stroke="#333" strokeWidth="0.5" />
              <line x1="365" y1="285" x2="365" y2="295" stroke="#333" strokeWidth="0.5" />
              <text x="260" y="287" textAnchor="middle" fontSize="8" fill="#333" fontWeight="bold">
                {data.rafterSize?.includes('24') ? '24" O.C.' : '16" O.C.'}
              </text>
              <text x="260" y="300" textAnchor="middle" fontSize="7" fill="#333" fontStyle="italic">
                2&quot; X 2&quot; FRAMING @ MAX {data.rafterSize?.includes('24') ? '24"' : '16"'} O.C. SPACING
              </text>

              {/* Flashing / attachment base */}
              {isMetalRoof ? (
                <>
                  {/* CorruSlide mount */}
                  <rect x="145" y="178" width="40" height="22" rx="2" fill="#bbb" stroke="#555" strokeWidth="1.5" />
                  <text x="165" y="193" textAnchor="middle" fontSize="6" fill="#333">CORRUSLIDE</text>
                  <rect x="345" y="178" width="40" height="22" rx="2" fill="#bbb" stroke="#555" strokeWidth="1.5" />
                  <text x="365" y="193" textAnchor="middle" fontSize="6" fill="#333">CORRUSLIDE</text>
                </>
              ) : (
                <>
                  {/* Flashing + L-foot */}
                  <path d="M130,200 L130,185 L180,185 L180,200" fill="#ddd" stroke="#555" strokeWidth="1.5" />
                  <text x="155" y="195" textAnchor="middle" fontSize="6" fill="#333">FLASHING</text>
                  <path d="M340,200 L340,185 L390,185 L390,200" fill="#ddd" stroke="#555" strokeWidth="1.5" />
                  <text x="365" y="195" textAnchor="middle" fontSize="6" fill="#333">FLASHING</text>
                </>
              )}

              {/* L-feet */}
              <rect x="150" y="165" width="12" height="20" fill="#999" stroke="#333" strokeWidth="1" />
              <rect x="355" y="165" width="12" height="20" fill="#999" stroke="#333" strokeWidth="1" />

              {/* Lag bolts */}
              <line x1="156" y1="185" x2="156" y2="240" stroke="#333" strokeWidth="1.5" strokeDasharray="3,2" />
              <line x1="361" y1="185" x2="361" y2="240" stroke="#333" strokeWidth="1.5" strokeDasharray="3,2" />
              <text x="175" y="230" fontSize="6" fill="#666">LAG BOLT</text>
              <text x="175" y="238" fontSize="6" fill="#666">INTO RAFTER</text>

              {/* Rails */}
              <rect x="100" y="155" width="330" height="12" rx="1" fill="#aaa" stroke="#333" strokeWidth="1.5" />
              <text x="265" y="164" textAnchor="middle" fontSize="7" fill="#222" fontWeight="bold">
                {data.rackingModel.toUpperCase()} RAIL
              </text>

              {/* Module clamp detail */}
              <rect x="148" y="145" width="14" height="12" fill="#777" stroke="#333" strokeWidth="1" />
              <rect x="353" y="145" width="14" height="12" fill="#777" stroke="#333" strokeWidth="1" />

              {/* PV Modules */}
              <rect x="100" y="120" width="140" height="28" rx="1" fill="#2563eb" fillOpacity="0.15" stroke="#2563eb" strokeWidth="1.5" />
              <text x="170" y="138" textAnchor="middle" fontSize="8" fill="#2563eb" fontWeight="bold">PV MODULE</text>
              <rect x="260" y="120" width="170" height="28" rx="1" fill="#2563eb" fillOpacity="0.15" stroke="#2563eb" strokeWidth="1.5" />
              <text x="345" y="138" textAnchor="middle" fontSize="8" fill="#2563eb" fontWeight="bold">PV MODULE</text>

              {/* 6" MAX gap callout */}
              <line x1="240" y1="105" x2="260" y2="105" stroke="#cc0000" strokeWidth="1" />
              <line x1="240" y1="100" x2="240" y2="110" stroke="#cc0000" strokeWidth="1" />
              <line x1="260" y1="100" x2="260" y2="110" stroke="#cc0000" strokeWidth="1" />
              <text x="250" y="100" textAnchor="middle" fontSize="8" fill="#cc0000" fontWeight="bold">6&quot; MAX</text>

              {/* Leader lines */}
              <line x1="450" y1="135" x2="510" y2="110" stroke="#333" strokeWidth="0.5" />
              <text x="512" y="108" fontSize="7" fill="#333">{isMetalRoof ? 'CF UNIV L-FOOT' : `${attachmentModel}`}</text>
              <text x="512" y="117" fontSize="7" fill="#333">{isMetalRoof ? 'CORRUSLIDE MOUNT AL' : 'ROOF ATTACHMENT'}</text>

              <line x1="430" y1="163" x2="510" y2="140" stroke="#333" strokeWidth="0.5" />
              <text x="512" y="138" fontSize="7" fill="#333">{data.rackingModel.toUpperCase()}</text>
              <text x="512" y="147" fontSize="7" fill="#333">RAIL EXTRUSION</text>

              <line x1="430" y1="200" x2="510" y2="170" stroke="#333" strokeWidth="0.5" />
              <text x="512" y="168" fontSize="7" fill="#333">{isMetalRoof ? 'METAL ROOF' : 'COMP SHINGLE'}</text>

              <line x1="180" y1="280" x2="510" y2="195" stroke="#333" strokeWidth="0.5" />
              <text x="512" y="193" fontSize="7" fill="#333">PURLINS</text>
              <text x="512" y="202" fontSize="7" fill="#333">DECKING</text>
              <text x="512" y="211" fontSize="7" fill="#333">{data.rafterSize} FRAMING</text>
            </svg>
            <div style={{ textAlign: 'center', marginTop: '-5px' }}>
              <div style={{ display: 'inline-block', border: '2px solid #333', borderRadius: '50%', width: '18px', height: '18px', lineHeight: '18px', textAlign: 'center', fontSize: '10pt', fontWeight: 'bold', marginRight: '6px' }}>1</div>
              <span style={{ fontSize: '10pt', fontWeight: 'bold' }}>ATTACHMENT DETAIL</span>
              <div style={{ fontSize: '7pt', color: '#666' }}>SCALE: NTS</div>
            </div>
          </div>

          {/* Detail-A close-up */}
          <div style={{ flex: 1 }}>
            <svg viewBox="0 0 280 320" style={{ width: '100%', height: '320px' }}>
              {/* Zoomed cross-section circle */}
              <circle cx="140" cy="160" r="120" fill="none" stroke="#333" strokeWidth="1.5" />
              <text x="140" y="30" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#111">DETAIL - A</text>
              <text x="140" y="42" textAnchor="middle" fontSize="7" fill="#666">SCALE: NTS</text>

              {/* Roof surface */}
              <line x1="40" y1="200" x2="240" y2="200" stroke="#555" strokeWidth="2" />

              {/* Decking */}
              <rect x="40" y="200" width="200" height="15" fill="#f0e0c0" stroke="#555" strokeWidth="0.5" />
              <text x="140" y="210" textAnchor="middle" fontSize="6" fill="#555">DECKING</text>

              {/* Purlin / framing */}
              <rect x="120" y="215" width="40" height="50" fill="none" stroke="#555" strokeWidth="1" />
              <text x="140" y="245" textAnchor="middle" fontSize="6" fill="#555">{data.rafterSize}</text>

              {isMetalRoof ? (
                <>
                  {/* Metal roof profile */}
                  <path d="M40,195 Q60,185 80,195 Q100,185 120,195 Q140,185 160,195 Q180,185 200,195 Q220,185 240,195" fill="none" stroke="#888" strokeWidth="1.5" />
                  {/* CorruSlide */}
                  <rect x="115" y="175" width="50" height="20" rx="3" fill="#ccc" stroke="#555" strokeWidth="1.5" />
                  <text x="140" y="189" textAnchor="middle" fontSize="6" fill="#333" fontWeight="bold">CORRUSLIDE</text>
                  <text x="140" y="171" textAnchor="middle" fontSize="5" fill="#666">MOUNT AL</text>
                </>
              ) : (
                <>
                  {/* Flashing */}
                  <path d="M100,200 L100,180 Q105,175 110,180 L110,175 L170,175 L170,180 Q175,175 180,180 L180,200" fill="#ddd" stroke="#555" strokeWidth="1" />
                  <text x="140" y="192" textAnchor="middle" fontSize="6" fill="#333">FLASHING</text>
                </>
              )}

              {/* L-foot */}
              <rect x="133" y="155" width="14" height="25" fill="#999" stroke="#333" strokeWidth="1" />
              <text x="80" y="168" fontSize="6" fill="#333">CF UNIV L-FOOT</text>
              <line x1="106" y1="168" x2="133" y2="168" stroke="#333" strokeWidth="0.5" />

              {/* Rail */}
              <rect x="90" y="143" width="100" height="14" rx="1" fill="#aaa" stroke="#333" strokeWidth="1.5" />
              <text x="60" y="142" fontSize="6" fill="#333">CF RAIL AL MLL CF</text>
              <line x1="87" y1="142" x2="90" y2="150" stroke="#333" strokeWidth="0.5" />

              {/* Module */}
              <rect x="90" y="120" width="100" height="24" fill="#2563eb" fillOpacity="0.15" stroke="#2563eb" strokeWidth="1.5" />
              <text x="140" y="136" textAnchor="middle" fontSize="7" fill="#2563eb" fontWeight="bold">PV MODULE</text>

              {/* End clamp */}
              <rect x="85" y="130" width="8" height="14" fill="#777" stroke="#333" strokeWidth="1" />
              <text x="55" y="125" fontSize="6" fill="#333">END CLAMP</text>
              <text x="55" y="133" fontSize="6" fill="#333">ASSEMBLY</text>
              <line x1="73" y1="130" x2="85" y2="137" stroke="#333" strokeWidth="0.5" />
            </svg>
          </div>
        </div>

        {/* ── RAIL DETAIL (bottom half) ── */}
        <div style={{ display: 'flex', gap: '20px' }}>
          {/* Rail extrusion profile */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <svg viewBox="0 0 300 140" style={{ width: '100%', height: '140px' }}>
              {/* Rail extrusion cross-section */}
              <path d="M80,30 L220,30 L220,45 L210,45 L210,55 L220,55 L220,90 L200,90 L200,80 L180,80 L180,90 L120,90 L120,80 L100,80 L100,90 L80,90 L80,55 L90,55 L90,45 L80,45 Z"
                fill="#ccc" stroke="#333" strokeWidth="1.5" />
              <text x="150" y="70" textAnchor="middle" fontSize="8" fill="#333" fontWeight="bold">{data.rackingModel.toUpperCase()}</text>
              <text x="150" y="82" textAnchor="middle" fontSize="7" fill="#666">RAIL EXTRUSION PROFILE</text>
              {/* Slot detail */}
              <rect x="130" y="38" width="40" height="12" fill="#fff" stroke="#555" strokeWidth="0.5" />
              <text x="150" y="47" textAnchor="middle" fontSize="5" fill="#555">BOLT SLOT</text>
            </svg>
            <div style={{ fontSize: '7pt', color: '#666' }}>CF RAIL MILL AL</div>
            <div style={{ fontSize: '7pt', color: '#666' }}>RAIL EXTRUSION PROFILE</div>
          </div>

          {/* Rail coupler assembly */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <svg viewBox="0 0 300 140" style={{ width: '100%', height: '140px' }}>
              {/* Two rail sections with coupler */}
              <rect x="30" y="50" width="100" height="14" rx="1" fill="#aaa" stroke="#333" strokeWidth="1.5" />
              <rect x="170" y="50" width="100" height="14" rx="1" fill="#aaa" stroke="#333" strokeWidth="1.5" />
              {/* Coupler plate */}
              <rect x="115" y="42" width="70" height="30" rx="2" fill="#888" stroke="#333" strokeWidth="2" />
              <text x="150" y="62" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="bold">RAIL COUPLER</text>
              {/* Bolts */}
              <circle cx="130" cy="57" r="4" fill="#555" stroke="#333" strokeWidth="1" />
              <circle cx="170" cy="57" r="4" fill="#555" stroke="#333" strokeWidth="1" />
              {/* Labels */}
              <text x="80" y="45" textAnchor="middle" fontSize="7" fill="#333">CF RAIL MILL ALL</text>
              <text x="220" y="45" textAnchor="middle" fontSize="7" fill="#333">CF RAIL MILL ALL</text>
            </svg>
            <div style={{ display: 'inline-block', border: '2px solid #333', borderRadius: '50%', width: '16px', height: '16px', lineHeight: '16px', textAlign: 'center', fontSize: '9pt', fontWeight: 'bold', marginRight: '4px' }}>2</div>
            <span style={{ fontSize: '9pt', fontWeight: 'bold' }}>RAILING DETAIL</span>
            <div style={{ fontSize: '7pt', color: '#666' }}>SCALE: NTS</div>
          </div>

          {/* Rail coupler assemblies close-up */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <svg viewBox="0 0 300 140" style={{ width: '100%', height: '140px' }}>
              {/* Coupler piece isometric */}
              <rect x="70" y="40" width="160" height="25" rx="3" fill="#999" stroke="#333" strokeWidth="1.5" />
              <rect x="90" y="50" width="15" height="25" rx="1" fill="#777" stroke="#333" strokeWidth="1" />
              <rect x="195" y="50" width="15" height="25" rx="1" fill="#777" stroke="#333" strokeWidth="1" />
              <text x="150" y="56" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="bold">RAIL COUPLER</text>
              {/* Dimensions */}
              <text x="150" y="100" textAnchor="middle" fontSize="8" fill="#333" fontWeight="bold">RAIL COUPLER ASSEMBLIES</text>
              <text x="150" y="112" textAnchor="middle" fontSize="7" fill="#666">{data.racking.railSpliceCount} REQUIRED</text>
            </svg>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginTop: '6px', borderTop: '1px solid #ddd', paddingTop: '4px', fontSize: '7pt', color: '#444' }}>
          <strong>NOTE:</strong> MAXIMUM ATTACHMENT SPACING IS 45&quot;. ALL ATTACHMENTS SHALL BE INTO STRUCTURAL MEMBERS (RAFTERS/TRUSSES).
          MODULE FRAME GROUNDING VIA EQUIPMENT GROUNDING CONDUCTOR AND GROUNDING LUGS PER NEC 690.43.
        </div>
      </div>
      <TitleBlockHtml sheetName="ATTACHMENT DETAIL" sheetNumber="PV-4.1" data={data} />
    </div>
  )
}
