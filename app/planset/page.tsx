'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Nav } from '@/components/Nav'
import { calculateSldLayout } from '@/lib/sld-layout'
import { SldRenderer } from '@/components/SldRenderer'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { loadProjectById, searchProjects } from '@/lib/api'
import { buildPlansetData, DURACELL_DEFAULTS } from '@/lib/planset-types'
import type { PlansetData, PlansetOverrides, PlansetString, PlansetRoofFace } from '@/lib/planset-types'
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

// ── PRINT CSS ───────────────────────────────────────────────────────────────

const PRINT_CSS = `
@page {
  size: 17in 11in;
  margin: 0.25in;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
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

/* Label boxes for PV-5.1 and PV-7 */
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

// ── TITLE BLOCK (HTML) ─────────────────────────────────────────────────────

function TitleBlockHtml({ sheetName, sheetNumber, data }: { sheetName: string; sheetNumber: string; data: PlansetData }) {
  return (
    <div className="sheet-sidebar" style={{ borderLeft: '1px solid #000', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ flex: 1 }} />
      <div className="stamp-box" style={{ border: '1.5px solid #000', height: '0.8in', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7pt', color: '#999', margin: '0.05in' }}>
        ENGINEER&apos;S STAMP
      </div>
      <div className="title-block" style={{ borderTop: '1px solid #000', padding: '0.08in', fontSize: '6.5pt', lineHeight: 1.5 }}>
        <div style={{ fontWeight: 'bold', fontSize: '7pt' }}>{data.contractor.name}</div>
        <div>{data.contractor.address}, {data.contractor.city}</div>
        <div>Ph: {data.contractor.phone} | Lic# {data.contractor.license}</div>
        <div style={{ fontWeight: 'bold', marginTop: '3pt' }}>{data.projectId} {data.owner}</div>
        <div>{data.address}</div>
        <div style={{ fontSize: '6pt', color: '#333' }}>DRAWN: MicroGRID | DATE: {data.drawnDate}</div>
        <div style={{ fontWeight: 'bold', fontSize: '8pt', marginTop: '4pt' }}>{sheetName}</div>
        <div>
          <span style={{ fontWeight: 'bold', fontSize: '14pt' }}>{sheetNumber}</span>
          <span style={{ fontSize: '7pt', color: '#333', marginLeft: '8px' }}>of {data.sheetTotal}</span>
        </div>
      </div>
    </div>
  )
}

// ── SHEET PV-1: COVER PAGE ──────────────────────────────────────────────────

function SheetPV1({ data }: { data: PlansetData }) {
  const generalNotes = [
    'ALL WORK SHALL COMPLY WITH THE LATEST EDITION OF THE NEC (NFPA 70) AND ALL APPLICABLE LOCAL CODES.',
    'ALL WIRING METHODS AND MATERIALS SHALL COMPLY WITH NEC ARTICLES 690, 705, AND 706.',
    'ALL PV MODULES SHALL BE LISTED TO UL 1703 OR UL 61730.',
    'INVERTER(S) SHALL BE LISTED TO UL 1741 AND/OR UL 1741SA FOR UTILITY INTERACTIVE OPERATION.',
    'ALL EQUIPMENT SHALL BE INSTALLED PER MANUFACTURER INSTRUCTIONS AND SPECIFICATIONS.',
    'RAPID SHUTDOWN SHALL COMPLY WITH NEC 690.12. MODULE-LEVEL POWER ELECTRONICS PROVIDE COMPLIANCE.',
    'ARC-FAULT CIRCUIT PROTECTION SHALL COMPLY WITH NEC 690.11.',
    'ALL ROOF PENETRATIONS SHALL BE PROPERLY FLASHED AND SEALED TO MAINTAIN ROOF WARRANTY.',
    'EQUIPMENT GROUNDING SHALL COMPLY WITH NEC 250.134 AND 690.43.',
    'GROUNDING ELECTRODE SYSTEM SHALL COMPLY WITH NEC 250.50 AND 250.52.',
    'PV SYSTEM DC CIRCUITS SHALL BE INSTALLED PER NEC 690.31.',
    'MAXIMUM SYSTEM VOLTAGE SHALL NOT EXCEED 600V DC PER NEC 690.7.',
    'OVERCURRENT PROTECTION SHALL COMPLY WITH NEC 690.9.',
    'ALL CONDUCTORS SHALL BE COPPER AND RATED FOR WET LOCATIONS.',
    'GROUND-MOUNTED OR ROOF-MOUNTED CONDUIT SHALL BE RATED FOR OUTDOOR USE.',
    'SYSTEM SHALL BE INSPECTED AND APPROVED PRIOR TO INTERCONNECTION.',
  ]

  const pvNotes = [
    'PV ARRAY OUTPUT CIRCUIT CONDUCTORS SHALL BE SIZED AT 125% OF Isc PER NEC 690.8(A).',
    'MAXIMUM SYSTEM VOLTAGE (Voc CORRECTED) SHALL NOT EXCEED INVERTER MAXIMUM INPUT VOLTAGE.',
    'STRING VOLTAGE RANGE (Vmp) SHALL FALL WITHIN INVERTER MPPT OPERATING RANGE.',
    'PV SOURCE CIRCUITS SHALL BE PROVIDED WITH OCPD PER NEC 690.9.',
    'ALL DC WIRING SHALL USE PV WIRE OR USE RATED PER NEC 690.31(C).',
    'MODULE-LEVEL RAPID SHUTDOWN DEVICES SHALL COMPLY WITH NEC 690.12(B)(2).',
    'BATTERY ENERGY STORAGE SYSTEM SHALL COMPLY WITH NEC ARTICLE 706.',
    'ESS SHALL BE INSTALLED IN ACCORDANCE WITH MANUFACTURER INSTALLATION MANUAL.',
  ]

  const codeRefs = [
    'NEC 2020 (NFPA 70)', 'IBC 2015', 'IRC 2015', 'ASCE 7-16',
    'UL 1703 / UL 61730', 'UL 1741 / UL 1741SA', 'UL 9540 (ESS)', 'IEEE 1547',
  ]

  const unitIndex: [string, string][] = [
    ['MSP', 'MAIN SERVICE PANEL'], ['SP', 'SUB PANEL'], ['MDP', 'MAIN DISTRIBUTION PANEL'],
    ['GP', 'GROUND POINT'], ['PV', 'PHOTOVOLTAIC'], ['ESS', 'ENERGY STORAGE SYSTEM'],
    ['OCPD', 'OVERCURRENT PROTECTION DEVICE'], ['GEC', 'GROUNDING ELECTRODE CONDUCTOR'],
    ['EGC', 'EQUIPMENT GROUNDING CONDUCTOR'], ['RSD', 'RAPID SHUTDOWN DEVICE'],
    ['MPPT', 'MAX POWER POINT TRACKER'], ['Voc', 'OPEN CIRCUIT VOLTAGE'],
    ['Vmp', 'MAXIMUM POWER VOLTAGE'], ['Isc', 'SHORT CIRCUIT CURRENT'],
    ['Imp', 'MAXIMUM POWER CURRENT'],
  ]

  const sheetIndex: [string, string][] = [
    ['PV-1', 'COVER PAGE & GENERAL NOTES'], ['PV-2', 'PROJECT DATA'],
    ['PV-5', 'SINGLE LINE DIAGRAM'], ['PV-5.1', 'PCS LABELS'],
    ['PV-6', 'WIRING CALCULATIONS'], ['PV-7', 'WARNING LABELS'],
    ['PV-7.1', 'EQUIPMENT PLACARDS'], ['PV-8', 'CONDUCTOR SCHEDULE & BOM'],
  ]

  const storiesLabel = data.stories === 1 ? 'ONE' : String(data.stories)

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div className="sheet-title" style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>
          ROOF INSTALLATION OF {data.systemDcKw.toFixed(2)} KW DC PHOTOVOLTAIC SYSTEM
        </div>
        <div className="sheet-subtitle" style={{ fontSize: '8pt', color: '#555', marginBottom: '8pt' }}>
          WITH {data.totalStorageKwh} KWH BATTERY ENERGY STORAGE SYSTEM
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 0.9fr', gap: '8px' }}>
          {/* LEFT COLUMN */}
          <div>
            {/* PROJECT DATA */}
            <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div className="section-header" style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>PROJECT DATA</div>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt' }}>
                <tbody>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>PROJECT:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.projectId} {data.owner}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>ADDRESS:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.address}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>SYSTEM SIZE:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.systemDcKw.toFixed(2)} kWDC / {data.systemAcKw} kWAC</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>PV MODULES:</td><td style={{ padding: '2px 4px', color: '#333' }}>({data.panelCount}) {data.panelModel}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>INVERTERS:</td><td style={{ padding: '2px 4px', color: '#333' }}>({data.inverterCount}) {data.inverterModel}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>BATTERIES:</td><td style={{ padding: '2px 4px', color: '#333' }}>({data.batteryCount}) {data.batteryModel} = {data.totalStorageKwh} kWh</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>RACKING:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.rackingModel}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>ATTACHMENTS:</td><td style={{ padding: '2px 4px', color: '#333' }}>({data.racking.attachmentCount}) {data.racking.attachmentModel}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>RAIL:</td><td style={{ padding: '2px 4px', color: '#333' }}>({data.racking.railCount}) {data.racking.railModel}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>UTILITY:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.utility}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>METER #:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.meter}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>ESID:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.esid}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>BUILDING:</td><td style={{ padding: '2px 4px', color: '#333' }}>{storiesLabel} STORY, {data.buildingType}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>ROOF:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.roofType}, {data.rafterSize}</td></tr>
                  <tr><td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111' }}>WIND SPEED:</td><td style={{ padding: '2px 4px', color: '#333' }}>{data.windSpeed} MPH, Cat {data.riskCategory}, Exp {data.exposure}</td></tr>
                </tbody>
              </table>
            </div>

            {/* EXISTING SYSTEM */}
            {data.existingPanelModel && (
              <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
                <div style={{ background: '#555', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>EXISTING SYSTEM (TO REMAIN)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt' }}>
                  <tbody>
                    <tr><td style={{ fontWeight: 'bold', padding: '2px 4px' }}>PV MODULES:</td><td style={{ padding: '2px 4px' }}>({data.existingPanelCount ?? 0}) {data.existingPanelModel} ({data.existingPanelWattage ?? 0}W)</td></tr>
                    <tr><td style={{ fontWeight: 'bold', padding: '2px 4px' }}>INVERTERS:</td><td style={{ padding: '2px 4px' }}>({data.existingInverterCount ?? 0}) {data.existingInverterModel}</td></tr>
                    <tr><td style={{ fontWeight: 'bold', padding: '2px 4px' }}>EXISTING DC:</td><td style={{ padding: '2px 4px' }}>{((data.existingPanelCount ?? 0) * (data.existingPanelWattage ?? 0) / 1000).toFixed(2)} kW</td></tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* CODE REFERENCES */}
            <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div className="section-header" style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>CODE REFERENCES</div>
              <div style={{ padding: '4px 6px', fontSize: '6.5pt', lineHeight: 1.7 }}>
                {codeRefs.map((ref, i) => <div key={i}>{ref}</div>)}
              </div>
            </div>

            {/* UNIT INDEX */}
            <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div className="section-header" style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>UNIT INDEX</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6pt' }}>
                <tbody>
                  {unitIndex.map(([abbr, def], i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 'bold', padding: '1px 4px', color: '#111', width: '40px' }}>{abbr}</td>
                      <td style={{ padding: '1px 4px', color: '#333' }}>{def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* CENTER COLUMN */}
          <div>
            {/* GENERAL NOTES */}
            <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div className="section-header" style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>GENERAL NOTES</div>
              <ol style={{ padding: '4px 6px 4px 18px', fontSize: '5.5pt', lineHeight: 1.8, color: '#333' }}>
                {generalNotes.map((note, i) => <li key={i}>{note}</li>)}
              </ol>
            </div>

            {/* PHOTOVOLTAIC NOTES */}
            <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div className="section-header" style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>PHOTOVOLTAIC NOTES</div>
              <ol style={{ padding: '4px 6px 4px 18px', fontSize: '5.5pt', lineHeight: 1.8, color: '#333' }}>
                {pvNotes.map((note, i) => <li key={i}>{note}</li>)}
              </ol>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div>
            {/* CONTRACTOR */}
            <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div className="section-header" style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>CONTRACTOR</div>
              <div style={{ padding: '6px 8px', fontSize: '7pt', lineHeight: 1.8 }}>
                <div style={{ fontWeight: 'bold' }}>{data.contractor.name}</div>
                <div>{data.contractor.address}</div>
                <div>{data.contractor.city}</div>
                <div>Phone: {data.contractor.phone}</div>
                <div>License# {data.contractor.license}</div>
                <div>{data.contractor.email}</div>
              </div>
            </div>

            {/* SHEET INDEX */}
            <div className="section-box" style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div className="section-header" style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>SHEET INDEX</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt' }}>
                <tbody>
                  {sheetIndex.map(([num, title], i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 'bold', padding: '2px 6px', color: '#111', width: '45px' }}>{num}</td>
                      <td style={{ padding: '2px 4px', color: '#333' }}>{title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <TitleBlockHtml sheetName="COVER PAGE & GENERAL NOTES" sheetNumber="PV-1" data={data} />
    </div>
  )
}

// ── SHEET PV-2: PROJECT DATA PAGE ───────────────────────────────────────────

function SheetPV2({ data }: { data: PlansetData }) {
  const storiesLabel = data.stories === 1 ? 'ONE' : data.stories === 2 ? 'TWO' : String(data.stories)

  const roofRows = data.roofFaces.map(rf => ({
    roof: `ROOF ${rf.id}`,
    tilt: rf.tilt === 0 && rf.azimuth === 0 ? '\u2014' : `${rf.tilt}\u00B0`,
    azimuth: rf.tilt === 0 && rf.azimuth === 0 ? '\u2014' : `${rf.azimuth}\u00B0`,
    modules: rf.modules,
  }))

  const codeRefs: [string, string][] = [
    ['2020 (NEC)', 'NATIONAL ELECTRICAL CODE'], ['2018 (IBC)', 'INTERNATIONAL BUILDING CODE'],
    ['2018 (IRC)', 'INTERNATIONAL RESIDENTIAL CODE'], ['2018 (IMC)', 'INTERNATIONAL MECHANICAL CODE'],
    ['2018 (IPC)', 'INTERNATIONAL PLUMBING CODE'], ['2018 (IFC)', 'INTERNATIONAL FIRE CODE'],
    ['2018 (IECC)', 'INTERNATIONAL ENERGY CONSERVATION CODE'],
  ]

  const existingDcKw = data.existingPanelCount && data.existingPanelWattage
    ? (data.existingPanelCount * data.existingPanelWattage / 1000).toFixed(2) : null

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

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>PROJECT DATA PAGE</div>
        <div style={{ fontSize: '8pt', color: '#555', marginBottom: '8pt' }}>
          {data.systemDcKw.toFixed(2)} KW DC PHOTOVOLTAIC SYSTEM WITH {data.totalStorageKwh} KWH BATTERY ENERGY STORAGE
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          {/* LEFT COLUMN */}
          <div>
            {/* PROJECT DATA */}
            <div style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>PROJECT DATA</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <tbody>
                  {([
                    ['PROJECT ADDRESS', data.address],
                    ['', `${data.city}, TX ${data.zip}`],
                    ['OWNER', data.owner],
                    ['SYSTEM SIZE (DC)', `${data.systemDcKw.toFixed(2)} kWdc`],
                    ['SYSTEM SIZE (AC)', `${(data.panelCount * data.panelWattage / 1000).toFixed(2)} kWac`],
                  ] as [string, string][]).map(([label, value], i) => (
                    <tr key={i}>
                      {label ? <td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px', width: '40%' }}>{label}</td> : <td style={{ padding: '2px 4px' }} />}
                      <td style={{ padding: '2px 4px', color: '#111' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* SCOPE OF WORK */}
            <div style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div style={{ background: '#333', color: 'white', padding: '4px 6px', fontSize: '7pt', fontWeight: 'bold', textAlign: 'center' }}>SCOPE OF WORK</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <thead>
                  <tr style={{ background: '#eee' }}>
                    <th style={{ padding: '2px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6.5pt' }}>QUANTITY</th>
                    <th style={{ padding: '2px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6.5pt' }}>DESCRIPTION</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [String(data.panelCount), data.panelModel],
                    [String(data.inverterCount), data.inverterModel],
                    [String(data.batteryCount), data.batteryModel],
                    [String(data.racking.attachmentCount), data.racking.attachmentModel],
                    [String(data.racking.railCount), data.racking.railModel],
                    [String(data.racking.midClampCount), 'Mid Clamp Assembly'],
                    [String(data.racking.endClampCount), 'End Clamp Assembly'],
                  ].map(([qty, desc], i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                      <td style={{ padding: '2px 4px', textAlign: 'center' }}>{qty}</td>
                      <td style={{ padding: '2px 4px', color: '#333' }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* BUILDING INFORMATION */}
            <div style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>BUILDING INFORMATION</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <tbody>
                  {([
                    ['BUILDING TYPE', `${storiesLabel} STORY BUILDING`],
                    ['CONSTRUCTION TYPE', data.buildingType],
                    ['OCCUPANCY', data.occupancy],
                    ['ROOF TYPE', data.roofType],
                    ['RAFTERS', data.rafterSize],
                  ] as [string, string][]).map(([label, value], i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 'bold', color: '#999', padding: '3px 4px', width: '40%' }}>{label}</td>
                      <td style={{ padding: '3px 4px', color: '#111' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* CENTER COLUMN */}
          <div>
            {/* ROOF DESCRIPTION */}
            <div style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>NEW SYSTEM ROOF DESCRIPTION</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <thead>
                  <tr style={{ background: '#eee' }}>
                    <th style={{ padding: '2px 4px', fontSize: '6.5pt' }}>ROOF</th>
                    <th style={{ padding: '2px 4px', fontSize: '6.5pt' }}>ARRAY TILT</th>
                    <th style={{ padding: '2px 4px', fontSize: '6.5pt' }}>AZIMUTH</th>
                    <th style={{ padding: '2px 4px', fontSize: '6.5pt' }}># MODULES</th>
                  </tr>
                </thead>
                <tbody>
                  {roofRows.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                      <td style={{ padding: '2px 4px', textAlign: 'center' }}>{row.roof}</td>
                      <td style={{ padding: '2px 4px', textAlign: 'center' }}>{row.tilt}</td>
                      <td style={{ padding: '2px 4px', textAlign: 'center' }}>{row.azimuth}</td>
                      <td style={{ padding: '2px 4px', textAlign: 'center' }}>{row.modules}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* RACKING INFORMATION */}
            <div style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>RACKING INFORMATION</div>
              <div style={{ padding: '6px 8px', fontSize: '7pt' }}>
                <div>{data.rackingModel}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt', marginTop: '4px' }}>
                  <tbody>
                    <tr><td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px' }}>ATTACHMENT</td><td style={{ padding: '2px 4px' }}>{data.racking.attachmentModel}</td></tr>
                    <tr><td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px' }}>RAIL</td><td style={{ padding: '2px 4px' }}>{data.racking.railModel}</td></tr>
                  </tbody>
                </table>
                <div style={{ fontWeight: 'bold', marginTop: '6px' }}>DESIGN CRITERIA</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt', marginTop: '4px' }}>
                  <tbody>
                    <tr><td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px' }}>EXPOSURE CATEGORY</td><td style={{ padding: '2px 4px' }}>{data.exposure}</td></tr>
                    <tr><td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px' }}>WIND SPEED</td><td style={{ padding: '2px 4px' }}>{data.windSpeed} MPH</td></tr>
                    <tr><td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px' }}>RISK CATEGORY</td><td style={{ padding: '2px 4px' }}>{data.riskCategory}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div>
            {/* ELECTRICAL INFORMATION */}
            <div style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>ELECTRICAL INFORMATION</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <tbody>
                  {([
                    ['VOLTAGE', data.voltage],
                    ['MSP BUS RATING', `${data.mspBusRating}A`],
                    ['MAIN BREAKER', data.mainBreaker],
                    ['METER #', data.meter],
                    ['ESID', data.esid],
                    ['INTERCONNECTION TYPE', 'UTILITY INTERCONNECTION'],
                  ] as [string, string][]).map(([label, value], i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                      <td style={{ fontWeight: 'bold', color: '#999', padding: '3px 4px', width: '45%' }}>{label}</td>
                      <td style={{ padding: '3px 4px', color: '#111' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* CODE REFERENCES */}
            <div style={{ border: '1px solid #111', marginBottom: '6px' }}>
              <div style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>CODE REFERENCES</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <tbody>
                  {codeRefs.map(([code, desc], i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 'bold', padding: '2px 4px', color: '#111', width: '35%' }}>{code}</td>
                      <td style={{ padding: '2px 4px', color: '#333' }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* SYSTEM SUMMARY */}
        <div style={{ border: '1px solid #111', marginTop: '6px' }}>
          <div style={{ background: '#111', color: 'white', padding: '4px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>SYSTEM SUMMARY</div>
          <div style={{ display: 'grid', gridTemplateColumns: data.existingPanelModel ? '1fr 1fr' : '1fr', gap: '6px', padding: '4px' }}>
            {data.existingPanelModel && (
              <div>
                <div style={{ background: '#555', color: 'white', padding: '3px 6px', fontSize: '7pt', fontWeight: 'bold', textAlign: 'center' }}>EXISTING SYSTEM</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                  <tbody>
                    {existingRows.map(([label, value], i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#f5f5f5' : 'white' }}>
                        <td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px', width: '35%' }}>{label}</td>
                        <td style={{ padding: '2px 4px', color: '#333' }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <div style={{ background: '#1D9E75', color: 'white', padding: '3px 6px', fontSize: '7pt', fontWeight: 'bold', textAlign: 'center' }}>NEW SYSTEM</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
                <tbody>
                  {newRows.map(([label, value], i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#f5f5f5' : 'white' }}>
                      <td style={{ fontWeight: 'bold', color: '#999', padding: '2px 4px', width: '35%' }}>{label}</td>
                      <td style={{ padding: '2px 4px', color: '#111' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <TitleBlockHtml sheetName="PROJECT DATA" sheetNumber="PV-2" data={data} />
    </div>
  )
}

// ── SHEET PV-5: SINGLE LINE DIAGRAM (SVG) ──────────────────────────────────

function SheetPV5({ data }: { data: PlansetData }) {
  let sldStrings = data.strings
  let sldStringsPerInverter = data.stringsPerInverter
  const effectivePanelCount = data.panelCount > 0 ? data.panelCount : (data.existingPanelCount ?? 0)

  if (sldStrings.length === 0 && effectivePanelCount > 0) {
    const d = DURACELL_DEFAULTS
    sldStrings = autoDistributeStrings(
      effectivePanelCount, data.vocCorrected, data.panelVmp, data.panelImp,
      data.inverterCount, data.mpptsPerInverter, data.stringsPerMppt, d.maxVoc
    )
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
      id: s.id, modules: s.modules, roofFace: s.roofFace,
      vocCold: s.vocCold, vmp: s.vmpNominal, imp: s.current,
    })),
    stringsPerInverter: sldStringsPerInverter,
    meter: data.meter, esid: data.esid, utility: data.utility,
    systemDcKw: data.systemDcKw, systemAcKw: data.systemAcKw, totalStorageKwh: data.totalStorageKwh,
    existingPanels: data.existingPanelModel
      ? `(${data.existingPanelCount ?? 0}) ${data.existingPanelModel} (${data.existingPanelWattage ?? 0}W)` : undefined,
    existingInverters: data.existingInverterModel
      ? `(${data.existingInverterCount ?? 0}) ${data.existingInverterModel} (240V)` : undefined,
    existingDcKw: data.existingPanelCount && data.existingPanelWattage
      ? (data.existingPanelCount * data.existingPanelWattage) / 1000 : undefined,
    contractor: data.contractor.name,
    contractorAddress: `${data.contractor.address}, ${data.contractor.city}`,
    contractorPhone: data.contractor.phone,
    contractorLicense: data.contractor.license,
    contractorEmail: data.contractor.email,
  }

  const layout = calculateSldLayout(config)

  // PV-5 stays as SVG — render inside a sheet div
  return (
    <div className="sheet sld-sheet" style={{ display: 'grid', gridTemplateColumns: '1fr', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sld-content">
        <SldRenderer layout={layout} />
      </div>
    </div>
  )
}

// ── SHEET PV-5.1: PCS LABELS ────────────────────────────────────────────────

function SheetPV51({ data }: { data: PlansetData }) {
  const maxStringVocCold = data.strings.length > 0
    ? Math.max(...data.strings.map(s => s.vocCold)).toFixed(1) : '0.0'
  const totalAcAmps = (data.inverterAcPower * 1000 / 240).toFixed(1)

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
    lines: string[]
    borderColor?: string
  }

  const leftLabels: LabelDef[] = [
    {
      title: 'INVERTER LABEL', nec: 'NEC 690.54',
      lines: [
        'CAUTION: DUAL POWER SOURCE', '',
        'THIS EQUIPMENT IS SUPPLIED BY TWO POWER SOURCES:',
        `1. UTILITY GRID (240V AC, SINGLE PHASE)`,
        `2. PHOTOVOLTAIC SYSTEM (${data.systemDcKw.toFixed(2)} kW DC)`,
        `3. BATTERY ENERGY STORAGE (${data.totalStorageKwh} kWh)`, '',
        `INVERTER: (${data.inverterCount}) ${data.inverterModel}`,
        `RATED AC OUTPUT: ${data.inverterAcPower} kW PER UNIT, ${data.systemAcKw} kW TOTAL`,
        `RATED AC CURRENT: ${totalAcAmps}A @ 240V PER UNIT`,
      ],
    },
    {
      title: 'AC DISCONNECT LABEL', nec: 'NEC 690.14(C)',
      lines: [
        'AC DISCONNECT \u2014 SOLAR PHOTOVOLTAIC SYSTEM', '',
        'VOLTAGE: 240V AC, SINGLE PHASE',
        `MAX AC CURRENT: ${totalAcAmps}A PER INVERTER`,
        `TOTAL AC CURRENT: ${(parseFloat(totalAcAmps) * data.inverterCount).toFixed(1)}A`,
        'DISCONNECT RATING: 200A, NEMA 3R',
        'CAUTION: TURN OFF AC DISCONNECT BEFORE SERVICING INVERTER',
      ],
    },
    {
      title: 'PV DISCONNECT LABEL', nec: 'NEC 690.13',
      lines: [
        'DC DISCONNECT \u2014 PHOTOVOLTAIC SYSTEM', '',
        `MAXIMUM SYSTEM VOLTAGE (Voc @ -5\u00B0C): ${maxStringVocCold}V DC`,
        `MAXIMUM DC CURRENT: ${(data.panelIsc * 1.25).toFixed(1)}A (125% Isc)`,
        `STRINGS: ${stringDesc}`,
        `CONDUCTOR: ${data.dcStringWire}`,
        `CONDUIT: ${data.dcConduit}`,
        'WARNING: SHOCK HAZARD \u2014 DC CIRCUITS MAY BE ENERGIZED WHEN MODULES ARE EXPOSED TO LIGHT',
      ],
    },
  ]

  const rightLabels: LabelDef[] = [
    {
      title: 'MAIN PANEL LABEL', nec: 'NEC 705.12',
      lines: [
        'WARNING: SOLAR PHOTOVOLTAIC SYSTEM CONNECTED', '',
        `SOLAR SYSTEM: ${data.systemDcKw.toFixed(2)} kW DC / ${data.systemAcKw} kW AC`,
        `BATTERY STORAGE: ${data.totalStorageKwh} kWh`,
        `PV BACKFEED BREAKER: (${data.inverterCount}) 100A, 240V`,
        'CAUTION: DO NOT EXCEED BUS RATING WHEN ADDING BREAKERS',
        'SEE NEC 705.12 FOR 120% BUS BAR RATING RULE',
      ],
    },
    {
      title: 'UTILITY METER LABEL', nec: 'NEC 705.10',
      lines: [
        'NET METERING \u2014 PHOTOVOLTAIC SYSTEM', '',
        `UTILITY: ${data.utility}`,
        `METER: ${data.meter}`,
        `ESID: ${data.esid}`,
        `SYSTEM OUTPUT: ${data.systemAcKw} kW AC`,
      ],
    },
    {
      title: 'BATTERY WARNING LABEL', nec: 'NEC 706.30', borderColor: '#cc0000',
      lines: [
        'WARNING: BATTERY ENERGY STORAGE SYSTEM', '',
        `BATTERY: (${data.batteryCount}) ${data.batteryModel}`,
        `TOTAL STORAGE: ${data.totalStorageKwh} kWh, LFP CHEMISTRY`,
        'NOMINAL VOLTAGE: 51.2V DC PER BATTERY', '',
        'CAUTION: CHEMICAL HAZARD \u2014 LITHIUM IRON PHOSPHATE BATTERIES',
        'CAUTION: ELECTRICAL SHOCK HAZARD \u2014 DC CIRCUITS MAY BE ENERGIZED',
        'DO NOT OPEN BATTERY ENCLOSURE \u2014 NO USER-SERVICEABLE PARTS',
      ],
    },
    {
      title: 'RAPID SHUTDOWN LABEL', nec: 'NEC 690.12', borderColor: '#cc0000',
      lines: [
        'RAPID SHUTDOWN SYSTEM', '',
        'THIS SYSTEM IS EQUIPPED WITH MODULE-LEVEL RAPID SHUTDOWN',
        'COMPLIANT WITH NEC 690.12(B)(2)', '',
        'TO INITIATE RAPID SHUTDOWN: TURN OFF AC DISCONNECT',
        'ARRAY VOLTAGE WILL REDUCE TO <30V WITHIN 30 SECONDS',
      ],
    },
  ]

  function renderLabel(label: LabelDef, i: number) {
    const bc = label.borderColor || '#111'
    const isRed = bc === '#cc0000'
    return (
      <div key={i} style={{ border: `${isRed ? '2px' : '1.5px'} solid ${bc}`, marginBottom: '8px', overflow: 'hidden' }}>
        <div style={{ background: bc, color: 'white', padding: '3px 6px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center', position: 'relative' }}>
          {label.title}
          <span style={{ position: 'absolute', right: '5px', top: '3px', fontSize: '6pt', color: '#ddd', fontWeight: 'normal' }}>{label.nec}</span>
        </div>
        <div style={{ padding: '5px 8px', fontSize: '6.5pt', lineHeight: 1.6 }}>
          {label.lines.map((line, j) => {
            if (!line) return <br key={j} />
            const isWarn = line.startsWith('CAUTION') || line.startsWith('WARNING') || line.startsWith('DO NOT')
            return (
              <div key={j} style={{ fontWeight: j === 0 ? 'bold' : 'normal', color: isWarn ? '#cc0000' : '#333' }}>
                {line}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>PCS LABELS &mdash; NEC REQUIRED EQUIPMENT LABELS</div>
        <div style={{ fontSize: '8pt', color: '#555', marginBottom: '8pt' }}>ALL LABELS SHALL BE PERMANENT, WEATHER-RESISTANT, AND INSTALLED AT POINT OF APPLICATION</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>{leftLabels.map((l, i) => renderLabel(l, i))}</div>
          <div>{rightLabels.map((l, i) => renderLabel(l, i))}</div>
        </div>
      </div>
      <TitleBlockHtml sheetName="PCS LABELS" sheetNumber="PV-5.1" data={data} />
    </div>
  )
}

// ── SHEET PV-6: WIRING CALCULATIONS ─────────────────────────────────────────

function SheetPV6({ data }: { data: PlansetData }) {
  const wireResistance: Record<string, number> = {
    '#14': 3.14, '#12': 1.98, '#10': 1.24, '#8': 0.778, '#6': 0.491,
    '#4': 0.308, '#3': 0.245, '#2': 0.194, '#1': 0.154, '1/0': 0.122,
  }

  const strings = data.strings.map((s, i) => {
    const voc = s.modules * data.panelVoc
    const vocCold = s.vocCold
    const vmp = s.vmpNominal
    const isc = data.panelIsc
    const runFt = 100
    const wireSize = '#10'
    const conductor125 = isc * 1.25
    const vDrop = (2 * runFt * isc * wireResistance[wireSize]) / 1000
    const vDropPct = (vDrop / vmp) * 100
    return {
      id: i + 1, modules: s.modules, mppt: s.mppt,
      voc: voc.toFixed(1), vocCold: vocCold.toFixed(1), vmp: vmp.toFixed(1),
      isc: isc.toFixed(1), conductor125: conductor125.toFixed(1),
      wireSize, conduit: data.dcConduit, runFt,
      vDrop: vDrop.toFixed(2), vDropPct: vDropPct.toFixed(2),
      status: vDropPct < 2 ? 'PASS' : 'FAIL',
    }
  })

  const acCurrentPerInv = data.inverterAcPower * 1000 / 240
  const acCurrent125 = acCurrentPerInv * 1.25
  const acRunFt = 50
  const acVDrop = (2 * acRunFt * acCurrentPerInv * wireResistance['#4']) / 1000
  const acVDropPct = (acVDrop / 240) * 100

  const battCurrentPerStack = 23000 / 51.2
  const battCurrent125 = battCurrentPerStack * 1.25

  const stringFuseCalc = data.panelIsc * 1.56
  const stringFuseSize = Math.ceil(stringFuseCalc / 5) * 5

  const tempCF = 0.91

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>WIRING CALCULATIONS</div>
        <div style={{ fontSize: '8pt', color: '#555', marginBottom: '6pt' }}>ALL CONDUCTORS COPPER (CU), RATED 75&deg;C MINIMUM. VOLTAGE DROP LIMIT: 2% DC, 3% AC.</div>

        {/* DC STRING WIRING */}
        <div style={{ fontWeight: 'bold', fontSize: '9pt', color: '#111', marginBottom: '3px' }}>DC STRING WIRE SIZING (NEC 690.8)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt', marginBottom: '8px' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              {['STRING', 'MODULES', 'Voc (V)', 'Voc COLD', 'Vmp (V)', 'Isc (A)', '125% Isc', 'WIRE', 'CONDUIT', 'RUN (ft)', 'V DROP', '% DROP', 'STATUS'].map((h, i) => (
                <th key={i} style={{ color: 'white', padding: '3px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6pt', textTransform: 'uppercase' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strings.map((s, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                <td style={{ padding: '2px 4px' }}>S{s.id} (MPPT {s.mppt})</td>
                <td style={{ padding: '2px 4px' }}>{s.modules}</td>
                <td style={{ padding: '2px 4px' }}>{s.voc}</td>
                <td style={{ padding: '2px 4px' }}>{s.vocCold}</td>
                <td style={{ padding: '2px 4px' }}>{s.vmp}</td>
                <td style={{ padding: '2px 4px' }}>{s.isc}</td>
                <td style={{ padding: '2px 4px' }}>{s.conductor125}</td>
                <td style={{ padding: '2px 4px' }}>{s.wireSize} AWG CU</td>
                <td style={{ padding: '2px 4px' }}>{s.conduit}</td>
                <td style={{ padding: '2px 4px' }}>{s.runFt}</td>
                <td style={{ padding: '2px 4px' }}>{s.vDrop}V</td>
                <td style={{ padding: '2px 4px' }}>{s.vDropPct}%</td>
                <td style={{ padding: '2px 4px', color: s.status === 'FAIL' ? '#cc0000' : '#006600', fontWeight: 'bold' }}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* AC WIRING */}
        <div style={{ fontWeight: 'bold', fontSize: '9pt', color: '#111', marginBottom: '3px' }}>INVERTER TO PANEL &mdash; AC WIRE SIZING (NEC 310.16)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt', marginBottom: '8px' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              {['CIRCUIT', 'VOLTAGE', 'POWER', 'CURRENT', '125%', 'WIRE', 'CONDUIT', 'RUN (ft)', 'V DROP', '% DROP', 'STATUS'].map((h, i) => (
                <th key={i} style={{ color: 'white', padding: '3px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6pt', textTransform: 'uppercase' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.strings.length > 0 && (
              <tr style={{ background: '#f9f9f9' }}>
                <td style={{ padding: '2px 4px' }}>INV &rarr; PANEL (x{data.inverterCount})</td>
                <td style={{ padding: '2px 4px' }}>240V AC</td>
                <td style={{ padding: '2px 4px' }}>{data.inverterAcPower} kW</td>
                <td style={{ padding: '2px 4px' }}>{acCurrentPerInv.toFixed(1)}A</td>
                <td style={{ padding: '2px 4px' }}>{acCurrent125.toFixed(1)}A</td>
                <td style={{ padding: '2px 4px' }}>{data.acWireToPanel}</td>
                <td style={{ padding: '2px 4px' }}>{data.acConduit}</td>
                <td style={{ padding: '2px 4px' }}>{acRunFt}</td>
                <td style={{ padding: '2px 4px' }}>{acVDrop.toFixed(2)}V</td>
                <td style={{ padding: '2px 4px' }}>{acVDropPct.toFixed(2)}%</td>
                <td style={{ padding: '2px 4px', color: acVDropPct < 3 ? '#006600' : '#cc0000', fontWeight: 'bold' }}>{acVDropPct < 3 ? 'PASS' : 'FAIL'}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* BATTERY WIRING */}
        <div style={{ fontWeight: 'bold', fontSize: '9pt', color: '#111', marginBottom: '3px' }}>BATTERY WIRE SIZING (NEC 706)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt', marginBottom: '8px' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              {['CIRCUIT', 'VOLTAGE', 'CAPACITY', 'MAX CURRENT', '125%', 'WIRE', 'CONDUIT'].map((h, i) => (
                <th key={i} style={{ color: 'white', padding: '3px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6pt', textTransform: 'uppercase' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: '#f9f9f9' }}>
              <td style={{ padding: '2px 4px' }}>BATT &rarr; INV ({data.batteryCount}x {data.batteryModel})</td>
              <td style={{ padding: '2px 4px' }}>51.2V DC NOM</td>
              <td style={{ padding: '2px 4px' }}>{data.totalStorageKwh} kWh TOTAL</td>
              <td style={{ padding: '2px 4px' }}>{battCurrentPerStack.toFixed(1)}A</td>
              <td style={{ padding: '2px 4px' }}>{battCurrent125.toFixed(1)}A</td>
              <td style={{ padding: '2px 4px' }}>{data.batteryWire}</td>
              <td style={{ padding: '2px 4px' }}>{data.batteryConduit}</td>
            </tr>
          </tbody>
        </table>

        {/* OCPD */}
        <div style={{ fontWeight: 'bold', fontSize: '9pt', color: '#111', marginBottom: '3px' }}>OVERCURRENT PROTECTION DEVICE (OCPD) SIZING (NEC 690.9)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt', marginBottom: '8px' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              {['DEVICE', 'CALCULATION', 'RESULT', 'STANDARD SIZE', 'RATING'].map((h, i) => (
                <th key={i} style={{ color: 'white', padding: '3px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6pt', textTransform: 'uppercase' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['STRING FUSE', `Isc \u00D7 1.56 = ${data.panelIsc} \u00D7 1.56`, `${stringFuseCalc.toFixed(1)}A`, `${stringFuseSize}A`, '600V DC'],
              ['PV BREAKER (per INV)', 'Per inverter AC output rating', `${acCurrent125.toFixed(1)}A`, '100A', '240V AC'],
              ['MAIN BREAKER', 'Per system total AC capacity', `${(acCurrent125 * data.inverterCount).toFixed(1)}A`, '200A', '240V AC'],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                {row.map((val, j) => <td key={j} style={{ padding: '2px 4px' }}>{val}</td>)}
              </tr>
            ))}
          </tbody>
        </table>

        {/* GROUNDING */}
        <div style={{ fontWeight: 'bold', fontSize: '9pt', color: '#111', marginBottom: '3px' }}>GROUNDING CONDUCTOR SIZING (NEC 250)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt', marginBottom: '8px' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              {['CONDUCTOR', 'SIZE', 'REFERENCE', 'NOTES'].map((h, i) => (
                <th key={i} style={{ color: 'white', padding: '3px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6pt', textTransform: 'uppercase' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['EQUIPMENT GROUNDING (EGC)', '#6 AWG BARE CU', 'NEC 250.122', 'SIZED PER LARGEST OCPD'],
              ['GROUNDING ELECTRODE (GEC)', '#6 AWG BARE CU', 'NEC 250.66', 'TO EXISTING GROUNDING ELECTRODE'],
              ['MODULE FRAME BONDING', '#6 AWG BARE CU', 'NEC 690.43', 'VIA RACKING GROUNDING LUGS'],
              ['DC SYSTEM GROUNDING', '#10 AWG CU', 'NEC 690.41', 'EQUIPMENT GROUNDING ONLY (UNGROUNDED)'],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                {row.map((val, j) => <td key={j} style={{ padding: '2px 4px' }}>{val}</td>)}
              </tr>
            ))}
          </tbody>
        </table>

        {/* AMPACITY CORRECTION */}
        <div style={{ fontWeight: 'bold', fontSize: '9pt', color: '#111', marginBottom: '3px' }}>AMPACITY CORRECTION &mdash; NEC 310.12 (83% RULE)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt', marginBottom: '4px' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              {['CONDUCTOR', 'AMPACITY (A)', 'CONDUIT FILL', 'AMBIENT (\u00B0C)', 'TEMP CF', 'CORRECTED (A)', '75\u00B0C MAX (A)', 'USABLE (A)'].map((h, i) => (
                <th key={i} style={{ color: 'white', padding: '3px 4px', textAlign: 'left', fontWeight: 'bold', fontSize: '6pt', textTransform: 'uppercase' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([
              ['#10 AWG CU (DC STRING)', 40, 0.70, 37, 30],
              ['#4 AWG CU (BATTERY)', 95, 0.70, 37, 85],
              ['#1 AWG CU (INVERTER AC)', 145, 0.70, 37, 130],
              ['#6 AWG CU (EGC)', 75, 1.0, 37, 65],
            ] as [string, number, number, number, number][]).map((row, i) => {
              const corrected = parseFloat((row[1] * row[2] * tempCF).toFixed(1))
              const usable = Math.min(corrected, row[4])
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                  <td style={{ padding: '2px 4px' }}>{row[0]}</td>
                  <td style={{ padding: '2px 4px' }}>{row[1]}</td>
                  <td style={{ padding: '2px 4px' }}>{row[2]}</td>
                  <td style={{ padding: '2px 4px' }}>{row[3]}</td>
                  <td style={{ padding: '2px 4px' }}>{tempCF}</td>
                  <td style={{ padding: '2px 4px' }}>{corrected}</td>
                  <td style={{ padding: '2px 4px' }}>{row[4]}</td>
                  <td style={{ padding: '2px 4px', color: '#006600' }}>{usable}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ fontSize: '6.5pt', color: '#555' }}>
          Temp correction factor 0.91 for THWN-2 copper at 37&deg;C ambient (NEC Table 310.15(B)(1)). Conduit fill factor per NEC 310.15(C)(1).
        </div>

        {/* VOLTAGE DROP FORMULA */}
        <div style={{ marginTop: '6px', fontSize: '7pt' }}>
          <strong>VOLTAGE DROP FORMULA:</strong>
          <div style={{ fontSize: '6.5pt', color: '#333', marginTop: '2px' }}>
            V_drop = 2 &times; L &times; I &times; R / 1000 where L = length (ft), I = current (A), R = resistance (ohms/1000ft)
          </div>
          <div style={{ fontSize: '6.5pt', color: '#333' }}>
            DC circuits: V_drop must be &lt; 2% of Vmp | AC circuits: V_drop must be &lt; 3% of nominal voltage
          </div>
        </div>
      </div>
      <TitleBlockHtml sheetName="WIRING CALCULATIONS" sheetNumber="PV-6" data={data} />
    </div>
  )
}

// ── SHEET PV-7: WARNING LABELS ──────────────────────────────────────────────

function SheetPV7({ data }: { data: PlansetData }) {
  const maxVocCold = data.strings.length > 0
    ? Math.max(...data.strings.map(s => s.vocCold)).toFixed(1) : '0.0'
  const totalAcAmps = (data.inverterAcPower * 1000 / 240).toFixed(1)

  const stringGroupsMap = new Map<number, number>()
  data.strings.forEach(s => stringGroupsMap.set(s.modules, (stringGroupsMap.get(s.modules) ?? 0) + 1))
  const stringSummary = Array.from(stringGroupsMap.entries()).map(([m, c]) => `${c}\u00D7${m}`).join(' + ')
  const stringConfigLabel = stringSummary ? `${stringSummary} MODULES` : 'N/A'

  interface WarningLabel {
    title: string; nec: string; lines: string[]; color: 'red' | 'yellow' | 'black'
  }

  const labels: WarningLabel[] = [
    {
      title: 'SOLAR PV SYSTEM CONNECTED', nec: 'NEC 690.54', color: 'red',
      lines: ['WARNING', '', 'THIS ELECTRICAL PANEL IS SUPPLIED BY', 'A SOLAR PHOTOVOLTAIC SYSTEM.', '',
        `SYSTEM SIZE: ${data.systemDcKw.toFixed(2)} kW DC`, `AC OUTPUT: ${data.systemAcKw} kW`, `BATTERY: ${data.totalStorageKwh} kWh`],
    },
    {
      title: 'ELECTRIC SHOCK HAZARD', nec: 'NEC 690.31(G)', color: 'red',
      lines: ['DANGER', '', 'ELECTRIC SHOCK HAZARD', 'DO NOT TOUCH TERMINALS.', 'TERMINALS ON BOTH THE LINE',
        'AND LOAD SIDES MAY BE', 'ENERGIZED IN THE OPEN POSITION.'],
    },
    {
      title: 'DUAL POWER SOURCE', nec: 'NEC 705.12', color: 'yellow',
      lines: ['CAUTION', '', 'DUAL POWER SOURCE', 'THIS EQUIPMENT IS SUPPLIED BY', 'TWO POWER SOURCES: UTILITY GRID',
        'AND PHOTOVOLTAIC SYSTEM.', 'DISCONNECT BOTH BEFORE SERVICING.'],
    },
    {
      title: 'PHOTOVOLTAIC POWER SOURCE', nec: 'NEC 690.53', color: 'black',
      lines: ['PHOTOVOLTAIC POWER SOURCE', '', `MAX SYSTEM VOLTAGE (Voc COLD): ${maxVocCold}V DC`,
        `MAX CIRCUIT CURRENT (Isc): ${data.panelIsc}A`, `RATED OUTPUT: ${data.systemDcKw.toFixed(2)} kW DC`, '',
        `MODULES: (${data.panelCount}) ${data.panelModel}`, `STRINGS: ${stringConfigLabel}`, `Voc PER MODULE: ${data.panelVoc}V`],
    },
    {
      title: 'BATTERY STORAGE WARNING', nec: 'NEC 706.30', color: 'red',
      lines: ['WARNING: BATTERY STORAGE SYSTEM', '', 'CHEMICAL HAZARD \u2014 LITHIUM IRON PHOSPHATE',
        'ELECTRICAL SHOCK HAZARD', '', `(${data.batteryCount}) ${data.batteryModel}`,
        `TOTAL: ${data.totalStorageKwh} kWh`, 'DO NOT EXPOSE TO FIRE OR EXTREME HEAT', 'DO NOT SHORT CIRCUIT BATTERY TERMINALS'],
    },
    {
      title: 'RAPID SHUTDOWN SWITCH', nec: 'NEC 690.12', color: 'red',
      lines: ['RAPID SHUTDOWN', '', 'PHOTOVOLTAIC SYSTEM EQUIPPED WITH', 'RAPID SHUTDOWN PER NEC 690.12', '',
        'TO SHUT DOWN PV SYSTEM:', '1. OPEN AC DISCONNECT', '2. ARRAY WILL DE-ENERGIZE IN 30 SEC', 'CONTROLLED TO <30V WITHIN ARRAY'],
    },
    {
      title: 'AC DISCONNECT', nec: 'NEC 690.14', color: 'yellow',
      lines: ['AC DISCONNECT', '', 'SOLAR PHOTOVOLTAIC AC DISCONNECT', 'VOLTAGE: 240V AC, SINGLE PHASE',
        `CURRENT: ${totalAcAmps}A PER INVERTER`, 'TURN OFF BEFORE SERVICING', 'EQUIPMENT ON EITHER SIDE'],
    },
    {
      title: 'POINT OF INTERCONNECTION', nec: 'NEC 705.10', color: 'black',
      lines: ['POINT OF INTERCONNECTION', '', `UTILITY: ${data.utility}`, `METER: ${data.meter}`,
        `SYSTEM: ${data.systemDcKw.toFixed(2)} kW DC / ${data.systemAcKw} kW AC`,
        'INTERCONNECTION TYPE: UTILITY INTERACTIVE', 'WITH BATTERY BACKUP'],
    },
  ]

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>WARNING LABELS &mdash; NEC 690 / 705 / 706</div>
        <div style={{ fontSize: '8pt', color: '#555', marginBottom: '8pt' }}>ALL LABELS SHALL BE PERMANENT, UV-RESISTANT, AND AFFIXED WITH ADHESIVE OR MECHANICAL FASTENER</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', gridAutoRows: 'auto' }}>
          {labels.map((label, i) => {
            const borderColor = label.color === 'red' ? '#cc0000' : label.color === 'yellow' ? '#cc9900' : '#111'
            return (
              <div key={i} style={{ border: `3px solid ${borderColor}`, padding: '3px' }}>
                <div style={{ border: `1.5px solid ${borderColor}`, overflow: 'hidden' }}>
                  <div style={{ background: borderColor, color: 'white', padding: '3px 6px', fontSize: '7pt', fontWeight: 'bold', textAlign: 'center', position: 'relative' }}>
                    {label.title}
                    <span style={{ position: 'absolute', right: '4px', top: '3px', fontSize: '5pt', color: '#eee', fontWeight: 'normal' }}>{label.nec}</span>
                  </div>
                  <div style={{ padding: '5px 8px', fontSize: '6pt', lineHeight: 1.6 }}>
                    {label.lines.map((line, j) => {
                      if (!line) return <br key={j} />
                      const isFirstLine = j === 0
                      const isWarn = line === 'WARNING' || line === 'DANGER'
                      const isCaution = line === 'CAUTION'
                      return (
                        <div key={j} style={{
                          fontWeight: isFirstLine ? 'bold' : 'normal',
                          fontSize: isFirstLine ? '7pt' : '6pt',
                          color: isWarn ? '#cc0000' : isCaution ? '#cc9900' : '#333',
                        }}>{line}</div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '8px', fontSize: '7pt' }}>
          <strong>INSTALLATION NOTES:</strong>
          <div style={{ fontSize: '6pt', color: '#333', lineHeight: 1.6, marginTop: '2px' }}>
            1. ALL LABELS SHALL BE CLEARLY VISIBLE AND NOT OBSTRUCTED BY EQUIPMENT OR WIRING.<br />
            2. LABELS SHALL BE INSTALLED AT EACH DISCONNECT MEANS, JUNCTION BOX, AND POINT OF CONNECTION.<br />
            3. WARNING LABELS WITH RED BORDERS SHALL USE REFLECTIVE OR HIGH-VISIBILITY MATERIALS.<br />
            4. ALL LABELS SHALL BE LEGIBLE FROM A DISTANCE OF AT LEAST 3 FEET.
          </div>
        </div>
      </div>
      <TitleBlockHtml sheetName="WARNING LABELS" sheetNumber="PV-7" data={data} />
    </div>
  )
}

// ── SHEET PV-7.1: EQUIPMENT PLACARDS ────────────────────────────────────────

function SheetPV71({ data }: { data: PlansetData }) {
  const stringGroups: Record<number, number> = {}
  for (const s of data.strings) {
    stringGroups[s.modules] = (stringGroups[s.modules] || 0) + 1
  }
  const stringConfigLabel = Object.entries(stringGroups)
    .sort(([, a], [, b]) => b - a)
    .map(([mods, count]) => `${count} STRINGS x ${mods}`)
    .join(' + ')

  interface Placard { title: string; rows: [string, string][] }

  const placards: Placard[] = [
    {
      title: 'INVERTER PLACARD',
      rows: [
        ['EQUIPMENT', `(${data.inverterCount}) ${data.inverterModel}`],
        ['MANUFACTURER', 'DURACELL / HUBBLE TECHNOLOGY'],
        ['TYPE', 'HYBRID INVERTER (PV + ESS)'],
        ['RATED AC OUTPUT', `${data.inverterAcPower} kW PER UNIT (${data.systemAcKw} kW TOTAL)`],
        ['AC VOLTAGE', '240/120V SPLIT PHASE'],
        ['MAX PV INPUT', `${data.maxPvPower.toLocaleString()}W PER UNIT`],
        ['MAX INPUT VOLTAGE', '500V DC'],
        ['MPPT RANGE', '125V \u2014 425V DC'],
        ['MPPT CHANNELS', `${data.mpptsPerInverter} PER UNIT, ${data.stringsPerMppt} STRINGS EACH`],
        ['LISTING', 'UL 1741SA, IEEE 1547, FCC PART 15'],
        ['ENCLOSURE', 'NEMA 3R, OUTDOOR RATED'],
        ['INSTALLATION', 'WALL-MOUNTED, ACCESSIBLE'],
      ],
    },
    {
      title: 'BATTERY PLACARD',
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
      rows: [
        ['MODULE', data.panelModel],
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
  ]

  const emergencyPlacard: Placard = {
    title: 'EMERGENCY PLACARD',
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
  }

  function renderPlacard(placard: Placard, key: number) {
    return (
      <div key={key} style={{ border: '1.5px solid #111', overflow: 'hidden' }}>
        <div style={{ background: '#111', color: 'white', padding: '4px 8px', fontSize: '8pt', fontWeight: 'bold', textAlign: 'center' }}>{placard.title}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt' }}>
          <tbody>
            {placard.rows.map(([label, value], ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? '#f5f5f5' : 'white' }}>
                <td style={{ fontWeight: 'bold', color: '#111', padding: '2px 6px', width: '30%', borderBottom: '1px solid #eee' }}>{label}</td>
                <td style={{ color: '#333', padding: '2px 6px', borderBottom: '1px solid #eee' }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>EQUIPMENT IDENTIFICATION PLACARDS</div>
        <div style={{ fontSize: '8pt', color: '#555', marginBottom: '8pt' }}>PLACARDS SHALL BE INSTALLED ON OR ADJACENT TO EACH PIECE OF EQUIPMENT</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          {placards.map((p, i) => renderPlacard(p, i))}
        </div>

        {renderPlacard(emergencyPlacard, 99)}
      </div>
      <TitleBlockHtml sheetName="EQUIPMENT PLACARDS" sheetNumber="PV-7.1" data={data} />
    </div>
  )
}

// ── SHEET PV-8: CONDUCTOR SCHEDULE & BOM ────────────────────────────────────

function SheetPV8({ data }: { data: PlansetData }) {
  const stringCount = data.strings.length
  const panelImp = data.panelImp
  const fla125 = panelImp * 1.25
  const stringOcpd = Math.ceil(fla125 / 5) * 5
  const ambientTemp = 37
  const tempFactor = 0.91
  const conduitFillFactor = 0.70

  const string10Ampacity = 40
  const stringCorrected = parseFloat((string10Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const string75CMax = 30
  const stringUsable = Math.min(stringCorrected, string75CMax)

  const battFla = 63.16
  const battFla125 = parseFloat((battFla * 1.25).toFixed(1))
  const batt4Ampacity = 95
  const battCorrected = parseFloat((batt4Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const batt75CMax = 85
  const battUsable = Math.min(battCorrected, batt75CMax)

  const invFla = parseFloat((data.inverterAcPower * 1000 / 240).toFixed(1))
  const invFla125 = parseFloat((invFla * 1.25).toFixed(1))
  const inv1Ampacity = 145
  const invCorrected = parseFloat((inv1Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const inv75CMax = 130
  const invUsable = Math.min(invCorrected, inv75CMax)

  const genFla = 100
  const genFla125 = 125

  type CondRow = string[]

  const condRows: CondRow[] = []

  condRows.push([
    'RSD', 'RSD DEVICES', 'N/A', 'N/A', 'N/A',
    String(stringCount * 2), '#10 AWG', '1', '#6 AWG BARE', 'PV WIRE', 'FREE AIR',
    String(string10Ampacity), String(ambientTemp), String(tempFactor), String(stringCorrected),
    String(string75CMax), String(stringUsable),
  ])

  data.strings.forEach((s) => {
    condRows.push([
      `S${s.id}`, `STRING ${s.id} (${s.modules} MOD)`,
      panelImp.toFixed(1), fla125.toFixed(1), String(stringOcpd),
      '8', '#10 AWG', '1', '#8 AWG', 'THWN-2', '3/4" EMT',
      String(string10Ampacity), String(ambientTemp), String(tempFactor), String(stringCorrected),
      String(string75CMax), String(stringUsable),
    ])
  })

  if (data.batteryCount > 0) {
    condRows.push([
      'BATT', `BATTERY (${data.batteryCount}x ${data.batteryModel})`,
      battFla.toFixed(1), battFla125.toFixed(1), '80',
      '3', '#4 AWG', '1', '#6 AWG', 'THWN-2', '3/4" EMT',
      String(batt4Ampacity), String(ambientTemp), String(tempFactor), String(battCorrected),
      String(batt75CMax), String(battUsable),
    ])
  }

  condRows.push([
    'INV', `INVERTER (${data.inverterCount}x ${data.inverterModel.split(' ').slice(0, 3).join(' ')})`,
    invFla.toFixed(1), invFla125.toFixed(1), '100',
    '3', '#1 AWG', '1', '#6 AWG', 'THWN-2', '1-1/4" EMT',
    String(inv1Ampacity), String(ambientTemp), String(tempFactor), String(invCorrected),
    String(inv75CMax), String(invUsable),
  ])

  condRows.push([
    'GEN', 'GENERATION DISCONNECT',
    String(genFla), String(genFla125), '125',
    '3', '#1 AWG', '1', '#6 AWG', 'THWN-2', '1-1/4" EMT',
    String(inv1Ampacity), String(ambientTemp), String(tempFactor), String(invCorrected),
    String(inv75CMax), String(invUsable),
  ])

  const condColHeaders = [
    'TAG', 'CIRCUIT ORIGIN', 'FLA (A)', 'FLA\u00D71.25', 'OCPD (A)',
    '# WIRES', 'WIRE SIZE', '# GND', 'GND SIZE', 'WIRE TYPE', 'CONDUIT',
    'AMPACITY', 'AMB \u00B0C', 'TEMP CF', 'CORR AMP', '75\u00B0C MAX', 'USABLE',
  ]

  const bomRows: [string, string, string][] = [
    ['SOLAR PV MODULE', String(data.panelCount), data.panelModel],
    ['RAPID SHUTDOWN DEVICE', String(data.panelCount), 'APSMART RSD-D-20'],
    ['EMERGENCY POWER OFF', '1', 'DURACELL EMERGENCY STOP BUTTON'],
    ['INVERTER', String(data.inverterCount), data.inverterModel],
    ['BATTERY', String(data.batteryCount), data.batteryModel],
    ['JUNCTION BOX', '2', 'JUNCTION BOXES'],
    ['AC DISCONNECT', '1', '200A/2P NON-FUSIBLE DISCONNECT 240V N3R'],
    ['ATTACHMENT', String(data.racking.attachmentCount), data.racking.attachmentModel],
    ['RAIL CLICKER', String(data.racking.attachmentCount), 'IronRidge XR100 Rail Clicker'],
    ['RAIL', String(data.racking.railCount), data.racking.railModel],
    ['RAIL SPLICE', String(data.racking.railSpliceCount), 'CF RAIL SPLICE SS 2012013'],
    ['MID CLAMPS', String(data.racking.midClampCount), 'MID CLAMP ASSEMBLY'],
    ['END CLAMPS', String(data.racking.endClampCount), 'END CLAMP ASSEMBLY'],
    ['GROUNDING LUG', String(data.racking.groundingLugCount), 'GROUNDING LUGS'],
  ]

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.1in 0.15in', overflow: 'hidden' }}>
        <div style={{ fontWeight: 'bold', fontSize: '7pt', color: '#111' }}>CONDUCTOR AND CONDUIT SCHEDULE WITH AMPACITY CALCULATIONS</div>
        <div style={{ fontSize: '5pt', color: '#555', marginBottom: '4px' }}>
          WIRES ARE 90&deg;C RATED THWN-2 @ 30&deg;C (CU) | CONDUIT HEIGHT ABOVE ROOF IS OVER 7/8&quot; | NEC 310.12 (83% RULE)
        </div>

        {/* Conductor schedule table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '5.5pt', marginBottom: '10px' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              {condColHeaders.map((h, i) => (
                <th key={i} style={{ color: 'white', padding: '2px 3px', textAlign: 'left', fontWeight: 'bold', fontSize: '5pt', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {condRows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? '#f9f9f9' : 'white' }}>
                {row.map((val, ci) => (
                  <td key={ci} style={{ padding: '1px 3px', borderBottom: '1px solid #ddd', whiteSpace: 'nowrap' as const }}>{val}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* BOM */}
        <div style={{ fontWeight: 'bold', fontSize: '10pt', color: '#111', marginBottom: '4px' }}>BILL OF MATERIALS</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7pt' }}>
          <thead>
            <tr style={{ background: '#111' }}>
              <th style={{ color: 'white', padding: '3px 6px', textAlign: 'left', fontWeight: 'bold', fontSize: '6.5pt' }}>EQUIPMENT</th>
              <th style={{ color: 'white', padding: '3px 6px', textAlign: 'center', fontWeight: 'bold', fontSize: '6.5pt', width: '60px' }}>QTY</th>
              <th style={{ color: 'white', padding: '3px 6px', textAlign: 'left', fontWeight: 'bold', fontSize: '6.5pt' }}>DESCRIPTION</th>
            </tr>
          </thead>
          <tbody>
            {bomRows.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : 'white' }}>
                <td style={{ padding: '2px 6px', fontWeight: 'bold', color: '#111', borderBottom: '1px solid #ddd' }}>{row[0]}</td>
                <td style={{ padding: '2px 6px', textAlign: 'center', borderBottom: '1px solid #ddd' }}>{row[1]}</td>
                <td style={{ padding: '2px 6px', color: '#333', borderBottom: '1px solid #ddd' }}>{row[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TitleBlockHtml sheetName="CONDUCTOR SCHEDULE & BOM" sheetNumber="PV-8" data={data} />
    </div>
  )
}

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

  // Clone the sheets content
  const sheetsHtml = sheetsContainer.innerHTML

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Plan Set — ${data.projectId} ${data.owner}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>${sheetsHtml}</body>
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

function OverridesPanel({ data, strings, onStringsChange, overrides, onOverridesChange, roofFaces, onRoofFacesChange }: {
  data: PlansetData
  strings: PlansetString[]
  onStringsChange: (s: PlansetString[]) => void
  overrides: PlansetOverrides
  onOverridesChange: (o: PlansetOverrides) => void
  roofFaces: PlansetRoofFace[]
  onRoofFacesChange: (rf: PlansetRoofFace[]) => void
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

          {/* Roof Faces */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Roof Faces</h3>
            {roofFaces.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-3">No roof faces derived yet. Add strings with roof face assignments to populate.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1 px-2">Roof Face</th>
                    <th className="text-left py-1 px-2">Modules</th>
                    <th className="text-left py-1 px-2">Tilt (&deg;)</th>
                    <th className="text-left py-1 px-2">Azimuth (&deg;)</th>
                  </tr>
                </thead>
                <tbody>
                  {roofFaces.map((rf, i) => (
                    <tr key={rf.id} className="border-b border-gray-700/50">
                      <td className="py-1 px-2 text-gray-300">Roof {rf.id}</td>
                      <td className="py-1 px-2 text-gray-400 text-xs">{rf.modules}</td>
                      <td className="py-1 px-2">
                        <input value={rf.tilt} onChange={e => {
                          const updated = [...roofFaces]
                          updated[i] = { ...rf, tilt: parseInt(e.target.value) || 0 }
                          onRoofFacesChange(updated)
                        }} className="w-16 px-1 py-0.5 bg-gray-900 border border-gray-700 rounded text-xs text-white" />
                      </td>
                      <td className="py-1 px-2">
                        <input value={rf.azimuth} onChange={e => {
                          const updated = [...roofFaces]
                          updated[i] = { ...rf, azimuth: parseInt(e.target.value) || 0 }
                          onRoofFacesChange(updated)
                        }} className="w-16 px-1 py-0.5 bg-gray-900 border border-gray-700 rounded text-xs text-white" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-gray-600 mt-2">Roof faces are auto-derived from string assignments. Edit tilt and azimuth here.</p>
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

  const [projectId, setProjectId] = useState<string>('')
  const [data, setData] = useState<PlansetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [strings, setStrings] = useState<PlansetString[]>([])
  const [roofFaces, setRoofFaces] = useState<PlansetRoofFace[]>([])
  const [overrides, setOverrides] = useState<PlansetOverrides>({})

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
      const maxVoc = overrides.maxPvPower ? 500 : d.maxVoc

      const autoStrings = autoDistributeStrings(
        panelCount, vocCorrected, panelVmp, panelImp,
        inverterCount, mpptsPerInverter, stringsPerMppt, maxVoc
      )

      const finalStrings = overrides.strings ?? autoStrings
      setStrings(finalStrings)

      const plansetData = buildPlansetData(project, { ...overrides, strings: finalStrings, roofFaces: roofFaces.length > 0 ? roofFaces : undefined })
      setRoofFaces(plansetData.roofFaces)
      setData(plansetData)
      setProjectId(id)
    } catch (err) {
      console.error('Failed to load project:', err)
      setToast({ message: 'Failed to load project', type: 'error' })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setLoading(false)
    }
  }, [overrides, roofFaces])

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
      const plansetData = buildPlansetData(project, { ...overrides, strings, roofFaces: roofFaces.length > 0 ? roofFaces : undefined })
      setData(plansetData)
    } finally {
      setLoading(false)
    }
  }, [projectId, strings, overrides, roofFaces])

  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!projectId) return
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current)
    rebuildTimerRef.current = setTimeout(() => rebuildData(), 500)
    return () => { if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current) }
  }, [projectId, strings, overrides, roofFaces, rebuildData])

  const clearProject = () => {
    setProjectId('')
    setData(null)
    setStrings([])
    setRoofFaces([])
    setOverrides({})
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

  // Screen-mode scale for 11x17 sheets to fit in a browser window
  const screenScale = 0.55

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

            <OverridesPanel
              data={data}
              strings={strings}
              onStringsChange={setStrings}
              overrides={overrides}
              onOverridesChange={setOverrides}
              roofFaces={roofFaces}
              onRoofFacesChange={setRoofFaces}
            />

            {/* Sheets — rendered at print size, scaled down for screen */}
            <div id="planset-sheets" className="space-y-8">
              {[
                { id: 'PV-1', label: 'Cover Page & General Notes', component: <SheetPV1 data={data} /> },
                { id: 'PV-2', label: 'Project Data', component: <SheetPV2 data={data} /> },
                { id: 'PV-5', label: 'Single Line Diagram', component: <SheetPV5 data={data} /> },
                { id: 'PV-5.1', label: 'PCS Labels', component: <SheetPV51 data={data} /> },
                { id: 'PV-6', label: 'Wiring Calculations', component: <SheetPV6 data={data} /> },
                { id: 'PV-7', label: 'Warning Labels', component: <SheetPV7 data={data} /> },
                { id: 'PV-7.1', label: 'Equipment Placards', component: <SheetPV71 data={data} /> },
                { id: 'PV-8', label: 'Conductor Schedule & BOM', component: <SheetPV8 data={data} /> },
              ].map(sheet => (
                <div key={sheet.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-green-400 bg-gray-800 px-2 py-1 rounded">{sheet.id}</span>
                    <span className="text-sm text-gray-400">{sheet.label}</span>
                  </div>
                  <div className="border border-gray-700 rounded-lg overflow-hidden" style={{
                    width: `${16.5 * 96 * screenScale}px`,
                    height: `${10.5 * 96 * screenScale}px`,
                  }}>
                    <div style={{
                      transform: `scale(${screenScale})`,
                      transformOrigin: 'top left',
                      width: '16.5in',
                      height: '10.5in',
                      background: 'white',
                    }}>
                      {sheet.component}
                    </div>
                  </div>
                </div>
              ))}
            </div>

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
