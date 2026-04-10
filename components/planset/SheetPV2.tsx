import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV2({ data }: { data: PlansetData }) {
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
    ['MODULE WATTAGE', data.existingPanelWattage ? `${data.existingPanelWattage}W` : 'N/A'],
    ['INVERTER', `(${data.existingInverterCount ?? 0}) ${data.existingInverterModel ?? 'N/A'}`],
    ['BATTERY', 'N/A'],
    ['SYSTEM DC', existingDcKw ? `${existingDcKw} kW` : 'N/A'],
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
                    ['SYSTEM SIZE (AC)', `${data.systemAcKw.toFixed(2)} kWac`],
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
