import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV51({ data }: { data: PlansetData }) {
  const maxStringVocCold = data.strings.length > 0
    ? Math.max(...data.strings.map(s => s.vocCold)).toFixed(1) : '0.0'
  const totalAcAmps = (data.inverterAcPower * 1000 / 240).toFixed(1)
  const totalAcAmpsAll = (parseFloat(totalAcAmps) * data.inverterCount).toFixed(1)
  const maxDcCurrent125 = (data.panelIsc * 1.25).toFixed(1)
  const shortCircuitCurrent = data.panelIsc.toFixed(1)

  const stringGroups: Record<number, number> = {}
  for (const s of data.strings) {
    stringGroups[s.modules] = (stringGroups[s.modules] || 0) + 1
  }
  const stringDesc = Object.entries(stringGroups)
    .sort(([, a], [, b]) => b - a)
    .map(([mods, count]) => `${count}x ${mods}-MODULE (Voc=${(parseInt(mods) * data.vocCorrected).toFixed(1)}V)`)
    .join(' + ')

  // Label type: warning (red), caution (amber), info (blue/black)
  type LabelType = 'warning' | 'caution' | 'info'
  interface PcsLabel {
    title: string
    nec: string
    type: LabelType
    lines: string[]
    valueBoxes?: { label: string; value: string; color?: string }[]
  }

  const borderColors: Record<LabelType, string> = { warning: '#cc0000', caution: '#cc9900', info: '#1a6cb5' }
  const headerBgs: Record<LabelType, string> = { warning: '#cc0000', caution: '#cc9900', info: '#1a6cb5' }
  const lightBgs: Record<LabelType, string> = { warning: '#fff5f5', caution: '#fffbf0', info: '#f0f7ff' }

  const leftLabels: PcsLabel[] = [
    {
      title: 'INVERTER LABEL', nec: 'NEC 690.54', type: 'caution',
      lines: [
        'CAUTION: DUAL POWER SOURCE',
        'THIS EQUIPMENT IS SUPPLIED BY MULTIPLE POWER SOURCES:',
        '1. UTILITY GRID (240V AC, SINGLE PHASE)',
        `2. PHOTOVOLTAIC SYSTEM (${data.systemDcKw.toFixed(2)} kW DC)`,
        `3. BATTERY ENERGY STORAGE (${data.totalStorageKwh} kWh)`,
        `INVERTER: (${data.inverterCount}) ${data.inverterModel}`,
      ],
      valueBoxes: [
        { label: 'RATED AC OUTPUT', value: `${data.systemAcKw} kW` },
        { label: 'RATED AC CURRENT', value: `${totalAcAmps}A @ 240V` },
        { label: 'UNITS', value: `${data.inverterCount}` },
      ],
    },
    {
      title: 'AC DISCONNECT LABEL', nec: 'NEC 690.14(C)', type: 'warning',
      lines: [
        'AC DISCONNECT \u2014 SOLAR PHOTOVOLTAIC SYSTEM',
        'VOLTAGE: 240V AC, SINGLE PHASE',
        'DISCONNECT RATING: 200A, NEMA 3R',
        'CAUTION: TURN OFF AC DISCONNECT BEFORE SERVICING INVERTER',
      ],
      valueBoxes: [
        { label: 'RATED AC OUTPUT CURRENT', value: `${totalAcAmpsAll}A`, color: '#cc0000' },
        { label: 'NOMINAL OPERATING AC VOLTAGE', value: '240 Vac', color: '#cc0000' },
      ],
    },
    {
      title: 'PV DISCONNECT LABEL', nec: 'NEC 690.13', type: 'warning',
      lines: [
        'DC DISCONNECT \u2014 PHOTOVOLTAIC SYSTEM',
        `STRINGS: ${stringDesc}`,
        `CONDUCTOR: ${data.dcStringWire}`,
        `CONDUIT: ${data.dcConduit}`,
        'WARNING: SHOCK HAZARD \u2014 DC CIRCUITS MAY BE ENERGIZED WHEN MODULES ARE EXPOSED TO LIGHT',
      ],
      valueBoxes: [
        { label: 'MAX SYSTEM VOLTAGE', value: `${maxStringVocCold}V DC`, color: '#cc0000' },
        { label: 'SHORT CIRCUIT CURRENT', value: `${shortCircuitCurrent}A`, color: '#cc0000' },
        { label: 'MAX DC CURRENT (125% Isc)', value: `${maxDcCurrent125}A`, color: '#cc0000' },
      ],
    },
  ]

  const rightLabels: PcsLabel[] = [
    {
      title: 'MAIN PANEL LABEL', nec: 'NEC 705.12', type: 'warning',
      lines: [
        'WARNING: SOLAR PHOTOVOLTAIC SYSTEM CONNECTED',
        `SOLAR SYSTEM: ${data.systemDcKw.toFixed(2)} kW DC / ${data.systemAcKw} kW AC`,
        `BATTERY STORAGE: ${data.totalStorageKwh} kWh`,
        `PV BACKFEED BREAKER: (${data.inverterCount}) ${data.backfeedBreakerA}A, 240V`,
        'CAUTION: DO NOT EXCEED BUS RATING WHEN ADDING BREAKERS',
        'SEE NEC 705.12 FOR 120% BUS BAR RATING RULE',
      ],
    },
    {
      title: 'UTILITY METER LABEL', nec: 'NEC 705.10', type: 'info',
      lines: [
        'NET METERING \u2014 PHOTOVOLTAIC SYSTEM',
      ],
      valueBoxes: [
        { label: 'UTILITY', value: data.utility },
        { label: 'METER', value: data.meter },
        { label: 'ESID', value: data.esid },
        { label: 'SYSTEM OUTPUT', value: `${data.systemAcKw} kW AC` },
      ],
    },
    {
      title: 'BATTERY WARNING LABEL', nec: 'NEC 706.30', type: 'warning',
      lines: [
        'WARNING: BATTERY ENERGY STORAGE SYSTEM',
        `BATTERY: (${data.batteryCount}) ${data.batteryModel}`,
        `TOTAL STORAGE: ${data.totalStorageKwh} kWh, LFP CHEMISTRY`,
        'NOMINAL VOLTAGE: 51.2V DC PER BATTERY',
        'CAUTION: CHEMICAL HAZARD \u2014 LITHIUM IRON PHOSPHATE BATTERIES',
        'DO NOT OPEN BATTERY ENCLOSURE \u2014 NO USER-SERVICEABLE PARTS',
      ],
    },
    {
      title: 'RAPID SHUTDOWN LABEL', nec: 'NEC 690.12', type: 'warning',
      lines: [
        'RAPID SHUTDOWN SYSTEM',
        'MODULE-LEVEL RAPID SHUTDOWN',
        'COMPLIANT WITH NEC 690.12(B)(2)',
        'TO INITIATE: TURN OFF AC DISCONNECT',
        'ARRAY VOLTAGE <30V WITHIN 30 SECONDS',
      ],
    },
  ]

  function renderPcsLabel(label: PcsLabel, i: number) {
    const bc = borderColors[label.type]
    const hdrBg = headerBgs[label.type]
    const bgLight = lightBgs[label.type]
    return (
      <div key={i} style={{ borderLeft: `4px solid ${bc}`, marginBottom: '7px', overflow: 'hidden', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
        {/* Header bar */}
        <div style={{ background: hdrBg, color: 'white', padding: '3px 8px', fontSize: '7pt', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{label.title}</span>
          <span style={{ fontSize: '6.5pt', fontWeight: 'bold', background: 'rgba(255,255,255,0.2)', padding: '0 4px', borderRadius: '2px' }}>{label.nec}</span>
        </div>
        {/* Body */}
        <div style={{ padding: '4px 8px', fontSize: '6.5pt', lineHeight: 1.55, background: bgLight }}>
          {label.lines.map((line, j) => {
            if (!line) return <br key={j} />
            const isWarn = line.startsWith('CAUTION') || line.startsWith('WARNING') || line.startsWith('DO NOT') || line.startsWith('DANGER')
            return (
              <div key={j} style={{
                fontWeight: j === 0 ? 'bold' : 'normal',
                color: isWarn ? '#cc0000' : '#333',
                fontSize: j === 0 ? '7pt' : '6.5pt',
              }}>{line}</div>
            )
          })}
          {/* Value boxes */}
          {label.valueBoxes && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
              {label.valueBoxes.map((vb, vi) => (
                <div key={vi} style={{ border: `2px solid ${vb.color || bc}`, padding: '2px 8px', textAlign: 'center', background: '#fff', minWidth: '60px' }}>
                  <div style={{ fontSize: '4.5pt', color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.3px' }}>{vb.label}</div>
                  <div style={{ fontSize: '8pt', fontWeight: 'bold', color: vb.color || bc }}>{vb.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.15in 0.2in', overflow: 'hidden' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111' }}>PCS LABELS &mdash; NEC REQUIRED EQUIPMENT LABELS</div>
        <div style={{ fontSize: '7.5pt', color: '#555', marginBottom: '6pt' }}>ALL LABELS SHALL BE PERMANENT, WEATHER-RESISTANT, AND INSTALLED AT POINT OF APPLICATION</div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '6px', fontSize: '6pt', color: '#555' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '12px', height: '4px', background: '#cc0000', borderRadius: '1px' }} /> WARNING</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '12px', height: '4px', background: '#cc9900', borderRadius: '1px' }} /> CAUTION</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '12px', height: '4px', background: '#1a6cb5', borderRadius: '1px' }} /> INFORMATION</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>{leftLabels.map((l, i) => renderPcsLabel(l, i))}</div>
          <div>{rightLabels.map((l, i) => renderPcsLabel(l, i))}</div>
        </div>
      </div>
      <TitleBlockHtml sheetName="PCS LABELS" sheetNumber="PV-5.1" data={data} />
    </div>
  )
}
