'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { ALL_TASKS_MAP, TASK_STATUSES } from '@/lib/tasks'
import { QueueSection, Input, Modal, SaveBtn } from './shared'

export function QueueConfigManager() {
  const supabase = db()
  const [sections, setSections] = useState<QueueSection[]>([])
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<QueueSection | null>(null)
  const [draft, setDraft] = useState<Partial<QueueSection>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const taskOptions = Object.entries(ALL_TASKS_MAP).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  const statusOptions = TASK_STATUSES as readonly string[]
  const colorOptions = ['blue', 'indigo', 'purple', 'teal', 'cyan', 'green', 'red', 'amber', 'gray', 'yellow', 'pink', 'orange']

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from('queue_sections').select('*').order('sort_order')
    setSections((data ?? []) as QueueSection[])
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!draft.label || !draft.task_id || !draft.match_status) return
    setSaving(true)
    const payload = {
      label: draft.label,
      task_id: draft.task_id,
      match_status: draft.match_status,
      color: draft.color || 'gray',
      icon: draft.icon || '📋',
      sort_order: draft.sort_order ?? 0,
      active: draft.active ?? true,
    }
    if (editing) {
      const { error } = await (supabase as any).from('queue_sections').update(payload).eq('id', editing.id)
      if (error) { setToast('Save failed'); setSaving(false); setTimeout(() => setToast(''), 2500); return }
      setToast('Section updated'); setEditing(null)
    } else {
      const { error } = await (supabase as any).from('queue_sections').insert(payload)
      if (error) { setToast('Create failed'); setSaving(false); setTimeout(() => setToast(''), 2500); return }
      setToast('Section created'); setShowNew(false)
    }
    setSaving(false); setDraft({}); setTimeout(() => setToast(''), 2500); load()
  }

  const toggleActive = async (sec: QueueSection) => {
    await (supabase as any).from('queue_sections').update({ active: !sec.active }).eq('id', sec.id)
    load()
  }

  const deleteSection = async (sec: QueueSection) => {
    if (!confirm('Delete this queue section?')) return
    await (supabase as any).from('queue_sections').delete().eq('id', sec.id)
    load()
  }

  // Multi-select status helper
  const selectedStatuses = new Set((draft.match_status ?? '').split(',').map(s => s.trim()).filter(Boolean))
  const toggleStatus = (s: string) => {
    const next = new Set(selectedStatuses)
    if (next.has(s)) next.delete(s); else next.add(s)
    setDraft(d => ({ ...d, match_status: [...next].join(',') }))
  }

  const SectionForm = () => (
    <Modal title={editing ? 'Edit Queue Section' : 'New Queue Section'} onClose={() => { setEditing(null); setShowNew(false); setDraft({}) }}>
      <Input label="Label" value={draft.label ?? ''} onChange={v => setDraft(d => ({ ...d, label: v }))} />
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Task</label>
        <select value={draft.task_id ?? ''} onChange={e => setDraft(d => ({ ...d, task_id: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">Select task...</option>
          {taskOptions.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Match Statuses (select one or more)</label>
        <div className="flex flex-wrap gap-1.5">
          {statusOptions.map(s => (
            <button key={s} type="button" onClick={() => toggleStatus(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                selectedStatuses.has(s)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400 font-medium">Color</label>
          <select value={draft.color ?? 'gray'} onChange={e => setDraft(d => ({ ...d, color: e.target.value }))}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
            {colorOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Input label="Icon" value={draft.icon ?? '📋'} onChange={v => setDraft(d => ({ ...d, icon: v }))} className="flex-1" />
        <Input label="Sort Order" value={String(draft.sort_order ?? 0)} onChange={v => setDraft(d => ({ ...d, sort_order: parseInt(v) || 0 }))} type="number" className="flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={draft.active ?? true} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))} className="rounded" />
        <span className="text-sm text-gray-300">Active</span>
      </div>
      <SaveBtn onClick={save} saving={saving} />
    </Modal>
  )

  const COLOR_DOT: Record<string, string> = {
    blue: 'bg-blue-500', indigo: 'bg-indigo-500', purple: 'bg-purple-500',
    teal: 'bg-teal-500', cyan: 'bg-cyan-500', green: 'bg-green-500',
    red: 'bg-red-500', amber: 'bg-amber-500', gray: 'bg-gray-500',
    yellow: 'bg-yellow-500', pink: 'bg-pink-500', orange: 'bg-orange-500',
  }

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Queue Sections</h2>
          <p className="text-xs text-gray-500 mt-0.5">{sections.length} sections configured</p>
        </div>
        <button onClick={() => { setShowNew(true); setDraft({ active: true, color: 'gray', icon: '📋', sort_order: sections.length + 1 }) }} className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Section</button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Order', 'Label', 'Task', 'Match Statuses', 'Color', 'Icon', 'Active', ''].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((s, i) => (
              <tr key={s.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                <td className="px-3 py-2 text-gray-400 font-mono">{s.sort_order}</td>
                <td className="px-3 py-2 text-white">{s.label}</td>
                <td className="px-3 py-2 text-gray-300">{ALL_TASKS_MAP[s.task_id] ?? s.task_id}</td>
                <td className="px-3 py-2 text-gray-300 max-w-[200px]">
                  <div className="flex flex-wrap gap-1">
                    {s.match_status.split(',').map(st => (
                      <span key={st} className="bg-gray-800 px-1.5 py-0.5 rounded text-[10px] text-gray-400">{st.trim()}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2"><span className={`inline-block w-3 h-3 rounded-full ${COLOR_DOT[s.color] ?? 'bg-gray-500'}`} /></td>
                <td className="px-3 py-2">{s.icon}</td>
                <td className="px-3 py-2">
                  <button onClick={() => toggleActive(s)} className={`px-2 py-0.5 rounded text-xs font-medium ${s.active ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                    {s.active ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="px-3 py-2 flex gap-1">
                  <button onClick={() => { setEditing(s); setDraft({ ...s }) }} className="text-blue-400 hover:text-blue-300 text-xs">Edit</button>
                  <button onClick={() => deleteSection(s)} className="text-red-400 hover:text-red-300 text-xs">Del</button>
                </td>
              </tr>
            ))}
            {sections.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-gray-600">No queue sections configured yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {(showNew || editing) && <SectionForm />}
    </div>
  )
}
