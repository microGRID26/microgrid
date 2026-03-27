'use client'

import { useEffect, useState, useCallback } from 'react'
import { loadFieldDefinitions, addFieldDefinition, updateFieldDefinition, deleteFieldDefinition, FIELD_TYPES } from '@/lib/api'
import type { CustomFieldDefinition, CustomFieldType } from '@/lib/api'
import { Modal, SaveBtn, SearchBar, Badge } from './shared'

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

const TYPE_COLORS: Record<string, string> = {
  text: 'bg-blue-900/40 text-blue-400 border-blue-800',
  number: 'bg-purple-900/40 text-purple-400 border-purple-800',
  date: 'bg-amber-900/40 text-amber-400 border-amber-800',
  select: 'bg-green-900/40 text-green-400 border-green-800',
  boolean: 'bg-cyan-900/40 text-cyan-400 border-cyan-800',
  url: 'bg-pink-900/40 text-pink-400 border-pink-800',
}

interface FieldDraft {
  field_name: string
  label: string
  field_type: CustomFieldType
  options: string[] | null
  required: boolean
  default_value: string | null
  section: string
  sort_order: number
  active: boolean
}

const emptyDraft: FieldDraft = {
  field_name: '',
  label: '',
  field_type: 'text',
  options: null,
  required: false,
  default_value: null,
  section: 'custom',
  sort_order: 0,
  active: true,
}

