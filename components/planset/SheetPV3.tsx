import { memo } from 'react'
import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'
import { RoofPlaneSvg } from './RoofPlaneSvg'

function SheetPV3Inner({ data }: { data: PlansetData }) {
  const propertyDims = data.propertyLines || [
    { side: 'N', dim: "125'-7\"" },
    { side: 'E', dim: "82'-3\"" },
    { side: 'S', dim: "125'-7\"" },
    { side: 'W', dim: "82'-3\"" },
  ]

  function SiteSurvey() {
    return (
      <svg viewBox="0 0 700 560" style={{ width: '100%', height: '100%' }}>
        <g transform="translate(620, 30)">
          <line x1={0} y1={20} x2={0} y2={-20} stroke="#000" strokeWidth={1.5} />
          <polygon points="0,-20 -5,-6 5,-6" fill="#000" />
          <text x={0} y={-24} textAnchor="middle" fontSize={9} fontWeight={700}>N</text>
          <circle cx={0} cy={0} r={24} fill="none" stroke="#000" strokeWidth={0.5} />
        </g>
        <g transform="translate(50, 520)">
          <line x1={0} y1={0} x2={120} y2={0} stroke="#000" strokeWidth={1.5} />
          <line x1={0} y1={-4} x2={0} y2={4} stroke="#000" strokeWidth={1} />
          <line x1={60} y1={-3} x2={60} y2={3} stroke="#000" strokeWidth={1} />
          <line x1={120} y1={-4} x2={120} y2={4} stroke="#000" strokeWidth={1} />
          <text x={0} y={16} fontSize={7}>0</text>
          <text x={60} y={16} fontSize={7} textAnchor="middle">10</text>
          <text x={120} y={16} fontSize={7} textAnchor="middle">20&apos;</text>
          <text x={60} y={-8} fontSize={7} textAnchor="middle" fontWeight={700}>SCALE: 1&quot; = 20&apos;</text>
        </g>

        <rect x={70} y={70} width={520} height={420} fill="none" stroke="#000" strokeWidth={2.2} />
        <text x={330} y={62} textAnchor="middle" fontSize={7} fontWeight={700}>PROPERTY LINE — {propertyDims[0]?.dim || "125'-7\""}</text>
        <text x={604} y={282} fontSize={7} fontWeight={700} transform="rotate(90 604 282)">PROPERTY LINE — {propertyDims[1]?.dim || "82'-3\""}</text>
        <text x={330} y={506} textAnchor="middle" fontSize={7} fontWeight={700}>PROPERTY LINE — {propertyDims[2]?.dim || "125'-7\""}</text>
        <text x={66} y={282} fontSize={7} fontWeight={700} transform="rotate(-90 66 282)">PROPERTY LINE — {propertyDims[3]?.dim || "82'-3\""}</text>

        <rect x={90} y={90} width={480} height={380} fill="none" stroke="#000" strokeWidth={0.5} strokeDasharray="4 3" />
        <text x={95} y={102} fontSize={6}>10&apos; SETBACK</text>

        <rect x={170} y={170} width={300} height={220} fill="none" stroke="#000" strokeWidth={1.8} />
        <text x={320} y={195} textAnchor="middle" fontSize={9} fontWeight={700}>{data.stories === 1 ? 'ONE-STORY' : 'TWO-STORY'} RESIDENCE</text>
        <text x={320} y={206} textAnchor="middle" fontSize={7}>{data.address?.split(',')[0] || 'PRIMARY DWELLING'}</text>

        <line x1={170} y1={280} x2={470} y2={280} stroke="#000" strokeWidth={0.8} strokeDasharray="6 3" />
        <text x={476} y={282} fontSize={6}>RIDGE</text>

        <rect x={300} y={390} width={170} height={70} fill="none" stroke="#000" strokeWidth={1.8} />
        <text x={385} y={428} textAnchor="middle" fontSize={8} fontWeight={700}>(E) DETACHED GARAGE</text>
        <text x={385} y={440} textAnchor="middle" fontSize={6}>BATTERY LOCATION — SEE PV-3.2</text>

        <rect x={420} y={460} width={70} height={30} fill="none" stroke="#000" strokeWidth={0.6} strokeDasharray="3 2" />
        <text x={455} y={478} textAnchor="middle" fontSize={6}>DRIVEWAY</text>

        <line x1={170} y1={300} x2={170} y2={360} stroke="#000" strokeWidth={3} />
        <text x={140} y={332} fontSize={7} fontWeight={700} textAnchor="end">EQUIPMENT</text>
        <text x={140} y={342} fontSize={7} fontWeight={700} textAnchor="end">WALL</text>
        <g transform="translate(150, 330)">
          <circle cx={0} cy={0} r={10} fill="#fff" stroke="#22d3ee" strokeWidth={1.5} />
          <text x={0} y={4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#0e7490">A</text>
        </g>

        <rect x={310} y={400} width={50} height={30} fill="#000" />
        <g transform="translate(295, 415)">
          <circle cx={0} cy={0} r={10} fill="#fff" stroke="#22d3ee" strokeWidth={1.5} />
          <text x={0} y={4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#0e7490">B</text>
        </g>

        <path d="M 170 330 Q 230 360 310 415" fill="none" stroke="#000" strokeWidth={0.7} strokeDasharray="4 2" />
        <text x={245} y={395} fontSize={6}>(N) UNDERGROUND CONDUIT — SEE PV-6</text>

        <text x={330} y={540} textAnchor="middle" fontSize={9} fontWeight={700}>
          {(data.address?.split(',')[0] || 'STREET').toUpperCase()}
        </text>

        <g transform="translate(40, 50)">
          <circle cx={0} cy={0} r={11} fill="#fff" stroke="#000" strokeWidth={1.5} />
          <text x={0} y={4} textAnchor="middle" fontSize={10} fontWeight={700}>1</text>
        </g>
        <text x={58} y={48} fontSize={9} fontWeight={700}>SITE PLAN</text>
        <text x={58} y={58} fontSize={6}>SCALE: 1&quot; = 20&apos;</text>
      </svg>
    )
  }

  function RoofPlan() {
    return (
      <div style={{ flex: 1, border: '1px solid #000', position: 'relative', overflow: 'hidden' }}>
        {data.sitePlanImageUrl ? (
          <img src={data.sitePlanImageUrl} alt="Site Plan" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : data.roofFaces.some(f => f.polygon && f.polygon.length >= 3) ? (
          <RoofPlaneSvg faces={data.roofFaces} strings={data.strings} width={900} height={580} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: '8pt' }}>
            ROOF POLYGON DATA PENDING — TODO(data): roofFaces[].polygon
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 6, left: 8, fontSize: '7pt', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, border: '1.5px solid #000', borderRadius: '50%', fontWeight: 700 }}>2</span>
          <span style={{ fontWeight: 700 }}>ROOF PLAN WITH MODULES</span>
          <span style={{ color: '#666' }}>SCALE: 1/8&quot; = 1&apos;-0&quot;</span>
        </div>
      </div>
    )
  }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden' }}>
      <div className="sheet-content" style={{ padding: '0.12in 0.18in', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        <div style={{ fontSize: '11pt', fontWeight: 700, letterSpacing: '0.04em' }}>SITE PLAN · ROOF PLAN</div>
        <div style={{ fontSize: '7pt', color: '#333' }}>
          {[data.address, data.city, `${data.state}${data.zip ? ' ' + data.zip : ''}`].filter(Boolean).join(', ')}
          {' · '}{data.panelCount} × {data.panelModel} · {data.systemDcKw.toFixed(2)} kW DC / {data.systemAcKw} kW AC
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minHeight: 0 }}>
          <div style={{ border: '1px solid #000', overflow: 'hidden' }}><SiteSurvey /></div>
          <RoofPlan />
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6pt', border: '1px solid #000' }}>
          <thead>
            <tr style={{ background: '#000' }}>
              <th style={{ color: '#fff', padding: '2px 4px', textAlign: 'left' }}>DETAILS</th>
              {data.roofFaces.map(rf => <th key={rf.id} style={{ color: '#fff', padding: '2px 4px' }}>ROOF #{rf.id}</th>)}
              <th style={{ color: '#fff', padding: '2px 4px' }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '2px 4px', fontWeight: 700, borderRight: '1px solid #ccc' }}>MODULES</td>
              {data.roofFaces.map(rf => <td key={rf.id} style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ccc' }}>{rf.modules}</td>)}
              <td style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 700 }}>{data.panelCount}</td>
            </tr>
            <tr style={{ background: '#f5f5f5' }}>
              <td style={{ padding: '2px 4px', fontWeight: 700, borderRight: '1px solid #ccc' }}>TILT</td>
              {data.roofFaces.map(rf => <td key={rf.id} style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ccc' }}>{rf.tilt}°</td>)}
              <td style={{ padding: '2px 4px', textAlign: 'center' }}>—</td>
            </tr>
            <tr>
              <td style={{ padding: '2px 4px', fontWeight: 700, borderRight: '1px solid #ccc' }}>AZIMUTH</td>
              {data.roofFaces.map(rf => <td key={rf.id} style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ccc' }}>{rf.azimuth}°</td>)}
              <td style={{ padding: '2px 4px', textAlign: 'center' }}>—</td>
            </tr>
            <tr style={{ background: '#f5f5f5' }}>
              <td style={{ padding: '2px 4px', fontWeight: 700, borderRight: '1px solid #ccc' }}>RACKING</td>
              <td colSpan={data.roofFaces.length + 1} style={{ padding: '2px 4px' }}>{data.rackingModel} · ATTACHMENT {data.racking?.attachmentModel || 'QUICKMOUNT QBASE'} · MAX SPACING 45&quot;</td>
            </tr>
          </tbody>
        </table>

        <div style={{ fontSize: '6pt', color: '#555' }}>
          FIRE SETBACKS PER IFC 2018: RIDGE 36&quot; · EAVE 18&quot; · RAKE 18&quot; (SEE PV-2A). DETAIL A = EQUIPMENT WALL (PV-3.1) · DETAIL B = BATTERY LOCATION (PV-3.2).
        </div>
      </div>
      <TitleBlockHtml sheetName="SITE PLAN · ROOF PLAN" sheetNumber="PV-3" data={data} />
    </div>
  )
}

export const SheetPV3 = memo(SheetPV3Inner)
