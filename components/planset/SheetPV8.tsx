import type { PlansetData } from '@/lib/planset-types'
import { ampacityFor } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV8({ data }: { data: PlansetData }) {
  const stringCount = data.strings.length
  const panelImp = data.panelImp
  const fla125 = panelImp * 1.25
  const stringOcpd = Math.ceil(fla125 / 5) * 5
  const ambientTemp = 37
  const tempFactor = 0.91
  const conduitFillFactor = 0.70

  // String row ampacity derives from data.dcHomerunWire so designer overrides
  // (e.g. upsizing to #8 AWG via OverridesPanel) update both wire size AND
  // ampacity columns consistently. Was hardcoded 40 / 30 for #10 AWG —
  // would silently mismatch the wire size column on any override.
  const homerunAmp = ampacityFor(data.dcHomerunWire)
  const string10Ampacity = homerunAmp.c90 || 40
  const stringCorrected = parseFloat((string10Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const string75CMax = homerunAmp.c75 || 30
  const stringUsable = Math.min(stringCorrected, string75CMax)

  // Battery FLA from inverter battery port max continuous current spec.
  // Wire size + ampacity derive from data.batteryWire so this row matches PV-6
  // ampacity table and SLD label (single source-of-truth fix from William Carter audit).
  const battFla = data.batteryMaxCurrentA
  const battFla125 = parseFloat((battFla * 1.25).toFixed(1))
  const battAmp = ampacityFor(data.batteryWire)
  const battWireSize = data.batteryWire.match(/#?\d+(?:\/0)?\s*AWG/i)?.[0] ?? '#4 AWG'
  const battC90Ampacity = battAmp.c90 || 95
  const battCorrected = parseFloat((battC90Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const batt75CMax = battAmp.c75 || 85
  const battUsable = Math.min(battCorrected, batt75CMax)

  const invFla = parseFloat((data.inverterAcPower * 1000 / 240).toFixed(1))
  const invFla125 = parseFloat((invFla * 1.25).toFixed(1))
  const acAmp = ampacityFor(data.acWireToPanel)
  const invWireSize = data.acWireToPanel.match(/#?\d+(?:\/0)?\s*AWG/i)?.[0] ?? '#1 AWG'
  const invC90Ampacity = acAmp.c90 || 145
  const invCorrected = parseFloat((invC90Ampacity * conduitFillFactor * tempFactor).toFixed(1))
  const inv75CMax = acAmp.c75 || 130
  const invUsable = Math.min(invCorrected, inv75CMax)

  // Service-entrance conductor sized for full service rating (200A) per NEC 230.42
  // and 215.2(B). Three current-carrying conductors → no conduit-fill derate per NEC 310.15(C)(1).
  const genFla = 200
  const genFla125 = 250
  const gen250kcmilAmpacity = 255 // 250 kcmil CU THWN-2 @ 75°C
  const genUsable = gen250kcmilAmpacity // service entrance not subject to 4+CCC fill derate

  type CondRow = string[]

  const condRows: CondRow[] = []

  condRows.push([
    '① RSD', 'RSD DEVICES (PV MODULES → JBOX)', 'N/A', 'N/A', 'N/A',
    String(stringCount * 2), '#10 AWG', '1', '#6 AWG BARE', 'PV WIRE', 'FREE AIR',
    String(string10Ampacity), String(ambientTemp), String(tempFactor), String(stringCorrected),
    String(string75CMax), String(stringUsable),
  ])

  // Per-string detail of the consolidated homerun (tag ② JBOX → PV LC).
  // Each string contributes 2 conductors (positive + negative) sharing the
  // homerun conduit. Wire size + EGC + conduit derive from data.dcHomerun*
  // so OverridesPanel changes propagate. Was hardcoded `8 / #10 AWG / #8 AWG /
  // 3/4" EMT` — wire count was wrong (8 fixed regardless of strings) and
  // conduit was wrong (3/4" matches per-string PV WIRE, not the homerun).
  const homerunWireSize = data.dcHomerunWire.match(/#?\d+(?:\/0)?\s*AWG/i)?.[0] ?? '#10 AWG'
  const homerunEgcSize = data.dcHomerunEgc.match(/#?\d+(?:\/0)?\s*AWG/i)?.[0] ?? '#8 AWG'
  data.strings.forEach((s) => {
    condRows.push([
      `② S${s.id}`, `STRING ${s.id} (${s.modules} MOD, JBOX → PV LC)`,
      panelImp.toFixed(1), fla125.toFixed(1), String(stringOcpd),
      '2', homerunWireSize, '1', homerunEgcSize, 'THWN-2', data.dcHomerunConduit,
      String(string10Ampacity), String(ambientTemp), String(tempFactor), String(stringCorrected),
      String(string75CMax), String(stringUsable),
    ])
  })

  if (data.batteryCount > 0) {
    condRows.push([
      '⑤ BATT', `BATTERY → COMBINER (${data.batteryCount}x ${data.batteryModel})`,
      battFla.toFixed(1), battFla125.toFixed(1), '80',
      '3', battWireSize, '1', '#6 AWG', 'THWN-2', data.batteryConduit,
      String(battC90Ampacity), String(ambientTemp), String(tempFactor), String(battCorrected),
      String(batt75CMax), String(battUsable),
    ])
  }

  condRows.push([
    '③ INV', `INVERTER → MSP (${data.inverterCount}x ${data.inverterModel.split(' ').slice(0, 3).join(' ')})`,
    invFla.toFixed(1), invFla125.toFixed(1), '100',
    '3', invWireSize, '1', '#6 AWG', 'THWN-2', data.acConduit,
    String(invC90Ampacity), String(ambientTemp), String(tempFactor), String(invCorrected),
    String(inv75CMax), String(invUsable),
  ])

  // Generation disconnect — only for systems with utility interconnection
  if (data.inverterCount > 0) {
    condRows.push([
      '⑦ GEN', 'SERVICE DISCONNECT → UTILITY METER',
      String(genFla), String(genFla125), '200',
      '3', '250 kcmil', '1', '#6 AWG', 'THWN-2', '2" EMT',
      String(gen250kcmilAmpacity), String(ambientTemp), '1.00', String(gen250kcmilAmpacity),
      String(gen250kcmilAmpacity), String(genUsable),
    ])
  }

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
