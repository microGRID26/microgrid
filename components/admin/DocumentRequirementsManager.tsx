'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { db } from '@/lib/db'
import { Input, Textarea, Modal, SaveBtn, SearchBar, Badge } from './shared'
import { STAGE_ORDER, STAGE_LABELS } from '@/lib/utils'
import type { DocumentRequirement } from '@/lib/api/documents'

export function DocumentRequirementsManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([])
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [editing, setEditing] = useState<DocumentRequirement | null>(null)
  const [draft, setDraft] = useState<Partial<DocumentRequirement>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    let q = supabase.from('document_requirements').select('*').order('stage').order('sort_order')
    if (stageFilter) q = q.eq('stage', stageFilter)
    const { data } = await q
    let items = (data ?? []) as DocumentRequirement[]
    if (search) {
      const s = search.toLowerCase()
      items = items.filter(r =>
        r.document_type.toLowerCase().includes(s) ||
        (r.folder_name ?? '').toLowerCase().includes(s) ||
        (r.filename_pattern ?? '').toLowerCase().includes(s)
      )
    }
    setRequirements(items)
  }, [search, stageFilter])

  useEffect(() => { load() }, [load])

  const openEdit = (r: DocumentRequirement) => {
    setEditing(r)
    setDraft({ ...r })
  }

  const save = async () => {
    if (!editing) return
    if (!draft.stage?.trim()) {
      setToast('Stage is required')
      setTimeout(() => setToast(''), 2500)
      return
    }
    if (!draft.document_type?.trim()) {
      setToast('Document type is required')
      setTimeout(() => setToast(''), 2500)
      return
    }
    const sortOrder = Number(draft.sort_order)
    if (isNaN(sortOrder)) {
      setToast('Sort order must be a valid number')
      setTimeout(() => setToast(''), 2500)
      return
    }
    setSaving(true)
    const { error } = await supabase.from('document_requirements').update({
      stage: draft.stage,
      task_id: draft.task_id || null,
      document_type: draft.document_type,
      folder_name: draft.folder_name || null,
      filename_pattern: draft.filename_pattern || null,
      required: draft.required ?? true,
      description: draft.description || null,
      sort_order: draft.sort_order ?? 0,
      active: draft.active ?? true,
    }).eq('id', editing.id)
    if (error) {
      setSaving(false)
      setToast('Save failed')
      setTimeout(() => setToast(''), 2500)
      return
    }
    setSaving(false)
    setEditing(null)
    setToast('Requirement saved')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  const createNew = async () => {
    if (!draft.stage?.trim()) {
      setToast('Stage is required')
      setTimeout(() => setToast(''), 2500)
      return
    }
    if (!draft.document_type?.trim()) {
      setToast('Document type is required')
      setTimeout(() => setToast(''), 2500)
      return
    }
    const sortOrder = Number(draft.sort_order)
    if (isNaN(sortOrder)) {
      setToast('Sort order must be a valid number')
      setTimeout(() => setToast(''), 2500)
      return
    }
    setSaving(true)
    const { error } = await supabase.from('document_requirements').insert({
      stage: draft.stage,
      task_id: draft.task_id || null,
      document_type: draft.document_type,
      folder_name: draft.folder_name || null,
      filename_pattern: draft.filename_pattern || null,
      required: draft.required ?? true,
      description: draft.description || null,
      sort_order: draft.sort_order ?? 0,
      active: true,
    })
    if (error) {
      setSaving(false)
      setToast('Create failed')
      setTimeout(() => setToast(''), 2500)
      return
    }
    setSaving(false)
    setShowNew(false)
    setDraft({})
    setToast('Requirement created')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  const toggleActive = async (r: DocumentRequirement) => {
    await supabase.from('document_requirements').update({ active: !r.active }).eq('id', r.id)
    load()
  }

  // Group requirements by stage for display (memoized to avoid re-filtering each render)
  const grouped = useMemo(() => STAGE_ORDER
    .map(s => ({
      stage: s,
      items: requirements.filter(r => r.stage === s),
    }))
    .filter(g => g.items.length > 0), [requirements])

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Document Requirements</h2>
          <p className="text-xs text-gray-500 mt-0.5">{requirements.length} requirements</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All Stages</option>
            {STAGE_ORDER.map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
          <div className="w-56">
            <SearchBar value={search} onChange={setSearch} placeholder="Search requirements..." />
          </div>
          <button
            onClick={() => { setShowNew(true); setDraft({ stage: 'evaluation', required: true, sort_order: 0, active: true }) }}
            className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600"
          >
            + New Requirement
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        {grouped.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-600 text-sm">
            No document requirements found. Click &ldquo;+ New Requirement&rdquo; to add one.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {grouped.map(({ stage, items }) => (
              <div key={stage}>
                <div className="bg-gray-900/50 px-3 py-2 sticky top-0">
                  <span className="text-xs font-semibold text-green-400">{STAGE_LABELS[stage] || stage}</span>
                  <span className="text-xs text-gray-600 ml-2">({items.length})</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {items.map((r, i) => (
                      <tr
                        key={r.id}
                        className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${
                          i % 2 === 0 ? '' : 'bg-gray-900/20'
                        } ${!r.active ? 'opacity-50' : ''}`}
                        onClick={() => openEdit(r)}
                      >
                        <td className="px-3 py-2 text-white font-medium max-w-[200px] truncate">
                          {r.document_type}
                        </td>
                        <td className="px-3 py-2 text-gray-400 max-w-[120px] truncate">
                          {r.folder_name || '--'}
                        </td>
                        <td className="px-3 py-2 text-gray-500 max-w-[150px] truncate font-mono text-[10px]">
                          {r.filename_pattern || '--'}
                        </td>
                        <td className="px-3 py-2">
                          {r.required ? (
                            <span className="text-red-400 text-[10px] font-medium">Required</span>
                          ) : (
                            <span className="text-gray-600 text-[10px]">Optional</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge active={r.active} />
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{r.sort_order}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit / New Modal */}
      {(editing || showNew) && (
        <Modal
          title={editing ? `Edit — ${editing.document_type}` : 'New Document Requirement'}
          onClose={() => { setEditing(null); setShowNew(false) }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Stage</label>
              <select
                value={draft.stage ?? 'evaluation'}
                onChange={e => setDraft(d => ({ ...d, stage: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              >
                {STAGE_ORDER.map(s => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <Input
              label="Sort Order"
              type="number"
              value={String(draft.sort_order ?? 0)}
              onChange={v => setDraft(d => ({ ...d, sort_order: parseInt(v) || 0 }))}
            />
          </div>

          <Input
            label="Document Type"
            value={draft.document_type ?? ''}
            onChange={v => setDraft(d => ({ ...d, document_type: v }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Folder Name"
              value={draft.folder_name ?? ''}
              onChange={v => setDraft(d => ({ ...d, folder_name: v }))}
            />
            <Input
              label="Task ID (optional)"
              value={draft.task_id ?? ''}
              onChange={v => setDraft(d => ({ ...d, task_id: v }))}
            />
          </div>

          <Input
            label="Filename Pattern (SQL ILIKE, e.g. %proposal%)"
            value={draft.filename_pattern ?? ''}
            onChange={v => setDraft(d => ({ ...d, filename_pattern: v }))}
          />

          <Textarea
            label="Description"
            value={draft.description ?? ''}
            onChange={v => setDraft(d => ({ ...d, description: v }))}
          />

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.required ?? true}
                onChange={e => setDraft(d => ({ ...d, required: e.target.checked }))}
                className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500"
              />
              <span className="text-xs text-gray-300">Required</span>
            </label>

            {editing && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.active ?? true}
                  onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}
                  className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500"
                />
                <span className="text-xs text-gray-300">Active</span>
              </label>
            )}
          </div>

          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button
                onClick={async () => {
                  if (!confirm(`DELETE requirement "${editing.document_type}"?`)) return
                  await supabase.from('document_requirements').delete().eq('id', editing.id)
                  setEditing(null)
                  setToast('Requirement deleted')
                  setTimeout(() => setToast(''), 2500)
                  load()
                }}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md"
              >
                Delete
              </button>
            ) : <div />}
            <div className="flex gap-2">
              <button
                onClick={() => { setEditing(null); setShowNew(false) }}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md"
              >
                Cancel
              </button>
              <SaveBtn onClick={editing ? save : createNew} saving={saving} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
