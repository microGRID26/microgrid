'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import type { Project } from '@/types/database'

interface BomItem {
  cat: string
  key: string
  label: string
  pn: string
  qty: number
  unit: string
  note: string
}

interface BomInputs {
  arrayCount: number
  rowCount: number
  attachmentCount: number
  overrides: Record<string, number>
}

function calcBOM(p: Project, inputs: BomInputs): BomItem[] {
  const modules   = Number(p.module_qty) || 0
  const batteries = Number(p.battery_qty) || 0
  const inverters = Number(p.inverter_qty) || 1
  const arrays    = Number(inputs.arrayCount) || 1
  const rows      = Number(inputs.rowCount) || 1
  const attach    = Number(inputs.attachmentCount) || Math.round(modules * 2.4)
  const ov        = inputs.overrides || {}

  function qty(key: string, formula: number): number {
    return ov[key] !== undefined ? Number(ov[key]) : Math.max(0, Math.round(formula))
  }

  const rsd       = Math.ceil(modules / 2)
  const endClamps = Math.round(attach * 0.375)
  const midClamps = (modules - rows) * 2 - 4

  return [
    { cat:'PV Equipment',  key:'modules',       label:'Solar PV Modules',              pn: p.module ?? '',    qty: qty('modules', modules),                unit:'EACH',   note:'From project data' },
    { cat:'PV Equipment',  key:'inverters',     label:'Inverters',                     pn: p.inverter ?? '',  qty: qty('inverters', inverters),             unit:'EACH',   note:'From project data' },
    { cat:'PV Equipment',  key:'batteries',     label:'Batteries',                     pn: p.battery ?? '',   qty: qty('batteries', batteries),             unit:'EACH',   note:'From project data' },
    { cat:'Rapid Shutdown',key:'rsd',           label:'Rapid Shutdown Device (RSD)',    pn:'APSMART RSD-D-20', qty: qty('rsd', rsd),                         unit:'EACH',   note:'1 RSD per 2 panels' },
    { cat:'Rapid Shutdown',key:'mlpe_mounts',   label:'MLPE Mounts',                   pn:'',                 qty: qty('mlpe_mounts', rsd + 4),             unit:'EACH',   note:'RSDs + 4 spare' },
    { cat:'Solar Wiring',  key:'soladecks',     label:'Soladecks',                     pn:'',                 qty: qty('soladecks', arrays),                unit:'EACH',   note:'1 per array' },
    { cat:'Solar Wiring',  key:'trunk_cables',  label:'Trunk Cables',                  pn:'',                 qty: qty('trunk_cables', modules + arrays*2 + 4), unit:'EACH', note:'Panels + arrays×2 + 4 spare' },
    { cat:'Solar Wiring',  key:'terminators',   label:'Terminators',                   pn:'',                 qty: qty('terminators', arrays*2 + 1),        unit:'EACH',   note:'2 per array + 1' },
    { cat:'Solar Wiring',  key:'seals',         label:'Seals',                         pn:'',                 qty: qty('seals', arrays*2 + 1),              unit:'EACH',   note:'2 per array + 1' },
    { cat:'Disconnects',   key:'disc_30a',      label:'30A/2P Non-Fusible Disconnect', pn:'CHD DG221URB',     qty: qty('disc_30a', 1),                      unit:'EACH',   note:'As needed' },
    { cat:'Disconnects',   key:'disc_200a',     label:'200A/2P Non-Fusible Disconnect',pn:'CHD DG224URK',     qty: qty('disc_200a', 1),                     unit:'EACH',   note:'As needed' },
    { cat:'Electrical',    key:'ground_lugs',   label:'Ground Lugs',                   pn:'',                 qty: qty('ground_lugs', arrays),              unit:'EACH',   note:'1 per continuous array' },
    { cat:'Electrical',    key:'roof_sealant',  label:'Roof Sealant',                  pn:'',                 qty: qty('roof_sealant', modules < 20 ? 6 : modules <= 40 ? 9 : 10), unit:'TUBES', note:'<20=6, 20-40=9, >40=10' },
    { cat:'Electrical',    key:'strain_relief', label:'1/2" Strain Relief',            pn:'',                 qty: qty('strain_relief', arrays + 1),        unit:'EACH',   note:'1 per array + 1 spare' },
    { cat:'Electrical',    key:'cts',           label:'CTs (Splitters)',               pn:'',                 qty: qty('cts', 2),                           unit:'EACH',   note:'Always 2' },
    { cat:'Electrical',    key:'emt',           label:'3/4" EMT Conduit',              pn:'',                 qty: qty('emt', 11),                          unit:'STICKS', note:'Standard' },
    { cat:'Electrical',    key:'connectors',    label:'3/4" EMT Connectors',           pn:'',                 qty: qty('connectors', 6),                    unit:'EACH',   note:'Standard' },
    { cat:'Electrical',    key:'couplings',     label:'3/4" EMT Couplings',            pn:'',                 qty: qty('couplings', 6),                     unit:'EACH',   note:'Standard' },
    { cat:'Electrical',    key:'zip_ties',      label:'Zip Ties',                      pn:'',                 qty: qty('zip_ties', 1),                      unit:'BUNDLE', note:'Standard' },
    { cat:'Electrical',    key:'water',         label:'Water',                         pn:'',                 qty: qty('water', 1),                         unit:'CASE',   note:'Standard' },
    { cat:'Electrical',    key:'bare_copper6',  label:'#6 Bare Copper Wire',           pn:'',                 qty: qty('bare_copper6', 22),                 unit:'FT',     note:'Avg per install' },
    { cat:'Electrical',    key:'green6',        label:'Green #6 THHN Wire',            pn:'',                 qty: qty('green6', 99),                       unit:'FT',     note:'Avg per install' },
    { cat:'Electrical',    key:'black10',       label:'Black #10 Copper Wire',         pn:'',                 qty: qty('black10', 83),                      unit:'FT',     note:'Avg per install' },
    { cat:'Electrical',    key:'red10',         label:'Red #10 Copper Wire',           pn:'',                 qty: qty('red10', 83),                        unit:'FT',     note:'Avg per install' },
    { cat:'EcoFlow',       key:'smart_panel',   label:'EcoFlow Smart Electrical Panel',pn:'',                 qty: qty('smart_panel', 1),                   unit:'EACH',   note:'As needed' },
    { cat:'EcoFlow',       key:'efa_ct',        label:'EcoFlow OCEAN Pro CT',          pn:'ECO5018004001',    qty: qty('efa_ct', 2),                        unit:'EACH',   note:'As needed' },
    { cat:'EcoFlow',       key:'handle_bar',    label:'EcoFlow OCEAN Pro Handle Bar',  pn:'ECO5018004005',    qty: qty('handle_bar', 1),                    unit:'EACH',   note:'As needed' },
    { cat:'EcoFlow',       key:'epo',           label:'Emergency Power Off Device',    pn:'CE4T-10R-02',      qty: qty('epo', 1),                           unit:'EACH',   note:'As needed' },
    { cat:'Racking',       key:'smart_foot',    label:'CF Smart Foot AL MLL',          pn:'2012036',          qty: qty('smart_foot', attach),               unit:'EACH',   note:'From design' },
    { cat:'Racking',       key:'rail_clicker',  label:'CF Rail Clicker AL MLL',        pn:'2012039',          qty: qty('rail_clicker', attach),             unit:'EACH',   note:'Same as smart foot' },
    { cat:'Racking',       key:'rails',         label:'Rails CF LTE US 165.4"',        pn:'2012034',          qty: qty('rails', 0),                         unit:'EACH',   note:'Enter from design' },
    { cat:'Racking',       key:'rail_splice',   label:'Rail Splice SS',                pn:'2012013',          qty: qty('rail_splice', 0),                   unit:'EACH',   note:'Enter from design' },
    { cat:'Racking',       key:'mid_clamps',    label:'Mid Clamps 30-40mm',            pn:'2099045',          qty: qty('mid_clamps', Math.max(0, midClamps)), unit:'EACH', note:'2 between each panel in a row' },
    { cat:'Racking',       key:'end_clamps',    label:'End Clamps 30-40mm',            pn:'2099046',          qty: qty('end_clamps', endClamps),            unit:'EACH',   note:'Based on attachment count' },
    { cat:'Racking',       key:'mlpe_mount',    label:'CF MLPE Mount SS',              pn:'2012019',          qty: qty('mlpe_mount', modules + 5),          unit:'EACH',   note:'Modules + 5' },
    { cat:'Racking',       key:'wire_clip',     label:'CF Wire Mgmt Clip',             pn:'2012020',          qty: qty('wire_clip', modules + 5),           unit:'EACH',   note:'Modules + 5' },
    { cat:'Racking',       key:'end_cap',       label:'CF End Cap PLS BLK',            pn:'2012029',          qty: qty('end_cap', endClamps),               unit:'EACH',   note:'Same as end clamp count' },
    { cat:'Racking',       key:'screw_14x3',    label:'Screw 14x3 W/WB',              pn:'3016018',          qty: qty('screw_14x3', attach * 3),           unit:'EACH',   note:'3 per attachment' },
    { cat:'Racking',       key:'module_jumper', label:'CF Module Jumper SS 8"',        pn:'4011011',          qty: qty('module_jumper', arrays * 2),        unit:'EACH',   note:'2 per array' },
  ]
}

