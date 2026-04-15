'use client'

import { useState } from 'react'
import { db } from '@/lib/db'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn } from '@/lib/utils'
import { MoreHorizontal, AlertTriangle, MessageSquare, Ticket, Calendar } from 'lucide-react'

interface QuickActionMenuProps {
  projectId: string
  projectName: string
  onRefresh?: () => void
}

export function QuickActionMenu({ projectId, projectName, onRefresh }: QuickActionMenuProps) {
  const { user } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<'blocker' | 'note' | 'followup' | null>(null)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)

    if (action === 'blocker') {
      await db().from('projects').update({ blocker: value.trim() }).eq('id', projectId)
      await db().from('audit_log').insert({
        project_id: projectId, field: 'blocker', old_value: null, new_value: value.trim(),
        changed_by: user?.name ?? 'Unknown', changed_by_id: user?.id,
      })
    } else if (action === 'note') {
      await db().from('notes').insert({
        project_id: projectId, author: user?.name ?? 'Unknown', message: value.trim(),
      })
    } else if (action === 'followup') {
      await db().from('projects').update({ follow_up_date: value.trim() }).eq('id', projectId)
    }

    setSaving(false)
    setAction(null)
    setValue('')
    setOpen(false)
    onRefresh?.()
  }

  const handleCreateTicket = () => {
    window.open(`/tickets?create=true&project=${projectId}`, '_blank')
    setOpen(false)
  }

  if (action) {
    return (
      <div className="absolute right-0 top-0 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 p-2 w-56" onClick={e => e.stopPropagation()}>
        <div className="text-[10px] text-gray-500 mb-1">
          {action === 'blocker' && 'Set Blocker'}
          {action === 'note' && 'Quick Note'}
          {action === 'followup' && 'Set Follow-up Date'}
        </div>
        {action === 'followup' ? (
          <input type="date" value={value} onChange={e => setValue(e.target.value)} autoFocus
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white" />
        ) : (
          <input value={value} onChange={e => setValue(e.target.value)} autoFocus
            placeholder={action === 'blocker' ? 'Blocker reason...' : 'Note...'}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500" />
        )}
        <div className="flex gap-1 mt-1.5">
          <button onClick={handleSave} disabled={!value.trim() || saving}
            className="text-[10px] px-2 py-0.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded">
            {saving ? '...' : 'Save'}
          </button>
          <button onClick={() => { setAction(null); setValue('') }}
            className="text-[10px] px-2 py-0.5 text-gray-400 hover:text-white">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)}
        className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-white transition-colors">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
          <button onClick={() => { setAction('blocker'); setOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] text-gray-300 hover:bg-gray-700 hover:text-white">
            <AlertTriangle className="w-3 h-3 text-red-400" /> Set Blocker
          </button>
          <button onClick={() => { setAction('note'); setOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] text-gray-300 hover:bg-gray-700 hover:text-white">
            <MessageSquare className="w-3 h-3 text-blue-400" /> Quick Note
          </button>
          <button onClick={() => { setAction('followup'); setOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] text-gray-300 hover:bg-gray-700 hover:text-white">
            <Calendar className="w-3 h-3 text-amber-400" /> Set Follow-up
          </button>
          <button onClick={handleCreateTicket}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] text-gray-300 hover:bg-gray-700 hover:text-white">
            <Ticket className="w-3 h-3 text-purple-400" /> Create Ticket
          </button>
          <div className="border-t border-gray-700 my-1" />
          <button onClick={() => setOpen(false)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] text-gray-500 hover:bg-gray-700">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
