'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Nav } from '@/components/Nav'
import { calculateSldLayout } from '@/lib/sld-layout'
import { SldRenderer } from '@/components/SldRenderer'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { loadProjectById, searchProjects } from '@/lib/api'
import { buildPlansetData, DURACELL_DEFAULTS, MICROGRID_CONTRACTOR } from '@/lib/planset-types'
import type { PlansetData, PlansetOverrides, PlansetString } from '@/lib/planset-types'
import type { Project } from '@/types/database'
import { Search, ChevronDown, ChevronUp, X, Loader2, FileText } from 'lucide-react'

// ── AUTO-STRING DISTRIBUTION ────────────────────────────────────────────────

function autoDistributeStrings(panelCount: number, vocCorrected: number, panelVmp: number, panelImp: number, inverterCount: number, mpptsPerInverter: number, stringsPerMppt: number, maxVoc: number): PlansetString[] {
  const totalInputs = inverterCount * mpptsPerInverter * stringsPerMppt
  const maxPerString = Math.floor(maxVoc / vocCorrected)
  const neededStrings = Math.min(Math.ceil(panelCount / (maxPerString || 1)), totalInputs)
  if (neededStrings <= 0) return []
  const baseSize = Math.floor(panelCount / neededStrings)
  const extra = panelCount % neededStrings

  const strings: PlansetString[] = []
  for (let i = 0; i < neededStrings; i++) {
    const modules = baseSize + (i < extra ? 1 : 0)
    strings.push({
      id: i + 1,
      mppt: Math.floor(i / stringsPerMppt) + 1,
      modules,
      roofFace: 1,
      vocCold: parseFloat((modules * vocCorrected).toFixed(1)),
      vmpNominal: parseFloat((modules * panelVmp).toFixed(1)),
      current: panelImp,
    })
  }
  return strings
}

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

function TitleBlock({ sheetName, sheetNumber, data }: { sheetName: string; sheetNumber: string; data: PlansetData }) {
  const bx = SHEET_W - 330 // block X
  const by = SHEET_H - 130 // block Y
  const bw = 310
  const bh = 118
  const stampY = SHEET_H - 220 // Engineer's stamp box above title block
  const stampH = 80
  return (
    <g>
      {/* Engineer's Stamp box */}
      <rect x={bx} y={stampY} width={bw} height={stampH} fill="white" stroke="#111" strokeWidth="1.5" />
      <text x={bx + bw / 2} y={stampY + stampH / 2 + 3} fontSize="7" fill="#999" textAnchor="middle">ENGINEER&apos;S STAMP</text>
      {/* Outer box */}
      <rect x={bx} y={by} width={bw} height={bh} fill="white" stroke="#111" strokeWidth="1.5" />
      {/* Horizontal dividers */}
      <line x1={bx} y1={by + 30} x2={bx + bw} y2={by + 30} stroke="#111" strokeWidth="0.5" />
      <line x1={bx} y1={by + 55} x2={bx + bw} y2={by + 55} stroke="#111" strokeWidth="0.5" />
      <line x1={bx} y1={by + 80} x2={bx + bw} y2={by + 80} stroke="#111" strokeWidth="0.5" />
      <line x1={bx} y1={by + 98} x2={bx + bw} y2={by + 98} stroke="#111" strokeWidth="0.5" />
      {/* Vertical divider */}
      <line x1={bx + 155} y1={by + 55} x2={bx + 155} y2={by + 80} stroke="#111" strokeWidth="0.5" />
      {/* Contractor */}
      <text x={bx + 5} y={by + 12} fontSize="7" fontWeight="bold" fill="#111">{data.contractor.name}</text>
      <text x={bx + 5} y={by + 22} fontSize="6.5" fill="#333">{data.contractor.address}, {data.contractor.city}</text>
      <text x={bx + 200} y={by + 12} fontSize="6.5" fill="#333">Ph: {data.contractor.phone}</text>
      <text x={bx + 200} y={by + 22} fontSize="6.5" fill="#333">Lic# {data.contractor.license}</text>
      {/* Project info */}
      <text x={bx + 5} y={by + 42} fontSize="6.5" fontWeight="bold" fill="#111">{data.projectId} {data.owner}</text>
      <text x={bx + 5} y={by + 52} fontSize="6.5" fill="#333">{data.address}</text>
      {/* Drawn info */}
      <text x={bx + 5} y={by + 68} fontSize="6.5" fill="#333">DRAWN BY: MicroGRID</text>
      <text x={bx + 5} y={by + 76} fontSize="6.5" fill="#333">DATE: {data.drawnDate}</text>
      {/* Sheet name */}
      <text x={bx + 5} y={by + 92} fontSize="8" fontWeight="bold" fill="#111">{sheetName}</text>
      {/* Sheet number */}
      <text x={bx + 5} y={by + 112} fontSize="14" fontWeight="bold" fill="#111">{sheetNumber}</text>
      <text x={bx + 65} y={by + 112} fontSize="7" fill="#333">of {data.sheetTotal}</text>
    </g>
  )
}

// ── SHEET PV-1: COVER PAGE ──────────────────────────────────────────────────

