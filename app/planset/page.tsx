'use client'

import { Nav } from '@/components/Nav'

// ── HARDCODED PROJECT DATA (PROJ-29857) ─────────────────────────────────────

const PROJECT = {
  id: 'PROJ-29857',
  owner: 'MIGUEL AGUILERA',
  address: '7822 Brooks Crossing Dr, Baytown TX 77521',
  city: 'Baytown',
  state: 'TX',
  zip: '77521',
  panelModel: 'AMP 410W Domestic',
  panelWattage: 410,
  panelCount: 53,
  panelVoc: 37.4,
  panelVmp: 31.3,
  panelIsc: 14.0,
  panelImp: 13.1,
  systemDcKw: 21.73,
  systemAcKw: 30.0,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterCount: 2,
  inverterAcPower: 15, // kW per inverter
  batteryModel: 'Duracell 5kWh LFP',
  batteryCount: 16,
  batteryCapacity: 5, // kWh each
  totalStorageKwh: 80,
  rackingModel: 'IronRidge XR100',
  roofType: 'COMP SHINGLE',
  rafterSize: '2x8 @ 24 OC',
  stories: 1,
  buildingType: 'Type V-B',
  occupancy: 'R',
  windSpeed: 150,
  riskCategory: 'II',
  exposure: 'B',
  utility: 'CenterPoint Energy',
  meter: '88 353 523',
  esid: '1008901020901254810117',
  contractor: 'MicroGRID Energy',
  contractorAddress: '15200 E Hardy Rd',
  contractorCity: 'Houston, TX 77060',
  contractorPhone: '(888) 485-5551',
  contractorLicense: '32259',
  contractorEmail: 'engineering@microgridenergy.com',
  // Existing system
  existingPanelModel: 'Silfab SIL-370 HC',
  existingPanelWattage: 370,
  existingPanelCount: 20,
  existingInverterModel: 'Enphase IQ7PLUS',
  existingInverterCount: 20,
  // String configurations: 5 strings (3x11, 2x10)
  strings: [
    { id: 1, mppt: 1, modules: 9, roofFace: 1 },
    { id: 2, mppt: 2, modules: 9, roofFace: 1 },
    { id: 3, mppt: 3, modules: 9, roofFace: 1 },
    { id: 4, mppt: 4, modules: 9, roofFace: 2 },
    { id: 5, mppt: 5, modules: 9, roofFace: 2 },
    { id: 6, mppt: 6, modules: 8, roofFace: 3 },
  ],
}

// Computed values
const VOC_COLD = PROJECT.panelVoc * 1.14 // correction for -5C
const STRING_VOCS = PROJECT.strings.map(s => s.modules * VOC_COLD)
const STRING_VMPS = PROJECT.strings.map(s => s.modules * PROJECT.panelVmp)

// ── DATE HELPER ─────────────────────────────────────────────────────────────

