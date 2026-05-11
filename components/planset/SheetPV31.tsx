import { memo } from 'react'
import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

interface SheetPV31Props {
  data: PlansetData
  equipmentPhotos?: (string | null)[]
}

function SheetPV31Inner({ data }: SheetPV31Props) {
  // equipmentPhotos param accepted for backward-compat with legacy callers; unused
  // by the drafted elevation (which renders symbolically, not photographically).
  const eq = [
    { id: 'LC',  label: '(N) PV LOAD CENTER',        model: 'EATON BRP12L125R',     w: 14, h: 22, hAGL: 60 },
    { id: 'PV',  label: '(N) PV DISCONNECT',         model: 'EATON DG222URB',       w: 12, h: 18, hAGL: 60 },
    { id: 'CGD', label: '(N) CUSTOMER GEN DISC',     model: 'EATON DG222NRB',       w: 12, h: 18, hAGL: 60 },
    { id: 'PLP', label: '(N) PROTECTED LOAD PANEL',  model: 'EATON BRP20B125R',     w: 14, h: 24, hAGL: 60 },
    { id: 'MSP', label: '(E) MAIN SERVICE PANEL',    model: '225A BUSBAR · 125A MAIN', w: 16, h: 28, hAGL: 60 },
    { id: 'UM',  label: '(E) UTILITY METER',         model: data.meter || '#66 317 844', w: 10, h: 14, hAGL: 60 },
  ]

  function Elevation() {
    return (
      <svg viewBox="0 0 1400 700" style={{ width: '100%', height: '100%' }}>
        <line x1={40} y1={620} x2={1360} y2={620} stroke="#000" strokeWidth={2.4} />
        {Array.from({ length: 80 }).map((_, i) => (
          <line key={i} x1={50 + i * 16} y1={620} x2={42 + i * 16} y2={636} stroke="#000" strokeWidth={0.5} />
        ))}
        <text x={1360} y={650} textAnchor="end" fontSize={9} fontWeight={700}>FINISHED GRADE</text>

        {(() => {
          const isTwo = data.stories === 2
          const wallTop = isTwo ? 180 : 280
          const roofPeak = isTwo ? 100 : 200
          return (
            <g>
              <line x1={150} y1={wallTop} x2={150} y2={620} stroke="#000" strokeWidth={2.2} />
              <line x1={1250} y1={wallTop} x2={1250} y2={620} stroke="#000" strokeWidth={2.2} />
              <line x1={150} y1={wallTop} x2={1250} y2={wallTop} stroke="#000" strokeWidth={2.2} />
              <line x1={150} y1={wallTop} x2={700} y2={roofPeak} stroke="#000" strokeWidth={2.2} />
              <line x1={1250} y1={wallTop} x2={700} y2={roofPeak} stroke="#000" strokeWidth={2.2} />
              {Array.from({ length: 10 }).map((_, i) => (
                <line key={i} x1={200 + i * 110} y1={wallTop - 6} x2={210 + i * 110} y2={wallTop + 2} stroke="#000" strokeWidth={0.4} />
              ))}
              <text x={700} y={wallTop - 12} textAnchor="middle" fontSize={8} fontWeight={700}>{isTwo ? 'TWO-STORY ELEVATION' : 'ONE-STORY ELEVATION'}</text>
            </g>
          )
        })()}

        <line x1={300} y1={620} x2={300} y2={400} stroke="#000" strokeWidth={2.6} />
        <text x={306} y={394} fontSize={7} fontWeight={700}>EQUIPMENT WALL</text>

        {(() => {
          const scale = 4
          const groundY = 620
          let xCursor = 320
          return eq.map((e, idx) => {
            const w = e.w * scale, h = e.h * scale
            const x = xCursor
            const yTop = groundY - e.hAGL * scale - h
            xCursor += w + 24
            return (
              <g key={e.id}>
                <rect x={x} y={yTop} width={w} height={h} fill="#fff" stroke="#000" strokeWidth={1.4} />
                <text x={x + w / 2} y={yTop + h / 2 - 2} textAnchor="middle" fontSize={8} fontWeight={700}>{e.id}</text>
                <text x={x + w / 2} y={yTop + h / 2 + 8} textAnchor="middle" fontSize={6}>{e.w}&quot;×{e.h}&quot;</text>
                <line x1={x - 8} y1={yTop + h} x2={x - 8} y2={groundY} stroke="#000" strokeWidth={0.5} />
                <line x1={x - 12} y1={yTop + h} x2={x - 4} y2={yTop + h} stroke="#000" strokeWidth={0.5} />
                <line x1={x - 12} y1={groundY} x2={x - 4} y2={groundY} stroke="#000" strokeWidth={0.5} />
                <text x={x - 12} y={(yTop + h + groundY) / 2} fontSize={6} textAnchor="end">{e.hAGL}&quot;</text>
                <text x={x + w / 2} y={groundY + 18 + (idx % 2) * 12} textAnchor="middle" fontSize={6.5} fontWeight={700}>{e.label}</text>
                <text x={x + w / 2} y={groundY + 26 + (idx % 2) * 12} textAnchor="middle" fontSize={5.5} fill="#444">{e.model}</text>
              </g>
            )
          })
        })()}

        <rect x={1080} y={580} width={70} height={40} fill="none" stroke="#000" strokeWidth={1} strokeDasharray="3 2" />
        <text x={1115} y={604} textAnchor="middle" fontSize={6.5}>(E) AC UNIT</text>

        <line x1={40} y1={620} x2={40} y2={560} stroke="#000" strokeWidth={1} />
        <line x1={40} y1={560} x2={130} y2={560} stroke="#000" strokeWidth={0.7} strokeDasharray="3 2" />
        <text x={86} y={552} textAnchor="middle" fontSize={6}>(E) FENCE</text>

        <text x={700} y={672} textAnchor="middle" fontSize={7}>EQUIPMENT BOTTOM @ 60&quot; AGL TYP · TOP &lt; 79&quot; PER NEC 240.24(A)</text>

        <g transform="translate(80, 56)">
          <circle cx={0} cy={0} r={11} fill="#fff" stroke="#000" strokeWidth={1.5} />
          <text x={0} y={4} textAnchor="middle" fontSize={10} fontWeight={700}>1</text>
        </g>
        <text x={100} y={50} fontSize={10} fontWeight={700}>EQUIPMENT ELEVATION · DETAIL A</text>
        <text x={100} y={62} fontSize={7}>SCALE: 1/2&quot; = 1&apos;-0&quot;</text>
      </svg>
    )
  }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden' }}>
      <div className="sheet-content" style={{ padding: '0.12in 0.18in', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: '11pt', fontWeight: 700, letterSpacing: '0.04em' }}>EQUIPMENT ELEVATION</div>
        <div style={{ fontSize: '7pt', color: '#333' }}>EXTERIOR ELEVATION · DETAIL A REFERENCED FROM PV-3</div>

        <div style={{ flex: 1, border: '1px solid #000', overflow: 'hidden' }}><Elevation /></div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt', border: '1px solid #000' }}>
          <thead><tr style={{ background: '#000' }}>
            <th style={{ color: '#fff', padding: '2px 4px', textAlign: 'left' }}>TAG</th>
            <th style={{ color: '#fff', padding: '2px 4px', textAlign: 'left' }}>EQUIPMENT</th>
            <th style={{ color: '#fff', padding: '2px 4px', textAlign: 'left' }}>MODEL</th>
            <th style={{ color: '#fff', padding: '2px 4px', textAlign: 'center' }}>W × H</th>
            <th style={{ color: '#fff', padding: '2px 4px', textAlign: 'center' }}>BOTTOM AGL</th>
            <th style={{ color: '#fff', padding: '2px 4px', textAlign: 'left' }}>NOTES</th>
          </tr></thead>
          <tbody>
            {eq.map((e, i) => (
              <tr key={e.id} style={{ background: i % 2 ? '#f5f5f5' : '#fff' }}>
                <td style={{ padding: '2px 4px', fontWeight: 700, borderRight: '1px solid #ccc' }}>{e.id}</td>
                <td style={{ padding: '2px 4px', borderRight: '1px solid #ccc' }}>{e.label}</td>
                <td style={{ padding: '2px 4px', borderRight: '1px solid #ccc' }}>{e.model}</td>
                <td style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ccc' }}>{e.w}&quot;×{e.h}&quot;</td>
                <td style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid #ccc' }}>{e.hAGL}&quot;</td>
                <td style={{ padding: '2px 4px', fontSize: '5.5pt' }}>NEMA 3R · WORKING SPACE PER NEC 110.26</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: '6pt', color: '#555' }}>
          ALL EQUIPMENT WORKING CLEARANCE 36&quot; MIN PER NEC 110.26(A)(1) · DISCONNECT HANDLES READILY ACCESSIBLE · ALL EQUIPMENT NEMA 3R OR BETTER · LABELS PER PV-5.1
        </div>
      </div>
      <TitleBlockHtml sheetName="EQUIPMENT ELEVATION" sheetNumber="PV-3.1" data={data} />
    </div>
  )
}

export const SheetPV31 = memo(SheetPV31Inner)