function SheetPV1({ data }: { data: PlansetData }) {
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
    ['PV-2', 'PROJECT DATA'],
    ['PV-5', 'SINGLE LINE DIAGRAM'],
    ['PV-5.1', 'PCS LABELS'],
    ['PV-6', 'WIRING CALCULATIONS'],
    ['PV-7', 'WARNING LABELS'],
    ['PV-7.1', 'EQUIPMENT PLACARDS'],
    ['PV-8', 'CONDUCTOR SCHEDULE & BOM'],
  ]

  // Build string config summary
  const stringGroups: Record<number, number> = {}
  for (const s of data.strings) {
    stringGroups[s.modules] = (stringGroups[s.modules] || 0) + 1
  }
  const storiesLabel = data.stories === 1 ? 'ONE' : String(data.stories)

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      {/* ── TITLE ── */}
      <text x="25" y="35" fontSize="14" fontWeight="bold" fill="#111">
        ROOF INSTALLATION OF {data.systemDcKw.toFixed(2)} KW DC PHOTOVOLTAIC SYSTEM
      </text>
      <text x="25" y="50" fontSize="9" fill="#333">
        WITH {data.totalStorageKwh} KWH BATTERY ENERGY STORAGE SYSTEM
      </text>

      {/* ── PROJECT DATA BOX ── */}
      <rect x="25" y="65" width="340" height="310" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="25" y="65" width="340" height="18" fill="#111" />
      <text x="195" y="78" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">PROJECT DATA</text>

      {(() => {
        let y = 98
        const ls = 13
        const items = [
          ['PROJECT:', `${data.projectId} ${data.owner}`],
          ['ADDRESS:', data.address],
          ['', ''],
          ['SYSTEM SIZE:', `${data.systemDcKw.toFixed(2)} kWDC / ${data.systemAcKw.toFixed(3)} kWAC`],
          ['PV MODULES:', `(${data.panelCount}) ${data.panelModel}`],
          ['INVERTERS:', `(${data.inverterCount}) ${data.inverterModel}`],
          ['BATTERIES:', `(${data.batteryCount}) ${data.batteryModel} = ${data.totalStorageKwh} kWh`],
          ['', ''],
          ['RACKING:', data.rackingModel],
          ['INTERCONNECTION:', 'UTILITY INTERCONNECTION'],
          ['UTILITY:', data.utility],
          ['METER #:', data.meter],
          ['ESID:', data.esid],
          ['', ''],
          ['BUILDING:', `${storiesLabel} STORY BUILDING`],
          ['CONSTRUCTION:', `${data.buildingType}, Occupancy ${data.occupancy}`],
          ['ROOF:', `${data.roofType}, ${data.rafterSize}`],
          ['WIND SPEED:', `${data.windSpeed} MPH, Risk Cat ${data.riskCategory}`],
          ['EXPOSURE:', data.exposure],
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
      {data.existingPanelModel && (
        <>
          <rect x="25" y="385" width="340" height="70" fill="none" stroke="#111" strokeWidth="1" />
          <rect x="25" y="385" width="340" height="18" fill="#555" />
          <text x="195" y="398" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">EXISTING SYSTEM (TO REMAIN)</text>
          <text x="32" y="418" fontSize="6" fontWeight="bold" fill="#111">PV MODULES:</text>
          <text x="110" y="418" fontSize="6" fill="#333">({data.existingPanelCount ?? 0}) {data.existingPanelModel} ({data.existingPanelWattage ?? 0}W)</text>
          <text x="32" y="431" fontSize="6" fontWeight="bold" fill="#111">INVERTERS:</text>
          <text x="110" y="431" fontSize="6" fill="#333">({data.existingInverterCount ?? 0}) {data.existingInverterModel}</text>
          <text x="32" y="444" fontSize="6" fontWeight="bold" fill="#111">EXISTING DC:</text>
          <text x="110" y="444" fontSize="6" fill="#333">{((data.existingPanelCount ?? 0) * (data.existingPanelWattage ?? 0) / 1000).toFixed(2)} kW</text>
        </>
      )}

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
          <text x="207" y={498 + i * 9} fontSize="6.5" fontWeight="bold" fill="#111">{abbr}</text>
          <text x="240" y={498 + i * 9} fontSize="6.5" fill="#333">{def}</text>
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
      <text x="757" y="98" fontSize="7" fontWeight="bold" fill="#111">{data.contractor.name}</text>
      <text x="757" y="111" fontSize="6" fill="#333">{data.contractor.address}</text>
      <text x="757" y="122" fontSize="6" fill="#333">{data.contractor.city}</text>
      <text x="757" y="133" fontSize="6" fill="#333">Phone: {data.contractor.phone}</text>
      <text x="757" y="144" fontSize="6" fill="#333">License# {data.contractor.license}</text>
      <text x="757" y="155" fontSize="6" fill="#333">{data.contractor.email}</text>

      <TitleBlock sheetName="COVER PAGE & GENERAL NOTES" sheetNumber="PV-1" data={data} />
    </svg>
  )
}

// ── SHEET PV-2: PROJECT DATA PAGE ───────────────────────────────────────────

function SheetPV2({ data }: { data: PlansetData }) {
  const storiesLabel = data.stories === 1 ? 'ONE' : data.stories === 2 ? 'TWO' : String(data.stories)

  // Group strings by roof face
  const roofGroups: Record<number, { modules: number; tilt: string; azimuth: string }> = {}
  for (const s of data.strings) {
    if (!roofGroups[s.roofFace]) {
      roofGroups[s.roofFace] = { modules: 0, tilt: '—', azimuth: '—' }
    }
    roofGroups[s.roofFace].modules += s.modules
  }
  const roofRows = Object.entries(roofGroups).map(([face, info]) => ({
    roof: `ROOF ${face}`,
    tilt: info.tilt,
    azimuth: info.azimuth,
    modules: info.modules,
  }))

  const codeRefs = [
    ['2020 (NEC)', 'NATIONAL ELECTRICAL CODE'],
    ['2018 (IBC)', 'INTERNATIONAL BUILDING CODE'],
    ['2018 (IRC)', 'INTERNATIONAL RESIDENTIAL CODE'],
    ['2018 (IMC)', 'INTERNATIONAL MECHANICAL CODE'],
    ['2018 (IPC)', 'INTERNATIONAL PLUMBING CODE'],
    ['2018 (IFC)', 'INTERNATIONAL FIRE CODE'],
    ['2018 (IECC)', 'INTERNATIONAL ENERGY CONSERVATION CODE'],
  ]

  const sectionHeaderH = 20
  const rowH = 16

  // Existing system data
  const existingDcKw = data.existingPanelCount && data.existingPanelWattage
    ? (data.existingPanelCount * data.existingPanelWattage / 1000).toFixed(2)
    : null

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      <text x="25" y="35" fontSize="14" fontWeight="bold" fill="#111">PROJECT DATA PAGE</text>
      <text x="25" y="50" fontSize="8" fill="#555">
        {data.systemDcKw.toFixed(2)} KW DC PHOTOVOLTAIC SYSTEM WITH {data.totalStorageKwh} KWH BATTERY ENERGY STORAGE
      </text>

      {/* ── PROJECT DATA TABLE (top left) ── */}
      <rect x="25" y="70" width="350" height="280" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="25" y="70" width="350" height={sectionHeaderH} fill="#111" />
      <text x="200" y="85" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">PROJECT DATA</text>

      {(() => {
        let y = 106
        const ls = 16
        const items: [string, string][] = [
          ['PROJECT ADDRESS:', `${data.address}`],
          ['', `${data.city}, TX ${data.zip}`],
          ['OWNER:', data.owner],
          ['', ''],
          ['SYSTEM SIZE (DC):', `${data.systemDcKw.toFixed(2)} kWdc`],
          ['SYSTEM SIZE (AC):', `${(data.panelCount * data.panelWattage / 1000).toFixed(2)} kWac`],
          ['', ''],
        ]
        return items.map(([label, value], i) => {
          if (!label && !value) { y += 8; return null }
          const el = (
            <g key={`pd-${i}`}>
              {label && <text x="32" y={y} fontSize="7" fontWeight="bold" fill="#111">{label}</text>}
              <text x={label ? 130 : 32} y={y} fontSize="8" fill="#333">{value}</text>
            </g>
          )
          y += ls
          return el
        })
      })()}

      {/* SCOPE OF WORK sub-table */}
      <rect x="30" y="216" width="340" height={sectionHeaderH} fill="#333" />
      <text x="200" y="230" fontSize="7" fontWeight="bold" fill="white" textAnchor="middle">SCOPE OF WORK</text>
      <rect x="30" y={216 + sectionHeaderH} width="80" height={rowH} fill="#eee" stroke="#ccc" strokeWidth="0.5" />
      <rect x="110" y={216 + sectionHeaderH} width="260" height={rowH} fill="#eee" stroke="#ccc" strokeWidth="0.5" />
      <text x="35" y={216 + sectionHeaderH + 12} fontSize="7" fontWeight="bold" fill="#111">QUANTITY</text>
      <text x="115" y={216 + sectionHeaderH + 12} fontSize="7" fontWeight="bold" fill="#111">DESCRIPTION</text>

      {[
        [`${data.panelCount}`, data.panelModel],
        [`${data.inverterCount}`, data.inverterModel],
        [`${data.batteryCount}`, data.batteryModel],
      ].map(([qty, desc], i) => {
        const ry = 216 + sectionHeaderH + rowH + i * rowH
        return (
          <g key={`sow-${i}`}>
            <rect x="30" y={ry} width="80" height={rowH} fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ccc" strokeWidth="0.5" />
            <rect x="110" y={ry} width="260" height={rowH} fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ccc" strokeWidth="0.5" />
            <text x="70" y={ry + 12} fontSize="7" fill="#333" textAnchor="middle">{qty}</text>
            <text x="115" y={ry + 12} fontSize="7" fill="#333">{desc}</text>
          </g>
        )
      })}

      {/* ── NEW SYSTEM ROOF DESCRIPTION (top center) ── */}
      <rect x="400" y="70" width="360" height={sectionHeaderH + rowH + roofRows.length * rowH} fill="none" stroke="#111" strokeWidth="1" />
      <rect x="400" y="70" width="360" height={sectionHeaderH} fill="#111" />
      <text x="580" y="85" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">NEW SYSTEM ROOF DESCRIPTION</text>

      {/* Column headers */}
      <rect x="400" y={70 + sectionHeaderH} width="90" height={rowH} fill="#eee" stroke="#ccc" strokeWidth="0.5" />
      <rect x="490" y={70 + sectionHeaderH} width="90" height={rowH} fill="#eee" stroke="#ccc" strokeWidth="0.5" />
      <rect x="580" y={70 + sectionHeaderH} width="90" height={rowH} fill="#eee" stroke="#ccc" strokeWidth="0.5" />
      <rect x="670" y={70 + sectionHeaderH} width="90" height={rowH} fill="#eee" stroke="#ccc" strokeWidth="0.5" />
      <text x="445" y={70 + sectionHeaderH + 12} fontSize="7" fontWeight="bold" fill="#111" textAnchor="middle">ROOF</text>
      <text x="535" y={70 + sectionHeaderH + 12} fontSize="7" fontWeight="bold" fill="#111" textAnchor="middle">ARRAY TILT</text>
      <text x="625" y={70 + sectionHeaderH + 12} fontSize="7" fontWeight="bold" fill="#111" textAnchor="middle">AZIMUTH</text>
      <text x="715" y={70 + sectionHeaderH + 12} fontSize="7" fontWeight="bold" fill="#111" textAnchor="middle"># OF MODULES</text>

      {roofRows.map((row, i) => {
        const ry = 70 + sectionHeaderH + rowH + i * rowH
        return (
          <g key={`roof-${i}`}>
            <rect x="400" y={ry} width="90" height={rowH} fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ccc" strokeWidth="0.5" />
            <rect x="490" y={ry} width="90" height={rowH} fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ccc" strokeWidth="0.5" />
            <rect x="580" y={ry} width="90" height={rowH} fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ccc" strokeWidth="0.5" />
            <rect x="670" y={ry} width="90" height={rowH} fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ccc" strokeWidth="0.5" />
            <text x="445" y={ry + 12} fontSize="7" fill="#333" textAnchor="middle">{row.roof}</text>
            <text x="535" y={ry + 12} fontSize="7" fill="#333" textAnchor="middle">{row.tilt}</text>
            <text x="625" y={ry + 12} fontSize="7" fill="#333" textAnchor="middle">{row.azimuth}</text>
            <text x="715" y={ry + 12} fontSize="7" fill="#333" textAnchor="middle">{row.modules}</text>
          </g>
        )
      })}

      {/* ── ELECTRICAL INFORMATION (right side) ── */}
      <rect x="800" y="70" width="280" height="220" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="800" y="70" width="280" height={sectionHeaderH} fill="#111" />
      <text x="940" y="85" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">ELECTRICAL INFORMATION</text>

      {[
        ['VOLTAGE', data.voltage],
        ['MSP BUS RATING', `${data.mspBusRating}A`],
        ['MAIN BREAKER', data.mainBreaker],
        ['METER #', data.meter],
        ['ESID', data.esid],
        ['INTERCONNECTION TYPE', 'UTILITY INTERCONNECTION'],
      ].map(([label, value], i) => {
        const ry = 70 + sectionHeaderH + i * rowH
        return (
          <g key={`elec-${i}`}>
            <rect x="800" y={ry + sectionHeaderH} width="280" height={rowH}
              fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ccc" strokeWidth="0.5" />
            <text x="808" y={ry + sectionHeaderH + 12} fontSize="7" fontWeight="bold" fill="#999">{label}</text>
            <text x="925" y={ry + sectionHeaderH + 12} fontSize="8" fill="#111">{value}</text>
          </g>
        )
      })}

      {/* ── BUILDING INFORMATION (below left) ── */}
      <rect x="25" y="370" width="350" height="160" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="25" y="370" width="350" height={sectionHeaderH} fill="#111" />
      <text x="200" y="384" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">BUILDING INFORMATION</text>

      {[
        ['BUILDING TYPE', `${storiesLabel} STORY BUILDING`],
        ['CONSTRUCTION TYPE', data.buildingType],
        ['OCCUPANCY', data.occupancy],
        ['ROOF TYPE', data.roofType],
        ['RAFTERS', data.rafterSize],
      ].map(([label, value], i) => {
        const ry = 370 + sectionHeaderH + i * 22
        return (
          <g key={`bldg-${i}`}>
            <text x="32" y={ry + 18} fontSize="7" fontWeight="bold" fill="#999">{label}</text>
            <text x="150" y={ry + 18} fontSize="8" fill="#111">{value}</text>
          </g>
        )
      })}

      {/* ── RACKING INFORMATION (below center) ── */}
      <rect x="400" y="370" width="360" height="160" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="400" y="370" width="360" height={sectionHeaderH} fill="#111" />
      <text x="580" y="384" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">RACKING INFORMATION</text>

      <text x="408" y="408" fontSize="8" fill="#111">{data.rackingModel}</text>

      <text x="408" y="434" fontSize="8" fontWeight="bold" fill="#111">DESIGN CRITERIA</text>
      <text x="408" y="452" fontSize="7" fontWeight="bold" fill="#999">EXPOSURE CATEGORY</text>
      <text x="540" y="452" fontSize="8" fill="#111">{data.exposure}</text>
      <text x="408" y="470" fontSize="7" fontWeight="bold" fill="#999">WIND SPEED</text>
      <text x="540" y="470" fontSize="8" fill="#111">{data.windSpeed} MPH</text>
      <text x="408" y="488" fontSize="7" fontWeight="bold" fill="#999">RISK CATEGORY</text>
      <text x="540" y="488" fontSize="8" fill="#111">{data.riskCategory}</text>

      {/* ── CODE REFERENCES (below right) ── */}
      <rect x="800" y="370" width="280" height="160" fill="none" stroke="#111" strokeWidth="1" />
      <rect x="800" y="370" width="280" height={sectionHeaderH} fill="#111" />
      <text x="940" y="384" fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">CODE REFERENCES</text>

      {codeRefs.map(([code, desc], i) => (
        <g key={`code-${i}`}>
          <text x="808" y={406 + i * 16} fontSize="7" fontWeight="bold" fill="#111">{code}</text>
          <text x="890" y={406 + i * 16} fontSize="7" fill="#333">{desc}</text>
        </g>
      ))}

      {/* ── SYSTEM SUMMARY (bottom section) ── */}
      {(() => {
        const sumY = 550
        const sumW = data.existingPanelModel ? 530 : 530
        const colW = data.existingPanelModel ? 255 : sumW - 20
        const sumRowH = 18

        const newRows: [string, string][] = [
          ['PV MODULE', `(${data.panelCount}) ${data.panelModel}`],
          ['MODULE WATTAGE', `${data.panelWattage}W STC`],
          ['INVERTER', `(${data.inverterCount}) ${data.inverterModel}`],
          ['BATTERY', `(${data.batteryCount}) ${data.batteryModel}`],
          ['SYSTEM DC', `${data.systemDcKw.toFixed(2)} kW`],
          ['SYSTEM AC', `${data.systemAcKw} kW`],
          ['TOTAL STORAGE', `${data.totalStorageKwh} kWh`],
        ]

        const existingRows: [string, string][] = data.existingPanelModel ? [
          ['PV MODULE', `(${data.existingPanelCount ?? 0}) ${data.existingPanelModel}`],
          ['MODULE WATTAGE', `${data.existingPanelWattage ?? 0}W`],
          ['INVERTER', `(${data.existingInverterCount ?? 0}) ${data.existingInverterModel ?? 'N/A'}`],
          ['BATTERY', 'N/A'],
          ['SYSTEM DC', `${existingDcKw} kW`],
          ['SYSTEM AC', 'N/A'],
          ['TOTAL STORAGE', 'N/A'],
        ] : []

        const tableRows = Math.max(newRows.length, existingRows.length)
        const sumH = sectionHeaderH + sumRowH + tableRows * sumRowH + 10

        return (
          <g>
            {/* Main container */}
            <rect x="25" y={sumY} width={sumW} height={sumH} fill="none" stroke="#111" strokeWidth="1" />
            <rect x="25" y={sumY} width={sumW} height={sectionHeaderH} fill="#111" />
            <text x={25 + sumW / 2} y={sumY + 14} fontSize="8" fontWeight="bold" fill="white" textAnchor="middle">SYSTEM SUMMARY</text>

            {/* Existing system column (left) */}
            {data.existingPanelModel && (
              <g>
                <rect x="30" y={sumY + sectionHeaderH + 2} width={colW} height={sumRowH} fill="#555" />
                <text x={30 + colW / 2} y={sumY + sectionHeaderH + 14} fontSize="7" fontWeight="bold" fill="white" textAnchor="middle">EXISTING SYSTEM</text>
                {existingRows.map(([label, value], i) => {
                  const ry = sumY + sectionHeaderH + 2 + sumRowH + i * sumRowH
                  return (
                    <g key={`ex-${i}`}>
                      <rect x="30" y={ry} width={colW} height={sumRowH} fill={i % 2 === 0 ? '#f5f5f5' : 'white'} stroke="#eee" strokeWidth="0.5" />
                      <text x="38" y={ry + 13} fontSize="7" fontWeight="bold" fill="#999">{label}</text>
                      <text x="130" y={ry + 13} fontSize="8" fill="#333">{value}</text>
                    </g>
                  )
                })}
              </g>
            )}

            {/* New system column (right, or full width if no existing) */}
            <g>
              <rect x={data.existingPanelModel ? 30 + colW + 10 : 30} y={sumY + sectionHeaderH + 2} width={colW} height={sumRowH} fill="#1D9E75" />
              <text x={(data.existingPanelModel ? 30 + colW + 10 : 30) + colW / 2} y={sumY + sectionHeaderH + 14} fontSize="7" fontWeight="bold" fill="white" textAnchor="middle">NEW SYSTEM</text>
              {newRows.map(([label, value], i) => {
                const nx = data.existingPanelModel ? 30 + colW + 10 : 30
                const ry = sumY + sectionHeaderH + 2 + sumRowH + i * sumRowH
                return (
                  <g key={`new-${i}`}>
                    <rect x={nx} y={ry} width={colW} height={sumRowH} fill={i % 2 === 0 ? '#f5f5f5' : 'white'} stroke="#eee" strokeWidth="0.5" />
                    <text x={nx + 8} y={ry + 13} fontSize="7" fontWeight="bold" fill="#999">{label}</text>
                    <text x={nx + 110} y={ry + 13} fontSize="8" fill="#111">{value}</text>
                  </g>
                )
              })}
            </g>
          </g>
        )
      })()}

      <TitleBlock sheetName="PROJECT DATA" sheetNumber="PV-2" data={data} />
    </svg>
  )
}

// ── SHEET PV-5: SINGLE LINE DIAGRAM ─────────────────────────────────────────

function SheetPV5({ data }: { data: PlansetData }) {
  // If no strings provided, auto-distribute panels across inverters
  let sldStrings = data.strings
  let sldStringsPerInverter = data.stringsPerInverter

  if (sldStrings.length === 0 && data.panelCount > 0) {
    const d = DURACELL_DEFAULTS
    sldStrings = autoDistributeStrings(
      data.panelCount, data.vocCorrected, data.panelVmp, data.panelImp,
      data.inverterCount, data.mpptsPerInverter, data.stringsPerMppt, d.maxVoc
    )
    // Build stringsPerInverter arrays
    sldStringsPerInverter = []
    if (sldStrings.length > 0 && data.inverterCount > 0) {
      const perInv = Math.ceil(sldStrings.length / data.inverterCount)
      for (let i = 0; i < data.inverterCount; i++) {
        const start = i * perInv
        const end = Math.min(start + perInv, sldStrings.length)
        sldStringsPerInverter.push(Array.from({ length: end - start }, (_, j) => start + j))
      }
    }
  }

  const config = {
    projectName: data.owner,
    address: data.address,
    panelModel: data.panelModel,
    panelWattage: data.panelWattage,
    panelCount: data.panelCount,
    inverterModel: data.inverterModel,
    inverterCount: data.inverterCount,
    inverterAcKw: data.inverterAcPower,
    maxPvPower: data.maxPvPower,
    mpptsPerInverter: data.mpptsPerInverter,
    stringsPerMppt: data.stringsPerMppt,
    maxCurrentPerMppt: data.maxCurrentPerMppt,
    batteryModel: data.batteryModel,
    batteryCount: data.batteryCount,
    batteryCapacity: data.batteryCapacity,
    batteriesPerStack: data.batteriesPerStack,
    rackingModel: data.rackingModel,
    strings: sldStrings.map(s => ({
      id: s.id,
      modules: s.modules,
      roofFace: s.roofFace,
      vocCold: s.vocCold,
      vmp: s.vmpNominal,
      imp: s.current,
    })),
    stringsPerInverter: sldStringsPerInverter,
    meter: data.meter,
    esid: data.esid,
    utility: data.utility,
    systemDcKw: data.systemDcKw,
    systemAcKw: data.systemAcKw,
    totalStorageKwh: data.totalStorageKwh,
    existingPanels: data.existingPanelModel
      ? `(${data.existingPanelCount ?? 0}) ${data.existingPanelModel} (${data.existingPanelWattage ?? 0}W)`
      : undefined,
    existingInverters: data.existingInverterModel
      ? `(${data.existingInverterCount ?? 0}) ${data.existingInverterModel} (240V)`
      : undefined,
    existingDcKw: data.existingPanelCount && data.existingPanelWattage
      ? (data.existingPanelCount * data.existingPanelWattage) / 1000
      : undefined,
    contractor: data.contractor.name,
    contractorAddress: `${data.contractor.address}, ${data.contractor.city}`,
    contractorPhone: data.contractor.phone,
    contractorLicense: data.contractor.license,
    contractorEmail: data.contractor.email,
  }

  const layout = calculateSldLayout(config)
  return <SldRenderer layout={layout} />
}

// ── SHEET PV-5.1: PCS LABELS ────────────────────────────────────────────────

function SheetPV51({ data }: { data: PlansetData }) {
  const maxStringVocCold = data.strings.length > 0
    ? Math.max(...data.strings.map(s => s.vocCold)).toFixed(1)
    : '0.0'
  const totalAcAmps = (data.inverterAcPower * 1000 / 240).toFixed(1)

  // Build dynamic string description
  const stringGroups: Record<number, number> = {}
  for (const s of data.strings) {
    stringGroups[s.modules] = (stringGroups[s.modules] || 0) + 1
  }
  const stringDesc = Object.entries(stringGroups)
    .sort(([, a], [, b]) => b - a)
    .map(([mods, count]) => `${count}x ${mods}-MODULE (Voc=${(parseInt(mods) * data.vocCorrected).toFixed(1)}V)`)
    .join(' + ')

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
        `2. PHOTOVOLTAIC SYSTEM (${data.systemDcKw.toFixed(2)} kW DC)`,
        `3. BATTERY ENERGY STORAGE (${data.totalStorageKwh} kWh)`,
        '',
        `INVERTER: (${data.inverterCount}) ${data.inverterModel}`,
        `RATED AC OUTPUT: ${data.inverterAcPower} kW PER UNIT, ${data.systemAcKw} kW TOTAL`,
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
        `TOTAL AC CURRENT: ${(parseFloat(totalAcAmps) * data.inverterCount).toFixed(1)}A`,
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
        `MAXIMUM SYSTEM VOLTAGE (Voc @ -5°C): ${maxStringVocCold}V DC`,
        `MAXIMUM DC CURRENT: ${(data.panelIsc * 1.25).toFixed(1)}A (125% Isc)`,
        `STRINGS: ${stringDesc}`,
        `CONDUCTOR: ${data.dcStringWire}`,
        `CONDUIT: ${data.dcConduit}`,
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
        `SOLAR SYSTEM: ${data.systemDcKw.toFixed(2)} kW DC / ${data.systemAcKw} kW AC`,
        `BATTERY STORAGE: ${data.totalStorageKwh} kWh`,
        `PV BACKFEED BREAKER: (${data.inverterCount}) 100A, 240V`,
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
        `UTILITY: ${data.utility}`,
        `METER: ${data.meter}`,
        `ESID: ${data.esid}`,
        `SYSTEM OUTPUT: ${data.systemAcKw} kW AC`,
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
        `BATTERY: (${data.batteryCount}) ${data.batteryModel}`,
        `TOTAL STORAGE: ${data.totalStorageKwh} kWh, LFP CHEMISTRY`,
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
          <text x={label.x + label.w - 5} y={label.y + 13} fontSize="6.5"
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

      <TitleBlock sheetName="PCS LABELS" sheetNumber="PV-5.1" data={data} />
    </svg>
  )
}