function today(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

// ── SHARED SVG COMPONENTS ───────────────────────────────────────────────────

const SHEET_W = 1500
const SHEET_H = 950

function DrawingBorder() {
  return (
    <>
      <rect x="5" y="5" width={SHEET_W - 10} height={SHEET_H - 10} fill="none" stroke="#111" strokeWidth="2" />
      <rect x="9" y="9" width={SHEET_W - 18} height={SHEET_H - 18} fill="none" stroke="#111" strokeWidth="0.5" />
    </>
  )
}

function TitleBlock({ sheetName, sheetNumber }: { sheetName: string; sheetNumber: string }) {
  const bx = SHEET_W - 330 // block X
  const by = SHEET_H - 130 // block Y
  const bw = 310
  const bh = 118
  return (
    <g>
      {/* Outer box */}
      <rect x={bx} y={by} width={bw} height={bh} fill="white" stroke="#111" strokeWidth="1.5" />
      {/* Horizontal dividers */}
      <line x1={bx} y1={by + 30} x2={bx + bw} y2={by + 30} stroke="#111" strokeWidth="0.5" />
      <line x1={bx} y1={by + 55} x2={bx + bw} y2={by + 55} stroke="#111" strokeWidth="0.5" />
      <line x1={bx} y1={by + 80} x2={bx + bw} y2={by + 80} stroke="#111" strokeWidth="0.5" />
      <line x1={bx} y1={by + 98} x2={bx + bw} y2={by + 98} stroke="#111" strokeWidth="0.5" />
      {/* Vertical divider for stamp area */}
      <line x1={bx + 155} y1={by + 55} x2={bx + 155} y2={by + 80} stroke="#111" strokeWidth="0.5" />
      {/* Contractor */}
      <text x={bx + 5} y={by + 12} fontSize="7" fontWeight="bold" fill="#111">{PROJECT.contractor}</text>
      <text x={bx + 5} y={by + 22} fontSize="5.5" fill="#333">{PROJECT.contractorAddress}, {PROJECT.contractorCity}</text>
      <text x={bx + 200} y={by + 12} fontSize="5.5" fill="#333">Ph: {PROJECT.contractorPhone}</text>
      <text x={bx + 200} y={by + 22} fontSize="5.5" fill="#333">Lic# {PROJECT.contractorLicense}</text>
      {/* Project info */}
      <text x={bx + 5} y={by + 42} fontSize="6.5" fontWeight="bold" fill="#111">{PROJECT.id} {PROJECT.owner}</text>
      <text x={bx + 5} y={by + 52} fontSize="5.5" fill="#333">{PROJECT.address}</text>
      {/* Engineer stamp area */}
      <text x={bx + 160} y={by + 65} fontSize="5" fill="#999">ENGINEER&apos;S STAMP</text>
      <rect x={bx + 158} y={by + 57} width="148" height="21" fill="none" stroke="#ccc" strokeWidth="0.5" strokeDasharray="2,2" />
      {/* Drawn info */}
      <text x={bx + 5} y={by + 68} fontSize="5.5" fill="#333">DRAWN BY: NOVA CRM</text>
      <text x={bx + 5} y={by + 76} fontSize="5.5" fill="#333">DATE: {today()}</text>
      {/* Sheet name */}
      <text x={bx + 5} y={by + 92} fontSize="8" fontWeight="bold" fill="#111">{sheetName}</text>
      {/* Sheet number */}
      <text x={bx + 5} y={by + 112} fontSize="14" fontWeight="bold" fill="#111">{sheetNumber}</text>
      <text x={bx + 65} y={by + 112} fontSize="7" fill="#333">of 6</text>
    </g>
  )
}

// ── SHEET PV-1: COVER PAGE ──────────────────────────────────────────────────

function SheetPV1() {
  const generalNotes = [
    '1. ALL WORK SHALL COMPLY WITH THE LATEST EDITION OF THE NEC (NFPA 70) AND ALL APPLICABLE LOCAL CODES.',
    '2. ALL WIRING METHODS AND MATERIALS SHALL COMPLY WITH NEC ARTICLES 690, 705, AND 706.',
    '3. ALL PV MODULES SHALL BE LISTED TO UL 1703 OR UL 61730.',
    '4. INVERTER(S) SHALL BE LISTED TO UL 1741 AND/OR UL 1741SA FOR UTILITY INTERACTIVE OPERATION.',
    '5. ALL EQUIPMENT SHALL BE INSTALLED PER MANUFACTURER INSTRUCTIONS AND SPECIFICATIONS.',
    '6. RAPID SHUTDOWN SHALL COMPLY WITH NEC 690.12. MODULE-LEVEL POWER ELECTRONICS PROVIDE COMPLIANCE.',
    '7. ARC-FAULT CIRCUIT PROTECTION SHALL COMPLY WITH NEC 690.11.',
    '8. ALL ROOF PENETRATIONS SHALL BE PROPERLY FLASHED AND SEALED TO MAINTAIN ROOF WARRANTY.',
    '9. EQUIPMENT GROUNDING SHALL COMPLY WITH NEC 250.134 AND 690.43.',
    '10. GROUNDING ELECTRODE SYSTEM SHALL COMPLY WITH NEC 250.50 AND 250.52.',
    '11. PV SYSTEM DC CIRCUITS SHALL BE INSTALLED PER NEC 690.31.',
    '12. MAXIMUM SYSTEM VOLTAGE SHALL NOT EXCEED 600V DC PER NEC 690.7.',
    '13. OVERCURRENT PROTECTION SHALL COMPLY WITH NEC 690.9.',
    '14. ALL CONDUCTORS SHALL BE COPPER AND RATED FOR WET LOCATIONS.',
    '15. GROUND-MOUNTED OR ROOF-MOUNTED CONDUIT SHALL BE RATED FOR OUTDOOR USE.',
    '16. SYSTEM SHALL BE INSPECTED AND APPROVED PRIOR TO INTERCONNECTION.',
  ]

  const pvNotes = [
    '1. PV ARRAY OUTPUT CIRCUIT CONDUCTORS SHALL BE SIZED AT 125% OF Isc PER NEC 690.8(A).',
    '2. MAXIMUM SYSTEM VOLTAGE (Voc CORRECTED) SHALL NOT EXCEED INVERTER MAXIMUM INPUT VOLTAGE.',
    '3. STRING VOLTAGE RANGE (Vmp) SHALL FALL WITHIN INVERTER MPPT OPERATING RANGE.',
    '4. PV SOURCE CIRCUITS SHALL BE PROVIDED WITH OCPD PER NEC 690.9.',
    '5. ALL DC WIRING SHALL USE PV WIRE OR USE RATED PER NEC 690.31(C).',
    '6. MODULE-LEVEL RAPID SHUTDOWN DEVICES SHALL COMPLY WITH NEC 690.12(B)(2).',
    '7. BATTERY ENERGY STORAGE SYSTEM SHALL COMPLY WITH NEC ARTICLE 706.',
    '8. ESS SHALL BE INSTALLED IN ACCORDANCE WITH MANUFACTURER INSTALLATION MANUAL.',
  ]

  const codeRefs = [
    'NEC 2020 (NFPA 70)',
    'IBC 2015',
    'IRC 2015',
    'ASCE 7-16',
    'UL 1703 / UL 61730',
    'UL 1741 / UL 1741SA',
    'UL 9540 (ESS)',
    'IEEE 1547',
  ]

  const unitIndex = [
    ['MSP', 'MAIN SERVICE PANEL'],
    ['SP', 'SUB PANEL'],
    ['MDP', 'MAIN DISTRIBUTION PANEL'],
    ['GP', 'GROUND POINT'],
    ['PV', 'PHOTOVOLTAIC'],
    ['ESS', 'ENERGY STORAGE SYSTEM'],
    ['OCPD', 'OVERCURRENT PROTECTION DEVICE'],
    ['GEC', 'GROUNDING ELECTRODE CONDUCTOR'],
    ['EGC', 'EQUIPMENT GROUNDING CONDUCTOR'],
    ['RSD', 'RAPID SHUTDOWN DEVICE'],
    ['MPPT', 'MAX POWER POINT TRACKER'],
    ['Voc', 'OPEN CIRCUIT VOLTAGE'],
    ['Vmp', 'MAXIMUM POWER VOLTAGE'],
    ['Isc', 'SHORT CIRCUIT CURRENT'],
    ['Imp', 'MAXIMUM POWER CURRENT'],
  ]

  const sheetIndex = [
    ['PV-1', 'COVER PAGE & GENERAL NOTES'],
    ['PV-5', 'SINGLE LINE DIAGRAM'],
    ['PV-5.1', 'PCS LABELS'],
    ['PV-6', 'WIRING CALCULATIONS'],
    ['PV-7', 'WARNING LABELS'],
    ['PV-7.1', 'EQUIPMENT PLACARDS'],
  ]

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      {/* ── TITLE ── */}
      <text x="25" y="35" fontSize="14" fontWeight="bold" fill="#111">
        ROOF INSTALLATION OF {PROJECT.systemDcKw.toFixed(2)} KW DC PHOTOVOLTAIC SYSTEM
      </text>
      <text x="25" y="50" fontSize="9" fill="#333">
        WITH {PROJECT.totalStorageKwh} KWH BATTERY ENERGY STORAGE SYSTEM
      </text>

      {/* ── PROJECT DATA BOX ── */}
      <rect x="25" y="65" width="340" height="310" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="25" y="65" width="340" height="18" fill="#111" />
      <text x="195" y="78" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">PROJECT DATA</text>

      {(() => {
        let y = 98
        const ls = 13
        const items = [
          ['PROJECT:', `${PROJECT.id} ${PROJECT.owner}`],
          ['ADDRESS:', PROJECT.address],
          ['', ''],
          ['SYSTEM SIZE:', `${PROJECT.systemDcKw.toFixed(2)} kWDC / ${PROJECT.systemAcKw.toFixed(3)} kWAC`],
          ['PV MODULES:', `(${PROJECT.panelCount}) ${PROJECT.panelModel}`],
          ['INVERTERS:', `(${PROJECT.inverterCount}) ${PROJECT.inverterModel}`],
          ['BATTERIES:', `(${PROJECT.batteryCount}) ${PROJECT.batteryModel} = ${PROJECT.totalStorageKwh} kWh`],
          ['', ''],
          ['RACKING:', PROJECT.rackingModel],
          ['INTERCONNECTION:', 'UTILITY INTERCONNECTION'],
          ['UTILITY:', PROJECT.utility],
          ['METER #:', PROJECT.meter],
          ['ESID:', PROJECT.esid],
          ['', ''],
          ['BUILDING:', `${PROJECT.stories === 1 ? 'ONE' : PROJECT.stories} STORY BUILDING`],
          ['CONSTRUCTION:', `${PROJECT.buildingType}, Occupancy ${PROJECT.occupancy}`],
          ['ROOF:', `${PROJECT.roofType}, ${PROJECT.rafterSize}`],
          ['WIND SPEED:', `${PROJECT.windSpeed} MPH, Risk Cat ${PROJECT.riskCategory}`],
          ['EXPOSURE:', PROJECT.exposure],
        ]
        return items.map(([label, value], i) => {
          if (!label && !value) { y += 5; return null }
          const el = (
            <g key={i}>
              <text x="32" y={y} fontSize="6" fontWeight="bold" fill="#111">{label}</text>
              <text x="110" y={y} fontSize="6" fill="#333">{value}</text>
            </g>
          )
          y += ls
          return el
        })
      })()}

      {/* ── EXISTING SYSTEM BOX ── */}
      <rect x="25" y="385" width="340" height="70" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="25" y="385" width="340" height="18" fill="#555" />
      <text x="195" y="398" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">EXISTING SYSTEM (TO REMAIN)</text>
      <text x="32" y="418" fontSize="6" fontWeight="bold" fill="#111">PV MODULES:</text>
      <text x="110" y="418" fontSize="6" fill="#333">({PROJECT.existingPanelCount}) {PROJECT.existingPanelModel} ({PROJECT.existingPanelWattage}W)</text>
      <text x="32" y="431" fontSize="6" fontWeight="bold" fill="#111">INVERTERS:</text>
      <text x="110" y="431" fontSize="6" fill="#333">({PROJECT.existingInverterCount}) {PROJECT.existingInverterModel}</text>
      <text x="32" y="444" fontSize="6" fontWeight="bold" fill="#111">EXISTING DC:</text>
      <text x="110" y="444" fontSize="6" fill="#333">{(PROJECT.existingPanelCount * PROJECT.existingPanelWattage / 1000).toFixed(2)} kW</text>

      {/* ── GENERAL NOTES ── */}
      <rect x="385" y="65" width="345" height="360" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="385" y="65" width="345" height="18" fill="#111" />
      <text x="557" y="78" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">GENERAL NOTES</text>
      {generalNotes.map((note, i) => (
        <text key={i} x="392" y={98 + i * 21} fontSize="5.2" fill="#333" style={{ maxWidth: 335 }}>
          {note}
        </text>
      ))}

      {/* ── PHOTOVOLTAIC NOTES ── */}
      <rect x="385" y="435" width="345" height="145" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="385" y="435" width="345" height="18" fill="#111" />
      <text x="557" y="448" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">PHOTOVOLTAIC NOTES</text>
      {pvNotes.map((note, i) => (
        <text key={i} x="392" y={468 + i * 15} fontSize="5.2" fill="#333">
          {note}
        </text>
      ))}

      {/* ── CODE REFERENCES ── */}
      <rect x="25" y="465" width="165" height="160" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="25" y="465" width="165" height="18" fill="#111" />
      <text x="107" y="478" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">CODE REFERENCES</text>
      {codeRefs.map((ref, i) => (
        <text key={i} x="32" y={498 + i * 14} fontSize="6" fill="#333">{ref}</text>
      ))}

      {/* ── UNIT INDEX ── */}
      <rect x="200" y="465" width="175" height="160" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="200" y="465" width="175" height="18" fill="#111" />
      <text x="287" y="478" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">UNIT INDEX</text>
      {unitIndex.map(([abbr, def], i) => (
        <g key={i}>
          <text x="207" y={498 + i * 9} fontSize="5.5" fontWeight="bold" fill="#111">{abbr}</text>
          <text x="240" y={498 + i * 9} fontSize="5.5" fill="#333">{def}</text>
        </g>
      ))}

      {/* ── SHEET INDEX ── */}
      <rect x="25" y="635" width="350" height="85" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="25" y="635" width="350" height="18" fill="#111" />
      <text x="200" y="648" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">SHEET INDEX</text>
      {sheetIndex.map(([num, title], i) => (
        <g key={i}>
          <text x="32" y={668 + i * 13} fontSize="6.5" fontWeight="bold" fill="#111">{num}</text>
          <text x="80" y={668 + i * 13} fontSize="6.5" fill="#333">{title}</text>
        </g>
      ))}

      {/* ── CONTRACTOR INFO (right side) ── */}
      <rect x="750" y="65" width="330" height="100" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="750" y="65" width="330" height="18" fill="#111" />
      <text x="915" y="78" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">CONTRACTOR</text>
      <text x="757" y="98" fontSize="7" fontWeight="bold" fill="#111">{PROJECT.contractor}</text>
      <text x="757" y="111" fontSize="6" fill="#333">{PROJECT.contractorAddress}</text>
      <text x="757" y="122" fontSize="6" fill="#333">{PROJECT.contractorCity}</text>
      <text x="757" y="133" fontSize="6" fill="#333">Phone: {PROJECT.contractorPhone}</text>
      <text x="757" y="144" fontSize="6" fill="#333">License# {PROJECT.contractorLicense}</text>
      <text x="757" y="155" fontSize="6" fill="#333">{PROJECT.contractorEmail}</text>

      <TitleBlock sheetName="COVER PAGE & GENERAL NOTES" sheetNumber="PV-1" />
    </svg>
  )
}

// ── SHEET PV-5: SINGLE LINE DIAGRAM ─────────────────────────────────────────

