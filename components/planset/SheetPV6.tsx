import type { PlansetData } from '@/lib/planset-types'
import { ampacityFor } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV6({ data }: { data: PlansetData }) {
  const wireResistance: Record<string, number> = {
    '#14': 3.14, '#12': 1.98, '#10': 1.24, '#8': 0.778, '#6': 0.491,
    '#4': 0.308, '#3': 0.245, '#2': 0.194, '#1': 0.154, '1/0': 0.122,
  }

  const strings = data.strings.map((s, i) => {
    const voc = s.modules * data.panelVoc
    const vocCold = s.vocCold
    const vmp = s.vmpNominal
    const isc = data.panelIsc
    const runFt = data.dcRunLengthFt
    const wireSize = data.dcStringWire.match(/#\d+/)?.[0] ?? '#10'
    const conductor125 = isc * 1.25
    const vDrop = (2 * runFt * isc * (wireResistance[wireSize] ?? wireResistance['#10'])) / 1000
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
  const acRunFt = data.acRunLengthFt
  // Extract wire gauge from data for resistance lookup (e.g., '#6 AWG CU THWN-2' → '#6')
  const acWireGauge = data.acWireToPanel.match(/#\d+/)?.[0] ?? '#4'
  const acVDrop = (2 * acRunFt * acCurrentPerInv * (wireResistance[acWireGauge] ?? wireResistance['#4'])) / 1000
  const acVDropPct = (acVDrop / 240) * 100

  const battCurrentPerStack = data.batteryMaxCurrentA
  const battCurrent125 = battCurrentPerStack * 1.25

  const stringFuseCalc = data.panelIsc * 1.56
  const stringFuseSize = Math.ceil(stringFuseCalc / 5) * 5

  const tempCF = 0.91

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>WIRING CALCULATIONS</div>
          <div style={{ fontSize: '6pt', color: '#555' }}>ALL CONDUCTORS COPPER (CU), RATED 75&deg;C MIN. VOLTAGE DROP: 2% DC, 3% AC.</div>
        </div>

        {/* ── TAG-BASED WIRE CHART (matches SLD callout circles ①-⑨) ── */}
        <div style={{ fontWeight: 'bold', fontSize: '8pt', color: '#111', marginTop: '4px', marginBottom: '2px', borderBottom: '2px solid #111', paddingBottom: '2px' }}>WIRE CHART</div>
        {/* Draft-project guard: on projects without strings, conductor count
            would render "(0)" which leaks to AHJ-bound PDF if exported in
            draft state. Use "(TBD)" so the row stays informative. */}
        {(() => {
          const stringCount = data.strings.length
          const conductorCount = stringCount > 0 ? `(${stringCount * 2})` : '(TBD)'
          return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '5.5pt', marginBottom: '6px' }}>
          {[
            { tag: 1, from: 'FROM PV MODULES TO JBOX', specs: [
              `${conductorCount} ${data.dcStringWire}`,
              `(1) #6 AWG BARE CU EGC`,
              `${data.dcConduit}`,
            ]},
            { tag: 2, from: 'FROM JBOX TO PV LOAD CENTER', specs: [
              // 2 conductors per string (positive + negative), all in the
              // shared homerun conduit. All wire/EGC/conduit specs derive
              // from data so OverridesPanel changes propagate to PV-6.
              `${conductorCount} ${data.dcHomerunWire}`,
              `(1) ${data.dcHomerunEgc}`,
              `${data.dcHomerunConduit} TYPE CONDUIT`,
            ]},
            { tag: 3, from: `FROM NON-FUSED PV DISCONNECT TO ${data.inverterModel.split(' ').slice(0, 4).join(' ').toUpperCase()}`, specs: [
              `(3) ${data.dcDisconnectWire}`,
              `(1) #8 AWG CU EGC`,
              `${data.dcDisconnectConduit} TYPE CONDUIT`,
            ]},
            { tag: 4, from: `FROM ${data.inverterModel.split(' ').slice(0, 4).join(' ').toUpperCase()} TO MAIN SERVICE PANEL`, specs: [
              `(3) ${data.acWireToPanel}`,
              `(1) #6 AWG CU EGC`,
              `${data.acConduit}`,
            ]},
            ...(data.batteryCount > 0 ? [
              { tag: 5, from: `FROM DURAS BATTERY TO BATTERY COMBINER`, specs: [
                // Conduit is data.batteryConduit (default 2" EMT) — #4/0 AWG
                // doesn't fit in 1" EMT per Chapter 9 Table 4.
                `${data.batteryWire}`,
                `#8 AWG CU, ${data.batteryConduit}`,
              ]},
              { tag: 6, from: `FROM BATTERY COMBINER TO ${data.inverterModel.split(' ').slice(0, 4).join(' ').toUpperCase()}`, specs: [
                `(4) ${data.batteryCombinerOutputWire}`,
                `(1) #8 AWG CU EGC`,
                `${data.batteryCombinerOutputConduit} TYPE CONDUIT`,
              ]},
            ] : []),
            { tag: 7, from: 'FROM SERVICE DISCONNECT TO UTILITY METER', specs: [
              `(3) 250 kcmil CU THWN-2`,
              // 250 kcmil conductors don't fit in 1-1/4" EMT per Chapter 9 Table 4.
              // Service entrance always 2" EMT regardless of acConduit (which sizes
              // the inverter→MSP run). Matches PV-8 conductor schedule row ⑦.
              `2" EMT TYPE CONDUIT`,
              `ROUGHLY ${data.acRunLengthFt} FEET (DIRT) TRENCHING`,
              `FROM UTILITY POLE TO HOME WALL`,
            ]},
          ].map(({ tag, from, specs }) => (
            <div key={tag} style={{ display: 'flex', gap: '4px', borderBottom: '1px solid #ddd', paddingBottom: '2px', paddingTop: '2px' }}>
              <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#111', color: '#fff', fontSize: '7pt', fontWeight: 'bold', textAlign: 'center', lineHeight: '14px', flexShrink: 0 }}>{tag}</div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#111', marginBottom: '1px' }}>{from}</div>
                {specs.map((s, i) => <div key={i} style={{ color: '#444' }}>{s}</div>)}
              </div>
            </div>
          ))}
        </div>
          )
        })()}

        {/* ── DETAILED CALCULATIONS ── */}
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
              ['PV BREAKER (per INV)', 'Per inverter AC output rating', `${acCurrent125.toFixed(1)}A`, `${data.backfeedBreakerA}A`, '240V AC'],
              ['MAIN BREAKER', 'Existing service main', `${(acCurrent125 * data.inverterCount).toFixed(1)}A`, data.mainBreaker, '240V AC'],
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
            {/*
              Battery + inverter ampacity rows derive from data.batteryWire /
              data.acWireToPanel via NEC_AMPACITY_75C lookup so this table
              matches PV-8 conductor schedule and PV-4 detail labels.
              DC string + EGC are static defaults (#10 AWG free air, #6 AWG EGC).
            */}
            {((): [string, number, number, number, number][] => {
              const battAmp = ampacityFor(data.batteryWire)
              const acAmp = ampacityFor(data.acWireToPanel)
              const battSize = data.batteryWire.match(/#?\d+(?:\/0)?\s*AWG/i)?.[0] ?? '#4 AWG'
              const acSize = data.acWireToPanel.match(/#?\d+(?:\/0)?\s*AWG/i)?.[0] ?? '#1 AWG'
              return [
                ['#10 AWG CU (DC STRING)', 40, 0.70, 37, 30],
                [`${battSize} CU (BATTERY)`, battAmp.c90 || 95, 0.70, 37, battAmp.c75 || 85],
                [`${acSize} CU (INVERTER AC)`, acAmp.c90 || 145, 0.70, 37, acAmp.c75 || 130],
                ['#6 AWG CU (EGC)', 75, 1.0, 37, 65],
              ]
            })().map((row, i) => {
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