// ── SHEET PV-6: WIRING CALCULATIONS ─────────────────────────────────────────

function SheetPV6({ data }: { data: PlansetData }) {
  // Wire resistance per 1000ft (ohms) for copper at 75C
  const wireResistance: Record<string, number> = {
    '#14': 3.14, '#12': 1.98, '#10': 1.24, '#8': 0.778, '#6': 0.491,
    '#4': 0.308, '#3': 0.245, '#2': 0.194, '#1': 0.154, '1/0': 0.122,
  }

  // String calculations
  const strings = data.strings.map((s, i) => {
    const voc = s.modules * data.panelVoc
    const vocCold = s.vocCold
    const vmp = s.vmpNominal
    const isc = data.panelIsc
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
      conduit: data.dcConduit,
      runFt,
      vDrop: vDrop.toFixed(2),
      vDropPct: vDropPct.toFixed(2),
      status: vDropPct < 2 ? 'PASS' : 'FAIL',
    }
  })

  // AC calculation
  const acCurrentPerInv = data.inverterAcPower * 1000 / 240
  const acCurrent125 = acCurrentPerInv * 1.25
  const acRunFt = 50
  const acVDrop = (2 * acRunFt * acCurrentPerInv * wireResistance['#4']) / 1000
  const acVDropPct = (acVDrop / 240) * 100

  // Battery wiring — VPP discharge at 23kW continuous
  const battCurrentPerStack = 23000 / 51.2 // VPP discharge: 23kW / 51.2V = ~449A
  const battCurrent125 = battCurrentPerStack * 1.25

  // OCPD
  const stringFuseCalc = data.panelIsc * 1.56
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
        <text key={i} x={colX[i]} y={tableY + 11} fontSize="6.5" fontWeight="bold" fill="white">{h}</text>
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
              <text key={j} x={colX[j]} y={ry + 11} fontSize="6.5"
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
              <text key={i} x={[25, 100, 175, 265, 340, 420, 530, 580, 640, 710, 775][i]} y={acY + 26} fontSize="6.5" fontWeight="bold" fill="white">{h}</text>
            ))}

            {data.strings.length > 0 && (
              <>
                <rect x="25" y={acY + 15 + rowH} width="840" height={rowH} fill="#f9f9f9" stroke="#ddd" strokeWidth="0.5" />
                {[
                  `INV → PANEL (x${data.inverterCount})`, '240V AC', `${data.inverterAcPower} kW`,
                  `${acCurrentPerInv.toFixed(1)}A`, `${acCurrent125.toFixed(1)}A`,
                  data.acWireToPanel, data.acConduit, `${acRunFt}`,
                  `${acVDrop.toFixed(2)}V`, `${acVDropPct.toFixed(2)}%`,
                  acVDropPct < 3 ? 'PASS' : 'FAIL',
                ].map((val, j) => (
                  <text key={j} x={[25, 100, 175, 265, 340, 420, 530, 580, 640, 710, 775][j]}
                    y={acY + 15 + rowH + 11} fontSize="6.5"
                    fill={val === 'FAIL' ? '#cc0000' : val === 'PASS' ? '#006600' : '#333'}>{val}</text>
                ))}
              </>
            )}

            {/* ── BATTERY WIRING ── */}
            <text x="25" y={acY + 75} fontSize="10" fontWeight="bold" fill="#111">BATTERY WIRE SIZING (NEC 706)</text>
            <rect x="25" y={acY + 90} width="840" height={rowH} fill="#111" />
            {['CIRCUIT', 'VOLTAGE', 'CAPACITY', 'MAX CURRENT', '125%', 'WIRE', 'CONDUIT'].map((h, i) => (
              <text key={i} x={[25, 150, 265, 370, 470, 560, 700][i]} y={acY + 101} fontSize="6.5" fontWeight="bold" fill="white">{h}</text>
            ))}
            <rect x="25" y={acY + 90 + rowH} width="840" height={rowH} fill="#f9f9f9" stroke="#ddd" strokeWidth="0.5" />
            {[
              `BATT → INV (${data.batteryCount}x ${data.batteryModel})`,
              '51.2V DC NOM',
              `${data.totalStorageKwh} kWh TOTAL`,
              `${battCurrentPerStack.toFixed(1)}A`,
              `${battCurrent125.toFixed(1)}A`,
              data.batteryWire,
              data.batteryConduit,
            ].map((val, j) => (
              <text key={j} x={[25, 150, 265, 370, 470, 560, 700][j]}
                y={acY + 90 + rowH + 11} fontSize="6.5" fill="#333">{val}</text>
            ))}

            {/* ── OCPD SIZING ── */}
            <text x="25" y={acY + 155} fontSize="10" fontWeight="bold" fill="#111">OVERCURRENT PROTECTION DEVICE (OCPD) SIZING (NEC 690.9)</text>
            <rect x="25" y={acY + 170} width="840" height={rowH} fill="#111" />
            {['DEVICE', 'CALCULATION', 'RESULT', 'STANDARD SIZE', 'RATING'].map((h, i) => (
              <text key={i} x={[25, 200, 420, 560, 700][i]} y={acY + 181} fontSize="6.5" fontWeight="bold" fill="white">{h}</text>
            ))}
            {[
              ['STRING FUSE', `Isc × 1.56 = ${data.panelIsc} × 1.56`, `${stringFuseCalc.toFixed(1)}A`, `${stringFuseSize}A`, '600V DC'],
              ['PV BREAKER (per INV)', 'Per inverter AC output rating', `${acCurrent125.toFixed(1)}A`, '100A', '240V AC'],
              ['MAIN BREAKER', 'Per system total AC capacity', `${(acCurrent125 * data.inverterCount).toFixed(1)}A`, '200A', '240V AC'],
            ].map((row, i) => (
              <g key={i}>
                <rect x="25" y={acY + 170 + rowH + i * rowH} width="840" height={rowH}
                  fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ddd" strokeWidth="0.5" />
                {row.map((val, j) => (
                  <text key={j} x={[25, 200, 420, 560, 700][j]}
                    y={acY + 170 + rowH + i * rowH + 11} fontSize="6.5" fill="#333">{val}</text>
                ))}
              </g>
            ))}

            {/* ── GROUNDING ── */}
            <text x="25" y={acY + 240} fontSize="10" fontWeight="bold" fill="#111">GROUNDING CONDUCTOR SIZING (NEC 250)</text>
            <rect x="25" y={acY + 255} width="840" height={rowH} fill="#111" />
            {['CONDUCTOR', 'SIZE', 'REFERENCE', 'NOTES'].map((h, i) => (
              <text key={i} x={[25, 300, 480, 650][i]} y={acY + 266} fontSize="6.5" fontWeight="bold" fill="white">{h}</text>
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
                    y={acY + 255 + rowH + i * rowH + 11} fontSize="6.5" fill="#333">{val}</text>
                ))}
              </g>
            ))}

            {/* ── AMPACITY CORRECTION (NEC 310.12) ── */}
            <text x="25" y={acY + 345} fontSize="10" fontWeight="bold" fill="#111">AMPACITY CORRECTION — NEC 310.12 (83% RULE)</text>

            {(() => {
              const ampY = acY + 360
              const ampHeaders = ['CONDUCTOR', 'AMPACITY (A)', 'CONDUIT FILL', 'AMBIENT (°C)', 'TEMP CF', 'CORRECTED (A)', '75°C MAX (A)', 'USABLE (A)']
              const ampColX2 = [25, 180, 310, 420, 530, 660, 780, 840]
              // Ampacity data: wire size → [base ampacity at 90C, 75C terminal max]
              const ampRows: [string, number, number, number, number][] = [
                ['#10 AWG CU (DC STRING)', 40, 0.70, 37, 30],
                ['#4 AWG CU (BATTERY)', 95, 0.70, 37, 85],
                ['#1 AWG CU (INVERTER AC)', 145, 0.70, 37, 130],
                ['#6 AWG CU (EGC)', 75, 1.0, 37, 65],
              ]
              const tempCF = 0.91 // THWN-2 at 37°C
              return (
                <g>
                  <rect x="25" y={ampY} width="840" height={rowH} fill="#111" />
                  {ampHeaders.map((h, i) => (
                    <text key={i} x={ampColX2[i]} y={ampY + 11} fontSize="6.5" fontWeight="bold" fill="white">{h}</text>
                  ))}
                  {ampRows.map((row, i) => {
                    const ry2 = ampY + rowH + i * rowH
                    const corrected = parseFloat((row[1] * row[2] * tempCF).toFixed(1))
                    const usable = Math.min(corrected, row[4])
                    return (
                      <g key={`amp-${i}`}>
                        <rect x="25" y={ry2} width="840" height={rowH}
                          fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ddd" strokeWidth="0.5" />
                        {[
                          row[0], String(row[1]), String(row[2]), String(row[3]),
                          String(tempCF), String(corrected), String(row[4]), String(usable),
                        ].map((val, j) => (
                          <text key={j} x={ampColX2[j]} y={ry2 + 11} fontSize="6.5"
                            fill={parseFloat(val) > 0 && j === 7 ? '#006600' : '#333'}>{val}</text>
                        ))}
                      </g>
                    )
                  })}
                  <text x="25" y={ampY + rowH + ampRows.length * rowH + 14} fontSize="6.5" fill="#555">
                    Temp correction factor 0.91 for THWN-2 copper at 37°C ambient (NEC Table 310.15(B)(1)). Conduit fill factor per NEC 310.15(C)(1).
                  </text>
                </g>
              )
            })()}

            {/* Voltage drop formula */}
            <text x="25" y={acY + 470} fontSize="7" fontWeight="bold" fill="#111">VOLTAGE DROP FORMULA:</text>
            <text x="25" y={acY + 485} fontSize="6.5" fill="#333">
              V_drop = 2 × L × I × R / 1000 where L = length (ft), I = current (A), R = resistance (ohms/1000ft)
            </text>
            <text x="25" y={acY + 498} fontSize="6.5" fill="#333">
              DC circuits: V_drop must be &lt; 2% of Vmp | AC circuits: V_drop must be &lt; 3% of nominal voltage
            </text>
          </g>
        )
      })()}

      <TitleBlock sheetName="WIRING CALCULATIONS" sheetNumber="PV-6" data={data} />
    </svg>
  )
}

