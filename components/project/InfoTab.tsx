'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { STAGE_LABELS, fmt$, escapeIlike } from '@/lib/utils'
import type { Project } from '@/types/database'

// ── HELPER COMPONENTS ────────────────────────────────────────────────────────

function EditRow({ label, field, value, draft, editing, onChange, small, type = 'text' }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  small?: boolean
  type?: 'text' | 'date' | 'number' | 'currency'
}) {
  const current = field in draft ? draft[field] : value
  const inputType = type === 'currency' ? 'number' : type
  if (!editing) {
    if (!value) return null
    const display = type === 'date' && value
      ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : type === 'currency' && value
      ? fmt$(Number(value))
      : value
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className={`text-gray-200 text-xs break-words ${small ? 'text-xs' : ''}`}>{display}</span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 relative">
        {type === 'currency' && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>}
        <input
          type={inputType}
          value={current ?? ''}
          onChange={e => onChange((d: any) => ({ ...d, [field]: e.target.value || null }))}
          className={`w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none ${type === 'currency' ? 'pl-5' : ''}`}
        />
      </div>
    </div>
  )
}

function SelectEditRow({ label, field, value, draft, editing, onChange, options }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  options: string[]
}) {
  const current = field in draft ? draft[field] : value
  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className="text-gray-200 text-xs">{value}</span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <select
        value={current ?? ''}
        onChange={e => onChange((d: any) => ({ ...d, [field]: e.target.value || null }))}
        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
      >
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function AutocompleteRow({ label, field, value, draft, editing, onChange, table, searchCol = 'name', onClickValue }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  table: 'ahjs' | 'utilities'
  searchCol?: string
  onClickValue?: () => void
}) {
  const supabase = createClient()
  const current = field in draft ? draft[field] : value
  const [query, setQuery] = useState(current ?? '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(current ?? '') }, [current])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    if (!focused || query.length < 2) { setSuggestions([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      const { data } = await (supabase as any).from(table).select(searchCol).ilike(searchCol, `%${escapeIlike(query)}%`).order(searchCol).limit(8)
      const names = (data ?? []).map((r: any) => r[searchCol])
      setSuggestions(names)
      setOpen(names.length > 0)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, focused])

  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        {onClickValue ? (
          <button onClick={onClickValue} className="text-green-400 hover:text-green-300 text-xs break-words text-left hover:underline cursor-pointer">
            {value}
          </button>
        ) : (
          <span className="text-gray-200 text-xs break-words">{value}</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2 py-0.5 items-start" ref={ref}>
      <span className="text-gray-500 text-xs w-28 flex-shrink-0 mt-1">{label}</span>
      <div className="flex-1 relative">
        <input
          type="text"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={e => {
            setQuery(e.target.value)
            onChange((d: any) => ({ ...d, [field]: e.target.value || null }))
          }}
          className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
          placeholder={`Search ${label}…`}
        />
        {open && suggestions.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-gray-800 border border-gray-600 rounded-md shadow-xl overflow-hidden max-h-48 overflow-y-auto">
            {suggestions.map(s => (
              <button key={s} type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                onMouseDown={() => {
                  setQuery(s)
                  onChange((d: any) => ({ ...d, [field]: s }))
                  setOpen(false)
                }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 pb-1 border-b border-gray-800">{title}</div>
      {children}
    </div>
  )
}

// ── INFO TAB ─────────────────────────────────────────────────────────────────

interface InfoTabProps {
  project: Project
  editMode: boolean
  editDraft: Partial<Project>
  setEditDraft: (fn: any) => void
  ahjInfo: any
  utilityInfo: any
  openAhjEdit: () => void
  openUtilEdit: () => void
  stageHistory?: any[]
  serviceCalls?: any[]
}

export function InfoTab({ project, editMode, editDraft, setEditDraft, ahjInfo, utilityInfo, openAhjEdit, openUtilEdit, stageHistory = [], serviceCalls = [] }: InfoTabProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-2 gap-6 max-w-3xl">
        <div>
          <Section title="Customer">
            <EditRow label="Name" field="name" value={project.name} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            {editMode ? (
              <EditRow label="Address" field="address" value={project.address} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            ) : (
              project.address ? (
                <div className="flex gap-2 py-0.5">
                  <span className="text-gray-500 text-xs w-28 flex-shrink-0">Address</span>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent([project.address, project.city].filter(Boolean).join(', '))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-400 text-xs break-words hover:underline"
                  >
                    {project.address}
                  </a>
                </div>
              ) : null
            )}
            <EditRow label="City" field="city" value={project.city} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Phone" field="phone" value={project.phone} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Email" field="email" value={project.email} draft={editDraft} editing={editMode} onChange={setEditDraft} small />
          </Section>
          <Section title="Project">
            <SelectEditRow label="Disposition" field="disposition" value={project.disposition} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Sale','Loyalty','Cancelled','In Service']} />
            <EditRow label="Contract" field="contract" value={project.contract?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="currency" />
            <EditRow label="System kW" field="systemkw" value={project.systemkw?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
            <SelectEditRow label="Financier" field="financier" value={project.financier} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Cash','EDGE','Mosaic','Sungage','GoodLeap','Dividend','Sunrun','Tesla','Sunnova','Loanpal','Other']} />
            <SelectEditRow label="Financing type" field="financing_type" value={project.financing_type} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Loan','TPO (Lease, PPA)','Cash']} />
            <EditRow label="Down payment" field="down_payment" value={project.down_payment?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="currency" />
            <EditRow label="TPO escalator" field="tpo_escalator" value={project.tpo_escalator?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
            <EditRow label="Financier adv pmt" field="financier_adv_pmt" value={project.financier_adv_pmt?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
            <EditRow label="Dealer" field="dealer" value={project.dealer} draft={editDraft} editing={editMode} onChange={setEditDraft} />
          </Section>
          <Section title="Equipment">
            <EditRow label="Module" field="module" value={project.module} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Module qty" field="module_qty" value={project.module_qty?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
            <EditRow label="Inverter" field="inverter" value={project.inverter} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Inverter qty" field="inverter_qty" value={project.inverter_qty?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
            <EditRow label="Battery" field="battery" value={project.battery} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Battery qty" field="battery_qty" value={project.battery_qty?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
            <EditRow label="Optimizer" field="optimizer" value={project.optimizer} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Optimizer qty" field="optimizer_qty" value={project.optimizer_qty?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
          </Section>
          <Section title="Site">
            <SelectEditRow label="Meter location" field="meter_location" value={project.meter_location} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Garage','Side of House','Front of House','Back of House','Other']} />
            <SelectEditRow label="Panel location" field="panel_location" value={project.panel_location} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Garage','Inside House','Outside','Basement','Other']} />
            <SelectEditRow label="Voltage" field="voltage" value={project.voltage} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['120/240V','120/208V','277/480V']} />
            <SelectEditRow label="MSP bus rating" field="msp_bus_rating" value={project.msp_bus_rating} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['100A','125A','150A','200A','225A','320A','400A']} />
            <SelectEditRow label="MPU" field="mpu" value={project.mpu} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Yes','No','Pending']} />
            <SelectEditRow label="Shutdown" field="shutdown" value={project.shutdown} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Rapid Shutdown','Standard']} />
            <SelectEditRow label="Perf. meter" field="performance_meter" value={project.performance_meter} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['Yes','No']} />
            <SelectEditRow label="IBC breaker" field="interconnection_breaker" value={project.interconnection_breaker} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['15A','20A','25A','30A','40A','50A','60A']} />
            <SelectEditRow label="Main breaker" field="main_breaker" value={project.main_breaker} draft={editDraft} editing={editMode} onChange={setEditDraft}
              options={['100A','125A','150A','200A','225A','400A']} />
            <EditRow label="HOA" field="hoa" value={project.hoa} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="ESID" field="esid" value={project.esid?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} />
          </Section>
        </div>
        <div>
          <Section title="Team">
            <EditRow label="PM" field="pm" value={project.pm} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Advisor" field="advisor" value={project.advisor} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Consultant" field="consultant" value={project.consultant} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Consultant email" field="consultant_email" value={project.consultant_email} draft={editDraft} editing={editMode} onChange={setEditDraft} small />
            <EditRow label="Site surveyor" field="site_surveyor" value={project.site_surveyor} draft={editDraft} editing={editMode} onChange={setEditDraft} />
          </Section>
          <Section title="Permitting">
            <AutocompleteRow label="AHJ" field="ahj" value={project.ahj} draft={editDraft} editing={editMode} onChange={setEditDraft} table="ahjs" onClickValue={openAhjEdit} />
            {!editMode && ahjInfo && (
              <div className="ml-0 mt-1 mb-2 pl-28 space-y-0.5">
                {ahjInfo.permit_phone && <div className="text-xs text-green-400">{ahjInfo.permit_phone}</div>}
                {ahjInfo.permit_website && <a href={ahjInfo.permit_website.startsWith('http') ? ahjInfo.permit_website : 'https://'+ahjInfo.permit_website} target="_blank" rel="noopener" className="text-xs text-green-400 hover:underline block">{ahjInfo.permit_website} ↗</a>}
                {ahjInfo.max_duration && <div className="text-xs text-gray-500">{ahjInfo.max_duration}d turnaround</div>}
                {ahjInfo.electric_code && <div className="text-xs text-gray-500">{ahjInfo.electric_code}</div>}
                {ahjInfo.permit_notes && <div className="text-xs text-gray-400 mt-1 bg-gray-800 rounded p-2">{ahjInfo.permit_notes.slice(0,200)}</div>}
              </div>
            )}
            <AutocompleteRow label="Utility" field="utility" value={project.utility} draft={editDraft} editing={editMode} onChange={setEditDraft} table="utilities" onClickValue={openUtilEdit} />
            {!editMode && utilityInfo && (
              <div className="ml-0 mt-1 mb-2 pl-28 space-y-0.5">
                {utilityInfo.phone && <div className="text-xs text-green-400">{utilityInfo.phone}</div>}
                {utilityInfo.website && <a href={utilityInfo.website.startsWith('http') ? utilityInfo.website : 'https://'+utilityInfo.website} target="_blank" rel="noopener" className="text-xs text-green-400 hover:underline block">{utilityInfo.website} ↗</a>}
                {utilityInfo.notes && <div className="text-xs text-gray-400 mt-1 bg-gray-800 rounded p-2">{utilityInfo.notes.slice(0,150)}</div>}
              </div>
            )}
            <EditRow label="Permit #" field="permit_number" value={project.permit_number} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Utility app #" field="utility_app_number" value={project.utility_app_number} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Permit fee" field="permit_fee" value={project.permit_fee?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="currency" />
            <EditRow label="City permit" field="city_permit_date" value={project.city_permit_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="Utility permit" field="utility_permit_date" value={project.utility_permit_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
          </Section>
          <Section title="Milestones">
            <EditRow label="Sale date" field="sale_date" value={project.sale_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="NTP" field="ntp_date" value={project.ntp_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="Survey scheduled" field="survey_scheduled_date" value={project.survey_scheduled_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="Survey complete" field="survey_date" value={project.survey_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="Install scheduled" field="install_scheduled_date" value={project.install_scheduled_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="Install complete" field="install_complete_date" value={project.install_complete_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="City inspection" field="city_inspection_date" value={project.city_inspection_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="Utility inspection" field="utility_inspection_date" value={project.utility_inspection_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="PTO" field="pto_date" value={project.pto_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
            <EditRow label="In service" field="in_service_date" value={project.in_service_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
          </Section>
          {stageHistory.length > 0 && (
            <Section title="Stage History">
              {stageHistory.map((h: any, i: number) => (
                <div key={i} className="flex gap-2 py-0.5 text-xs">
                  <span className="text-gray-500 w-28 flex-shrink-0">{h.entered ? new Date(h.entered + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>
                  <span className="text-gray-300">{h.stage}</span>
                </div>
              ))}
            </Section>
          )}
          {serviceCalls.length > 0 && (
            <Section title="Service Calls">
              {serviceCalls.map((sc: any) => (
                <div key={sc.id} className="flex items-start gap-2 py-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                    sc.status === 'open' ? 'bg-red-900 text-red-300' :
                    sc.status === 'closed' ? 'bg-green-900 text-green-300' :
                    'bg-amber-900 text-amber-300'
                  }`}>{sc.status}</span>
                  <div className="min-w-0">
                    {sc.issue_type && <div className="text-xs text-gray-300">{sc.issue_type}</div>}
                    {sc.description && <div className="text-xs text-gray-500 truncate">{sc.description}</div>}
                  </div>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