function SheetPV5() {
  // String grouping: 3 strings on INV-1, 2 strings on INV-2
  const inv1Strings = PROJECT.strings.slice(0, 3) // strings 1-3 (27 modules)
  const inv2Strings = PROJECT.strings.slice(3)    // strings 4-6 (26 modules)
  const stringGroups = [inv1Strings, inv2Strings]
  const battsPerStack = PROJECT.batteryCount / PROJECT.inverterCount

  // Helpers
  const WireLabel = ({ x, y, text }: { x: number; y: number; text: string }) => (
    <text x={x} y={y} fontSize="5.5" fill="#444" fontStyle="italic">{text}</text>
  )

  const Breaker = ({ x, y, label, amps }: { x: number; y: number; label?: string; amps?: string }) => (
    <g>
      <line x1={x} y1={y - 8} x2={x} y2={y - 2} stroke="#111" strokeWidth="1.5" />
      <line x1={x} y1={y - 2} x2={x + 5} y2={y + 6} stroke="#111" strokeWidth="1.5" />
      <line x1={x} y1={y + 8} x2={x} y2={y + 14} stroke="#111" strokeWidth="1.5" />
      <circle cx={x} cy={y - 2} r="1.5" fill="#111" />
      {label && <text x={x + 10} y={y + 2} fontSize="5.5" fill="#111">{label}</text>}
      {amps && <text x={x + 10} y={y + 9} fontSize="5" fill="#666">{amps}</text>}
    </g>
  )

  const Disconnect = ({ x, y, label }: { x: number; y: number; label: string }) => (
    <g>
      <line x1={x} y1={y - 6} x2={x} y2={y} stroke="#111" strokeWidth="1.5" />
      <line x1={x} y1={y} x2={x + 6} y2={y - 8} stroke="#111" strokeWidth="2" />
      <circle cx={x} cy={y} r="2" fill="none" stroke="#111" strokeWidth="1" />
      <line x1={x} y1={y + 2} x2={x} y2={y + 8} stroke="#111" strokeWidth="1.5" />
      <text x={x + 10} y={y + 2} fontSize="5.5" fill="#111">{label}</text>
    </g>
  )

  const W = SHEET_W
  const H = SHEET_H

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={W} height={H} fill="white" />
      <DrawingBorder />

      {/* ── STC BOX (top left) ── */}
      <rect x="20" y="16" width="200" height="45" fill="none" stroke="#111" strokeWidth="1" />
      <text x="30" y="30" fontSize="7" fontWeight="bold">STC</text>
      <text x="30" y="41" fontSize="6">MODULES: {PROJECT.panelCount} x {PROJECT.panelWattage}W = {PROJECT.systemDcKw.toFixed(2)} kW DC</text>
      <text x="30" y="51" fontSize="6">INVERTER(S): {PROJECT.inverterCount} x 15kW = {PROJECT.systemAcKw.toFixed(1)} kW AC</text>

      {/* ── METER / ESID BOX (top center) ── */}
      <rect x="240" y="16" width="220" height="35" fill="none" stroke="#111" strokeWidth="1" />
      <text x="250" y="30" fontSize="6">METER NUMBER: {PROJECT.meter}</text>
      <text x="250" y="42" fontSize="6">ESID NUMBER: {PROJECT.esid}</text>

      {/* ── BATTERY SCOPE BOX (top right) ── */}
      <rect x={W - 280} y="16" width="265" height="55" fill="none" stroke="#111" strokeWidth="1" />
      <text x={W - 270} y="29" fontSize="6" fontWeight="bold">BATTERY SCOPE</text>
      <text x={W - 270} y="39" fontSize="5.5">(N)({PROJECT.batteryCount}) {PROJECT.batteryModel.toUpperCase()}</text>
      <text x={W - 270} y="49" fontSize="5.5">{PROJECT.batteryCapacity}KWH, 380VDC, IP67, NEMA 3R</text>
      <text x={W - 270} y="59" fontSize="5.5">TOTAL STORAGE: {PROJECT.totalStorageKwh} kWh | STACKS: {PROJECT.inverterCount} x {battsPerStack}</text>

      {/* ── PV ARRAYS ── */}
      {stringGroups.map((strings, inv) => {
        const baseX = inv === 0 ? 100 : 700
        const moduleW = 8
        const moduleH = 14

        return (
          <g key={`arr-${inv}`}>
            {strings.map((s, si) => {
              const sy = 90 + si * 48
              const vocCold = (s.modules * VOC_COLD).toFixed(1)

              return (
                <g key={si}>
                  {Array.from({ length: Math.min(s.modules, 14) }, (_, mi) => (
                    <rect key={mi} x={baseX + mi * (moduleW + 1)} y={sy}
                      width={moduleW} height={moduleH} fill="none" stroke="#111" strokeWidth="0.7" />
                  ))}
                  <line x1={baseX} y1={sy + moduleH / 2}
                    x2={baseX + Math.min(s.modules, 14) * (moduleW + 1) - 1} y2={sy + moduleH / 2}
                    stroke="#111" strokeWidth="0.3" strokeDasharray="1,2" />
                  <text x={baseX} y={sy - 4} fontSize="6" fontWeight="bold">
                    STRING {s.id}: ({s.modules}) {PROJECT.panelModel.toUpperCase()}
                  </text>
                  <text x={baseX + 200} y={sy - 4} fontSize="5.5" fill="#666">
                    ROOF #{s.roofFace}
                  </text>
                  <text x={baseX} y={sy + moduleH + 10} fontSize="5" fill="#444">
                    (N) RSD-D-20 ROOFTOP MODULE LEVEL RAPID SHUTDOWN DEVICE
                  </text>
                  <line x1={baseX + Math.min(s.modules, 14) * (moduleW + 1) + 10} y1={sy + moduleH / 2}
                    x2={baseX + Math.min(s.modules, 14) * (moduleW + 1) + 30} y2={sy + moduleH / 2}
                    stroke="#111" strokeWidth="1" />
                  <text x={baseX + Math.min(s.modules, 14) * (moduleW + 1) + 35} y={sy + moduleH / 2 - 2}
                    fontSize="5" fill="#444">{vocCold}V</text>
                  <text x={baseX + Math.min(s.modules, 14) * (moduleW + 1) + 35} y={sy + moduleH / 2 + 6}
                    fontSize="5" fill="#444">{PROJECT.panelImp}A</text>
                </g>
              )
            })}

            {/* Roof array wiring label */}
            <text x={baseX} y={90 + strings.length * 48 + 8} fontSize="5.5" fill="#444" fontStyle="italic">
              ROOF ARRAY WIRING
            </text>

            {/* Junction box */}
            <rect x={baseX + 170} y={90 + strings.length * 48 + 18} width={55} height={22}
              fill="none" stroke="#111" strokeWidth="1" />
            <text x={baseX + 197} y={90 + strings.length * 48 + 31} textAnchor="middle" fontSize="5.5">
              (N) JUNCTION BOX
            </text>
            <text x={baseX + 197} y={90 + strings.length * 48 + 38} textAnchor="middle" fontSize="5" fill="#666">
              600V, NEMA 3
            </text>

            <WireLabel x={baseX + 50} y={90 + strings.length * 48 + 15}
              text={'#10 AWG CU PV WIRE, 3/4" EMT TYPE CONDUIT'} />
          </g>
        )
      })}

      {/* ── INVERTERS ── */}
      {stringGroups.map((strings, inv) => {
        const cx = inv === 0 ? 320 : 950
        const invY = 380
        const invW = 200
        const invH = 80
        const invModules = strings.reduce((s, sc) => s + sc.modules, 0)

        return (
          <g key={`inv-${inv}`}>
            {/* Wire from JB to inverter */}
            <line x1={cx} y1={310} x2={cx} y2={invY} stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx + 8} y={320}
              text={'(2) #10 AWG CU THWN-2'} />
            <WireLabel x={cx + 8} y={328}
              text={'(1) #6 AWG BARE CU EGC'} />
            <WireLabel x={cx + 8} y={336}
              text={'3/4" EMT TYPE CONDUIT'} />

            <Disconnect x={cx} y={350} label="(N) DC DISCONNECT" />

            {/* Inverter box — 200w x 80h, plenty of room for 6 lines */}
            <rect x={cx - invW / 2} y={invY} width={invW} height={invH}
              fill="none" stroke="#111" strokeWidth="2" />
            <text x={cx} y={invY + 13} textAnchor="middle" fontSize="6" fontWeight="bold">
              (N) DURACELL POWER CENTER MAX
            </text>
            <text x={cx} y={invY + 23} textAnchor="middle" fontSize="5.5">
              HYBRID 15KW INVERTER {inv + 1}
            </text>
            <text x={cx} y={invY + 33} textAnchor="middle" fontSize="5">
              15KW AC, 19.5KW DC, 100A, 240V, NEMA 3R
            </text>
            <text x={cx} y={invY + 44} textAnchor="middle" fontSize="5" fill="#666">
              {invModules} MODULES = {(invModules * PROJECT.panelWattage / 1000).toFixed(2)} kW DC
            </text>
            <text x={cx} y={invY + 55} textAnchor="middle" fontSize="5" fill="#666">
              3 MPPT, 2 STRINGS/MPPT, MAX 26A/MPPT
            </text>
            <text x={cx} y={invY + 66} textAnchor="middle" fontSize="4.5" fill="#999">
              CEC EFF: 96.5% | PEAK: 97.5%
            </text>

            {/* Battery stack — wider box, clear wire labels */}
            <line x1={cx - invW / 2} y1={invY + invH / 2}
              x2={cx - invW / 2 - 50} y2={invY + invH / 2}
              stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx - invW / 2 - 48} y={invY + invH / 2 - 8}
              text={'(2) #4/0 AWG CU THWN-2'} />
            <WireLabel x={cx - invW / 2 - 48} y={invY + invH / 2 + 12}
              text={'2" EMT TYPE CONDUIT'} />

            <rect x={cx - invW / 2 - 120} y={invY + 5} width={68} height={invH - 10}
              fill="none" stroke="#111" strokeWidth="1.5" />
            <text x={cx - invW / 2 - 86} y={invY + 18} textAnchor="middle" fontSize="5" fontWeight="bold">
              (N)({battsPerStack})
            </text>
            <text x={cx - invW / 2 - 86} y={invY + 28} textAnchor="middle" fontSize="4.5">
              DURACELL 5KWH LFP
            </text>
            <text x={cx - invW / 2 - 86} y={invY + 38} textAnchor="middle" fontSize="4.5">
              380VDC, IP67, NEMA 3R
            </text>
            <text x={cx - invW / 2 - 86} y={invY + 48} textAnchor="middle" fontSize="4.5" fill="#666">
              STACK OF {battsPerStack}
            </text>
            <text x={cx - invW / 2 - 86} y={invY + 58} textAnchor="middle" fontSize="4.5" fill="#666">
              {battsPerStack * PROJECT.batteryCapacity} kWh TOTAL
            </text>

            {/* Monitoring Gateway — wider box */}
            <line x1={cx + invW / 2} y1={invY + 20}
              x2={cx + invW / 2 + 20} y2={invY + 20}
              stroke="#111" strokeWidth="1" />
            <rect x={cx + invW / 2 + 20} y={invY + 8} width={90} height={26}
              fill="none" stroke="#111" strokeWidth="0.8" />
            <text x={cx + invW / 2 + 65} y={invY + 19} textAnchor="middle" fontSize="4.5">(N) DCCGRGL</text>
            <text x={cx + invW / 2 + 65} y={invY + 28} textAnchor="middle" fontSize="3.8">DURACELL MONITORING GW</text>

            {/* Wireless Bridge — below gateway with gap */}
            <line x1={cx + invW / 2 + 65} y1={invY + 34}
              x2={cx + invW / 2 + 65} y2={invY + 44}
              stroke="#111" strokeWidth="0.8" strokeDasharray="2,2" />
            <rect x={cx + invW / 2 + 30} y={invY + 44} width={70} height={18}
              fill="none" stroke="#111" strokeWidth="0.8" />
            <text x={cx + invW / 2 + 65} y={invY + 55} textAnchor="middle" fontSize="4">(N) WIRELESS BRIDGE</text>

            {/* CT Clamp text — clearly below bridge */}
            <text x={cx + invW / 2 + 65} y={invY + 72} textAnchor="middle" fontSize="3.5" fill="#666">CT CLAMPS ON MAIN</text>
            <text x={cx + invW / 2 + 65} y={invY + 78} textAnchor="middle" fontSize="3.5" fill="#666">SERVICE ENTRANCE</text>

            {/* AC Output — clear spacing */}
            <line x1={cx} y1={invY + invH} x2={cx} y2={invY + invH + 15}
              stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx + 8} y={invY + invH + 10}
              text={'#6 AWG CU THWN-2'} />

            <Disconnect x={cx} y={invY + invH + 20} label="(N) AC DISCONNECT, 200A/2P, 240V" />

            <line x1={cx} y1={invY + invH + 30} x2={cx} y2={invY + invH + 65}
              stroke="#111" strokeWidth="1.5" />
            <WireLabel x={cx + 8} y={invY + invH + 42}
              text={'(2) #4 AWG CU THWN-2'} />
            <WireLabel x={cx + 8} y={invY + invH + 50}
              text={'(1) #8 AWG CU EGC'} />
            <WireLabel x={cx + 8} y={invY + invH + 58}
              text={'1-1/4" EMT TYPE CONDUIT'} />

            <Breaker x={cx} y={invY + invH + 72} label={'(N) 100A BACKFEED'} amps="BREAKER" />
          </g>
        )
      })}

      {/* ── EXISTING HOME PANEL BUS BAR ── */}
      {(() => {
        const busY = 550
        return (
          <>
            <line x1="60" y1={busY} x2={W - 380} y2={busY} stroke="#111" strokeWidth="3" />
            <text x={460} y={busY - 10} textAnchor="middle" fontSize="7" fontWeight="bold">
              (E) EXISTING HOME ELECTRICAL PANEL
            </text>
            <text x={460} y={busY + 18} textAnchor="middle" fontSize="5.5" fill="#666">
              200A RATED, 240V, SINGLE PHASE
            </text>

            {/* Main breaker — below bus */}
            <line x1="45" y1={busY} x2="45" y2={busY + 30} stroke="#111" strokeWidth="1.5" />
            <Breaker x={45} y={busY + 25} label="(E) MAIN" amps="200A" />
            <text x="45" y={busY + 55} textAnchor="middle" fontSize="5.5">TO LOADS</text>

            {/* Existing PV breaker */}
            <line x1="500" y1={busY} x2="500" y2={busY + 30} stroke="#111" strokeWidth="1" strokeDasharray="4,3" />
            <Breaker x={500} y={busY + 25} label="(E) 40A PV" amps="BREAKER" />
            <text x="500" y={busY + 55} textAnchor="middle" fontSize="5" fill="#666">(E) EXISTING ENPHASE</text>
            <text x="500" y={busY + 63} textAnchor="middle" fontSize="5" fill="#666">IQ7PLUS SYSTEM</text>
          </>
        )
      })()}

      {/* Generator Ready Circuit (future) */}
      <line x1="650" y1={550} x2="650" y2={600} stroke="#111" strokeWidth="1" strokeDasharray="4,3" />
      <rect x="618" y={600} width="64" height="24" fill="none" stroke="#111" strokeWidth="1" strokeDasharray="4,3" />
      <text x="650" y={611} textAnchor="middle" fontSize="4.5" fill="#666">(FUTURE) 100A</text>
      <text x="650" y={619} textAnchor="middle" fontSize="4.5" fill="#666">AC INPUT</text>
      <text x="650" y={635} textAnchor="middle" fontSize="4" fill="#999">FUTURE PLUG-AND-PLAY</text>
      <text x="650" y={643} textAnchor="middle" fontSize="4" fill="#999">22kW NG GENERATOR</text>

      {/* ── GENERATION DISCONNECT → RGM → METER → GRID ── */}
      <line x1={W - 380} y1={550} x2={W - 398} y2={550} stroke="#111" strokeWidth="1.5" />

      <rect x={W - 398} y={536} width={70} height={28} fill="none" stroke="#111" strokeWidth="1" />
      <text x={W - 363} y={548} textAnchor="middle" fontSize="5.5">(N) GENERATION</text>
      <text x={W - 363} y={558} textAnchor="middle" fontSize="5.5">DISCONNECT</text>

      <line x1={W - 328} y1={550} x2={W - 295} y2={550} stroke="#111" strokeWidth="1.5" />

      {/* Revenue Grade Meter */}
      <rect x={W - 300} y={537} width={65} height={26} fill="none" stroke="#111" strokeWidth="0.8" />
      <text x={W - 268} y={548} textAnchor="middle" fontSize="4.5">(N) RGM</text>
      <text x={W - 268} y={557} textAnchor="middle" fontSize="3.8">PC-PRO-RGM-W2-BA-L</text>

      <line x1={W - 235} y1={550} x2={W - 195} y2={550} stroke="#111" strokeWidth="1.5" />

      {/* Utility Meter */}
      <circle cx={W - 170} cy={550} r="22" fill="none" stroke="#111" strokeWidth="1.5" />
      <text x={W - 170} y={548} textAnchor="middle" fontSize="8" fontWeight="bold">M</text>
      <text x={W - 170} y={560} textAnchor="middle" fontSize="5.5">kWh</text>
      <text x={W - 170} y={522} textAnchor="middle" fontSize="5" fill="#666">(E) BIDIRECTIONAL</text>
      <text x={W - 170} y={514} textAnchor="middle" fontSize="5" fill="#666">UTILITY METER</text>

      <line x1={W - 148} y1={550} x2={W - 125} y2={550} stroke="#111" strokeWidth="1.5" />
      <text x={W - 120} y={543} fontSize="6" fill="#666">TO UTILITY</text>
      <text x={W - 120} y={553} fontSize="6" fill="#666">GRID</text>
      <text x={W - 120} y={565} fontSize="5" fill="#999">CENTERPOINT</text>
      <text x={W - 120} y={574} fontSize="5" fill="#999">ENERGY</text>

      {/* 10 FT MAX notation */}
      <line x1={W - 420} y1={510} x2={W - 130} y2={510} stroke="#111" strokeWidth="0.5" />
      <text x={W - 275} y={507} textAnchor="middle" fontSize="5.5" fontWeight="bold">10&apos; MAX</text>
      <line x1={W - 420} y1={508} x2={W - 420} y2={515} stroke="#111" strokeWidth="0.5" />
      <line x1={W - 130} y1={508} x2={W - 130} y2={515} stroke="#111" strokeWidth="0.5" />

      {/* ── GROUND SYSTEM ── */}
      <line x1="100" y1={550} x2="100" y2={610} stroke="#111" strokeWidth="1" />
      <line x1="92" y1={610} x2="108" y2={610} stroke="#111" strokeWidth="1.5" />
      <line x1="94" y1={614} x2="106" y2={614} stroke="#111" strokeWidth="1.5" />
      <line x1="96" y1={618} x2="104" y2={618} stroke="#111" strokeWidth="1.5" />
      <text x="115" y={610} fontSize="5.5">EXISTING GROUNDING</text>
      <text x="115" y={618} fontSize="5.5">ELECTRODE SYSTEM</text>
      <text x="115" y={626} fontSize="5" fill="#666">NEC 250.50, 250.52(A)</text>

      {/* ── EXISTING SYSTEM NOTE ── */}
      <rect x="380" y={615} width="180" height="30" fill="none" stroke="#111" strokeWidth="0.5" strokeDasharray="4,3" />
      <text x="390" y={629} fontSize="5" fill="#666">(E)({PROJECT.existingPanelCount}) {PROJECT.existingPanelModel} ({PROJECT.existingPanelWattage}W)</text>
      <text x="390" y={638} fontSize="5" fill="#666">(E)({PROJECT.existingInverterCount}) {PROJECT.existingInverterModel} (240V)</text>

      {/* ── NOTES ── */}
      <rect x="20" y={H - 130} width={W - 340} height={118} fill="none" stroke="#111" strokeWidth="0.5" />
      <text x="30" y={H - 116} fontSize="6.5" fontWeight="bold">NOTES:</text>
      {[
        '1. ALL ELECTRICAL MATERIALS SHALL BE NEW AND LISTED BY RECOGNIZED TESTING LABORATORY.',
        '2. OUTDOOR EQUIPMENT SHALL BE AT LEAST NEMA 3R RATED.',
        '3. ALL METALLIC EQUIPMENT SHALL BE GROUNDED PER NEC 250.',
        `4. PV SYSTEM SIZE: ${PROJECT.systemDcKw.toFixed(2)} kW DC / ${PROJECT.systemAcKw} kW AC.`,
        `5. BATTERY SYSTEM: (${PROJECT.batteryCount}) ${PROJECT.batteryModel.toUpperCase()}, ${PROJECT.totalStorageKwh} kWh TOTAL.`,
        `6. RACKING: ${PROJECT.rackingModel.toUpperCase()}`,
        '7. ALL WORK SHALL BE IN ACCORD WITH THE 2020 NEC WITH SPECIAL EMPHASIS ON ARTICLE 690.',
        'NOTE: PCS CONTROLLED CURRENT SETTING: 200A.',
        'NOTE: STRING CALCULATIONS REQUIRE PE REVIEW BEFORE PERMITTING.',
      ].map((note, i) => (
        <text key={i} x="30" y={H - 104 + i * 11} fontSize="5.5" fill="#333">{note}</text>
      ))}

      <TitleBlock sheetName="SINGLE LINE DIAGRAM" sheetNumber="PV-5" />
    </svg>
  )
}