// ── SHEET PV-7: WARNING LABELS ──────────────────────────────────────────────

function SheetPV7({ data }: { data: PlansetData }) {
  const maxVocCold = data.strings.length > 0
    ? Math.max(...data.strings.map(s => s.vocCold)).toFixed(1)
    : '0.0'
  const totalAcAmps = (data.inverterAcPower * 1000 / 240).toFixed(1)

  // Build dynamic string config summary
  const stringGroups: Record<number, number> = {}
  for (const s of data.strings) {
    stringGroups[s.modules] = (stringGroups[s.modules] || 0) + 1
  }
  const stringConfigLabel = Object.entries(stringGroups)
    .sort(([, a], [, b]) => b - a)
    .map(([mods, count]) => `${count}x${mods}`)
    .join(' + ')
    + ' MODULES'

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
        `SYSTEM SIZE: ${data.systemDcKw.toFixed(2)} kW DC`,
        `AC OUTPUT: ${data.systemAcKw} kW`,
        `BATTERY: ${data.totalStorageKwh} kWh`,
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
        `MAX CIRCUIT CURRENT (Isc): ${data.panelIsc}A`,
        `RATED OUTPUT: ${data.systemDcKw.toFixed(2)} kW DC`,
        '',
        `MODULES: (${data.panelCount}) ${data.panelModel}`,
        `STRINGS: ${stringConfigLabel}`,
        `Voc PER MODULE: ${data.panelVoc}V`,
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
        `(${data.batteryCount}) ${data.batteryModel}`,
        `TOTAL: ${data.totalStorageKwh} kWh`,
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
        `UTILITY: ${data.utility}`,
        `METER: ${data.meter}`,
        `SYSTEM: ${data.systemDcKw.toFixed(2)} kW DC / ${data.systemAcKw} kW AC`,
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

      <TitleBlock sheetName="WARNING LABELS" sheetNumber="PV-7" data={data} />
    </svg>
  )
}

