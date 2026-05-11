import { memo } from 'react'
import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

// Duracell hybrid: 2 stacks side-by-side · 3' separation · 3' bollard offsets
// TODO(data): garage interior dims from data.garage.{width,depth} when plumbed
function SheetPV32Inner({ data }: { data: PlansetData }) {
  const garageW = 24
  const garageD = 22
  const dpcW = 2.5, dpcD = 1.8
  const dpcGap = 3
  const bollardOffset = 3

  function TopView() {
    const sc = 14
    const W = garageW * sc, D = garageD * sc
    const ox = 30, oy = 30
    const dpc1X = ox + W / 2 - dpcW * sc - (dpcGap * sc) / 2
    const dpc2X = ox + W / 2 + (dpcGap * sc) / 2
    const dpcY = oy + 30
    return (
      <svg viewBox={`0 0 ${W + 60} ${D + 80}`} style={{ width: '100%', height: '100%' }}>
        <text x={(W + 60) / 2} y={18} textAnchor="middle" fontSize={9} fontWeight={700}>TOP / PLAN VIEW</text>
        <rect x={ox} y={oy} width={W} height={D} fill="none" stroke="#000" strokeWidth={2.2} />
        <line x1={ox + 30} y1={oy + D} x2={ox + W - 30} y2={oy + D} stroke="#000" strokeWidth={3.5} />
        <text x={ox + W / 2} y={oy + D + 14} textAnchor="middle" fontSize={6}>GARAGE DOOR (16&apos; WIDE)</text>
        <rect x={dpc1X} y={dpcY} width={dpcW * sc} height={dpcD * sc} fill="#000" />
        <text x={dpc1X + dpcW * sc / 2} y={dpcY - 4} textAnchor="middle" fontSize={6} fontWeight={700}>DPC #1</text>
        <rect x={dpc2X} y={dpcY} width={dpcW * sc} height={dpcD * sc} fill="#000" />
        <text x={dpc2X + dpcW * sc / 2} y={dpcY - 4} textAnchor="middle" fontSize={6} fontWeight={700}>DPC #2</text>
        {[dpc1X - bollardOffset * sc / 2, dpc2X + dpcW * sc + bollardOffset * sc / 2].map((x, i) => (
          <g key={i}>
            <circle cx={x} cy={dpcY + dpcD * sc + bollardOffset * sc / 2} r={6} fill="#fff" stroke="#000" strokeWidth={1.4} />
            <text x={x} y={dpcY + dpcD * sc + bollardOffset * sc / 2 + 2} textAnchor="middle" fontSize={5} fontWeight={700}>B</text>
          </g>
        ))}
        <circle cx={ox + W - 30} cy={oy + 30} r={8} fill="none" stroke="#000" strokeWidth={1.2} />
        <text x={ox + W - 30} y={oy + 33} textAnchor="middle" fontSize={5}>SD</text>
        <text x={ox + W - 30} y={oy + 50} textAnchor="middle" fontSize={5}>SMOKE</text>
        <circle cx={ox + 30} cy={oy + 30} r={8} fill="#000" />
        <text x={ox + 30} y={oy + 33} textAnchor="middle" fontSize={5} fill="#fff" fontWeight={700}>H</text>
        <text x={ox + 30} y={oy + 50} textAnchor="middle" fontSize={5}>HEAT</text>
        <line x1={ox} y1={oy - 10} x2={ox + W} y2={oy - 10} stroke="#000" strokeWidth={0.5} />
        <text x={ox + W / 2} y={oy - 14} textAnchor="middle" fontSize={6} fontWeight={700}>{garageW}&apos;-0&quot;</text>
        <line x1={ox + W + 10} y1={oy} x2={ox + W + 10} y2={oy + D} stroke="#000" strokeWidth={0.5} />
        <text x={ox + W + 14} y={oy + D / 2} fontSize={6} fontWeight={700} transform={`rotate(90 ${ox + W + 14} ${oy + D / 2})`}>{garageD}&apos;-0&quot;</text>
        <text x={(dpc1X + dpc2X + dpcW * sc) / 2} y={dpcY + dpcD * sc / 2 + 2} textAnchor="middle" fontSize={5} fontWeight={700}>3&apos;-0&quot;</text>
      </svg>
    )
  }

  function IsoView() {
    return (
      <svg viewBox="0 0 320 240" style={{ width: '100%', height: '100%' }}>
        <text x={160} y={16} textAnchor="middle" fontSize={9} fontWeight={700}>ISOMETRIC VIEW</text>
        <polygon points="40,200 200,200 240,160 80,160" fill="none" stroke="#000" strokeWidth={1.4} />
        <polygon points="40,200 40,100 80,60 80,160" fill="none" stroke="#000" strokeWidth={1.4} />
        <polygon points="80,160 240,160 240,60 80,60" fill="none" stroke="#000" strokeWidth={1.4} strokeDasharray="2 2" />
        <polygon points="120,170 160,170 168,162 128,162" fill="#000" />
        <polygon points="120,170 120,130 128,122 128,162" fill="#000" />
        <polygon points="160,170 160,130 168,122 168,162" fill="#000" />
        <polygon points="180,170 220,170 228,162 188,162" fill="#000" />
        <polygon points="180,170 180,130 188,122 188,162" fill="#000" />
        <polygon points="220,170 220,130 228,122 228,162" fill="#000" />
        <text x={140} y={194} textAnchor="middle" fontSize={6}>DPC #1</text>
        <text x={200} y={194} textAnchor="middle" fontSize={6}>DPC #2</text>
        <ellipse cx={100} cy={196} rx={4} ry={2} fill="#fff" stroke="#000" />
        <ellipse cx={240} cy={196} rx={4} ry={2} fill="#fff" stroke="#000" />
      </svg>
    )
  }

  function FrontView() {
    return (
      <svg viewBox="0 0 400 220" style={{ width: '100%', height: '100%' }}>
        <text x={200} y={16} textAnchor="middle" fontSize={9} fontWeight={700}>FRONT ELEVATION</text>
        <line x1={20} y1={200} x2={380} y2={200} stroke="#000" strokeWidth={2.4} />
        {Array.from({ length: 30 }).map((_, i) => <line key={i} x1={24 + i * 12} y1={200} x2={20 + i * 12} y2={208} stroke="#000" strokeWidth={0.4} />)}
        <rect x={130} y={70} width={50} height={130} fill="none" stroke="#000" strokeWidth={1.6} />
        <rect x={220} y={70} width={50} height={130} fill="none" stroke="#000" strokeWidth={1.6} />
        <rect x={130} y={70} width={50} height={28} fill="#fff" stroke="#000" strokeWidth={0.8} />
        <rect x={220} y={70} width={50} height={28} fill="#fff" stroke="#000" strokeWidth={0.8} />
        <text x={155} y={86} textAnchor="middle" fontSize={5.5} fontWeight={700}>INV-1</text>
        <text x={245} y={86} textAnchor="middle" fontSize={5.5} fontWeight={700}>INV-2</text>
        {[0, 1, 2, 3].map(i => (
          <g key={i}>
            <rect x={134} y={104 + i * 22} width={42} height={20} fill="none" stroke="#000" strokeWidth={0.5} />
            <rect x={224} y={104 + i * 22} width={42} height={20} fill="none" stroke="#000" strokeWidth={0.5} />
          </g>
        ))}
        <rect x={104} y={158} width={6} height={42} fill="#000" />
        <rect x={290} y={158} width={6} height={42} fill="#000" />
        <text x={107} y={155} textAnchor="middle" fontSize={5}>BOLLARD</text>
        <text x={293} y={155} textAnchor="middle" fontSize={5}>BOLLARD</text>
        <text x={200} y={216} textAnchor="middle" fontSize={6} fontWeight={700}>3&apos;-0&quot; SEPARATION TYP</text>
        <line x1={130} y1={64} x2={180} y2={64} stroke="#000" strokeWidth={0.5} />
        <text x={155} y={60} textAnchor="middle" fontSize={5}>30&quot;</text>
        <line x1={284} y1={70} x2={284} y2={200} stroke="#000" strokeWidth={0.5} />
        <text x={290} y={135} fontSize={5}>72&quot;</text>
      </svg>
    )
  }

  function SideView() {
    return (
      <svg viewBox="0 0 320 220" style={{ width: '100%', height: '100%' }}>
        <text x={160} y={16} textAnchor="middle" fontSize={9} fontWeight={700}>SIDE ELEVATION</text>
        <line x1={20} y1={200} x2={300} y2={200} stroke="#000" strokeWidth={2.4} />
        {Array.from({ length: 25 }).map((_, i) => <line key={i} x1={24 + i * 12} y1={200} x2={20 + i * 12} y2={208} stroke="#000" strokeWidth={0.4} />)}
        <rect x={120} y={70} width={36} height={130} fill="none" stroke="#000" strokeWidth={1.6} />
        <rect x={120} y={70} width={36} height={28} fill="#fff" stroke="#000" strokeWidth={0.8} />
        <text x={138} y={86} textAnchor="middle" fontSize={5.5} fontWeight={700}>INV</text>
        {[0, 1, 2, 3].map(i => <rect key={i} x={124} y={104 + i * 22} width={28} height={20} fill="none" stroke="#000" strokeWidth={0.5} />)}
        <line x1={108} y1={70} x2={108} y2={200} stroke="#000" strokeWidth={1.4} />
        <text x={102} y={140} fontSize={6} textAnchor="end" fontWeight={700}>GARAGE WALL</text>
        <rect x={180} y={170} width={6} height={30} fill="#000" />
        <text x={183} y={166} textAnchor="middle" fontSize={5}>BOLLARD</text>
        <line x1={156} y1={210} x2={186} y2={210} stroke="#000" strokeWidth={0.5} />
        <text x={171} y={218} textAnchor="middle" fontSize={5} fontWeight={700}>36&quot; CLEAR</text>
      </svg>
    )
  }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden' }}>
      <div className="sheet-content" style={{ padding: '0.12in 0.18in', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: '11pt', fontWeight: 700, letterSpacing: '0.04em' }}>GARAGE FLOOR PLAN · BATTERY DETAIL B</div>
        <div style={{ fontSize: '7pt', color: '#333' }}>
          DURACELL POWER CENTER · 2 STACKS · {data.totalStorageKwh || 80} kWh TOTAL · NFPA 855 COMPLIANT
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 6, minHeight: 0 }}>
          <div style={{ border: '1px solid #000', overflow: 'hidden' }}><TopView /></div>
          <div style={{ border: '1px solid #000', overflow: 'hidden' }}><IsoView /></div>
          <div style={{ border: '1px solid #000', overflow: 'hidden' }}><FrontView /></div>
          <div style={{ border: '1px solid #000', overflow: 'hidden' }}><SideView /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ border: '1px solid #000', padding: '4px 6px', fontSize: '6.5pt' }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>BATTERY DIMENSIONS · PER STACK</div>
            <div>WIDTH: 30&quot; · DEPTH: 22&quot; · HEIGHT: 72&quot;</div>
            <div>WEIGHT: 880 LBS FULLY POPULATED</div>
            <div>FLOOR LOADING: 195 PSF (CONCRETE SLAB OK)</div>
            <div>CABINET RATING: NEMA 3R · UL 9540</div>
          </div>
          <div style={{ border: '1px solid #000', padding: '4px 6px', fontSize: '6.5pt' }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>NFPA 855 NOTES</div>
            <div>1. 3&apos;-0&quot; MIN SEPARATION BETWEEN STACKS PER NFPA 855 §1207.1.3</div>
            <div>2. 3&apos;-0&quot; MIN WORKING SPACE FRONT/SIDES</div>
            <div>3. STEEL BOLLARDS (2) PER ESS — 4&quot; Ø SCH 40 CONCRETE-FILLED, 36&quot; AGL</div>
            <div>4. SMOKE + HEAT DETECTORS REQUIRED IN GARAGE PER NFPA 72</div>
            <div>5. MAX AGGREGATE ENERGY 80 kWh — WITHIN RESIDENTIAL LIMIT</div>
          </div>
        </div>
      </div>
      <TitleBlockHtml sheetName="GARAGE FLOOR PLAN" sheetNumber="PV-3.2" data={data} />
    </div>
  )
}

export const SheetPV32GarageFloorPlan = memo(SheetPV32Inner)