// ── SHEET PV-5.1: PCS LABELS ────────────────────────────────────────────────

function SheetPV51() {
  // Per-string Voc calculations
  const string11Voc = (11 * PROJECT.panelVoc).toFixed(1)
  const string10Voc = (10 * PROJECT.panelVoc).toFixed(1)
  const string9VocCold = (9 * VOC_COLD).toFixed(1)
  const string8VocCold = (8 * VOC_COLD).toFixed(1)
  const maxStringVoc = Math.max(...STRING_VOCS).toFixed(1)
  const totalAcAmps = (PROJECT.inverterAcPower * 1000 / 240).toFixed(1)

  interface LabelDef {
    title: string
    nec: string
    x: number
    y: number
    w: number
    h: number
    lines: string[]
    borderColor?: string
  }

  const labels: LabelDef[] = [
    {
      title: 'INVERTER LABEL',
      nec: 'NEC 690.54',
      x: 25, y: 65, w: 500, h: 140,
      lines: [
        'CAUTION: DUAL POWER SOURCE',
        '',
        'THIS EQUIPMENT IS SUPPLIED BY TWO POWER SOURCES:',
        '1. UTILITY GRID (240V AC, SINGLE PHASE)',
        `2. PHOTOVOLTAIC SYSTEM (${PROJECT.systemDcKw.toFixed(2)} kW DC)`,
        `3. BATTERY ENERGY STORAGE (${PROJECT.totalStorageKwh} kWh)`,
        '',
        `INVERTER: (${PROJECT.inverterCount}) ${PROJECT.inverterModel}`,
        `RATED AC OUTPUT: ${PROJECT.inverterAcPower} kW PER UNIT, ${PROJECT.systemAcKw} kW TOTAL`,
        `RATED AC CURRENT: ${totalAcAmps}A @ 240V PER UNIT`,
      ],
    },
    {
      title: 'AC DISCONNECT LABEL',
      nec: 'NEC 690.14(C)',
      x: 25, y: 220, w: 500, h: 110,
      lines: [
        'AC DISCONNECT — SOLAR PHOTOVOLTAIC SYSTEM',
        '',
        'VOLTAGE: 240V AC, SINGLE PHASE',
        `MAX AC CURRENT: ${totalAcAmps}A PER INVERTER`,
        `TOTAL AC CURRENT: ${(parseFloat(totalAcAmps) * PROJECT.inverterCount).toFixed(1)}A`,
        'DISCONNECT RATING: 200A, NEMA 3R',
        'CAUTION: TURN OFF AC DISCONNECT BEFORE SERVICING INVERTER',
      ],
    },
    {
      title: 'PV DISCONNECT LABEL',
      nec: 'NEC 690.13',
      x: 25, y: 345, w: 500, h: 120,
      lines: [
        'DC DISCONNECT — PHOTOVOLTAIC SYSTEM',
        '',
        `MAXIMUM SYSTEM VOLTAGE (Voc @ -5°C): ${maxStringVoc}V DC`,
        `MAXIMUM DC CURRENT: ${(PROJECT.panelIsc * 1.25).toFixed(1)}A (125% Isc)`,
        `STRINGS: 5x 9-MODULE (Voc=${string9VocCold}V) + 1x 8-MODULE (Voc=${string8VocCold}V)`,
        'CONDUCTOR: #10 AWG CU PV WIRE',
        'CONDUIT: 3/4" EMT',
        'WARNING: SHOCK HAZARD — DC CIRCUITS MAY BE ENERGIZED WHEN MODULES ARE EXPOSED TO LIGHT',
      ],
    },
    {
      title: 'MAIN PANEL LABEL',
      nec: 'NEC 705.12',
      x: 550, y: 65, w: 500, h: 110,
      lines: [
        'WARNING: SOLAR PHOTOVOLTAIC SYSTEM CONNECTED',
        '',
        `SOLAR SYSTEM: ${PROJECT.systemDcKw.toFixed(2)} kW DC / ${PROJECT.systemAcKw} kW AC`,
        `BATTERY STORAGE: ${PROJECT.totalStorageKwh} kWh`,
        `PV BACKFEED BREAKER: (${PROJECT.inverterCount}) 100A, 240V`,
        'CAUTION: DO NOT EXCEED BUS RATING WHEN ADDING BREAKERS',
        'SEE NEC 705.12 FOR 120% BUS BAR RATING RULE',
      ],
    },
    {
      title: 'UTILITY METER LABEL',
      nec: 'NEC 705.10',
      x: 550, y: 190, w: 500, h: 100,
      lines: [
        'NET METERING — PHOTOVOLTAIC SYSTEM',
        '',
        `UTILITY: ${PROJECT.utility}`,
        `METER: ${PROJECT.meter}`,
        `ESID: ${PROJECT.esid}`,
        `SYSTEM OUTPUT: ${PROJECT.systemAcKw} kW AC`,
      ],
    },
    {
      title: 'BATTERY WARNING LABEL',
      nec: 'NEC 706.30',
      x: 550, y: 305, w: 500, h: 130,
      borderColor: '#cc0000',
      lines: [
        'WARNING: BATTERY ENERGY STORAGE SYSTEM',
        '',
        `BATTERY: (${PROJECT.batteryCount}) ${PROJECT.batteryModel}`,
        `TOTAL STORAGE: ${PROJECT.totalStorageKwh} kWh, LFP CHEMISTRY`,
        `NOMINAL VOLTAGE: 51.2V DC PER BATTERY`,
        '',
        'CAUTION: CHEMICAL HAZARD — LITHIUM IRON PHOSPHATE BATTERIES',
        'CAUTION: ELECTRICAL SHOCK HAZARD — DC CIRCUITS MAY BE ENERGIZED',
        'DO NOT OPEN BATTERY ENCLOSURE — NO USER-SERVICEABLE PARTS',
      ],
    },
    {
      title: 'RAPID SHUTDOWN LABEL',
      nec: 'NEC 690.12',
      x: 550, y: 450, w: 500, h: 110,
      borderColor: '#cc0000',
      lines: [
        'RAPID SHUTDOWN SYSTEM',
        '',
        'THIS SYSTEM IS EQUIPPED WITH MODULE-LEVEL RAPID SHUTDOWN',
        'COMPLIANT WITH NEC 690.12(B)(2)',
        '',
        'TO INITIATE RAPID SHUTDOWN: TURN OFF AC DISCONNECT',
        'ARRAY VOLTAGE WILL REDUCE TO <30V WITHIN 30 SECONDS',
      ],
    },
  ]

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      <text x="25" y="35" fontSize="14" fontWeight="bold" fill="#111">PCS LABELS — NEC REQUIRED EQUIPMENT LABELS</text>
      <text x="25" y="50" fontSize="8" fill="#555">ALL LABELS SHALL BE PERMANENT, WEATHER-RESISTANT, AND INSTALLED AT POINT OF APPLICATION</text>

      {labels.map((label, i) => (
        <g key={i}>
          {/* Label border */}
          <rect x={label.x} y={label.y} width={label.w} height={label.h}
            fill="none" stroke={label.borderColor || '#111'} strokeWidth={label.borderColor ? 2 : 1} />
          {/* Title bar */}
          <rect x={label.x} y={label.y} width={label.w} height="18"
            fill={label.borderColor || '#111'} />
          <text x={label.x + label.w / 2} y={label.y + 13} fontSize="8" fontWeight="bold"
            fill="white" textAnchor="middle">{label.title}</text>
          <text x={label.x + label.w - 5} y={label.y + 13} fontSize="5.5"
            fill="#ddd" textAnchor="end">{label.nec}</text>
          {/* Content lines */}
          {label.lines.map((line, j) => (
            <text key={j} x={label.x + 8} y={label.y + 33 + j * 10.5}
              fontSize={j === 0 ? '7' : '6'}
              fontWeight={j === 0 ? 'bold' : 'normal'}
              fill={line.startsWith('CAUTION') || line.startsWith('WARNING') || line.startsWith('DO NOT') ? '#cc0000' : '#333'}>
              {line}
            </text>
          ))}
        </g>
      ))}

      <TitleBlock sheetName="PCS LABELS" sheetNumber="PV-5.1" />
    </svg>
  )
}