// ── SHEET PV-7.1: PLACARDS ──────────────────────────────────────────────────

function SheetPV71({ data }: { data: PlansetData }) {
  // Build dynamic string config label
  const stringGroups: Record<number, number> = {}
  for (const s of data.strings) {
    stringGroups[s.modules] = (stringGroups[s.modules] || 0) + 1
  }
  const stringConfigLabel = Object.entries(stringGroups)
    .sort(([, a], [, b]) => b - a)
    .map(([mods, count]) => `${count} STRINGS x ${mods}`)
    .join(' + ')

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
        ['EQUIPMENT', `(${data.inverterCount}) ${data.inverterModel}`],
        ['MANUFACTURER', 'DURACELL / HUBBLE TECHNOLOGY'],
        ['TYPE', 'HYBRID INVERTER (PV + ESS)'],
        ['RATED AC OUTPUT', `${data.inverterAcPower} kW PER UNIT (${data.systemAcKw} kW TOTAL)`],
        ['AC VOLTAGE', '240/120V SPLIT PHASE'],
        ['MAX PV INPUT', `${data.maxPvPower.toLocaleString()}W PER UNIT`],
        ['MAX INPUT VOLTAGE', '500V DC'],
        ['MPPT RANGE', '125V — 425V DC'],
        ['MPPT CHANNELS', `${data.mpptsPerInverter} PER UNIT, ${data.stringsPerMppt} STRINGS EACH`],
        ['LISTING', 'UL 1741SA, IEEE 1547, FCC PART 15'],
        ['ENCLOSURE', 'NEMA 3R, OUTDOOR RATED'],
        ['INSTALLATION', 'WALL-MOUNTED, ACCESSIBLE'],
      ],
    },
    {
      title: 'BATTERY PLACARD',
      x: 550, y: 70, w: 500, h: 190,
      rows: [
        ['EQUIPMENT', `(${data.batteryCount}) ${data.batteryModel}`],
        ['MANUFACTURER', 'DURACELL / HUBBLE TECHNOLOGY'],
        ['CHEMISTRY', 'LITHIUM IRON PHOSPHATE (LiFePO4 / LFP)'],
        ['CAPACITY PER UNIT', `${data.batteryCapacity} kWh`],
        ['TOTAL CAPACITY', `${data.totalStorageKwh} kWh`],
        ['NOMINAL VOLTAGE', '51.2V DC'],
        ['CONFIGURATION', `${data.batteryCount / data.inverterCount} BATTERIES PER INVERTER`],
        ['STACKING', `${data.batteriesPerStack} PER STACK (${Math.ceil(data.batteryCount / data.batteriesPerStack)} STACKS)`],
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
        ['MODULE', `${data.panelModel}`],
        ['QUANTITY', `${data.panelCount} MODULES`],
        ['WATTAGE', `${data.panelWattage}W STC`],
        ['Voc', `${data.panelVoc}V`],
        ['Vmp', `${data.panelVmp}V`],
        ['Isc', `${data.panelIsc}A`],
        ['Imp', `${data.panelImp}A`],
        ['CONFIGURATION', stringConfigLabel || 'N/A'],
        ['LISTING', 'UL 61730 / IEC 61215'],
        ['RACKING', data.rackingModel],
      ],
    },
    {
      title: 'SYSTEM PLACARD',
      x: 550, y: 280, w: 500, h: 165,
      rows: [
        ['SYSTEM DC CAPACITY', `${data.systemDcKw.toFixed(2)} kW DC`],
        ['SYSTEM AC CAPACITY', `${data.systemAcKw} kW AC`],
        ['ENERGY STORAGE', `${data.totalStorageKwh} kWh`],
        ['PV MODULES', `(${data.panelCount}) ${data.panelModel}`],
        ['INVERTERS', `(${data.inverterCount}) ${data.inverterModel}`],
        ['BATTERIES', `(${data.batteryCount}) ${data.batteryModel}`],
        ['RACKING', data.rackingModel],
        ['UTILITY', data.utility],
        ['INTERCONNECTION', 'LINE SIDE TAP / UTILITY INTERACTIVE'],
        ['AHJ', data.ahj || `${data.city}, ${data.state}`],
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
        ['FIRE DEPT CONTACT', `911 / ${data.city.toUpperCase()} FIRE DEPARTMENT`],
        ['SOLAR CONTRACTOR', `${data.contractor.name}: ${data.contractor.phone}`],
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
                <text x={placard.x + 8} y={ry} fontSize="6.5" fontWeight="bold" fill="#111">{label}</text>
                <text x={placard.x + 150} y={ry} fontSize="6.5" fill="#333">{value}</text>
              </g>
            )
          })}
        </g>
      ))}

      <TitleBlock sheetName="EQUIPMENT PLACARDS" sheetNumber="PV-7.1" data={data} />
    </svg>
  )
}

