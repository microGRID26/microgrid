'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  onClose: () => void
  onCreated: (id: string) => void
  existingIds: string[]
  pms: { id: string; name: string }[]
}

function nextProjectId(existingIds: string[]): string {
  const nums = existingIds
    .map(id => parseInt((id || '').replace('PROJ-', '')) || 0)
    .filter(n => n > 0 && n < 1000000)
  const max = nums.length > 0 ? Math.max(...nums) : 30312
  return `PROJ-${max + 1}`
}

// ── Autocomplete Input ────────────────────────────────────────────────────────

function AutocompleteInput({ value, onChange, table, placeholder, className }: {
  value: string
  onChange: (v: string) => void
  table: 'ahjs' | 'utilities'
  placeholder?: string
  className?: string
}) {
  const supabase = createClient()
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    if (!focused || value.length < 2) { setSuggestions([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      const { data } = await (supabase as any).from(table).select('name').ilike('name', `%${value}%`).order('name').limit(8)
      const names = (data ?? []).map((r: any) => r.name)
      setSuggestions(names)
      setOpen(names.length > 0)
    }, 200)
    return () => clearTimeout(timer)
  }, [value, focused])

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-gray-800 border border-gray-600 rounded-md shadow-xl overflow-hidden max-h-40 overflow-y-auto">
          {suggestions.map(s => (
            <button key={s} type="button"
              onClick={() => { onChange(s); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export function NewProjectModal({ onClose, onCreated, existingIds, pms }: Props) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    address: '',
    city: '',
    state: 'TX',
    zip: '',
    phone: '',
    email: '',
    sale_date: new Date().toISOString().slice(0, 10),
    stage: 'evaluation',
    pm: '',
    disposition: 'Sale',
    // Required
    dealer: '',
    financier: '',
    // Optional
    contract: '',
    systemkw: '',
    module: '',
    module_qty: '',
    inverter: '',
    inverter_qty: '',
    battery: '',
    battery_qty: '',
    ahj: '',
    utility: '',
    hoa: '',
    advisor: '',
    consultant: '',
    consultant_email: '',
  })

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function save() {
    // Validate required fields
    const missing: string[] = []
    if (!form.name.trim()) missing.push('Customer Name')
    if (!form.address.trim()) missing.push('Address')
    if (!form.phone.trim()) missing.push('Phone')
    if (!form.email.trim()) missing.push('Email')
    if (!form.dealer.trim()) missing.push('Dealer')
    if (!form.financier.trim()) missing.push('Financier')
    if (missing.length > 0) {
      setError('Required: ' + missing.join(', '))
      return
    }

    // Validate phone — digits only (allow parens, dashes, spaces, dots, plus)
    const phoneDigits = form.phone.replace(/[\s\-().+]/g, '')
    if (!/^\d{10,}$/.test(phoneDigits)) {
      setError('Phone must be a valid phone number (at least 10 digits)')
      return
    }

    // Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Email must be a valid email address')
      return
    }

    setSaving(true)
    setError(null)

    const id = nextProjectId(existingIds)
    const today = new Date().toISOString().slice(0, 10)

    const project = {
      id,
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim() || null,
      state: form.state || null,
      zip: form.zip.trim() || null,
      phone: form.phone.trim(),
      email: form.email.trim(),
      sale_date: form.sale_date || today,
      stage: form.stage,
      stage_date: today,
      pm: pms.find(p => p.id === form.pm)?.name ?? null,
      pm_id: form.pm || null,
      disposition: form.disposition,
      dealer: form.dealer.trim(),
      financier: form.financier.trim(),
      contract: form.contract ? Number(form.contract) : null,
      systemkw: form.systemkw ? Number(form.systemkw) : null,
      module: form.module.trim() || null,
      module_qty: form.module_qty ? Number(form.module_qty) : null,
      inverter: form.inverter.trim() || null,
      inverter_qty: form.inverter_qty ? Number(form.inverter_qty) : null,
      battery: form.battery.trim() || null,
      battery_qty: form.battery_qty ? Number(form.battery_qty) : null,
      ahj: form.ahj.trim() || null,
      utility: form.utility.trim() || null,
      hoa: form.hoa.trim() || null,
      advisor: form.advisor.trim() || null,
      consultant: form.consultant.trim() || null,
      consultant_email: form.consultant_email.trim() || null,
      created_at: new Date().toISOString(),
    }

    const { error: err } = await (supabase as any).from('projects').insert(project)

    if (err) {
      setError(err.message)
      setSaving(false)
      return
    }

    // Insert initial stage history
    const { error: histErr } = await (supabase as any).from('stage_history').insert({
      project_id: id,
      stage: form.stage,
      entered: today,
    })

    if (histErr) {
      setError('Project created but stage history failed: ' + histErr.message)
    }

    // Initialize evaluation tasks as "Ready To Start"
    if (form.stage === 'evaluation') {
      const evalTasks = ['welcome', 'ia', 'ub', 'sched_survey', 'ntp']
      await (supabase as any).from('task_state').insert(
        evalTasks.map(taskId => ({
          project_id: id,
          task_id: taskId,
          status: 'Ready To Start',
        }))
      )
    }

    // ── Auto-create Google Drive folder structure ────────────────────────
    try {
      const driveRes = await fetch('https://script.google.com/macros/s/AKfycbzQY8s4U51KatxMY-y0aXfpYIBDWL4IqhpiAMHm3dWvH94OlrdCN2UovgQz_zO1qknV/exec', {
        method: 'POST',
        body: JSON.stringify({ project_id: id, customer_name: form.name.trim() }),
        redirect: 'follow',
      })
      const driveText = await driveRes.text()
      try {
        const driveData = JSON.parse(driveText)
        if (driveData.folder_url) {
          await (supabase as any).from('project_folders').upsert(
            { project_id: id, folder_url: driveData.folder_url },
            { onConflict: 'project_id' }
          )
        } else {
          console.error('Drive folder creation failed:', driveData.error ?? driveText)
        }
      } catch {
        console.error('Drive response not JSON:', driveText)
      }
    } catch (driveErr) {
      console.error('Drive folder creation error:', driveErr)
    }

    setSaving(false)
    onCreated(id)
  }

  const inputCls = "w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none placeholder-gray-500"
  const labelCls = "text-xs text-gray-400 mb-1 block"
  const reqCls = "text-red-400"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">New Project</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              ID: <span className="text-green-400 font-mono">{nextProjectId(existingIds)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button>
        </div>

        {/* Error banner — sticky above form */}
        {error && (
          <div className="px-6 py-2 bg-red-950 border-b border-red-900 flex-shrink-0">
            <div className="text-xs text-red-400 font-medium">{error}</div>
          </div>
        )}

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ── Customer Info (required) ────────────────────────────────── */}
          <div>
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-3">Customer Info <span className={reqCls}>*</span></h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Customer Name <span className={reqCls}>*</span></label>
                <input className={inputCls} placeholder="First Last" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Street Address <span className={reqCls}>*</span></label>
                <input className={inputCls} placeholder="123 Main St" value={form.address} onChange={e => set('address', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>City</label>
                <input className={inputCls} placeholder="Austin" value={form.city} onChange={e => set('city', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>State</label>
                <select className={inputCls} value={form.state} onChange={e => set('state', e.target.value)}>
                  <option value="TX">TX</option>
                  <option value="AL">AL</option><option value="AK">AK</option><option value="AZ">AZ</option><option value="AR">AR</option>
                  <option value="CA">CA</option><option value="CO">CO</option><option value="CT">CT</option><option value="DE">DE</option>
                  <option value="FL">FL</option><option value="GA">GA</option><option value="HI">HI</option><option value="ID">ID</option>
                  <option value="IL">IL</option><option value="IN">IN</option><option value="IA">IA</option><option value="KS">KS</option>
                  <option value="KY">KY</option><option value="LA">LA</option><option value="ME">ME</option><option value="MD">MD</option>
                  <option value="MA">MA</option><option value="MI">MI</option><option value="MN">MN</option><option value="MS">MS</option>
                  <option value="MO">MO</option><option value="MT">MT</option><option value="NE">NE</option><option value="NV">NV</option>
                  <option value="NH">NH</option><option value="NJ">NJ</option><option value="NM">NM</option><option value="NY">NY</option>
                  <option value="NC">NC</option><option value="ND">ND</option><option value="OH">OH</option><option value="OK">OK</option>
                  <option value="OR">OR</option><option value="PA">PA</option><option value="RI">RI</option><option value="SC">SC</option>
                  <option value="SD">SD</option><option value="TN">TN</option><option value="UT">UT</option><option value="VT">VT</option>
                  <option value="VA">VA</option><option value="WA">WA</option><option value="WV">WV</option><option value="WI">WI</option>
                  <option value="WY">WY</option><option value="DC">DC</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Zip Code</label>
                <input className={inputCls} inputMode="numeric" pattern="[0-9]*" maxLength={5} placeholder="78701" value={form.zip} onChange={e => set('zip', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Phone <span className={reqCls}>*</span></label>
                <input className={inputCls} type="tel" placeholder="(555) 555-5555" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Email <span className={reqCls}>*</span></label>
                <input className={inputCls} type="email" placeholder="customer@email.com" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Project Details (required) ──────────────────────────────── */}
          <div>
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-3">Project Details <span className={reqCls}>*</span></h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Sale Date</label>
                <input className={inputCls} type="date" value={form.sale_date} onChange={e => set('sale_date', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Stage</label>
                <select className={inputCls} value={form.stage} onChange={e => set('stage', e.target.value)}>
                  {['evaluation','survey','design','permit','install','inspection','complete'].map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>PM</label>
                <select className={inputCls} value={form.pm} onChange={e => set('pm', e.target.value)}>
                  <option value="">Select PM...</option>
                  {pms.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Dealer <span className={reqCls}>*</span></label>
                <select className={inputCls} value={form.dealer} onChange={e => set('dealer', e.target.value)}>
                  <option value="">Select Dealer...</option>
                  <option>MicroGRID</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Financier <span className={reqCls}>*</span></label>
                <select className={inputCls} value={form.financier} onChange={e => set('financier', e.target.value)}>
                  <option value="">Select Financier...</option>
                  <option>EDGE</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Contract Value</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                  <input className={inputCls + ' pl-6'} type="number" step="0.01" placeholder="75000" value={form.contract} onChange={e => set('contract', e.target.value)} />
                </div>
              </div>
              <div>
                <label className={labelCls}>System Size (kW)</label>
                <input className={inputCls} type="number" step="0.001" placeholder="18.00" value={form.systemkw} onChange={e => set('systemkw', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Disposition</label>
                <select className={inputCls} value={form.disposition} onChange={e => set('disposition', e.target.value)}>
                  <option>Sale</option>
                  <option>Loyalty</option>
                  <option>In Service</option>
                  <option>Cancelled</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Equipment ───────────────────────────────────────────────── */}
          <div>
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-3">Equipment</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Module</label>
                <input className={inputCls} placeholder="Module model" value={form.module} onChange={e => set('module', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Module Qty</label>
                <input className={inputCls} type="number" placeholder="20" value={form.module_qty} onChange={e => set('module_qty', e.target.value)} />
              </div>
              <div />
              <div className="col-span-2">
                <label className={labelCls}>Inverter</label>
                <input className={inputCls} placeholder="Inverter model" value={form.inverter} onChange={e => set('inverter', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Inverter Qty</label>
                <input className={inputCls} type="number" placeholder="1" value={form.inverter_qty} onChange={e => set('inverter_qty', e.target.value)} />
              </div>
              <div />
              <div className="col-span-2">
                <label className={labelCls}>Battery</label>
                <input className={inputCls} placeholder="Battery model" value={form.battery} onChange={e => set('battery', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Battery Qty</label>
                <input className={inputCls} type="number" placeholder="0" value={form.battery_qty} onChange={e => set('battery_qty', e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Permitting & Utility ────────────────────────────────────── */}
          <div>
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-3">Permitting & Utility</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>AHJ</label>
                <AutocompleteInput value={form.ahj} onChange={v => set('ahj', v)} table="ahjs" placeholder="Search AHJs..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Utility Company</label>
                <AutocompleteInput value={form.utility} onChange={v => set('utility', v)} table="utilities" placeholder="Search utilities..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>HOA</label>
                <input className={inputCls} placeholder="HOA name (if applicable)" value={form.hoa} onChange={e => set('hoa', e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Team ───────────────────────────────────────────────────── */}
          <div>
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-3">Team</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Energy Advisor</label>
                <input className={inputCls} placeholder="Full name" value={form.advisor} onChange={e => set('advisor', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Energy Consultant</label>
                <input className={inputCls} placeholder="Full name" value={form.consultant} onChange={e => set('consultant', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Consultant Email</label>
                <input className={inputCls} type="email" placeholder="consultant@email.com" value={form.consultant_email} onChange={e => set('consultant_email', e.target.value)} />
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 flex-shrink-0">
          <span className="text-[10px] text-gray-600"><span className={reqCls}>*</span> Required fields</span>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-xs px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              className="text-xs px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-medium rounded-lg transition-colors"
            >
              {saving ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