// ── SHEET PV-6: WIRING CALCULATIONS ─────────────────────────────────────────

function SheetPV6() {
  // Wire resistance per 1000ft (ohms) for copper at 75C
  const wireResistance: Record<string, number> = {
    '#14': 3.14, '#12': 1.98, '#10': 1.24, '#8': 0.778, '#6': 0.491,
    '#4': 0.308, '#3': 0.245, '#2': 0.194, '#1': 0.154, '1/0': 0.122,
  }

  // String calculations
  const strings = PROJECT.strings.map((s, i) => {
    const voc = s.modules * PROJECT.panelVoc
    const vocCold = s.modules * VOC_COLD
    const vmp = s.modules * PROJECT.panelVmp
    const isc = PROJECT.panelIsc
    const runFt = 100 // assumed
    const wireSize = '#10'
    const conductor125 = isc * 1.25
    const vDrop = (2 * runFt * isc * wireResistance[wireSize]) / 1000
    const vDropPct = (vDrop / vmp) * 100
    return {
      id: i + 1,
      modules: s.modules,
      mppt: s.mppt,
      voc: voc.toFixed(1),
      vocCold: vocCold.toFixed(1),
      vmp: vmp.toFixed(1),
      isc: isc.toFixed(1),
      conductor125: conductor125.toFixed(1),
      wireSize,
      conduit: '3/4" EMT',
      runFt,
      vDrop: vDrop.toFixed(2),
      vDropPct: vDropPct.toFixed(2),
      status: vDropPct < 2 ? 'PASS' : 'FAIL',
    }
  })

  // AC calculation
  const acCurrentPerInv = PROJECT.inverterAcPower * 1000 / 240
  const acCurrent125 = acCurrentPerInv * 1.25
  const acRunFt = 50
  const acVDrop = (2 * acRunFt * acCurrentPerInv * wireResistance['#4']) / 1000
  const acVDropPct = (acVDrop / 240) * 100

  // Battery wiring — VPP discharge at 23kW continuous
  const battCurrentPerStack = 23000 / 51.2 // VPP discharge: 23kW / 51.2V = ~449A
  const battCurrent125 = battCurrentPerStack * 1.25

  // OCPD
  const stringFuseCalc = PROJECT.panelIsc * 1.56
  const stringFuseSize = Math.ceil(stringFuseCalc / 5) * 5 // next 5A increment

  // Grounding
  const tableY = 90
  const rowH = 16
  const colX = [25, 65, 115, 165, 220, 290, 350, 420, 495, 560, 640, 710, 775]

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      <text x="25" y="35" fontSize="14" fontWeight="bold" fill="#111">WIRING CALCULATIONS</text>
      <text x="25" y="50" fontSize="8" fill="#555">ALL CONDUCTORS COPPER (CU), RATED 75°C MINIMUM. VOLTAGE DROP LIMIT: 2% DC, 3% AC.</text>

      {/* ── DC STRING WIRING TABLE ── */}
      <text x="25" y="75" fontSize="10" fontWeight="bold" fill="#111">DC STRING WIRE SIZING (NEC 690.8)</text>

      {/* Table header */}
      <rect x="25" y={tableY} width="840" height={rowH} fill="#111" />
      {['STRING', 'MODULES', 'Voc (V)', 'Voc COLD', 'Vmp (V)', 'Isc (A)', '125% Isc', 'WIRE', 'CONDUIT', 'RUN (ft)', 'V DROP', '% DROP', 'STATUS'].map((h, i) => (
        <text key={i} x={colX[i]} y={tableY + 11} fontSize="5.5" fontWeight="bold" fill="white">{h}</text>
      ))}

      {/* Table rows */}
      {strings.map((s, i) => {
        const ry = tableY + rowH + i * rowH
        return (
          <g key={i}>
            <rect x="25" y={ry} width="840" height={rowH} fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ddd" strokeWidth="0.5" />
            {[
              `S${s.id} (MPPT ${s.mppt})`, String(s.modules), s.voc, s.vocCold, s.vmp,
              s.isc, s.conductor125, s.wireSize + ' AWG CU', s.conduit,
              String(s.runFt), s.vDrop + 'V', s.vDropPct + '%', s.status,
            ].map((val, j) => (
              <text key={j} x={colX[j]} y={ry + 11} fontSize="5.5"
                fill={val === 'FAIL' ? '#cc0000' : val === 'PASS' ? '#006600' : '#333'}>
                {val}
              </text>
            ))}
          </g>
        )
      })}

      {/* ── AC WIRING TABLE ── */}
      {(() => {
        const acY = tableY + rowH + strings.length * rowH + 30
        return (
          <g>
            <text x="25" y={acY} fontSize="10" fontWeight="bold" fill="#111">INVERTER TO PANEL — AC WIRE SIZING (NEC 310.16)</text>

            <rect x="25" y={acY + 15} width="840" height={rowH} fill="#111" />
            {['CIRCUIT', 'VOLTAGE', 'POWER', 'CURRENT', '125%', 'WIRE', 'CONDUIT', 'RUN (ft)', 'V DROP', '% DROP', 'STATUS'].map((h, i) => (
              <text key={i} x={[25, 100, 175, 265, 340, 420, 530, 580, 640, 710, 775][i]} y={acY + 26} fontSize="5.5" fontWeight="bold" fill="white">{h}</text>
            ))}

            {PROJECT.strings.length > 0 && (
              <>
                <rect x="25" y={acY + 15 + rowH} width="840" height={rowH} fill="#f9f9f9" stroke="#ddd" strokeWidth="0.5" />
                {[
                  `INV → PANEL (x${PROJECT.inverterCount})`, '240V AC', `${PROJECT.inverterAcPower} kW`,
                  `${acCurrentPerInv.toFixed(1)}A`, `${acCurrent125.toFixed(1)}A`,
                  '#4 AWG CU THWN-2', '1-1/4" EMT', `${acRunFt}`,
                  `${acVDrop.toFixed(2)}V`, `${acVDropPct.toFixed(2)}%`,
                  acVDropPct < 3 ? 'PASS' : 'FAIL',
                ].map((val, j) => (
                  <text key={j} x={[25, 100, 175, 265, 340, 420, 530, 580, 640, 710, 775][j]}
                    y={acY + 15 + rowH + 11} fontSize="5.5"
                    fill={val === 'FAIL' ? '#cc0000' : val === 'PASS' ? '#006600' : '#333'}>{val}</text>
                ))}
              </>
            )}

            {/* ── BATTERY WIRING ── */}
            <text x="25" y={acY + 75} fontSize="10" fontWeight="bold" fill="#111">BATTERY WIRE SIZING (NEC 706)</text>
            <rect x="25" y={acY + 90} width="840" height={rowH} fill="#111" />
            {['CIRCUIT', 'VOLTAGE', 'CAPACITY', 'MAX CURRENT', '125%', 'WIRE', 'CONDUIT'].map((h, i) => (
              <text key={i} x={[25, 150, 265, 370, 470, 560, 700][i]} y={acY + 101} fontSize="5.5" fontWeight="bold" fill="white">{h}</text>
            ))}
            <rect x="25" y={acY + 90 + rowH} width="840" height={rowH} fill="#f9f9f9" stroke="#ddd" strokeWidth="0.5" />
            {[
              `BATT → INV (${PROJECT.batteryCount}x ${PROJECT.batteryModel})`,
              '51.2V DC NOM',
              `${PROJECT.totalStorageKwh} kWh TOTAL`,
              `${battCurrentPerStack.toFixed(1)}A`,
              `${battCurrent125.toFixed(1)}A`,
              '#4/0 AWG CU THWN-2',
              '2" EMT',
            ].map((val, j) => (
              <text key={j} x={[25, 150, 265, 370, 470, 560, 700][j]}
                y={acY + 90 + rowH + 11} fontSize="5.5" fill="#333">{val}</text>
            ))}

            {/* ── OCPD SIZING ── */}
            <text x="25" y={acY + 155} fontSize="10" fontWeight="bold" fill="#111">OVERCURRENT PROTECTION DEVICE (OCPD) SIZING (NEC 690.9)</text>
            <rect x="25" y={acY + 170} width="840" height={rowH} fill="#111" />
            {['DEVICE', 'CALCULATION', 'RESULT', 'STANDARD SIZE', 'RATING'].map((h, i) => (
              <text key={i} x={[25, 200, 420, 560, 700][i]} y={acY + 181} fontSize="5.5" fontWeight="bold" fill="white">{h}</text>
            ))}
            {[
              ['STRING FUSE', `Isc × 1.56 = ${PROJECT.panelIsc} × 1.56`, `${stringFuseCalc.toFixed(1)}A`, `${stringFuseSize}A`, '600V DC'],
              ['PV BREAKER (per INV)', 'Per inverter AC output rating', `${acCurrent125.toFixed(1)}A`, '100A', '240V AC'],
              ['MAIN BREAKER', 'Per system total AC capacity', `${(acCurrent125 * PROJECT.inverterCount).toFixed(1)}A`, '200A', '240V AC'],
            ].map((row, i) => (
              <g key={i}>
                <rect x="25" y={acY + 170 + rowH + i * rowH} width="840" height={rowH}
                  fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ddd" strokeWidth="0.5" />
                {row.map((val, j) => (
                  <text key={j} x={[25, 200, 420, 560, 700][j]}
                    y={acY + 170 + rowH + i * rowH + 11} fontSize="5.5" fill="#333">{val}</text>
                ))}
              </g>
            ))}

            {/* ── GROUNDING ── */}
            <text x="25" y={acY + 240} fontSize="10" fontWeight="bold" fill="#111">GROUNDING CONDUCTOR SIZING (NEC 250)</text>
            <rect x="25" y={acY + 255} width="840" height={rowH} fill="#111" />
            {['CONDUCTOR', 'SIZE', 'REFERENCE', 'NOTES'].map((h, i) => (
              <text key={i} x={[25, 300, 480, 650][i]} y={acY + 266} fontSize="5.5" fontWeight="bold" fill="white">{h}</text>
            ))}
            {[
              ['EQUIPMENT GROUNDING (EGC)', '#6 AWG BARE CU', 'NEC 250.122', 'SIZED PER LARGEST OCPD'],
              ['GROUNDING ELECTRODE (GEC)', '#6 AWG BARE CU', 'NEC 250.66', 'TO EXISTING GROUNDING ELECTRODE'],
              ['MODULE FRAME BONDING', '#6 AWG BARE CU', 'NEC 690.43', 'VIA RACKING GROUNDING LUGS'],
              ['DC SYSTEM GROUNDING', '#10 AWG CU', 'NEC 690.41', 'EQUIPMENT GROUNDING ONLY (UNGROUNDED)'],
            ].map((row, i) => (
              <g key={i}>
                <rect x="25" y={acY + 255 + rowH + i * rowH} width="840" height={rowH}
                  fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ddd" strokeWidth="0.5" />
                {row.map((val, j) => (
                  <text key={j} x={[25, 300, 480, 650][j]}
                    y={acY + 255 + rowH + i * rowH + 11} fontSize="5.5" fill="#333">{val}</text>
                ))}
              </g>
            ))}

            {/* Voltage drop formula */}
            <text x="25" y={acY + 345} fontSize="7" fontWeight="bold" fill="#111">VOLTAGE DROP FORMULA:</text>
            <text x="25" y={acY + 360} fontSize="6.5" fill="#333">
              V_drop = 2 × L × I × R / 1000 where L = length (ft), I = current (A), R = resistance (ohms/1000ft)
            </text>
            <text x="25" y={acY + 373} fontSize="6.5" fill="#333">
              DC circuits: V_drop must be &lt; 2% of Vmp | AC circuits: V_drop must be &lt; 3% of nominal voltage
            </text>
          </g>
        )
      })()}

      <TitleBlock sheetName="WIRING CALCULATIONS" sheetNumber="PV-6" />
    </svg>
  )
}