// ── SHEET PV-8: CONDUCTOR SCHEDULE & BOM ────────────────────────────────────

function SheetPV8({ data }: { data: PlansetData }) {
  const rowH = 13
  const headerH = 16

  // Conductor & conduit schedule rows
  const stringCount = data.strings.length
  const panelImp = data.panelImp
  const fla125 = panelImp * 1.25
  const stringOcpd = Math.ceil(fla125 / 5) * 5
  const ambientTemp = 37
  const tempFactor = 0.91
  const conduitFillFactor = 0.70

  // Ampacity for #10 AWG CU THWN-2 at 90C = 40A
  const string10Ampacity = 40
  const stringCorrected = parseFloat((string10Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const string75CMax = 30 // #10 AWG at 75C terminal
  const stringUsable = Math.min(stringCorrected, string75CMax)

  // Battery: #4 AWG
  const battFla = 63.16
  const battFla125 = parseFloat((battFla * 1.25).toFixed(1))
  const batt4Ampacity = 95
  const battCorrected = parseFloat((batt4Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const batt75CMax = 85
  const battUsable = Math.min(battCorrected, batt75CMax)

  // Inverter: #1 AWG
  const invFla = parseFloat((data.inverterAcPower * 1000 / 240).toFixed(1))
  const invFla125 = parseFloat((invFla * 1.25).toFixed(1))
  const inv1Ampacity = 145
  const invCorrected = parseFloat((inv1Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const inv75CMax = 130 // #1 AWG at 75C
  const invUsable = Math.min(invCorrected, inv75CMax)

  // Generation disconnect
  const genFla = 100
  const genFla125 = 125

  type CondRow = [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]

  const condRows: CondRow[] = []

  // RSD row
  condRows.push([
    'RSD', 'RSD DEVICES', 'N/A', 'N/A', 'N/A',
    String(stringCount * 2), '#10 AWG', '1', '#6 AWG BARE', 'PV WIRE', 'FREE AIR',
    String(string10Ampacity), String(ambientTemp), String(tempFactor), String(stringCorrected),
    String(string75CMax), String(stringUsable),
  ])

  // String rows
  data.strings.forEach((s) => {
    condRows.push([
      `S${s.id}`, `STRING ${s.id} (${s.modules} MOD)`,
      panelImp.toFixed(1), fla125.toFixed(1), String(stringOcpd),
      '8', '#10 AWG', '1', '#8 AWG', 'THWN-2', '3/4" EMT',
      String(string10Ampacity), String(ambientTemp), String(tempFactor), String(stringCorrected),
      String(string75CMax), String(stringUsable),
    ])
  })

  // Battery row
  if (data.batteryCount > 0) {
    condRows.push([
      'BATT', `BATTERY (${data.batteryCount}x ${data.batteryModel})`,
      battFla.toFixed(1), battFla125.toFixed(1), '80',
      '3', '#4 AWG', '1', '#6 AWG', 'THWN-2', '3/4" EMT',
      String(batt4Ampacity), String(ambientTemp), String(tempFactor), String(battCorrected),
      String(batt75CMax), String(battUsable),
    ])
  }

  // Inverter row
  condRows.push([
    'INV', `INVERTER (${data.inverterCount}x ${data.inverterModel.split(' ').slice(0, 3).join(' ')})`,
    invFla.toFixed(1), invFla125.toFixed(1), '100',
    '3', '#1 AWG', '1', '#6 AWG', 'THWN-2', '1-1/4" EMT',
    String(inv1Ampacity), String(ambientTemp), String(tempFactor), String(invCorrected),
    String(inv75CMax), String(invUsable),
  ])

  // Generation disconnect row
  condRows.push([
    'GEN', 'GENERATION DISCONNECT',
    String(genFla), String(genFla125), '125',
    '3', '#1 AWG', '1', '#6 AWG', 'THWN-2', '1-1/4" EMT',
    String(inv1Ampacity), String(ambientTemp), String(tempFactor), String(invCorrected),
    String(inv75CMax), String(invUsable),
  ])

  const condColHeaders = [
    'TAG', 'CIRCUIT ORIGIN', 'FLA (A)', 'FLA×1.25', 'OCPD (A)',
    '# WIRES', 'WIRE SIZE', '# GND', 'GND SIZE', 'WIRE TYPE', 'CONDUIT',
    'AMPACITY', 'AMB °C', 'TEMP CF', 'CORR AMP', '75°C MAX', 'USABLE',
  ]
  const condColX = [12, 45, 200, 245, 295, 340, 380, 430, 465, 525, 580, 655, 710, 760, 810, 870, 930]

  // BOM rows
  const attachments = Math.ceil(data.panelCount * 2.2)
  const rails = Math.ceil(data.panelCount * 0.7)
  const railSplices = Math.ceil(data.panelCount * 0.4)
  const midClamps = Math.ceil(data.panelCount * 1.5)
  const endClamps = Math.ceil(data.panelCount * 1.0)

  const bomRows: [string, string, string][] = [
    ['SOLAR PV MODULE', String(data.panelCount), data.panelModel],
    ['RAPID SHUTDOWN DEVICE', String(data.panelCount), 'APSMART RSD-D-20'],
    ['EMERGENCY POWER OFF', '1', 'DURACELL EMERGENCY STOP BUTTON'],
    ['INVERTER', String(data.inverterCount), data.inverterModel],
    ['BATTERY', String(data.batteryCount), data.batteryModel],
    ['JUNCTION BOX', '2', 'JUNCTION BOXES'],
    ['AC DISCONNECT', '1', '200A/2P NON-FUSIBLE DISCONNECT 240V N3R'],
    ['ATTACHMENT', String(attachments), `${data.rackingModel} ROOF ATTACHMENT`],
    ['RAIL CLICKER', String(attachments), `${data.rackingModel} RAIL CLICKER`],
    ['RAIL', String(rails), 'CF LTE US RAIL AL MLL 165.4" 2012034'],
    ['RAIL SPLICE', String(railSplices), 'CF RAIL SPLICE SS 2012013'],
    ['MID CLAMPS', String(midClamps), 'MID CLAMP ASSEMBLY'],
    ['END CLAMPS', String(endClamps), 'END CLAMP ASSEMBLY'],
    ['GROUNDING LUG', '5', 'GROUNDING LUGS'],
  ]

  const tableStartY = 55
  const condTableEndY = tableStartY + headerH + condRows.length * rowH + 10
  const bomStartY = condTableEndY + 15

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full bg-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <rect width={SHEET_W} height={SHEET_H} fill="white" />
      <DrawingBorder />

      {/* ── CONDUCTOR AND CONDUIT SCHEDULE ── */}
      <text x="12" y="25" fontSize="7" fontWeight="bold" fill="#111">
        CONDUCTOR AND CONDUIT SCHEDULE WITH AMPACITY CALCULATIONS
      </text>
      <text x="12" y="37" fontSize="5" fill="#555">
        WIRES ARE 90°C RATED THWN-2 @ 30°C (CU) | CONDUIT HEIGHT ABOVE ROOF IS OVER 7/8&quot; | NEC 310.12 (83% RULE)
      </text>

      {/* Header row */}
      <rect x="12" y={tableStartY} width="960" height={headerH} fill="#111" />
      {condColHeaders.map((h, i) => (
        <text key={i} x={condColX[i]} y={tableStartY + 11} fontSize="4.5" fontWeight="bold" fill="white">{h}</text>
      ))}

      {/* Data rows */}
      {condRows.map((row, ri) => {
        const ry = tableStartY + headerH + ri * rowH
        return (
          <g key={`cond-${ri}`}>
            <rect x="12" y={ry} width="960" height={rowH}
              fill={ri % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ddd" strokeWidth="0.3" />
            {row.map((val, ci) => (
              <text key={ci} x={condColX[ci]} y={ry + 9} fontSize="4.5" fill="#333">{val}</text>
            ))}
          </g>
        )
      })}

      {/* ── BILL OF MATERIALS ── */}
      <text x="12" y={bomStartY} fontSize="10" fontWeight="bold" fill="#111">BILL OF MATERIALS</text>

      <rect x="12" y={bomStartY + 10} width="960" height={headerH} fill="#111" />
      {['EQUIPMENT', 'QTY', 'DESCRIPTION'].map((h, i) => (
        <text key={i} x={[17, 250, 320][i]} y={bomStartY + 21} fontSize="6.5" fontWeight="bold" fill="white">{h}</text>
      ))}

      {bomRows.map((row, i) => {
        const ry = bomStartY + 10 + headerH + i * rowH
        return (
          <g key={`bom-${i}`}>
            <rect x="12" y={ry} width="960" height={rowH}
              fill={i % 2 === 0 ? '#f9f9f9' : 'white'} stroke="#ddd" strokeWidth="0.3" />
            <text x="17" y={ry + 9} fontSize="6.5" fontWeight="bold" fill="#111">{row[0]}</text>
            <text x="260" y={ry + 9} fontSize="6.5" fill="#333" textAnchor="middle">{row[1]}</text>
            <text x="320" y={ry + 9} fontSize="6.5" fill="#333">{row[2]}</text>
          </g>
        )
      })}

      <TitleBlock sheetName="CONDUCTOR SCHEDULE & BOM" sheetNumber="PV-8" data={data} />
    </svg>
  )
}

// ── PRINT HANDLER ───────────────────────────────────────────────────────────

function handlePrintAll(data: PlansetData) {
  const sheets = document.querySelectorAll('.plan-sheet svg')
  if (!sheets.length) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) { const t = document.createElement('div'); t.textContent = 'Please allow popups to print.'; t.className = 'fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium bg-red-600 text-white'; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); return }

  let svgContent = ''
  sheets.forEach((svg) => {
    svgContent += `<div class="sheet">${svg.outerHTML}</div>`
  })

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Plan Set — ${data.projectId} ${data.owner}</title>
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

// ── PROJECT SELECTOR ────────────────────────────────────────────────────────

function ProjectSelector({ onSelect }: { onSelect: (id: string) => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Pick<Project, 'id' | 'name' | 'city'>[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); setShowDropdown(false); return }
    setSearching(true)
    try {
      const results = await searchProjects(q, 15)
      setSearchResults(results)
      setShowDropdown(results.length > 0)
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(searchQuery), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery, doSearch])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="max-w-2xl mx-auto" ref={containerRef}>
      <div className="bg-gray-800 rounded-xl p-8 border border-gray-700">
        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-8 h-8 text-green-400" />
          <div>
            <h2 className="text-xl font-bold text-white">Generate Plan Set</h2>
            <p className="text-sm text-gray-400 mt-1">Search for a project by ID or homeowner name</p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => { if (searchResults.length > 0) setShowDropdown(true) }}
            placeholder="e.g. PROJ-29857 or Aguilera"
            className="w-full pl-10 pr-10 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            autoFocus
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
          {!searching && searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          )}

          {showDropdown && (
            <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-72 overflow-y-auto">
              {searchResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onSelect(p.id); setShowDropdown(false); setSearchQuery(`${p.id} ${p.name}`) }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0"
                >
                  <span className="text-xs font-mono text-green-400">{p.id}</span>
                  <span className="text-sm text-white ml-2">{p.name}</span>
                  {p.city && <span className="text-xs text-gray-500 ml-2">{p.city}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-3">
          Tip: You can also link directly with <code className="text-gray-400">?project=PROJ-XXXXX</code>
        </p>
      </div>
    </div>
  )
}

// ── OVERRIDES PANEL ─────────────────────────────────────────────────────────

function OverridesPanel({ data, strings, onStringsChange, overrides, onOverridesChange }: {
  data: PlansetData
  strings: PlansetString[]
  onStringsChange: (s: PlansetString[]) => void
  overrides: PlansetOverrides
  onOverridesChange: (o: PlansetOverrides) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const updateStringModules = (idx: number, modules: number) => {
    const updated = [...strings]
    updated[idx] = {
      ...updated[idx],
      modules,
      vocCold: parseFloat((modules * data.vocCorrected).toFixed(1)),
      vmpNominal: parseFloat((modules * data.panelVmp).toFixed(1)),
    }
    onStringsChange(updated)
  }

  const addString = () => {
    const nextId = strings.length > 0 ? Math.max(...strings.map(s => s.id)) + 1 : 1
    const nextMppt = strings.length > 0 ? Math.max(...strings.map(s => s.mppt)) + 1 : 1
    onStringsChange([...strings, {
      id: nextId,
      mppt: nextMppt,
      modules: 9,
      roofFace: 1,
      vocCold: parseFloat((9 * data.vocCorrected).toFixed(1)),
      vmpNominal: parseFloat((9 * data.panelVmp).toFixed(1)),
      current: data.panelImp,
    }])
  }

  const removeString = (idx: number) => {
    onStringsChange(strings.filter((_, i) => i !== idx))
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:text-white transition-colors"
      >
        <span>Overrides &amp; String Configuration ({strings.length} strings, {strings.reduce((s, x) => s + x.modules, 0)} modules)</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-700 pt-4 space-y-6">
          {/* Building overrides */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Building Info</h3>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Roof Type', key: 'roofType' as const, val: overrides.roofType ?? data.roofType },
                { label: 'Rafter Size', key: 'rafterSize' as const, val: overrides.rafterSize ?? data.rafterSize },
                { label: 'Stories', key: 'stories' as const, val: String(overrides.stories ?? data.stories) },
                { label: 'Wind Speed (MPH)', key: 'windSpeed' as const, val: String(overrides.windSpeed ?? data.windSpeed) },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
                  <input
                    value={f.val}
                    onChange={e => {
                      const v = e.target.value
                      if (f.key === 'stories' || f.key === 'windSpeed') {
                        onOverridesChange({ ...overrides, [f.key]: parseInt(v) || 0 })
                      } else {
                        onOverridesChange({ ...overrides, [f.key]: v })
                      }
                    }}
                    className="w-full px-2 py-1.5 bg-gray-900 border border-gray-600 rounded text-sm text-white focus:ring-1 focus:ring-green-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Existing system overrides */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Existing System (Optional)</h3>
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Panel Model', key: 'existingPanelModel' as const, val: overrides.existingPanelModel ?? data.existingPanelModel ?? '' },
                { label: 'Panel Count', key: 'existingPanelCount' as const, val: String(overrides.existingPanelCount ?? data.existingPanelCount ?? '') },
                { label: 'Panel Wattage', key: 'existingPanelWattage' as const, val: String(overrides.existingPanelWattage ?? data.existingPanelWattage ?? '') },
                { label: 'Inverter Model', key: 'existingInverterModel' as const, val: overrides.existingInverterModel ?? data.existingInverterModel ?? '' },
                { label: 'Inverter Count', key: 'existingInverterCount' as const, val: String(overrides.existingInverterCount ?? data.existingInverterCount ?? '') },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
                  <input
                    value={f.val}
                    onChange={e => {
                      const v = e.target.value
                      if (['existingPanelCount', 'existingPanelWattage', 'existingInverterCount'].includes(f.key)) {
                        onOverridesChange({ ...overrides, [f.key]: parseInt(v) || undefined })
                      } else {
                        onOverridesChange({ ...overrides, [f.key]: v || undefined })
                      }
                    }}
                    className="w-full px-2 py-1.5 bg-gray-900 border border-gray-600 rounded text-sm text-white focus:ring-1 focus:ring-green-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* String configuration table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">String Configuration</h3>
              <button onClick={addString}
                className="text-xs px-3 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors">
                + Add String
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="text-left py-1 px-2">String</th>
                  <th className="text-left py-1 px-2">MPPT</th>
                  <th className="text-left py-1 px-2">Modules</th>
                  <th className="text-left py-1 px-2">Roof Face</th>
                  <th className="text-left py-1 px-2">Voc Cold</th>
                  <th className="text-left py-1 px-2">Vmp</th>
                  <th className="text-left py-1 px-2">Imp</th>
                  <th className="text-left py-1 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {strings.map((s, i) => (
                  <tr key={s.id} className="border-b border-gray-700/50">
                    <td className="py-1 px-2 text-gray-300">S{s.id}</td>
                    <td className="py-1 px-2">
                      <input value={s.mppt} onChange={e => {
                        const updated = [...strings]; updated[i] = { ...s, mppt: parseInt(e.target.value) || 1 }; onStringsChange(updated)
                      }} className="w-14 px-1 py-0.5 bg-gray-900 border border-gray-700 rounded text-xs text-white" />
                    </td>
                    <td className="py-1 px-2">
                      <input value={s.modules} onChange={e => updateStringModules(i, parseInt(e.target.value) || 0)}
                        className="w-14 px-1 py-0.5 bg-gray-900 border border-gray-700 rounded text-xs text-white" />
                    </td>
                    <td className="py-1 px-2">
                      <input value={s.roofFace} onChange={e => {
                        const updated = [...strings]; updated[i] = { ...s, roofFace: parseInt(e.target.value) || 1 }; onStringsChange(updated)
                      }} className="w-14 px-1 py-0.5 bg-gray-900 border border-gray-700 rounded text-xs text-white" />
                    </td>
                    <td className="py-1 px-2 text-gray-400 text-xs">{s.vocCold.toFixed(1)}V</td>
                    <td className="py-1 px-2 text-gray-400 text-xs">{s.vmpNominal.toFixed(1)}V</td>
                    <td className="py-1 px-2 text-gray-400 text-xs">{s.current}A</td>
                    <td className="py-1 px-2">
                      <button onClick={() => removeString(i)} className="text-red-400/60 hover:text-red-400 text-xs">
                        <X className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {strings.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-4">No strings configured. Click &quot;+ Add String&quot; or auto-distribute will be used.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
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

  // Data state
  const [projectId, setProjectId] = useState<string>('')
  const [data, setData] = useState<PlansetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [strings, setStrings] = useState<PlansetString[]>([])
  const [overrides, setOverrides] = useState<PlansetOverrides>({})

  // Load project by ID
  const loadProject = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const project = await loadProjectById(id)
      if (!project) {
        setToast({ message: `Project ${id} not found`, type: 'error' })
        setTimeout(() => setToast(null), 3000)
        return
      }

      // Auto-distribute strings based on panel count
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
      const maxVoc = overrides.maxPvPower ? 500 : d.maxVoc

      const autoStrings = autoDistributeStrings(
        panelCount, vocCorrected, panelVmp, panelImp,
        inverterCount, mpptsPerInverter, stringsPerMppt, maxVoc
      )

      // Use override strings if provided, else auto-distributed
      const finalStrings = overrides.strings ?? autoStrings
      setStrings(finalStrings)

      const plansetData = buildPlansetData(project, { ...overrides, strings: finalStrings })
      setData(plansetData)
      setProjectId(id)
    } catch (err) {
      console.error('Failed to load project:', err)
      setToast({ message: 'Failed to load project', type: 'error' })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setLoading(false)
    }
  }, [overrides])

  // Read project from URL params on mount
  useEffect(() => {
    const urlProject = searchParams.get('project')
    if (urlProject && !projectId) {
      loadProject(urlProject)
    }
  }, [searchParams, projectId, loadProject])

  // Rebuild data when strings or overrides change (only if we have a project loaded)
  const rebuildData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const project = await loadProjectById(projectId)
      if (!project) return
      const plansetData = buildPlansetData(project, { ...overrides, strings })
      setData(plansetData)
    } finally {
      setLoading(false)
    }
  }, [projectId, strings, overrides])

  // Debounced rebuild on overrides/strings change
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!projectId) return
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current)
    rebuildTimerRef.current = setTimeout(() => rebuildData(), 500)
    return () => { if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current) }
  }, [projectId, strings, overrides, rebuildData])

  // Clear data to go back to selector
  const clearProject = () => {
    setProjectId('')
    setData(null)
    setStrings([])
    setOverrides({})
  }

  // Role gate: Manager+ only
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
        {/* Loading overlay */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-green-400 animate-spin mr-3" />
            <span className="text-gray-400 text-sm">Loading project data...</span>
          </div>
        )}

        {/* Project selector when no data */}
        {!loading && !data && (
          <ProjectSelector onSelect={loadProject} />
        )}

        {/* Plan set sheets when data is loaded */}
        {!loading && data && (
          <>
            {/* Header */}
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
                <button
                  onClick={clearProject}
                  className="px-4 py-2 text-sm rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  Change Project
                </button>
                <a href="/redesign"
                  className="px-4 py-2 text-sm rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  Back to Redesign
                </a>
                <button
                  onClick={() => handlePrintAll(data)}
                  className="px-5 py-2 text-sm font-medium rounded-md bg-green-600 hover:bg-green-500 text-white transition-colors">
                  Download as PDF
                </button>
                <span className="text-xs text-gray-500">Select &quot;Save as PDF&quot; in the print dialog</span>
              </div>
            </div>

            {/* Overrides panel */}
            <OverridesPanel
              data={data}
              strings={strings}
              onStringsChange={setStrings}
              overrides={overrides}
              onOverridesChange={setOverrides}
            />

            {/* Sheets */}
            <div className="plan-sheet space-y-8">
              {/* PV-1 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-1</span>
                  <span className="text-sm text-gray-400">Cover Page &amp; General Notes</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV1 data={data} />
                </div>
              </div>

              {/* PV-2 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-2</span>
                  <span className="text-sm text-gray-400">Project Data</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV2 data={data} />
                </div>
              </div>

              {/* PV-5 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-5</span>
                  <span className="text-sm text-gray-400">Single Line Diagram</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV5 data={data} />
                </div>
              </div>

              {/* PV-5.1 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-5.1</span>
                  <span className="text-sm text-gray-400">PCS Labels</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV51 data={data} />
                </div>
              </div>

              {/* PV-6 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-6</span>
                  <span className="text-sm text-gray-400">Wiring Calculations</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV6 data={data} />
                </div>
              </div>

              {/* PV-7 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-7</span>
                  <span className="text-sm text-gray-400">Warning Labels</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV7 data={data} />
                </div>
              </div>

              {/* PV-7.1 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-7.1</span>
                  <span className="text-sm text-gray-400">Equipment Placards</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV71 data={data} />
                </div>
              </div>

              {/* PV-8 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">PV-8</span>
                  <span className="text-sm text-gray-400">Conductor Schedule &amp; BOM</span>
                </div>
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <SheetPV8 data={data} />
                </div>
              </div>
            </div>

            {/* Footer */}
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
