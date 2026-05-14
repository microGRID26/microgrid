import { memo } from 'react'
import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

interface SheetPV1Props {
  data: PlansetData
  enhanced?: boolean
  aerialPhotoUrl?: string | null
  housePhotoUrl?: string | null
}

function SheetPV1Inner({ data, aerialPhotoUrl, housePhotoUrl }: SheetPV1Props) {
  // Prefer caller-passed URLs (legacy enhanced-mode flow), fall back to data fields
  const aerialUrl = aerialPhotoUrl ?? data.aerialImageUrl
  const houseUrl = housePhotoUrl ?? data.housePhotoUrl
  const HQ_ADDRESS = '600 Northpark Central Dr Suite 140, Houston TX 77073'

  const projectData: Array<[string, string | number]> = [
    ['CUSTOMER',         data.owner],
    ['SITE ADDRESS',     [data.address, data.city, `${data.state} ${data.zip || ''}`].filter(Boolean).join(', ')],
    ['PROJECT ID',       data.projectId],
    ['UTILITY',          'CENTERPOINT ENERGY'],
    ['METER NUMBER',     data.meter || 'PENDING'],
    ['ESID',             data.esid || 'PENDING'],
    ['SYSTEM TYPE',      'PV + ESS · GRID-INTERACTIVE'],
    ['DC SYSTEM SIZE',   `${data.systemDcKw.toFixed(3)} kW DC`],
    ['AC SYSTEM SIZE',   `${data.systemAcKw} kW AC`],
    ['ESS CAPACITY',     `${data.totalStorageKwh || 80} kWh USABLE`],
    ['MODULE',           `(${data.panelCount}) ${data.panelModel}`],
    ['INVERTER',         `(${data.inverterCount}) ${data.inverterModel}`],
    ['BATTERY',          `(${data.batteryCount}) ${data.batteryModel}`],
    ['RACKING',          data.rackingModel],
    ['MOUNT TYPE',       'ROOF-MOUNTED · COMP SHINGLE'],
    ['BUILDING TYPE',    `${data.stories === 1 ? 'ONE' : 'TWO'}-STORY RESIDENCE`],
    ['CODE BASIS',       'NEC 2020 · IFC 2018 · IRC 2018 · NFPA 855'],
    ['EXISTING SYSTEM',  '(E) MICRO-INVERTER ARRAY TO BE REMOVED'],
  ]

  const generalNotes = [
    'ALL WORK SHALL CONFORM TO NEC 2020, IFC 2018, IRC 2018, NFPA 855, IEEE 1547, AND ALL LOCAL CODES.',
    'ALL CONDUCTORS COPPER 75°C THWN-2 UNLESS NOTED OTHERWISE.',
    'ALL CONDUITS EMT NEMA 3R EXPOSED · PVC SCHEDULE 40 BELOW GRADE.',
    'ALL EQUIPMENT NEMA 3R RATED OR BETTER FOR OUTDOOR INSTALLATION.',
    'WORKING SPACE PER NEC 110.26(A)(1): 36" DEPTH · 30" WIDTH · 78" HEIGHT MIN.',
    'ALL DISCONNECTS LOCKABLE IN OPEN POSITION PER NEC 110.25.',
    'ALL LABELS PER NEC 690.13(B), 690.31(D), 690.56, 705.10 — SEE PV-5.1.',
    'GEC PER NEC 250.52 · BONDED TO EXISTING GROUNDING ELECTRODE SYSTEM.',
    'PV ARRAY RAPID SHUTDOWN PER NEC 690.12 — MODULE-LEVEL.',
    'ESS PER NFPA 855 §1207 · MAX 80 kWh AGGREGATE · GARAGE INSTALLATION.',
    'ROOF FIRE SETBACKS PER IFC 2018 §1204: RIDGE 36" · EAVE 18" · RAKE 18".',
    'ATTACHMENT INTO 2×6 RAFTERS @ 24" O.C. · IRONRIDGE XR100 PER PV-4.1.',
    'STRUCTURAL CERTIFICATION LETTER ON FILE · PE-STAMPED · SEE APPENDIX.',
    'EXISTING (E) MICRO-INVERTER ARRAY TO BE FULLY DECOMMISSIONED PRIOR TO NEW INSTALLATION.',
    'CONTRACTOR TO VERIFY ALL EXISTING CONDITIONS PRIOR TO CONSTRUCTION.',
  ]

  const sheetIndex = [
    ['PV-1',   'COVER PAGE & GENERAL NOTES'],
    ['PV-2',   'PROJECT DATA + EQUIPMENT SPECS'],
    ['PV-2A',  'UNIT INDEX / LEGEND'],
    ['PV-3',   'SITE PLAN + ROOF PLAN'],
    ['PV-3.1', 'EQUIPMENT ELEVATION'],
    ['PV-3.2', 'GARAGE FLOOR PLAN · BATTERY DETAIL B'],
    ['PV-4',   'ROOF PLAN WITH MODULES'],
    ['PV-4.1', 'ATTACHMENT DETAIL'],
    ['PV-5',   'ELECTRICAL THREE LINE DIAGRAM'],
    ['PV-5.1', 'PCS LABELS'],
    ['PV-6',   'TAG WIRE CHART + CALCULATIONS'],
    ['PV-7',   'WARNING LABELS'],
    ['PV-7.1', 'EQUIPMENT PLACARDS'],
    ['PV-8',   'CONDUCTOR SCHEDULE + BOM'],
  ]

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '7pt', width: '16.5in', height: '10.5in', overflow: 'hidden' }}>
      <div className="sheet-content" style={{ padding: '0.12in 0.18in', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ borderBottom: '2px solid #000', paddingBottom: 4 }}>
          <div style={{ fontSize: '16pt', fontWeight: 800, letterSpacing: '0.04em' }}>PHOTOVOLTAIC ROOF MOUNT SYSTEM + ENERGY STORAGE</div>
          <div style={{ fontSize: '9pt', color: '#333', marginTop: 2 }}>
            {data.panelCount} MODULES · {data.systemDcKw.toFixed(3)} kW DC · {data.systemAcKw} kW AC · {data.totalStorageKwh || 80} kWh ESS
          </div>
          <div style={{ fontSize: '8pt', color: '#000', marginTop: 2, fontWeight: 700 }}>
            {data.owner} · {[data.address, data.city, `${data.state} ${data.zip || ''}`].filter(Boolean).join(', ')}
          </div>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 8, minHeight: 0 }}>
          <div style={{ border: '1px solid #000', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: '#000', color: '#fff', padding: '3px 6px', fontWeight: 700, fontSize: '8pt' }}>PROJECT DATA</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6.5pt' }}>
              <tbody>
                {projectData.map(([k, v], i) => (
                  <tr key={i} style={{ background: i % 2 ? '#f5f5f5' : '#fff' }}>
                    <td style={{ padding: '2px 5px', fontWeight: 700, borderRight: '1px solid #ccc', verticalAlign: 'top', width: '36%' }}>{k}</td>
                    <td style={{ padding: '2px 5px' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ border: '1px solid #000', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: '#000', color: '#fff', padding: '3px 6px', fontWeight: 700, fontSize: '8pt' }}>GENERAL NOTES</div>
            <ol style={{ margin: 0, padding: '4px 6px 4px 22px', fontSize: '6.2pt', lineHeight: 1.45 }}>
              {generalNotes.map((n, i) => <li key={i} style={{ marginBottom: 2 }}>{n}</li>)}
            </ol>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ flex: 1, border: '1px solid #000', position: 'relative', background: 'repeating-linear-gradient(45deg, #f8f8f8, #f8f8f8 6px, #efefef 6px, #efefef 12px)' }}>
              {aerialUrl
                ? <img src={aerialUrl} alt="Aerial" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '7pt', color: '#666' }}>AERIAL PHOTO</div>}
              <div style={{ position: 'absolute', bottom: 2, left: 4, fontSize: '6pt', fontWeight: 700, background: '#fff', padding: '0 3px' }}>AERIAL</div>
            </div>
            <div style={{ flex: 1, border: '1px solid #000', position: 'relative', background: 'repeating-linear-gradient(45deg, #f8f8f8, #f8f8f8 6px, #efefef 6px, #efefef 12px)' }}>
              {houseUrl
                ? <img src={houseUrl} alt="House" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '7pt', color: '#666' }}>HOUSE PHOTO</div>}
              <div style={{ position: 'absolute', bottom: 2, left: 4, fontSize: '6pt', fontWeight: 700, background: '#fff', padding: '0 3px' }}>HOUSE</div>
            </div>
            <div style={{ height: 80, border: '1px solid #000', position: 'relative', background: 'repeating-linear-gradient(45deg, #f8f8f8, #f8f8f8 6px, #efefef 6px, #efefef 12px)' }}>
              {data.vicinityImageUrl
                ? <img src={data.vicinityImageUrl} alt="Vicinity" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '7pt', color: '#666' }}>VICINITY MAP</div>}
              <div style={{ position: 'absolute', bottom: 2, left: 4, fontSize: '6pt', fontWeight: 700, background: '#fff', padding: '0 3px' }}>VICINITY</div>
            </div>
            <div style={{ height: 130, border: '2px solid #000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 4, left: 6, fontSize: '6pt', fontWeight: 700 }}>ENGINEER&apos;S STAMP</div>
              <div style={{ fontSize: '6.5pt', color: '#999', textAlign: 'center', padding: '0 8px' }}>
                RESERVED FOR<br />RUSH ENGINEERING<br />PE STAMP
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
          <div style={{ border: '1px solid #000' }}>
            <div style={{ background: '#22d3ee', color: '#0a0a0a', padding: '2px 6px', fontWeight: 700, fontSize: '7.5pt' }}>SHEET INDEX</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6pt' }}>
              <tbody>
                {sheetIndex.map(([num, name], i) => (
                  <tr key={i} style={{ background: i % 2 ? '#f9f9f9' : '#fff' }}>
                    <td style={{ padding: '1.5px 6px', fontWeight: 700, color: '#0e7490', borderRight: '1px solid #eee', width: '14%' }}>{num}</td>
                    <td style={{ padding: '1.5px 6px' }}>{name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ border: '1px solid #000', padding: '4px 6px', fontSize: '7pt', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontWeight: 700, fontSize: '8pt' }}>CONTRACTOR</div>
            <div style={{ fontWeight: 700 }}>MICROGRID ENERGY</div>
            <div>{HQ_ADDRESS}</div>
            <div>(832) 280-7764</div>
            <div style={{ marginTop: 4, fontSize: '6pt', color: '#444' }}>TECL #34286 · NABCEP CERTIFIED</div>
          </div>
        </div>
      </div>
      <TitleBlockHtml sheetName="COVER PAGE & GENERAL NOTES" sheetNumber="PV-1" data={data} />
    </div>
  )
}

export const SheetPV1 = memo(SheetPV1Inner)
