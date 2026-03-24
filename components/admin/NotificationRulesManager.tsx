'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { ALL_TASKS_MAP, TASK_STATUSES } from '@/lib/tasks'
import { NotificationRule, Input, Textarea, Modal, SaveBtn } from './shared'

export function NotificationRulesManager() {
  const supabase = db()
  const [rules, setRules] = useState<NotificationRule[]>([])
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<NotificationRule | null>(null)
  const [draft, setDraft] = useState<Partial<NotificationRule>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const taskOptions = Object.entries(ALL_TASKS_MAP).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  const statusOptions = TASK_STATUSES as readonly string[]
  const roleOptions = ['super_admin', 'admin', 'finance', 'manager', 'user']

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from('notification_rules').select('*').order('task_id')
    setRules((data ?? []) as NotificationRule[])
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!draft.task_id || !draft.trigger_status || !draft.action_message) return
    setSaving(true)
    if (editing) {
      const { error } = await (supabase as any).from('notification_rules').update({
        task_id: draft.task_id,
        trigger_status: draft.trigger_status,
        trigger_reason: draft.trigger_reason || null,
        action_type: draft.action_type || 'note',
        action_message: draft.action_message,
        notify_role: draft.notify_role || null,
        active: draft.active ?? true,
      }).eq('id', editing.id)
      if (error) { setToast('Save failed'); setSaving(false); setTimeout(() => setToast(''), 2500); return }
      setToast('Rule updated'); setEditing(null)
    } else {
      const { error } = await (supabase as any).from('notification_rules').insert({
        task_id: draft.task_id,
        trigger_status: draft.trigger_status,
        trigger_reason: draft.trigger_reason || null,
        action_type: draft.action_type || 'note',
        action_message: draft.action_message,
        notify_role: draft.notify_role || null,
        active: draft.active ?? true,
        created_by: 'admin',
      })
      if (error) { setToast('Create failed'); setSaving(false); setTimeout(() => setToast(''), 2500); return }
      setToast('Rule created'); setShowNew(false)
    }
    setSaving(false); setDraft({}); setTimeout(() => setToast(''), 2500); load()
  }

  const toggleActive = async (rule: NotificationRule) => {
    await (supabase as any).from('notification_rules').update({ active: !rule.active }).eq('id', rule.id)
    load()
  }

  const deleteRule = async (rule: NotificationRule) => {
    if (!confirm('Delete this notification rule?')) return
    await (supabase as any).from('notification_rules').delete().eq('id', rule.id)
    load()
  }

  const RuleForm = () => (
    <Modal title={editing ? 'Edit Notification Rule' : 'New Notification Rule'} onClose={() => { setEditing(null); setShowNew(false); setDraft({}) }}>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Task</label>
        <select value={draft.task_id ?? ''} onChange={e => setDraft(d => ({ ...d, task_id: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">Select task...</option>
          {taskOptions.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Trigger Status</label>
        <select value={draft.trigger_status ?? ''} onChange={e => setDraft(d => ({ ...d, trigger_status: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">Select status...</option>
          {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Input label="Trigger Reason (optional — blank matches any)" value={draft.trigger_reason ?? ''} onChange={v => setDraft(d => ({ ...d, trigger_reason: v }))} />
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Action Type</label>
        <select value={draft.action_type ?? 'note'} onChange={e => setDraft(d => ({ ...d, action_type: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="note">Create Note</option>
          <option value="toast">Show Toast Only</option>
        </select>
      </div>
      <Textarea label="Action Message" value={draft.action_message ?? ''} onChange={v => setDraft(d => ({ ...d, action_message: v }))} />
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium">Notify Role (optional)</label>
        <select value={draft.notify_role ?? ''} onChange={e => setDraft(d => ({ ...d, notify_role: e.target.value || null }))}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">None</option>
          {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={draft.active ?? true} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))} className="rounded" />
        <span className="text-sm text-gray-300">Active</span>
      </div>
      <SaveBtn onClick={save} saving={saving} />
    </Modal>
  )

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Notification Rules</h2>
          <p className="text-xs text-gray-500 mt-0.5">{rules.length} rules configured</p>
        </div>
        <button onClick={() => { setShowNew(true); setDraft({ active: true, action_type: 'note' }) }} className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Rule</button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Task', 'Trigger Status', 'Reason', 'Action', 'Message', 'Role', 'Active', ''].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                <td className="px-3 py-2 text-white">{ALL_TASKS_MAP[r.task_id] ?? r.task_id}</td>
                <td className="px-3 py-2 text-gray-300">{r.trigger_status}</td>
                <td className="px-3 py-2 text-gray-400">{r.trigger_reason ?? <span className="italic text-gray-600">any</span>}</td>
                <td className="px-3 py-2 text-gray-300">{r.action_type}</td>
                <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate">{r.action_message}</td>
                <td className="px-3 py-2 text-gray-400">{r.notify_role ?? '—'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => toggleActive(r)} className={`px-2 py-0.5 rounded text-xs font-medium ${r.active ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                    {r.active ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="px-3 py-2 flex gap-1">
                  <button onClick={() => { setEditing(r); setDraft({ ...r }) }} className="text-blue-400 hover:text-blue-300 text-xs">Edit</button>
                  <button onClick={() => deleteRule(r)} className="text-red-400 hover:text-red-300 text-xs">Del</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-gray-600">No notification rules configured yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {(showNew || editing) && <RuleForm />}
    </div>
  )
}