// ── SHEET PV-7: WARNING LABELS ──────────────────────────────────────────────

function SheetPV7() {
  const maxVocCold = Math.max(...STRING_VOCS).toFixed(1)
  const totalAcAmps = (PROJECT.inverterAcPower * 1000 / 240).toFixed(1)

  interface WarningLabel {
    title: string
    nec: string
    x: number
    y: number
    w: number
    h: number
    lines: string[]
    color: 'red' | 'yellow' | 'black'
  }

  const labels: WarningLabel[] = [
    {
      title: 'SOLAR PV SYSTEM CONNECTED',
      nec: 'NEC 690.54',
      x: 25, y: 70, w: 320, h: 125,
      color: 'red',
      lines: [
        'WARNING',
        '',
        'THIS ELECTRICAL PANEL IS SUPPLIED BY',
        'A SOLAR PHOTOVOLTAIC SYSTEM.',
        '',
        `SYSTEM SIZE: ${PROJECT.systemDcKw.toFixed(2)} kW DC`,
        `AC OUTPUT: ${PROJECT.systemAcKw} kW`,
        `BATTERY: ${PROJECT.totalStorageKwh} kWh`,
      ],
    },
    {
      title: 'ELECTRIC SHOCK HAZARD',
      nec: 'NEC 690.31(G)',
      x: 365, y: 70, w: 320, h: 125,
      color: 'red',
      lines: [
        'DANGER',
        '',
        'ELECTRIC SHOCK HAZARD',
        'DO NOT TOUCH TERMINALS.',
        'TERMINALS ON BOTH THE LINE',
        'AND LOAD SIDES MAY BE',
        'ENERGIZED IN THE OPEN POSITION.',
      ],
    },
    {
      title: 'DUAL POWER SOURCE',
      nec: 'NEC 705.12',

      x: 705, y: 70, w: 320, h: 125,
      color: 'yellow',
      lines: [
        'CAUTION',
        '',
        'DUAL POWER SOURCE',
        'THIS EQUIPMENT IS SUPPLIED BY',
        'TWO POWER SOURCES: UTILITY GRID',
        'AND PHOTOVOLTAIC SYSTEM.',
        'DISCONNECT BOTH BEFORE SERVICING.',
      ],
    },
    {
      title: 'PHOTOVOLTAIC POWER SOURCE',
      nec: 'NEC 690.53',
      x: 25, y: 215, w: 320, h: 140,
      color: 'black',
      lines: [
        'PHOTOVOLTAIC POWER SOURCE',
        '',
        `MAX SYSTEM VOLTAGE (Voc COLD): ${maxVocCold}V DC`,
        `MAX CIRCUIT CURRENT (Isc): ${PROJECT.panelIsc}A`,
        `RATED OUTPUT: ${PROJECT.systemDcKw.toFixed(2)} kW DC`,
        '',
        `MODULES: (${PROJECT.panelCount}) ${PROJECT.panelModel}`,
        `STRINGS: 5×9 + 1×8 MODULES`,
        `Voc PER MODULE: ${PROJECT.panelVoc}V`,
      ],
    },
    {
      title: 'BATTERY STORAGE WARNING',
      nec: 'NEC 706.30',
      x: 365, y: 215, w: 320, h: 140,
      color: 'red',
      lines: [
        'WARNING: BATTERY STORAGE SYSTEM',
        '',
        'CHEMICAL HAZARD — LITHIUM IRON PHOSPHATE',
        'ELECTRICAL SHOCK HAZARD',
        '',
        `(${PROJECT.batteryCount}) ${PROJECT.batteryModel}`,
        `TOTAL: ${PROJECT.totalStorageKwh} kWh`,
        'DO NOT EXPOSE TO FIRE OR EXTREME HEAT',
        'DO NOT SHORT CIRCUIT BATTERY TERMINALS',
      ],
    },
    {
      title: 'RAPID SHUTDOWN SWITCH',
      nec: 'NEC 690.12',
      x: 705, y: 215, w: 320, h: 140,
      color: 'red',
      lines: [
        'RAPID SHUTDOWN',
        '',
        'PHOTOVOLTAIC SYSTEM EQUIPPED WITH',
        'RAPID SHUTDOWN PER NEC 690.12',
        '',
        'TO SHUT DOWN PV SYSTEM:',
        '1. OPEN AC DISCONNECT',
        '2. ARRAY WILL DE-ENERGIZE IN 30 SEC',
        'CONTROLLED TO <30V WITHIN ARRAY',
      ],
    },
    {
      title: 'AC DISCONNECT',
      nec: 'NEC 690.14',
      x: 25, y: 375, w: 320, h: 110,
      color: 'yellow',
      lines: [
        'AC DISCONNECT',
        '',
        'SOLAR PHOTOVOLTAIC AC DISCONNECT',
        `VOLTAGE: 240V AC, SINGLE PHASE`,
        `CURRENT: ${totalAcAmps}A PER INVERTER`,
        'TURN OFF BEFORE SERVICING',
        'EQUIPMENT ON EITHER SIDE',
      ],
    },
    {
      title: 'POINT OF INTERCONNECTION',
      nec: 'NEC 705.10',
      x: 365, y: 375, w: 320, h: 110,
      color: 'black',
      lines: [
        'POINT OF INTERCONNECTION',
        '',
        `UTILITY: ${PROJECT.utility}`,
        `METER: ${PROJECT.meter}`,
        `SYSTEM: ${PROJECT.systemDcKw.toFixed(2)} kW DC / ${PROJECT.systemAcKw} kW AC`,
        'INTERCONNECTION TYPE: UTILITY INTERACTIVE',
        'WITH BATTERY BACKUP',
      ],
    },
  ]

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      <text x="25" y="35" fontSize="14" fontWeight="bold" fill="#111">WARNING LABELS — NEC 690 / 705 / 706</text>
      <text x="25" y="50" fontSize="8" fill="#555">ALL LABELS SHALL BE PERMANENT, UV-RESISTANT, AND AFFIXED WITH ADHESIVE OR MECHANICAL FASTENER</text>

      {labels.map((label, i) => {
        const borderColor = label.color === 'red' ? '#cc0000' : label.color === 'yellow' ? '#cc9900' : '#111'
        const headerBg = label.color === 'red' ? '#cc0000' : label.color === 'yellow' ? '#cc9900' : '#111'
        const headerFg = 'white'

        return (
          <g key={i}>
            {/* Outer warning border */}
            <rect x={label.x - 3} y={label.y - 3} width={label.w + 6} height={label.h + 6}
              fill="none" stroke={borderColor} strokeWidth="3" />
            {/* Inner box */}
            <rect x={label.x} y={label.y} width={label.w} height={label.h}
              fill="white" stroke={borderColor} strokeWidth="1.5" />
            {/* Header */}
            <rect x={label.x} y={label.y} width={label.w} height="20" fill={headerBg} />
            <text x={label.x + label.w / 2} y={label.y + 14} fontSize="8" fontWeight="bold"
              fill={headerFg} textAnchor="middle">{label.title}</text>
            <text x={label.x + label.w - 5} y={label.y + 14} fontSize="5"
              fill="#eee" textAnchor="end">{label.nec}</text>
            {/* Content */}
            {label.lines.map((line, j) => (
              <text key={j} x={label.x + 10} y={label.y + 35 + j * 11}
                fontSize={j === 0 ? '8' : '6'}
                fontWeight={j === 0 ? 'bold' : 'normal'}
                fill={
                  (j === 0 && (line === 'WARNING' || line === 'DANGER')) ? '#cc0000' :
                  (j === 0 && line === 'CAUTION') ? '#cc9900' : '#333'
                }>
                {line}
              </text>
            ))}
          </g>
        )
      })}

      {/* Installation note */}
      <text x="25" y="510" fontSize="7" fontWeight="bold" fill="#111">INSTALLATION NOTES:</text>
      <text x="25" y="525" fontSize="6" fill="#333">1. ALL LABELS SHALL BE CLEARLY VISIBLE AND NOT OBSTRUCTED BY EQUIPMENT OR WIRING.</text>
      <text x="25" y="537" fontSize="6" fill="#333">2. LABELS SHALL BE INSTALLED AT EACH DISCONNECT MEANS, JUNCTION BOX, AND POINT OF CONNECTION.</text>
      <text x="25" y="549" fontSize="6" fill="#333">3. WARNING LABELS WITH RED BORDERS SHALL USE REFLECTIVE OR HIGH-VISIBILITY MATERIALS.</text>
      <text x="25" y="561" fontSize="6" fill="#333">4. ALL LABELS SHALL BE LEGIBLE FROM A DISTANCE OF AT LEAST 3 FEET.</text>

      <TitleBlock sheetName="WARNING LABELS" sheetNumber="PV-7" />
    </svg>
  )
}

