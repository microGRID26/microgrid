import React from 'react'
import type { PlansetData } from '@/lib/planset-types'
import { TitleBlockHtml } from './TitleBlockHtml'

export function SheetPV7({ data }: { data: PlansetData }) {
  // F2 (v3) — micro-inverter installs have no DC disconnect (RSD integrated
  // per microinverter, NEC 690.12(B)(2)(a)) and no string-level DC voltages
  // exposed at panel level. Suppress the DC label blocks for those topologies.
  const isMicroInverter = data.systemTopology === 'micro-inverter'

  const maxVocCold = data.strings.length > 0
    ? Math.max(...data.strings.map(s => s.vocCold)).toFixed(1) : '0.0'
  const totalAcAmps = (data.inverterAcPower * 1000 / 240).toFixed(1)
  const totalAcAmpsAll = (parseFloat(totalAcAmps) * data.inverterCount).toFixed(1)
  // NEC 690.53(4) requires actual short-circuit current (Isc) on the DC
  // disconnect label, NOT 1.25 × Isc (which is the conductor sizing /
  // OCPD calc per NEC 690.8). Previously this rendered 16.88A on a 13.5A panel.
  const sccLabel = data.panelIsc.toFixed(2)

  // ── Sticker component renderers ──────────────────────────────────────────

  const stickerBase: React.CSSProperties = {
    padding: '6px 8px',
    fontSize: '7pt',
    lineHeight: 1.3,
    fontFamily: 'Arial, Helvetica, sans-serif',
    flex: '1 1 0',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  }

  function WarningSticker({ title, body, catalogs, nec }: {
    title: string; body: React.ReactNode; catalogs?: string; nec?: string
  }) {
    return (
      <div style={{ ...stickerBase, background: '#cc0000', color: 'white', border: '2px solid #990000' }}>
        <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11pt' }}>{'\u26A0'}</span> WARNING
        </div>
        <div style={{ fontWeight: 'bold', fontSize: '8pt', marginBottom: '2px' }}>{title}</div>
        <div style={{ flex: 1, fontSize: '6.5pt', lineHeight: 1.4 }}>{body}</div>
        {(catalogs || nec) && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.3)', marginTop: '4px', paddingTop: '3px', fontSize: '5pt', opacity: 0.85, lineHeight: 1.3 }}>
            {catalogs && <div>{catalogs}</div>}
            {nec && <div>{nec}</div>}
          </div>
        )}
      </div>
    )
  }

  function CautionSticker({ title, body, catalogs, nec }: {
    title: string; body: React.ReactNode; catalogs?: string; nec?: string
  }) {
    // Yellow background loses all distinction in print grayscale (becomes
    // pale gray indistinguishable from info-white). Heavy black left stripe
    // and outer black border preserve the "caution" signal in chroma-less print.
    return (
      <div style={{
        ...stickerBase,
        background: '#ffcc00', color: '#000',
        border: '2px solid #000',
        borderLeft: '8px solid #000',
      }}>
        <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11pt' }}>{'\u26A0'}</span> CAUTION
        </div>
        <div style={{ fontWeight: 'bold', fontSize: '8pt', marginBottom: '2px' }}>{title}</div>
        <div style={{ flex: 1, fontSize: '6.5pt', lineHeight: 1.4 }}>{body}</div>
        {(catalogs || nec) && (
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.2)', marginTop: '4px', paddingTop: '3px', fontSize: '5pt', opacity: 0.7, lineHeight: 1.3 }}>
            {catalogs && <div>{catalogs}</div>}
            {nec && <div>{nec}</div>}
          </div>
        )}
      </div>
    )
  }

  function InfoSticker({ title, body, catalogs, nec }: {
    title: string; body: React.ReactNode; catalogs?: string; nec?: string
  }) {
    return (
      <div style={{ ...stickerBase, background: '#fff', color: '#000', border: '2px solid #333' }}>
        <div style={{ fontWeight: 'bold', fontSize: '8.5pt', marginBottom: '3px' }}>{title}</div>
        <div style={{ flex: 1, fontSize: '6.5pt', lineHeight: 1.4 }}>{body}</div>
        {(catalogs || nec) && (
          <div style={{ borderTop: '1px solid #ccc', marginTop: '4px', paddingTop: '3px', fontSize: '5pt', color: '#666', lineHeight: 1.3 }}>
            {catalogs && <div>{catalogs}</div>}
            {nec && <div>{nec}</div>}
          </div>
        )}
      </div>
    )
  }

  function ValueBox({ label, value, color }: { label: string; value: string; color?: string }) {
    const bg = color || '#cc0000'
    return (
      <div style={{ display: 'inline-block', border: `2px solid ${bg}`, textAlign: 'center', minWidth: '70px' }}>
        <div style={{ background: bg, color: 'white', padding: '1px 6px', fontSize: '5pt', fontWeight: 'bold', textTransform: 'uppercase' as const }}>{label}</div>
        <div style={{ padding: '2px 6px', fontSize: '8pt', fontWeight: 'bold', color: bg }}>{value}</div>
      </div>
    )
  }

  function LocationCell({ name }: { name: string }) {
    return (
      <td style={{
        width: '1.1in', padding: '6px 5px', fontWeight: 'bold', fontSize: '6.5pt', color: '#fff',
        background: '#333', borderRight: '3px solid #111', verticalAlign: 'middle', textAlign: 'center',
        letterSpacing: '0.5px', textTransform: 'uppercase' as const, lineHeight: 1.3,
      }}>
        {name}
      </td>
    )
  }

  // ── Shared sticker content ───────────────────────────────────────────────

  const shockHazardBody = (
    <>TERMINALS ON THE LINE AND LOAD SIDES MAY BE ENERGIZED IN THE OPEN POSITION</>
  )

  const turnOffAcBody = (
    <>TURN OFF PHOTOVOLTAIC AC DISCONNECT PRIOR TO WORKING INSIDE PANEL</>
  )

  const threePowerBody = (
    <>
      <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>THREE POWER SOURCES</div>
      <div>SOURCES:</div>
      <div style={{ paddingLeft: '6px' }}>
        1. UTILITY GRID<br />
        2. BATTERY ({data.totalStorageKwh} kWh ESS)<br />
        3. PV SOLAR ELECTRIC SYSTEM ({data.systemAcKw} kW AC)
      </div>
      <div style={{ marginTop: '2px', fontWeight: 'bold' }}>DISCONNECT ALL SOURCES BEFORE SERVICING</div>
    </>
  )

  return (
    <div className="sheet" style={{ display: 'grid', gridTemplateColumns: '1fr 2.5in', border: '2px solid #000', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', width: '16.5in', height: '10.5in', overflow: 'hidden', position: 'relative' }}>
      <div className="sheet-content" style={{ padding: '0.12in 0.18in', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', color: '#111', marginBottom: '2px' }}>WARNING LABELS &mdash; NEC 690 / 705 / 706</div>
        <div style={{ fontSize: '6pt', color: '#555', marginBottom: '4pt' }}>ALL LABELS SHALL BE PERMANENT, WEATHER-RESISTANT, UV-RESISTANT, AND AFFIXED WITH ADHESIVE OR MECHANICAL FASTENER AT EACH EQUIPMENT LOCATION PER NEC 690.31(G).</div>

        {/* Label rows table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #333', flex: '0 0 auto' }}>
          <tbody>

            {/* ── ROW 1: EMT / CONDUIT RACEWAYS ── */}
            <tr style={{ borderBottom: '2px solid #333' }}>
              <LocationCell name="EMT / CONDUIT RACEWAYS" />
              <td style={{ padding: '4px', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <WarningSticker
                    title="PHOTOVOLTAIC POWER SOURCE"
                    body={<>CONDUIT CONTAINS ENERGIZED PV SOURCE CIRCUIT CONDUCTORS. DISCONNECT PV SYSTEM BEFORE WORKING ON THIS RACEWAY.</>}
                    catalogs="596-00999, 596-01007"
                    nec="NEC 690.31(D)(2)"
                  />
                </div>
              </td>
            </tr>

            {/* ── ROW 2: COMBINER BOX ── */}
            <tr style={{ borderBottom: '2px solid #333' }}>
              <LocationCell name="COMBINER BOX" />
              <td style={{ padding: '4px', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <WarningSticker
                    title="ELECTRICAL SHOCK HAZARD"
                    body={shockHazardBody}
                    catalogs="596-00878, 596-00893, 596-00921"
                    nec="NEC 706.15(C)(4), NEC 690.13(B)"
                  />
                  <WarningSticker
                    title="TURN OFF AC DISCONNECT"
                    body={turnOffAcBody}
                    catalogs="596-00499, 596-00664, 596-00832"
                    nec="NEC 110.27(C), OSHA 1910.145(f)(7)"
                  />
                  {/* F2 (v3) — DC labels suppressed for micro-inverter topology.
                      Substituted with RAPID SHUTDOWN INTEGRATED notice per
                      NEC 690.12(B)(2)(a). String-MPPT path keeps existing labels. */}
                  {!isMicroInverter ? (
                    <>
                      <InfoSticker
                        title="PV/AC AGGREGATE PANEL"
                        body={<>DO NOT REMOVE, ADD OR RELOCATE ANY CIRCUITS FROM THIS PANEL.</>}
                        nec="NEC 408.4"
                      />
                      <InfoSticker
                        title="PHOTOVOLTAIC SYSTEM DC DISCONNECT"
                        body={
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
                            <ValueBox label="OPERATING CURRENT" value={`${data.panelImp.toFixed(2)}A`} />
                            <ValueBox label="OPERATING VOLTAGE" value={`${(data.panelVmp * (data.strings[0]?.modules || 1)).toFixed(1)}V`} />
                            <ValueBox label="MAX SYSTEM VOLTAGE" value={`${maxVocCold}V`} />
                            <ValueBox label="SHORT CIRCUIT CURRENT" value={`${sccLabel}A`} />
                          </div>
                        }
                        nec="NEC 690.53"
                      />
                    </>
                  ) : (
                    <InfoSticker
                      title="RAPID SHUTDOWN INTEGRATED"
                      body={
                        <>
                          NO DC DISCONNECT REQUIRED — RAPID SHUTDOWN IS INTEGRATED PER MICROINVERTER.
                          INITIATED BY UTILITY DISCONNECT OPERATION. NO STRING-LEVEL DC VOLTAGES
                          EXPOSED AT PANEL — DC CONNECTIONS REMAIN INTERNAL TO EACH MICROINVERTER.
                        </>
                      }
                      nec="NEC 690.12(B)(2)(a)"
                    />
                  )}
                </div>
              </td>
            </tr>

            {/* ── ROW 3: PV AC DISCONNECT ── */}
            <tr style={{ borderBottom: '2px solid #333' }}>
              <LocationCell name="PV AC DISCONNECT" />
              <td style={{ padding: '4px', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <WarningSticker
                    title="ELECTRICAL SHOCK HAZARD"
                    body={shockHazardBody}
                    catalogs="596-00878, 596-00893"
                    nec="NEC 706.15(C)(4)"
                  />
                  <div style={{
                    ...stickerBase, background: '#cc0000', color: 'white', border: '2px solid #990000',
                    alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                  }}>
                    <div style={{ background: '#ffcc00', color: '#000', padding: '3px 10px', marginBottom: '4px', fontWeight: 'bold', fontSize: '8pt', border: '2px solid #cc9900' }}>
                      {'\u26A0'} RAPID SHUTDOWN
                    </div>
                    <div style={{ fontWeight: 'bold', fontSize: '8pt', marginBottom: '2px' }}>SOLAR PV SYSTEM EQUIPPED<br />WITH RAPID SHUTDOWN</div>
                    <div style={{ fontSize: '6pt' }}>COMPLIANT WITH NEC 690.12</div>
                    <div style={{ fontSize: '5pt', opacity: 0.8, marginTop: '3px' }}>NEC 690.56(C)(1)(a)</div>
                  </div>
                  <div style={{
                    ...stickerBase, background: '#fff', color: '#000', border: '3px solid #333',
                    alignItems: 'center', justifyContent: 'center', textAlign: 'center', flex: '1.5 1 0',
                  }}>
                    <div style={{ fontWeight: 'bold', fontSize: '10pt', marginBottom: '4px', borderBottom: '2px solid #333', paddingBottom: '4px', width: '100%' }}>
                      PHOTOVOLTAIC AC DISCONNECT
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', justifyContent: 'center' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '5.5pt', color: '#666', textTransform: 'uppercase' as const }}>RATED AC OUTPUT CURRENT</div>
                        <div style={{ fontSize: '12pt', fontWeight: 'bold', color: '#111', border: '2px solid #333', padding: '2px 10px', marginTop: '2px' }}>{totalAcAmpsAll}A</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '5.5pt', color: '#666', textTransform: 'uppercase' as const }}>NOMINAL OPERATING AC VOLTAGE</div>
                        <div style={{ fontSize: '12pt', fontWeight: 'bold', color: '#111', border: '2px solid #333', padding: '2px 10px', marginTop: '2px' }}>240 Vac</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '5pt', color: '#666', marginTop: '4px' }}>NEC 690.54</div>
                  </div>
                </div>
              </td>
            </tr>

            {/* ── ROW 4: BREAKER PANEL / PULL BOXES ── */}
            <tr style={{ borderBottom: '2px solid #333' }}>
              <LocationCell name="BREAKER PANEL / PULL BOXES" />
              <td style={{ padding: '4px', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <WarningSticker
                    title="ELECTRICAL SHOCK HAZARD"
                    body={shockHazardBody}
                    catalogs="596-00878, 596-00893"
                    nec="NEC 690.31(G)"
                  />
                  <WarningSticker
                    title="TURN OFF AC DISCONNECT"
                    body={turnOffAcBody}
                    catalogs="596-00499, 596-00664"
                    nec="NEC 110.27(C)"
                  />
                  <WarningSticker
                    title="THREE POWER SOURCES"
                    body={threePowerBody}
                    catalogs="596-01124"
                    nec="NEC 705.10"
                  />
                </div>
              </td>
            </tr>

            {/* ── ROW 5: MAIN SERVICE DISCONNECT ── */}
            <tr>
              <LocationCell name="MAIN SERVICE DISCONNECT" />
              <td style={{ padding: '4px', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <WarningSticker
                    title="ELECTRICAL SHOCK HAZARD"
                    body={shockHazardBody}
                    catalogs="596-00878"
                    nec="NEC 690.54"
                  />
                  <WarningSticker
                    title="POWER SOURCE OUTPUT CONNECTION"
                    body={<>DO NOT RELOCATE THIS OVERCURRENT DEVICE. PHOTOVOLTAIC POWER SOURCE OUTPUT CONNECTION.</>}
                    catalogs="596-00893"
                    nec="NEC 705.12(B)(2)(c)"
                  />
                  <CautionSticker
                    title="BACKFED CIRCUIT"
                    body={<>PHOTOVOLTAIC SYSTEM CIRCUIT IS BACKFED. THIS BREAKER/FUSE MUST REMAIN IN THIS LOCATION. DO NOT RELOCATE.</>}
                    catalogs="596-00921"
                    nec="NEC 690.13(F), NEC 705.12(B)(2)(c)"
                  />
                  <WarningSticker
                    title="THREE POWER SOURCES"
                    body={threePowerBody}
                    catalogs="596-01124"
                    nec="NEC 705.10"
                  />
                </div>
              </td>
            </tr>

          </tbody>
        </table>

        {/* ── System Summary Mirror (NEC 705 project-data label) ── */}
        <div style={{ marginTop: '5px', border: '2px solid #cc0000', padding: '4px 6px', background: '#fff8f8' }}>
          <div style={{ fontWeight: 'bold', fontSize: '7pt', color: '#cc0000', marginBottom: '3px', borderBottom: '1px solid #cc0000', paddingBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '9pt' }}>{'⚠'}</span>
            CAUTION: MULTIPLE SOURCES OF POWER — NEC 705.10 SYSTEM SUMMARY
          </div>
          <div style={{ fontSize: '5.5pt', color: '#333', marginBottom: '3px' }}>
            This building is equipped with a solar electric system. Multiple sources of power may be present.
            Disconnect all sources before servicing. For emergencies contact{' '}
            <strong>{data.contractor.name}</strong> at <strong>{data.contractor.phone}</strong>.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6pt' }}>
            <tbody>
              <tr style={{ background: '#f0f0f0' }}>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc', fontWeight: 'bold', width: '30%' }}>Owner</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc' }}>{data.owner}</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc', fontWeight: 'bold', width: '20%' }}>DC System Size</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc' }}>{data.systemDcKw.toFixed(2)} kW</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc', fontWeight: 'bold', width: '20%' }}>Battery Storage</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc' }}>{data.totalStorageKwh} kWh</td>
              </tr>
              <tr>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc', fontWeight: 'bold' }}>Address</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc' }}>{data.address}, {data.city}, {data.state} {data.zip}</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc', fontWeight: 'bold' }}>AC System Size</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc' }}>{data.systemAcKw} kW</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc', fontWeight: 'bold' }}>Panels</td>
                <td style={{ padding: '1px 4px', borderBottom: '1px solid #ccc' }}>({data.panelCount}) {data.panelModel}</td>
              </tr>
              <tr style={{ background: '#f0f0f0' }}>
                <td style={{ padding: '1px 4px', fontWeight: 'bold' }}>Project ID</td>
                <td style={{ padding: '1px 4px' }}>{data.projectId}</td>
                <td style={{ padding: '1px 4px', fontWeight: 'bold' }}>Inverters</td>
                <td style={{ padding: '1px 4px' }}>({data.inverterCount}) {data.inverterModel}</td>
                <td style={{ padding: '1px 4px', fontWeight: 'bold' }}>Batteries</td>
                <td style={{ padding: '1px 4px' }}>({data.batteryCount}) {data.batteryModel}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── NEC Article References ── */}
        <div style={{ marginTop: '5px', border: '2px solid #333', padding: '4px 6px', flex: '1 1 auto', overflow: 'hidden' }}>
          <div style={{ fontWeight: 'bold', fontSize: '7pt', color: '#111', marginBottom: '3px', borderBottom: '1px solid #999', paddingBottom: '2px' }}>NEC ARTICLE REFERENCES</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: '5pt', color: '#333', lineHeight: 1.4 }}>
            <div><strong>NEC 690.13(B):</strong> Each PV system disconnecting means shall plainly indicate whether in the open or closed position and shall be externally operable without exposing the operator to contact with live parts and, if sprung loaded, shall not result in a short circuit, or a connection between conductors in an ungrounded system, or between a grounded and ungrounded conductor in a grounded system.</div>
            <div><strong>NEC 690.31(B)(1):</strong> PV system circuit conductors installed in readily accessible locations shall be guarded, or shall be of a type identified as sunlight resistant, or shall be protected by a raceway, and shall be identified at all points of termination, connection, and splices.</div>
            <div><strong>NEC 690.31(D)(2):</strong> Where photovoltaic source circuits and photovoltaic output circuits operating at voltages greater than 30 volts are installed in readily accessible locations, circuit conductors shall be installed in a raceway. Unless located and arranged so the purpose is evident, PV source and output circuit conductors shall be identified at intervals not exceeding 10 ft with labels reading &ldquo;Photovoltaic Power Source.&rdquo;</div>
            <div><strong>NEC 690.53:</strong> A permanent label for the direct-current photovoltaic power source shall be provided by the installer at the PV disconnecting means that includes: (1) Rated maximum power-point current, (2) Rated maximum power-point voltage, (3) Maximum system voltage, (4) Short-circuit current, (5) Maximum rated output current of the charge controller (if installed).</div>
            <div><strong>NEC 690.54:</strong> A permanent label shall be applied by the installer near the PV system disconnecting means and at all interactive system(s) point(s) of interconnection with other sources. The label shall include: (1) Rated AC output current, (2) Nominal operating AC voltage.</div>
            <div><strong>NEC 690.56(C):</strong> PV systems with rapid shutdown shall be marked with the plaque shown in NEC 690.56(C)(1) at or within sight of each service disconnecting means. The plaque indicates the building has a PV system with rapid shutdown.</div>
            <div><strong>NEC 705.10:</strong> A directory shall be installed at each watt-hour meter enclosure, at each distribution equipment location, and at each power source interconnection point. The directory shall denote the location of each power source disconnecting means and identify, by name, each source of power.</div>
            <div><strong>NEC 705.12(B)(2)(c):</strong> Circuit breakers that are marked &ldquo;line&rdquo; and &ldquo;load&rdquo; shall not be backfed unless identified for such operation. Connections to a panelboard shall be positioned at the end of the panelboard that is electrically opposite from the input feeder connection or main circuit breaker.</div>
            <div><strong>NEC 690.13(F):</strong> A PV system disconnecting means that is an integral part of a listed overcurrent device or that is a circuit breaker shall be permitted. Circuit breakers that can be used in a backfed application shall be labeled &ldquo;WARNING: BACKFED&rdquo; and secured in the closed position per the listing requirements.</div>
            <div><strong>NEC 706.15(C)(4):</strong> Energy storage systems shall have a permanent label that includes the maximum operating and fault current, nominal voltage, and maximum stored energy. Warning labels shall indicate that terminals may be energized even with the main disconnect open.</div>
          </div>
        </div>
      </div>
      <TitleBlockHtml sheetName="WARNING LABELS" sheetNumber="PV-7" data={data} />
    </div>
  )
}
