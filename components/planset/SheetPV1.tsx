import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

interface SheetPV1Props {
  data: PlansetData
  aerialPhotoUrl?: string | null
  housePhotoUrl?: string | null
  enhanced?: boolean
}

export function SheetPV1({ data, aerialPhotoUrl, housePhotoUrl, enhanced = false }: SheetPV1Props) {
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

  // Dynamic sheet index based on enhanced mode
  const sheetIndex: [string, string][] = [
    ['PV-1', 'COVER PAGE & GENERAL NOTES'],
    ['PV-2', 'PROJECT DATA'],
    ['PV-3', 'SITE PLAN'],
    ...(enhanced ? [['PV-3.1', 'EQUIPMENT ELEVATION'] as [string, string]] : []),
    ...(enhanced ? [['PV-4', 'ROOF PLAN WITH MODULES'] as [string, string]] : []),
    ...(enhanced ? [['PV-4.1', 'ATTACHMENT DETAIL'] as [string, string]] : []),
    ['PV-5', 'SINGLE LINE DIAGRAM'],
    ['PV-5.1', 'PCS LABELS'],
    ['PV-6', 'WIRING CALCULATIONS'],
    ['PV-7', 'WARNING LABELS'],
    ['PV-7.1', 'EQUIPMENT PLACARDS'],
    ['PV-8', 'CONDUCTOR SCHEDULE & BOM'],
  ]

  // Scope of work — matching RUSH format
  const scopeOfWork: [string, string][] = [
    [String(data.panelCount), `${data.panelModel}`],
    [String(data.inverterCount), `${data.inverterModel}`],
    [String(data.batteryCount), `${data.batteryModel}`],
    [String(data.racking.attachmentCount), `${data.racking.attachmentModel}`],
    [String(data.racking.railCount), `${data.racking.railModel}`],
    [String(data.racking.midClampCount ?? 0), 'Mid Clamp Assembly'],
    [String(data.racking.endClampCount ?? 0), 'End Clamp Assembly'],
  ]

  const storiesLabel = data.stories === 1 ? 'ONE' : data.stories === 2 ? 'TWO' : String(data.stories)

  // Shared cell styles
  const hdr: React.CSSProperties = { background: '#111', color: 'white', padding: '3px 6px', fontSize: '7pt', fontWeight: 'bold', textAlign: 'center' }
  const cell: React.CSSProperties = { fontWeight: 'bold', padding: '1.5px 4px', color: '#111', fontSize: '6pt', whiteSpace: 'nowrap' }
  const val: React.CSSProperties = { padding: '1.5px 4px', color: '#333', fontSize: '6pt' }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.12in 0.15in', overflow: 'hidden' }}>
        {/* Title */}
        <div style={{ fontSize: '13pt', fontWeight: 'bold', color: '#111', marginBottom: '1px' }}>
          ROOF INSTALLATION OF {data.systemDcKw.toFixed(2)} KW DC PHOTOVOLTAIC SYSTEM
        </div>
        <div style={{ fontSize: '7.5pt', color: '#555', marginBottom: '6px' }}>
          WITH {data.totalStorageKwh} KWH BATTERY ENERGY STORAGE SYSTEM
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1.15fr 0.7fr', gap: '6px', height: 'calc(100% - 28px)' }}>
          {/* ── LEFT COLUMN: Project Data, Scope, Electrical, Building, Design, Codes ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
            {/* PROJECT DATA */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>PROJECT DATA</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={cell}>PROJECT:</td><td style={val}>{data.projectId} {data.owner}</td></tr>
                  <tr><td style={cell}>ADDRESS:</td><td style={val}>{data.address}</td></tr>
                  <tr><td style={cell}>SYSTEM SIZE:</td><td style={val}>{data.systemDcKw.toFixed(2)} kWDC / {data.systemAcKw} kWAC</td></tr>
                  <tr><td style={cell}>PV MODULES:</td><td style={val}>({data.panelCount}) {data.panelModel}</td></tr>
                  <tr><td style={cell}>INVERTERS:</td><td style={val}>({data.inverterCount}) {data.inverterModel}</td></tr>
                  <tr><td style={cell}>BATTERIES:</td><td style={val}>({data.batteryCount}) {data.batteryModel} = {data.totalStorageKwh} kWh</td></tr>
                  <tr><td style={cell}>RACKING:</td><td style={val}>{data.rackingModel}</td></tr>
                  <tr><td style={cell}>ATTACHMENTS:</td><td style={val}>({data.racking.attachmentCount}) {data.racking.attachmentModel}</td></tr>
                  <tr><td style={cell}>RAIL:</td><td style={val}>({data.racking.railCount}) {data.racking.railModel}</td></tr>
                  <tr><td style={cell}>UTILITY:</td><td style={val}>{data.utility}</td></tr>
                  {data.meter && <tr><td style={cell}>METER #:</td><td style={val}>{data.meter}</td></tr>}
                  {data.esid && <tr><td style={cell}>ESID:</td><td style={val}>{data.esid}</td></tr>}
                  <tr><td style={cell}>BUILDING:</td><td style={val}>{storiesLabel} STORY, {data.buildingType}</td></tr>
                  <tr><td style={cell}>ROOF:</td><td style={val}>{data.roofType}, {data.rafterSize}</td></tr>
                  <tr><td style={cell}>WIND SPEED:</td><td style={val}>{data.windSpeed} MPH, Cat {data.riskCategory}, Exp {data.exposure}</td></tr>
                </tbody>
              </table>
            </div>

            {/* EXISTING SYSTEM */}
            {data.existingPanelModel && (
              <div style={{ border: '1px solid #111' }}>
                <div style={{ ...hdr, background: '#555' }}>EXISTING SYSTEM (TO REMAIN)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr><td style={cell}>PV MODULES:</td><td style={val}>({data.existingPanelCount ?? 0}) {data.existingPanelModel}{data.existingPanelWattage ? ` (${data.existingPanelWattage}W)` : ''}</td></tr>
                    <tr><td style={cell}>INVERTERS:</td><td style={val}>({data.existingInverterCount ?? 0}) {data.existingInverterModel}</td></tr>
                    {data.existingPanelWattage ? (
                      <tr><td style={cell}>EXISTING DC:</td><td style={val}>{((data.existingPanelCount ?? 0) * data.existingPanelWattage / 1000).toFixed(2)} kW</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}

            {/* SCOPE OF WORK — matches RUSH quantity table */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>SCOPE OF WORK</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...cell, borderBottom: '1px solid #ccc', width: '50px', textAlign: 'center' }}>QUANTITY</th>
                    <th style={{ ...cell, borderBottom: '1px solid #ccc' }}>DESCRIPTION</th>
                  </tr>
                </thead>
                <tbody>
                  {scopeOfWork.map(([qty, desc], i) => (
                    <tr key={i}>
                      <td style={{ ...val, textAlign: 'center', fontWeight: 'bold' }}>{qty}</td>
                      <td style={val}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ELECTRICAL INFORMATION — matches RUSH */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>ELECTRICAL INFORMATION</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={cell}>VOLTAGE:</td><td style={val}>{data.voltage ?? '120/240V'}</td></tr>
                  <tr><td style={cell}>MSP BUS RATING:</td><td style={val}>{data.mspBusRating}A</td></tr>
                  <tr><td style={cell}>MAIN BREAKER:</td><td style={val}>{data.mainBreaker}</td></tr>
                  <tr><td style={cell}>SERVICE DISCONNECT RATING:</td><td style={val}>200A</td></tr>
                  <tr><td style={cell}>SERVICE DISCONNECT FUSE RATING:</td><td style={val}>200A</td></tr>
                  <tr><td style={cell}>INTERCONNECTION TYPE:</td><td style={val}>UTILITY INTERCONNECTION</td></tr>
                </tbody>
              </table>
            </div>

            {/* BUILDING INFORMATION — matches RUSH */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>BUILDING INFORMATION</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={cell}>BUILDING TYPE:</td><td style={val}>{storiesLabel} STORY BUILDING</td></tr>
                  <tr><td style={cell}>CONSTRUCTION TYPE:</td><td style={val}>{data.buildingType}</td></tr>
                  <tr><td style={cell}>OCCUPANCY:</td><td style={val}>R</td></tr>
                  <tr><td style={cell}>ROOF TYPE:</td><td style={val}>{data.roofType?.toUpperCase()}</td></tr>
                  <tr><td style={cell}>RAFTERS:</td><td style={val}>{data.rafterSize}</td></tr>
                </tbody>
              </table>
            </div>

            {/* DESIGN CRITERIA — matches RUSH */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>DESIGN CRITERIA</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={cell}>EXPOSURE CATEGORY:</td><td style={val}>{data.exposure}</td></tr>
                  <tr><td style={cell}>WIND SPEED:</td><td style={val}>{data.windSpeed} MPH</td></tr>
                  <tr><td style={cell}>RISK CATEGORY:</td><td style={val}>{data.riskCategory}</td></tr>
                </tbody>
              </table>
            </div>

            {/* CODE REFERENCES */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>CODE REFERENCES</div>
              <div style={{ padding: '3px 6px', fontSize: '5.5pt', lineHeight: 1.6 }}>
                {codeRefs.map((ref, i) => <div key={i}>{ref}</div>)}
              </div>
            </div>
          </div>

          {/* ── CENTER COLUMN: General Notes, PV Notes, Unit Index ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
            {/* GENERAL NOTES */}
            <div style={{ border: '1px solid #111', flex: 1 }}>
              <div style={hdr}>GENERAL NOTES</div>
              <ol style={{ padding: '3px 6px 3px 16px', fontSize: '5pt', lineHeight: 1.7, color: '#333', margin: 0 }}>
                {generalNotes.map((note, i) => <li key={i}>{note}</li>)}
              </ol>
            </div>

            {/* PHOTOVOLTAIC NOTES */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>PHOTOVOLTAIC NOTES</div>
              <ol style={{ padding: '3px 6px 3px 16px', fontSize: '5pt', lineHeight: 1.7, color: '#333', margin: 0 }}>
                {pvNotes.map((note, i) => <li key={i}>{note}</li>)}
              </ol>
            </div>

            {/* UNIT INDEX */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>UNIT INDEX</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {unitIndex.map(([abbr, def], i) => (
                    <tr key={i}>
                      <td style={{ ...cell, width: '36px', fontSize: '5.5pt' }}>{abbr}</td>
                      <td style={{ ...val, fontSize: '5.5pt' }}>{def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Images + Contractor + Sheet Index ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
            {/* CONTRACTOR */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>CONTRACTOR</div>
              <div style={{ padding: '4px 6px', fontSize: '6pt', lineHeight: 1.6 }}>
                <div style={{ fontWeight: 'bold' }}>{data.contractor.name}</div>
                <div>{data.contractor.address}</div>
                <div>{data.contractor.city}</div>
                <div>Phone: {data.contractor.phone}</div>
                <div>License# {data.contractor.license}</div>
                <div>{data.contractor.email}</div>
              </div>
            </div>

            {/* AERIAL VIEW */}
            <div style={{ border: '1px solid #111', flex: 1, minHeight: '1.2in' }}>
              <div style={hdr}>AERIAL VIEW</div>
              <div style={{ height: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {aerialPhotoUrl ? (
                  <img src={aerialPhotoUrl} alt="Aerial view" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '6pt', color: '#999' }}>Upload aerial photo</span>
                )}
              </div>
            </div>

            {/* HOUSE PHOTO */}
            <div style={{ border: '1px solid #111', flex: 1, minHeight: '1.2in' }}>
              <div style={hdr}>HOUSE PHOTO</div>
              <div style={{ height: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {housePhotoUrl ? (
                  <img src={housePhotoUrl} alt="House photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '6pt', color: '#999' }}>Upload house photo</span>
                )}
              </div>
            </div>

            {/* SHEET INDEX */}
            <div style={{ border: '1px solid #111' }}>
              <div style={hdr}>SHEET INDEX</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {sheetIndex.map(([num, title], i) => (
                    <tr key={i}>
                      <td style={{ ...cell, width: '38px', fontSize: '5.5pt' }}>{num}</td>
                      <td style={{ ...val, fontSize: '5.5pt' }}>{title}</td>
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