// ── SHEET PV-7.1: PLACARDS ──────────────────────────────────────────────────

function SheetPV71() {
  interface Placard {
    title: string
    x: number
    y: number
    w: number
    h: number
    rows: [string, string][]
  }

  const placards: Placard[] = [
    {
      title: 'INVERTER PLACARD',
      x: 25, y: 70, w: 500, h: 190,
      rows: [
        ['EQUIPMENT', `(${PROJECT.inverterCount}) ${PROJECT.inverterModel}`],
        ['MANUFACTURER', 'DURACELL / HUBBLE TECHNOLOGY'],
        ['TYPE', 'HYBRID INVERTER (PV + ESS)'],
        ['RATED AC OUTPUT', `${PROJECT.inverterAcPower} kW PER UNIT (${PROJECT.systemAcKw} kW TOTAL)`],
        ['AC VOLTAGE', '240/120V SPLIT PHASE'],
        ['MAX PV INPUT', '19,500W PER UNIT'],
        ['MAX INPUT VOLTAGE', '500V DC'],
        ['MPPT RANGE', '125V — 425V DC'],
        ['MPPT CHANNELS', '3 PER UNIT, 2 STRINGS EACH'],
        ['LISTING', 'UL 1741SA, IEEE 1547, FCC PART 15'],
        ['ENCLOSURE', 'NEMA 3R, OUTDOOR RATED'],
        ['INSTALLATION', 'WALL-MOUNTED, ACCESSIBLE'],
      ],
    },
    {
      title: 'BATTERY PLACARD',
      x: 550, y: 70, w: 500, h: 190,
      rows: [
        ['EQUIPMENT', `(${PROJECT.batteryCount}) ${PROJECT.batteryModel}`],
        ['MANUFACTURER', 'DURACELL / HUBBLE TECHNOLOGY'],
        ['CHEMISTRY', 'LITHIUM IRON PHOSPHATE (LiFePO4 / LFP)'],
        ['CAPACITY PER UNIT', `${PROJECT.batteryCapacity} kWh`],
        ['TOTAL CAPACITY', `${PROJECT.totalStorageKwh} kWh`],
        ['NOMINAL VOLTAGE', '51.2V DC'],
        ['CONFIGURATION', `${PROJECT.batteryCount / 2} BATTERIES PER INVERTER`],
        ['STACKING', `${PROJECT.batteryCount / 2} PER STACK (2 STACKS)`],
        ['LISTING', 'UL 9540, UL 9540A'],
        ['ENCLOSURE', 'NEMA 3R, FLOOR/WALL MOUNT'],
        ['THERMAL PROTECTION', 'INTEGRATED BMS'],
        ['INSTALLATION', 'PER MANUFACTURER SPEC, MIN CLEARANCES REQUIRED'],
      ],
    },
    {
      title: 'PV MODULE PLACARD',
      x: 25, y: 280, w: 500, h: 165,
      rows: [
        ['MODULE', `${PROJECT.panelModel}`],
        ['QUANTITY', `${PROJECT.panelCount} MODULES`],
        ['WATTAGE', `${PROJECT.panelWattage}W STC`],
        ['Voc', `${PROJECT.panelVoc}V`],
        ['Vmp', `${PROJECT.panelVmp}V`],
        ['Isc', `${PROJECT.panelIsc}A`],
        ['Imp', `${PROJECT.panelImp}A`],
        ['CONFIGURATION', '5 STRINGS × 9 + 1 STRING × 8'],
        ['LISTING', 'UL 61730 / IEC 61215'],
        ['RACKING', PROJECT.rackingModel],
      ],
    },
    {
      title: 'SYSTEM PLACARD',
      x: 550, y: 280, w: 500, h: 165,
      rows: [
        ['SYSTEM DC CAPACITY', `${PROJECT.systemDcKw.toFixed(2)} kW DC`],
        ['SYSTEM AC CAPACITY', `${PROJECT.systemAcKw} kW AC`],
        ['ENERGY STORAGE', `${PROJECT.totalStorageKwh} kWh`],
        ['PV MODULES', `(${PROJECT.panelCount}) ${PROJECT.panelModel}`],
        ['INVERTERS', `(${PROJECT.inverterCount}) ${PROJECT.inverterModel}`],
        ['BATTERIES', `(${PROJECT.batteryCount}) ${PROJECT.batteryModel}`],
        ['RACKING', PROJECT.rackingModel],
        ['UTILITY', PROJECT.utility],
        ['INTERCONNECTION', 'LINE SIDE TAP / UTILITY INTERACTIVE'],
        ['AHJ', 'CITY OF BAYTOWN, TX'],
      ],
    },
    {
      title: 'EMERGENCY PLACARD',
      x: 25, y: 460, w: 500, h: 145,
      rows: [
        ['RAPID SHUTDOWN', 'AC DISCONNECT LOCATION: ADJACENT TO INVERTERS'],
        ['UTILITY DISCONNECT', 'MAIN BREAKER AT ELECTRICAL PANEL'],
        ['AC DISCONNECT', 'WALL-MOUNTED ADJACENT TO INVERTER(S)'],
        ['DC DISCONNECT', 'INTEGRATED IN INVERTER'],
        ['BATTERY DISCONNECT', 'INTERNAL BMS WITH MANUAL ISOLATION'],
        ['FIRE DEPT CONTACT', '911 / BAYTOWN FIRE DEPARTMENT'],
        ['SOLAR CONTRACTOR', `${PROJECT.contractor}: ${PROJECT.contractorPhone}`],
        ['FIRST RESPONDERS', 'DO NOT CUT OR DAMAGE PV WIRING; DC ENERGIZED WHEN SUN IS UP'],
      ],
    },
  ]

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      <text x="25" y="35" fontSize="14" fontWeight="bold" fill="#111">EQUIPMENT IDENTIFICATION PLACARDS</text>
      <text x="25" y="50" fontSize="8" fill="#555">PLACARDS SHALL BE INSTALLED ON OR ADJACENT TO EACH PIECE OF EQUIPMENT</text>

      {placards.map((placard, pi) => (
        <g key={pi}>
          <rect x={placard.x} y={placard.y} width={placard.w} height={placard.h}
            fill="white" stroke="#111" strokeWidth="1.5" />
          <rect x={placard.x} y={placard.y} width={placard.w} height="20" fill="#111" />
          <text x={placard.x + placard.w / 2} y={placard.y + 14} fontSize="8" fontWeight="bold"
            fill="white" textAnchor="middle">{placard.title}</text>

          {placard.rows.map(([label, value], ri) => {
            const ry = placard.y + 35 + ri * 13
            return (
              <g key={ri}>
                {/* Alternating row background */}
                <rect x={placard.x + 1} y={ry - 10} width={placard.w - 2} height="13"
                  fill={ri % 2 === 0 ? '#f5f5f5' : 'white'} />
                <text x={placard.x + 8} y={ry} fontSize="5.5" fontWeight="bold" fill="#111">{label}</text>
                <text x={placard.x + 150} y={ry} fontSize="5.5" fill="#333">{value}</text>
              </g>
            )
          })}
        </g>
      ))}

      <TitleBlock sheetName="EQUIPMENT PLACARDS" sheetNumber="PV-7.1" />
    </svg>
  )
}

