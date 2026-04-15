'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { STAGE_LABELS, fmt$, fmtDate, escapeIlike, INTERNAL_DOMAINS } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { X, Plus } from 'lucide-react'
import type { Project } from '@/types/database'
import { EquipmentAutocomplete } from '@/components/EquipmentAutocomplete'
import type { Equipment } from '@/lib/api/equipment'
import { loadFieldDefinitions, loadProjectCustomFields, saveProjectCustomField } from '@/lib/api'
import type { CustomFieldDefinition } from '@/lib/api'

// ── HELPER COMPONENTS ────────────────────────────────────────────────────────

type DraftUpdater = (fn: (prev: Partial<Project>) => Partial<Project>) => void

function EditRow({ label, field, value, draft, editing, onChange, small, type = 'text' }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: DraftUpdater
  small?: boolean
  type?: 'text' | 'date' | 'number' | 'currency'
}) {
  const current = field in draft ? draft[field] : value
  const inputType = type === 'currency' ? 'number' : type
  if (!editing) {
    if (!value) return null
    const display = type === 'date' && value
      ? fmtDate(value)
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
          onChange={e => onChange(d => ({ ...d, [field]: e.target.value || null }))}
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
  onChange: DraftUpdater
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
        onChange={e => onChange(d => ({ ...d, [field]: e.target.value || null }))}
        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
      >
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function EquipmentEditRow({ label, field, category, value, draft, editing, onChange, qtyField, qtyValue, onEquipmentSelect }: {
  label: string
  field: string
  category: 'module' | 'inverter' | 'battery' | 'optimizer'
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: DraftUpdater
  qtyField?: string
  qtyValue?: string | null
  onEquipmentSelect?: (equipment: Equipment | undefined) => void
}) {
  const current = field in draft ? draft[field] : value
  const currentQty = qtyField && qtyField in draft ? draft[qtyField] : qtyValue
  if (!editing) {
    return null // View mode handled by EquipmentSummary
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <EquipmentAutocomplete
        category={category}
        value={current ?? ''}
        onChange={(v, equipment) => {
          onChange(d => ({ ...d, [field]: v || null }))
          if (onEquipmentSelect) onEquipmentSelect(equipment)
        }}
        placeholder={`Search ${label.toLowerCase()}...`}
      />
      {qtyField && (
        <input
          type="number"
          value={currentQty ?? ''}
          onChange={e => onChange(d => ({ ...d, [qtyField]: e.target.value || null }))}
          placeholder="Qty"
          min="0"
          className="w-20 bg-gray-700 text-white text-xs rounded px-2 py-2 border border-gray-600 focus:border-green-500 focus:outline-none"
        />
      )}
    </div>
  )
}

function PmSelectRow({ value, pmId, draft, editing, onChange }: {
  value: string | null
  pmId: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: DraftUpdater
}) {
  const supabase = createClient()
  const [pms, setPms] = useState<{ id: string; name: string }[]>([])
  const currentId = 'pm_id' in draft ? draft.pm_id : pmId

  useEffect(() => {
    if (!editing) return
    ;supabase.from('users').select('id, name').eq('active', true)
      .or(INTERNAL_DOMAINS.map(d => `email.like.%@${d}`).join(','))
      .order('name')
      .then((result) => { if (result.data) setPms(result.data as { id: string; name: string }[]) })
  }, [editing])

  if (!editing) return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">PM</span>
      <span className="text-gray-200 text-xs">{value ?? '—'}</span>
    </div>
  )

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">PM</span>
      <select
        value={currentId ?? ''}
        onChange={e => {
          const selected = pms.find(p => p.id === e.target.value)
          onChange(d => ({ ...d, pm_id: e.target.value || null, pm: selected?.name ?? null }))
        }}
        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
      >
        <option value="">Select PM...</option>
        {pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
  onChange: DraftUpdater
  table: 'ahjs' | 'utilities' | 'hoas' | 'financiers'
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
      const { data } = await supabase.from(table).select(searchCol).ilike(searchCol, `%${escapeIlike(query)}%`).order(searchCol).limit(8)
      const names = (data ?? []).map((r: Record<string, unknown>) => r[searchCol] as string)
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
            onChange(d => ({ ...d, [field]: e.target.value || null }))
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
                  onChange(d => ({ ...d, [field]: s }))
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

function DispositionEditRow({ value, draft, editing, onChange, isAdmin }: {
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: DraftUpdater
  isAdmin?: boolean
}) {
  const current = ('disposition' in draft ? draft.disposition : value) as string | null
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // Determine allowed options based on current disposition
  // Cancel/Reactivate is restricted to admin+ users
  const getOptions = () => {
    const disp = current ?? 'Sale'
    let options: string[]
    switch (disp) {
      case 'Sale':
        options = ['Sale', 'Loyalty']
        break
      case 'Loyalty':
        options = ['Sale', 'Loyalty', 'Cancelled']
        break
      case 'In Service':
        options = ['Sale', 'In Service']
        break
      case 'Cancelled':
        options = ['Loyalty', 'Cancelled']
        break
      default:
        options = ['Sale', 'Loyalty']
    }
    // Only admin+ can select Cancelled
    if (!isAdmin) {
      options = options.filter(o => o !== 'Cancelled')
    }
    return options
  }

  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">Disposition</span>
        <span className="text-gray-200 text-xs">{value}</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex gap-2 py-0.5 items-center">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">Disposition</span>
        <select
          value={current ?? ''}
          onChange={e => {
            const newVal = e.target.value || null
            if (newVal === 'Cancelled') {
              setShowCancelConfirm(true)
            } else {
              onChange(d => ({ ...d, disposition: newVal }))
            }
          }}
          className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
        >
          <option value="">Select...</option>
          {getOptions().map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 max-w-md shadow-xl">
            <h3 className="text-white text-sm font-semibold mb-2">Cancel this project?</h3>
            <p className="text-gray-400 text-xs mb-4">
              Are you sure? This project will be marked as Cancelled. The customer should have been in Loyalty status first for retention attempts.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-3 py-1.5 text-xs text-gray-300 bg-gray-700 rounded hover:bg-gray-600"
              >
                Go Back
              </button>
              <button
                onClick={() => {
                  onChange(d => ({ ...d, disposition: 'Cancelled' }))
                  setShowCancelConfirm(false)
                }}
                className="px-3 py-1.5 text-xs text-white bg-red-600 rounded hover:bg-red-500"
              >
                Yes, Cancel Project
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function EquipmentSummaryRow({ label, name, qty, watts }: { label: string; name?: string | null; qty?: number | null; watts?: number | null }) {
  const hasData = name || qty
  if (!hasData) {
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className="text-gray-600 text-xs">&mdash;</span>
      </div>
    )
  }
  const kw = watts && qty ? ((watts * qty) / 1000).toFixed(1) : null
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <span className="text-gray-200 text-xs break-words">
        {name || '—'}
        {qty ? ` \u00d7 ${qty}` : ''}
        {kw ? ` = ${kw} kW` : ''}
      </span>
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

// ── ADDERS SECTION ───────────────────────────────────────────────────────────

interface ProjectAdder { id: string; adder_name: string; price: number; quantity: number; total_amount: number }

function AddersSection({ adders, editing, onAdd, onDelete }: {
  adders: ProjectAdder[]
  editing: boolean
  onAdd?: (adder: { adder_name: string; price: number; quantity: number; total_amount: number }) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [saving, setSaving] = useState(false)

  const total = adders.reduce((sum: number, a: ProjectAdder) => sum + (Number(a.total_amount) || 0), 0)

  const handleAdd = async () => {
    if (!newName.trim() || !newPrice || !onAdd) return
    setSaving(true)
    const price = Number(newPrice)
    const qty = Number(newQty) || 1
    await onAdd({ adder_name: newName.trim(), price, quantity: qty, total_amount: price * qty })
    setNewName('')
    setNewPrice('')
    setNewQty('1')
    setShowForm(false)
    setSaving(false)
  }

  if (!editing && adders.length === 0) return null

  return (
    <Section title="Adders">
      {adders.length > 0 && (
        <div className="space-y-1">
          {adders.map((a) => (
            <div key={a.id} className="flex items-center gap-2 py-0.5 group">
              {editing && onDelete && (
                <button
                  onClick={() => onDelete(a.id)}
                  className="text-gray-600 hover:text-red-400 flex-shrink-0 transition-colors"
                  title="Remove adder"
                >
                  <X size={12} />
                </button>
              )}
              <span className="text-gray-300 text-xs flex-1 min-w-0 truncate">{a.adder_name}</span>
              <span className="text-gray-500 text-xs flex-shrink-0">x{a.quantity ?? 1}</span>
              <span className="text-gray-200 text-xs flex-shrink-0 w-20 text-right">{fmt$(Number(a.total_amount) || 0)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-700">
            <span className="text-gray-400 text-xs font-semibold flex-1">Total</span>
            <span className="text-white text-xs font-semibold w-20 text-right">{fmt$(total)}</span>
          </div>
        </div>
      )}
      {editing && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mt-2 flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
        >
          <Plus size={12} /> Add Adder
        </button>
      )}
      {editing && showForm && (
        <div className="mt-2 space-y-1.5 bg-gray-800 rounded p-2 border border-gray-700">
          <input
            type="text"
            placeholder="Adder name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
              <input
                type="number"
                placeholder="Price"
                value={newPrice}
                onChange={e => setNewPrice(e.target.value)}
                className="w-full bg-gray-700 text-white text-xs rounded pl-5 pr-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
              />
            </div>
            <input
              type="number"
              placeholder="Qty"
              value={newQty}
              onChange={e => setNewQty(e.target.value)}
              min="1"
              className="w-16 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowForm(false); setNewName(''); setNewPrice(''); setNewQty('1') }}
              className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim() || !newPrice}
              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

// ── INFO TAB ─────────────────────────────────────────────────────────────────

interface AHJInfo { permit_phone: string | null; permit_website: string | null; max_duration: number | null; electric_code: string | null; permit_notes: string | null }
interface UtilityInfo { phone: string | null; website: string | null; notes: string | null }
interface HOAInfo { phone: string | null; website: string | null; contact_name: string | null; contact_email: string | null; notes: string | null }
interface FinancierInfoData { phone: string | null; website: string | null; contact_name: string | null; contact_email: string | null; notes: string | null }
interface StageHistoryEntry { id: string; project_id: string; stage: string; entered: string }
interface ServiceCallEntry { id: string; project_id: string; created_at: string; status?: string; issue_type?: string; description?: string; [key: string]: unknown }

interface InfoTabProps {
  project: Project
  editMode: boolean
  editDraft: Partial<Project>
  setEditDraft: DraftUpdater
  ahjInfo: AHJInfo | null
  utilityInfo: UtilityInfo | null
  hoaInfo: HOAInfo | null
  financierInfo: FinancierInfoData | null
  openAhjEdit: () => void
  openUtilEdit: () => void
  openHoaEdit: () => void
  openFinancierEdit: () => void
  stageHistory?: StageHistoryEntry[]
  serviceCalls?: ServiceCallEntry[]
  adders?: ProjectAdder[]
  onAddAdder?: (adder: { adder_name: string; price: number; quantity: number; total_amount: number }) => Promise<void>
  onDeleteAdder?: (id: string) => Promise<void>
  isSales?: boolean
}

export function InfoTab({ project, editMode, editDraft, setEditDraft, ahjInfo, utilityInfo, hoaInfo, financierInfo, openAhjEdit, openUtilEdit, openHoaEdit, openFinancierEdit, stageHistory = [], serviceCalls = [], adders = [], onAddAdder, onDeleteAdder, isSales = false }: InfoTabProps) {
  const { user: currentUserInfo } = useCurrentUser()
  const [moduleWatts, setModuleWatts] = useState<number | null>(null)

  // ── Custom Fields ───────────────────────────────────────────────────────
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string | null>>({})
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, string | null>>({})

  useEffect(() => {
    loadFieldDefinitions(true).then(setCustomFieldDefs)
  }, [])

  useEffect(() => {
    if (!project.id) return
    loadProjectCustomFields(project.id).then(vals => {
      const map: Record<string, string | null> = {}
      vals.forEach(v => { map[v.field_id] = v.value })
      setCustomFieldValues(map)
      setCustomFieldDraft(map)
    })
  }, [project.id])

  // Save custom fields when parent saves (editMode goes from true to false)
  const prevEditMode = useRef(editMode)
  useEffect(() => {
    if (prevEditMode.current && !editMode) {
      // editMode just turned off — save custom fields
      for (const def of customFieldDefs) {
        const newVal = customFieldDraft[def.id] ?? null
        const oldVal = customFieldValues[def.id] ?? null
        if (newVal !== oldVal) {
          saveProjectCustomField(project.id, def.id, newVal)
        }
      }
      setCustomFieldValues({ ...customFieldDraft })
    }
    prevEditMode.current = editMode
  }, [editMode])

  // Parse watts from module name (e.g. "Q.PEAK DUO BLK ML-G10+ 405W" -> 405)
  const parseWattsFromName = useCallback((name: string): number | null => {
    const match = name.match(/(\d{2,4})\s*[Ww]/)
    return match ? parseInt(match[1]) : null
  }, [])

  // When a module is selected from the autocomplete, capture its watts
  const handleModuleSelect = useCallback((equipment: Equipment | undefined) => {
    if (equipment?.watts) {
      setModuleWatts(equipment.watts)
    } else if (equipment?.name) {
      setModuleWatts(parseWattsFromName(equipment.name))
    } else {
      setModuleWatts(null)
    }
  }, [parseWattsFromName])

  // Auto-calculate systemkw when module watts or module_qty changes
  useEffect(() => {
    if (!editMode) return
    const moduleName = ('module' in editDraft ? editDraft.module : project.module) as string | null
    const moduleQty = ('module_qty' in editDraft ? editDraft.module_qty : project.module_qty) as number | string | null
    const qty = moduleQty ? Number(moduleQty) : 0

    // Determine watts: use tracked watts from selection, or parse from name
    let watts = moduleWatts
    if (!watts && moduleName) {
      watts = parseWattsFromName(moduleName)
    }

    if (watts && qty > 0) {
      const kw = Number(((watts * qty) / 1000).toFixed(1))
      setEditDraft(d => ({ ...d, systemkw: kw }))
    }
  }, [editDraft.module, editDraft.module_qty, moduleWatts, editMode])

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
            <DispositionEditRow value={project.disposition} draft={editDraft} editing={editMode} onChange={setEditDraft} isAdmin={currentUserInfo?.isAdmin} />
            {!isSales && (
              <>
                <EditRow label="Contract" field="contract" value={project.contract?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="currency" />
                <AutocompleteRow label="Financier" field="financier" value={project.financier} draft={editDraft} editing={editMode} onChange={setEditDraft} table="financiers" onClickValue={openFinancierEdit} />
                {!editMode && financierInfo && (
                  <div className="ml-0 mt-1 mb-2 pl-28 space-y-0.5">
                    {financierInfo.contact_name && <div className="text-xs text-gray-300">{financierInfo.contact_name}</div>}
                    {financierInfo.phone && <div className="text-xs text-green-400">{financierInfo.phone}</div>}
                    {financierInfo.contact_email && <div className="text-xs text-green-400">{financierInfo.contact_email}</div>}
                    {financierInfo.website && <a href={financierInfo.website.startsWith('http') ? financierInfo.website : 'https://'+financierInfo.website} target="_blank" rel="noopener" className="text-xs text-green-400 hover:underline block">{financierInfo.website} ↗</a>}
                  </div>
                )}
                <SelectEditRow label="Financing type" field="financing_type" value={project.financing_type} draft={editDraft} editing={editMode} onChange={setEditDraft}
                  options={['Loan','TPO (Lease, PPA)','Cash']} />
                <EditRow label="Down payment" field="down_payment" value={project.down_payment?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="currency" />
                <EditRow label="TPO escalator" field="tpo_escalator" value={project.tpo_escalator?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
                <EditRow label="Financier adv pmt" field="financier_adv_pmt" value={project.financier_adv_pmt?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
              </>
            )}
            <EditRow label="Dealer" field="dealer" value={project.dealer} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            {/* Energy Community Toggle */}
            <div className="flex gap-2 py-0.5 items-center">
              <span className="text-gray-500 text-xs w-28 flex-shrink-0">Energy Community</span>
              {editMode ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={('energy_community' in editDraft ? editDraft.energy_community : project.energy_community) ?? false}
                    onClick={() => setEditDraft(d => ({ ...d, energy_community: !('energy_community' in d ? d.energy_community : project.energy_community) }))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      ('energy_community' in editDraft ? editDraft.energy_community : project.energy_community) ? 'bg-green-600' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      ('energy_community' in editDraft ? editDraft.energy_community : project.energy_community) ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                  <span className="text-xs text-gray-300">
                    {('energy_community' in editDraft ? editDraft.energy_community : project.energy_community) ? 'Yes' : 'No'}
                  </span>
                </label>
              ) : (
                <div className="flex items-center gap-2">
                  {project.energy_community ? (
                    <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-green-900/40 text-green-400 border border-green-800">EC</span>
                  ) : (
                    <span className="text-gray-400 text-xs">No</span>
                  )}
                </div>
              )}
            </div>
          </Section>
          <Section title="Equipment">
            {!editMode ? (
              <>
                <EquipmentSummaryRow label="Module" name={project.module} qty={project.module_qty ? Number(project.module_qty) : null} watts={parseWattsFromName(project.module ?? '')} />
                <EquipmentSummaryRow label="Inverter" name={project.inverter} qty={project.inverter_qty ? Number(project.inverter_qty) : null} />
                <EquipmentSummaryRow label="Battery" name={project.battery} qty={project.battery_qty ? Number(project.battery_qty) : null} />
                <EquipmentSummaryRow label="Optimizer" name={project.optimizer} qty={project.optimizer_qty ? Number(project.optimizer_qty) : null} />
              </>
            ) : (
              <>
                <EquipmentEditRow label="Module" field="module" category="module" value={project.module} draft={editDraft} editing={editMode} onChange={setEditDraft} qtyField="module_qty" qtyValue={project.module_qty?.toString()} onEquipmentSelect={handleModuleSelect} />
                <EquipmentEditRow label="Inverter" field="inverter" category="inverter" value={project.inverter} draft={editDraft} editing={editMode} onChange={setEditDraft} qtyField="inverter_qty" qtyValue={project.inverter_qty?.toString()} />
                <EquipmentEditRow label="Battery" field="battery" category="battery" value={project.battery} draft={editDraft} editing={editMode} onChange={setEditDraft} qtyField="battery_qty" qtyValue={project.battery_qty?.toString()} />
                <EquipmentEditRow label="Optimizer" field="optimizer" category="optimizer" value={project.optimizer} draft={editDraft} editing={editMode} onChange={setEditDraft} qtyField="optimizer_qty" qtyValue={project.optimizer_qty?.toString()} />
              </>
            )}
            <EditRow label="System kW" field="systemkw" value={project.systemkw?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="number" />
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
            <EditRow label="ESID" field="esid" value={project.esid != null ? String(project.esid).replace(/(\d)\.(\d+)[eE]\+(\d+)/, (_, d, dec, exp) => (d + dec).padEnd(Number(exp) + 1, '0')) : undefined} draft={editDraft} editing={editMode} onChange={setEditDraft} />
            <EditRow label="Meter Number" field="meter_number" value={project.meter_number?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} />
          </Section>
          <Section title="HOA">
            <AutocompleteRow label="HOA" field="hoa" value={project.hoa} draft={editDraft} editing={editMode} onChange={setEditDraft} table="hoas" onClickValue={openHoaEdit} />
            {!editMode && hoaInfo && (
              <div className="ml-0 mt-1 mb-2 pl-28 space-y-0.5">
                {hoaInfo.contact_name && <div className="text-xs text-gray-300">{hoaInfo.contact_name}</div>}
                {hoaInfo.phone && <div className="text-xs text-green-400">{hoaInfo.phone}</div>}
                {hoaInfo.contact_email && <div className="text-xs text-green-400">{hoaInfo.contact_email}</div>}
                {hoaInfo.website && <a href={hoaInfo.website.startsWith('http') ? hoaInfo.website : 'https://'+hoaInfo.website} target="_blank" rel="noopener" className="text-xs text-green-400 hover:underline block">{hoaInfo.website} ↗</a>}
                {hoaInfo.notes && <div className="text-xs text-gray-400 mt-1 bg-gray-800 rounded p-2">{hoaInfo.notes.slice(0,200)}</div>}
              </div>
            )}
          </Section>
        </div>
        <div>
          <Section title="Team">
            <PmSelectRow value={project.pm} pmId={project.pm_id} draft={editDraft} editing={editMode} onChange={setEditDraft} />
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
            <EditRow label="Re-inspection fee" field="reinspection_fee" value={project.reinspection_fee?.toString()} draft={editDraft} editing={editMode} onChange={setEditDraft} type="currency" />
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
          <AddersSection adders={adders} editing={editMode} onAdd={onAddAdder} onDelete={onDeleteAdder} />
          {customFieldDefs.length > 0 && (
            <Section title="Custom Fields">
              {customFieldDefs.map(def => {
                const savedValue = customFieldValues[def.id] ?? def.default_value ?? null
                const draftValue = customFieldDraft[def.id] ?? def.default_value ?? null
                if (!editMode) {
                  // View mode
                  if (def.field_type === 'boolean') {
                    return (
                      <div key={def.id} className="flex gap-2 py-0.5">
                        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{def.label}</span>
                        <span className="text-gray-200 text-xs">{savedValue === 'true' ? 'Yes' : savedValue === 'false' ? 'No' : '\u2014'}</span>
                      </div>
                    )
                  }
                  if (def.field_type === 'url' && savedValue) {
                    return (
                      <div key={def.id} className="flex gap-2 py-0.5">
                        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{def.label}</span>
                        <a href={savedValue.startsWith('http') ? savedValue : `https://${savedValue}`} target="_blank" rel="noopener noreferrer" className="text-green-400 text-xs hover:underline break-words">{savedValue} &#8599;</a>
                      </div>
                    )
                  }
                  if (def.field_type === 'date' && savedValue) {
                    const display = fmtDate(savedValue)
                    return (
                      <div key={def.id} className="flex gap-2 py-0.5">
                        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{def.label}</span>
                        <span className="text-gray-200 text-xs">{display}</span>
                      </div>
                    )
                  }
                  if (!savedValue) return null
                  return (
                    <div key={def.id} className="flex gap-2 py-0.5">
                      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{def.label}</span>
                      <span className="text-gray-200 text-xs break-words">{savedValue}</span>
                    </div>
                  )
                }
                // Edit mode
                if (def.field_type === 'boolean') {
                  return (
                    <div key={def.id} className="flex gap-2 py-0.5 items-center">
                      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{def.label}</span>
                      <button
                        type="button"
                        onClick={() => setCustomFieldDraft(d => ({ ...d, [def.id]: draftValue === 'true' ? 'false' : 'true' }))}
                        className={`w-9 h-5 rounded-full relative transition-colors ${draftValue === 'true' ? 'bg-green-600' : 'bg-gray-600'}`}
                      >
                        <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-all ${draftValue === 'true' ? 'right-[3px]' : 'left-[3px]'}`} />
                      </button>
                      <span className="text-xs text-gray-400">{draftValue === 'true' ? 'Yes' : 'No'}</span>
                    </div>
                  )
                }
                if (def.field_type === 'select') {
                  return (
                    <div key={def.id} className="flex gap-2 py-0.5 items-center">
                      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{def.label}{def.required && <span className="text-red-400 ml-0.5">*</span>}</span>
                      <select
                        value={draftValue ?? ''}
                        onChange={e => setCustomFieldDraft(d => ({ ...d, [def.id]: e.target.value || null }))}
                        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
                      >
                        <option value="">Select...</option>
                        {(def.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  )
                }
                const inputType = def.field_type === 'number' ? 'number' : def.field_type === 'date' ? 'date' : 'text'
                return (
                  <div key={def.id} className="flex gap-2 py-0.5 items-center">
                    <span className="text-gray-500 text-xs w-28 flex-shrink-0">{def.label}{def.required && <span className="text-red-400 ml-0.5">*</span>}</span>
                    <input
                      type={inputType}
                      value={draftValue ?? ''}
                      onChange={e => setCustomFieldDraft(d => ({ ...d, [def.id]: e.target.value || null }))}
                      className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
                      placeholder={def.field_type === 'url' ? 'https://...' : ''}
                    />
                  </div>
                )
              })}
            </Section>
          )}
          {stageHistory.length > 0 && (
            <Section title="Stage History">
              {stageHistory.map((h, i) => (
                <div key={i} className="flex gap-2 py-0.5 text-xs">
                  <span className="text-gray-500 w-28 flex-shrink-0">{h.entered ? fmtDate(h.entered) : ''}</span>
                  <span className="text-gray-300">{h.stage}</span>
                </div>
              ))}
            </Section>
          )}
          {serviceCalls.length > 0 && (
            <Section title="Service Calls">
              {serviceCalls.map((sc) => (
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