export function CustomFieldsManager({ isSuperAdmin: _isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [fields, setFields] = useState<CustomFieldDefinition[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null)
  const [draft, setDraft] = useState<FieldDraft>({ ...emptyDraft })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showDelete, setShowDelete] = useState<CustomFieldDefinition | null>(null)
  const [optionInput, setOptionInput] = useState('')

  const load = useCallback(async () => {
    const data = await loadFieldDefinitions()
    setFields(data)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = fields.filter(f => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return f.label.toLowerCase().includes(q) || f.field_name.toLowerCase().includes(q)
  })

  const openEdit = (f: CustomFieldDefinition) => {
    setEditing(f)
    setDraft({
      field_name: f.field_name,
      label: f.label,
      field_type: f.field_type as CustomFieldType,
      options: f.options,
      required: f.required,
      default_value: f.default_value,
      section: f.section,
      sort_order: f.sort_order,
      active: f.active,
    })
    setOptionInput('')
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const ok = await updateFieldDefinition(editing.id, {
      label: draft.label,
      field_name: draft.field_name,
      field_type: draft.field_type,
      options: draft.field_type === 'select' ? draft.options : null,
      required: draft.required,
      default_value: draft.default_value,
      section: draft.section,
      sort_order: draft.sort_order,
      active: draft.active,
    })
    setSaving(false)
    if (!ok) { setToast('Save failed'); setTimeout(() => setToast(''), 2500); return }
    setEditing(null)
    setToast('Field updated')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  const createNew = async () => {
    if (!draft.label.trim()) return
    setSaving(true)
    const fieldName = draft.field_name || slugify(draft.label)
    const result = await addFieldDefinition({
      ...draft,
      field_name: fieldName,
      options: draft.field_type === 'select' ? draft.options : null,
    })
    setSaving(false)
    if (!result) { setToast('Create failed — field name may already exist'); setTimeout(() => setToast(''), 3000); return }
    setShowNew(false)
    setDraft({ ...emptyDraft })
    setToast('Field created')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  const handleDelete = async () => {
    if (!showDelete) return
    setSaving(true)
    const ok = await deleteFieldDefinition(showDelete.id)
    setSaving(false)
    if (!ok) { setToast('Delete failed'); setTimeout(() => setToast(''), 2500); return }
    setShowDelete(null)
    setEditing(null)
    setToast('Field deleted')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  const addOption = () => {
    if (!optionInput.trim()) return
    const current = draft.options ?? []
    if (current.includes(optionInput.trim())) return
    setDraft({ ...draft, options: [...current, optionInput.trim()] })
    setOptionInput('')
  }

  const removeOption = (opt: string) => {
    setDraft({ ...draft, options: (draft.options ?? []).filter(o => o !== opt) })
  }

  const moveField = async (field: CustomFieldDefinition, direction: 'up' | 'down') => {
    const idx = filtered.findIndex(f => f.id === field.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= filtered.length) return
    const other = filtered[swapIdx]
    await updateFieldDefinition(field.id, { sort_order: other.sort_order })
    await updateFieldDefinition(other.id, { sort_order: field.sort_order })
    load()
  }

  const FieldForm = ({ isNew }: { isNew: boolean }) => (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Label *</label>
        <input
          value={draft.label}
          onChange={e => {
            const label = e.target.value
            setDraft(d => ({
              ...d,
              label,
              field_name: isNew ? slugify(label) : d.field_name,
            }))
          }}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          placeholder="e.g. Roof Type"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Field Name</label>
        <input
          value={draft.field_name}
          onChange={e => setDraft(d => ({ ...d, field_name: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          placeholder="auto-generated from label"
          disabled={!isNew}
        />
        <p className="text-[10px] text-gray-600">Machine-readable name. Cannot be changed after creation.</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-gray-400 font-medium">Type *</label>
          <select
            value={draft.field_type}
            onChange={e => setDraft(d => ({ ...d, field_type: e.target.value as CustomFieldType }))}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          >
            {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-gray-400 font-medium">Section</label>
          <input
            value={draft.section}
            onChange={e => setDraft(d => ({ ...d, section: e.target.value }))}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            placeholder="custom"
          />
        </div>
      </div>

      {draft.field_type === 'select' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400 font-medium">Options</label>
          <div className="flex gap-2">
            <input
              value={optionInput}
              onChange={e => setOptionInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="Add option and press Enter"
            />
            <button onClick={addOption} className="px-3 py-1.5 text-xs bg-gray-700 text-white rounded-md hover:bg-gray-600">Add</button>
          </div>
          {(draft.options ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(draft.options ?? []).map(opt => (
                <span key={opt} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded">
                  {opt}
                  <button onClick={() => removeOption(opt)} className="text-gray-500 hover:text-red-400 ml-0.5">&times;</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-gray-400 font-medium">Default Value</label>
          <input
            value={draft.default_value ?? ''}
            onChange={e => setDraft(d => ({ ...d, default_value: e.target.value || null }))}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            placeholder={draft.field_type === 'boolean' ? 'true or false' : 'Optional default'}
          />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-gray-400 font-medium">Sort Order</label>
          <input
            type="number"
            value={draft.sort_order}
            onChange={e => setDraft(d => ({ ...d, sort_order: parseInt(e.target.value) || 0 }))}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 pt-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={e => setDraft(d => ({ ...d, required: e.target.checked }))}
            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500"
          />
          <span className="text-xs text-gray-300">Required</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}
            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500"
          />
          <span className="text-xs text-gray-300">Active</span>
        </label>
      </div>

      {/* Preview */}
      <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/50">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Preview</p>
        <div className="flex gap-2 py-0.5 items-center">
          <span className="text-gray-500 text-xs w-28 flex-shrink-0">{draft.label || 'Label'}</span>
          {draft.field_type === 'text' && <div className="flex-1 bg-gray-700 text-gray-500 text-xs rounded px-2 py-1 border border-gray-600">Sample text</div>}
          {draft.field_type === 'number' && <div className="flex-1 bg-gray-700 text-gray-500 text-xs rounded px-2 py-1 border border-gray-600">123</div>}
          {draft.field_type === 'date' && <div className="flex-1 bg-gray-700 text-gray-500 text-xs rounded px-2 py-1 border border-gray-600">2026-03-27</div>}
          {draft.field_type === 'url' && <div className="flex-1 bg-gray-700 text-gray-500 text-xs rounded px-2 py-1 border border-gray-600">https://example.com</div>}
          {draft.field_type === 'boolean' && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-4 bg-green-600 rounded-full relative"><div className="w-3 h-3 bg-white rounded-full absolute right-0.5 top-0.5" /></div>
              <span className="text-xs text-gray-400">Yes</span>
            </div>
          )}
          {draft.field_type === 'select' && (
            <select className="flex-1 bg-gray-700 text-gray-500 text-xs rounded px-2 py-1 border border-gray-600" disabled>
              <option>Select...</option>
              {(draft.options ?? []).map(o => <option key={o}>{o}</option>)}
            </select>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Custom Fields Manager</h2>
          <p className="text-xs text-gray-500 mt-0.5">{fields.length} field definitions ({fields.filter(f => f.active).length} active)</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-64"><SearchBar value={search} onChange={setSearch} placeholder="Search fields..." /></div>
          <button onClick={() => { setShowNew(true); setDraft({ ...emptyDraft }); setOptionInput('') }} className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Field</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Order', 'Label', 'Field Name', 'Type', 'Section', 'Required', 'Status', ''].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No custom fields defined yet.</td></tr>
            )}
            {filtered.map((f, i) => (
              <tr key={f.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`} onClick={() => openEdit(f)}>
                <td className="px-3 py-2 text-gray-400">
                  <div className="flex items-center gap-1">
                    <button onClick={e => { e.stopPropagation(); moveField(f, 'up') }} className="text-gray-600 hover:text-white p-0.5" title="Move up">&#9650;</button>
                    <span className="w-5 text-center">{f.sort_order}</span>
                    <button onClick={e => { e.stopPropagation(); moveField(f, 'down') }} className="text-gray-600 hover:text-white p-0.5" title="Move down">&#9660;</button>
                  </div>
                </td>
                <td className="px-3 py-2 text-white font-medium">{f.label}</td>
                <td className="px-3 py-2 text-gray-400 font-mono">{f.field_name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${TYPE_COLORS[f.field_type] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                    {FIELD_TYPES.find(t => t.value === f.field_type)?.label ?? f.field_type}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-400">{f.section}</td>
                <td className="px-3 py-2">{f.required ? <span className="text-amber-400">Yes</span> : <span className="text-gray-600">No</span>}</td>
                <td className="px-3 py-2"><Badge active={f.active} /></td>
                <td className="px-3 py-2">
                  <button onClick={e => { e.stopPropagation(); setShowDelete(f) }} className="text-gray-600 hover:text-red-400 p-1" title="Delete">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editing && (
        <Modal title={`Edit: ${editing.label}`} onClose={() => setEditing(null)}>
          <FieldForm isNew={false} />
          <div className="flex justify-between pt-2 border-t border-gray-800">
            <button onClick={() => { setShowDelete(editing); setEditing(null) }} className="text-xs text-red-400 hover:text-red-300">Delete Field</button>
            <SaveBtn onClick={save} saving={saving} />
          </div>
        </Modal>
      )}

      {/* New Modal */}
      {showNew && (
        <Modal title="New Custom Field" onClose={() => setShowNew(false)}>
          <FieldForm isNew={true} />
          <div className="flex justify-end pt-2 border-t border-gray-800">
            <SaveBtn onClick={createNew} saving={saving} />
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {showDelete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onKeyDown={e => { if (e.key === 'Escape') setShowDelete(null) }}>
          <div role="alertdialog" aria-label={`Delete ${showDelete.label}`} className="bg-gray-800 border border-gray-600 rounded-lg p-6 max-w-md shadow-xl">
            <h3 className="text-white text-sm font-semibold mb-2">Delete &quot;{showDelete.label}&quot;?</h3>
            <p className="text-gray-400 text-xs mb-4">
              This will permanently delete this field definition and all saved values across all projects. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDelete(null)} className="px-3 py-1.5 text-xs text-gray-300 bg-gray-700 rounded hover:bg-gray-600">Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="px-3 py-1.5 text-xs text-white bg-red-600 rounded hover:bg-red-500 disabled:opacity-50">
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