function exportBomCSV(items: BomItem[], projectId: string) {
  const headers = ['Category','Item','Part Number','Qty','Unit','Notes']
  const rows = items.map(i => [i.cat, i.label, i.pn, i.qty, i.unit, i.note])
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bom-${projectId}-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

interface Props { project: Project }

export function BomTab({ project }: Props) {
  const supabase = db()
  const [inputs, setInputs] = useState<BomInputs>({ arrayCount: 1, rowCount: 1, attachmentCount: 0, overrides: {} })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])
  const [version, setVersion] = useState<number | null>(null)

  // Load saved BOM
  useEffect(() => {
    ;supabase.from('project_boms').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(1).single()
      .then(({ data }: any) => {
        if (data) {
          setInputs({
            arrayCount: data.array_count ?? 1,
            rowCount: data.row_count ?? 1,
            attachmentCount: data.attachment_count ?? 0,
            overrides: data.overrides ?? {},
          })
          setVersion(data.version ?? 1)
        }
      })
  }, [project.id])

  const items = calcBOM(project, inputs)
  const categories = [...new Set(items.map(i => i.cat))]

  function setInput(field: keyof BomInputs, value: number) {
    setInputs(prev => ({ ...prev, [field]: value }))
  }

  function setOverride(key: string, value: string) {
    setInputs(prev => {
      const overrides = { ...prev.overrides }
      if (value === '') {
        delete overrides[key]
      } else {
        overrides[key] = Number(value)
      }
      return { ...prev, overrides }
    })
  }

  async function saveBom() {
    setSaving(true)
    const newVersion = (version ?? 0) + 1
    await supabase.from('project_boms').upsert({
      project_id: project.id,
      array_count: inputs.arrayCount,
      row_count: inputs.rowCount,
      attachment_count: inputs.attachmentCount,
      overrides: inputs.overrides,
      version: newVersion,
      created_at: new Date().toISOString(),
    }, { onConflict: 'project_id' })
    setVersion(newVersion)
    setSaving(false)
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 2000)
  }

  const inputCls = "bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 focus:border-green-500 focus:outline-none w-16 text-center"

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="flex-shrink-0 border-b border-gray-800 px-4 py-3 flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Arrays</span>
          <input type="number" min={1} className={inputCls} value={inputs.arrayCount}
            onChange={e => setInput('arrayCount', Number(e.target.value))} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Rows</span>
          <input type="number" min={1} className={inputCls} value={inputs.rowCount}
            onChange={e => setInput('rowCount', Number(e.target.value))} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Attachments</span>
          <input type="number" min={0} className={inputCls} value={inputs.attachmentCount}
            onChange={e => setInput('attachmentCount', Number(e.target.value))} />
          <span className="text-xs text-gray-600">(0 = auto)</span>
        </div>
        {version && <span className="text-xs text-gray-600">v{version}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => exportBomCSV(items, project.id)}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
            ↓ CSV
          </button>
          <button onClick={saveBom} disabled={saving}
            className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save BOM'}
          </button>
        </div>
      </div>

      {/* BOM table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-gray-950 sticky top-0">
            <tr>
              {['Item','Part #','Qty','Unit','Notes'].map(h => (
                <th key={h} className="text-left text-gray-400 font-medium px-3 py-2 border-b border-gray-800">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => (
              <React.Fragment key={cat}>
                <tr>
                  <td colSpan={5} className="px-3 py-1.5 bg-gray-850 border-b border-gray-800">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{cat}</span>
                  </td>
                </tr>
                {items.filter(i => i.cat === cat).map(item => (
                  <tr key={item.key} className="border-b border-gray-800 hover:bg-gray-800">
                    <td className="px-3 py-2 text-gray-200">{item.label}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.pn || '—'}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={inputs.overrides[item.key] !== undefined ? inputs.overrides[item.key] : item.qty}
                        onChange={e => setOverride(item.key, e.target.value)}
                        className="w-16 bg-gray-800 text-white text-xs rounded px-2 py-0.5 border border-gray-700 focus:border-green-500 focus:outline-none text-center"
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-500">{item.unit}</td>
                    <td className="px-3 py-2 text-gray-600">{item.note}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