// ── PRINT HANDLER ───────────────────────────────────────────────────────────

function handlePrintAll() {
  const sheets = document.querySelectorAll('.plan-sheet svg')
  if (!sheets.length) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) { alert('Please allow popups to print.'); return }

  let svgContent = ''
  sheets.forEach((svg) => {
    svgContent += `<div class="sheet">${svg.outerHTML}</div>`
  })

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Plan Set — ${PROJECT.id} ${PROJECT.owner}</title>
  <style>
    @page {
      size: 11in 8.5in landscape;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; }
    .sheet {
      width: 11in;
      height: 8.5in;
      page-break-after: always;
      page-break-inside: avoid;
      overflow: hidden;
    }
    .sheet:last-child { page-break-after: auto; }
    .sheet svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    @media print {
      .sheet { break-after: page; break-inside: avoid; }
      .sheet:last-child { break-after: auto; }
    }
  </style>
</head>
<body>${svgContent}</body>
</html>`)

  printWindow.document.close()
  setTimeout(() => printWindow.print(), 500)
}

// ── PAGE COMPONENT ──────────────────────────────────────────────────────────

export default function PlanSetPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <Nav active="Redesign" />

      <div className="max-w-[1200px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Plan Set: {PROJECT.id} {PROJECT.owner}
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {PROJECT.address} &mdash; {PROJECT.systemDcKw.toFixed(2)} kW DC / {PROJECT.totalStorageKwh} kWh ESS
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/redesign"
              className="px-4 py-2 text-sm rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
              Back to Redesign
            </a>
            <button
              onClick={handlePrintAll}
              className="px-5 py-2 text-sm font-medium rounded-md bg-green-700 hover:bg-green-600 text-white transition-colors">
              Download as PDF
            </button>
            <span className="text-xs text-gray-500">Select &quot;Save as PDF&quot; in the print dialog</span>
          </div>
        </div>

        {/* Sheets */}
        <div className="plan-sheet space-y-8">
          {/* PV-1 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-1</span>
              <span className="text-sm text-gray-400">Cover Page &amp; General Notes</span>
            </div>
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <SheetPV1 />
            </div>
          </div>

          {/* PV-5 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-5</span>
              <span className="text-sm text-gray-400">Single Line Diagram</span>
            </div>
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <SheetPV5 />
            </div>
          </div>

          {/* PV-5.1 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-5.1</span>
              <span className="text-sm text-gray-400">PCS Labels</span>
            </div>
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <SheetPV51 />
            </div>
          </div>

          {/* PV-6 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-6</span>
              <span className="text-sm text-gray-400">Wiring Calculations</span>
            </div>
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <SheetPV6 />
            </div>
          </div>

          {/* PV-7 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-7</span>
              <span className="text-sm text-gray-400">Warning Labels</span>
            </div>
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <SheetPV7 />
            </div>
          </div>

          {/* PV-7.1 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-7.1</span>
              <span className="text-sm text-gray-400">Equipment Placards</span>
            </div>
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <SheetPV71 />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 mb-4 text-center text-xs text-gray-600">
          Generated by NOVA CRM &mdash; {today()} &mdash; For PE Review Only
        </div>
      </div>
    </div>
  )
}
