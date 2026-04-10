'use client'

import { useEffect, useState } from 'react'
import { escapeIlike } from '@/lib/utils'
import {
  submitAssignment, ASSIGNMENT_TYPE_LABELS, ASSIGNMENT_TYPES,
} from '@/lib/api/engineering'
import { autoRouteAssignment } from '@/lib/api/engineering-config'
import type { EngineeringConfig } from '@/lib/api/engineering-config'
import type { EngineeringAssignment } from '@/lib/api/engineering'
import { db } from '@/lib/db'
import { X } from 'lucide-react'

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export function SubmitAssignmentModal({
  onClose,
  onSubmitted,
  orgId,
  userId,
  userName,
  engineeringConfig,
}: {
  onClose: () => void
  onSubmitted: () => void
  orgId: string
  userId: string
  userName: string
  engineeringConfig: EngineeringConfig | null
}) {
  const isAutoRoute = engineeringConfig?.auto_route_enabled === 'true'
  const [projectSearch, setProjectSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; stage: string }[]>([])
  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null)
  const [assignedOrg, setAssignedOrg] = useState('')
  const [engineeringOrgs, setEngineeringOrgs] = useState<{ id: string; name: string }[]>([])
  const [type, setType] = useState<string>('new_design')
  const [priority, setPriority] = useState('normal')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Load engineering partner orgs
  useEffect(() => {
    async function load() {
      const supabase = db()
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('org_type', 'engineering')
        .eq('active', true)
        .order('name')
      if (data) setEngineeringOrgs(data as { id: string; name: string }[])
    }
    load()
  }, [])

  // Search projects for autocomplete
  useEffect(() => {
    if (projectSearch.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      const supabase = db()
      const q = escapeIlike(projectSearch)
      const { data } = await supabase
        .from('projects')
        .select('id, name, stage')
        .or(`name.ilike.%${q}%,id.ilike.%${q}%`)
        .eq('org_id', orgId)
        .limit(10)
      setSearchResults((data ?? []) as { id: string; name: string; stage: string }[])
    }, 200)
    return () => clearTimeout(timer)
  }, [projectSearch, orgId])

  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleSubmit() {
    const pid = selectedProject?.id
    if (!pid) return
    // When auto-routing is disabled, require a selected partner
    if (!isAutoRoute && !assignedOrg) return
    setSaving(true)
    setSubmitError(null)
    let result: EngineeringAssignment | null = null
    if (isAutoRoute) {
      result = await autoRouteAssignment(pid, orgId, userId, userName, type, priority, notes || undefined)
    } else {
      result = await submitAssignment(pid, assignedOrg, orgId, type, userId, userName, {
        priority,
        due_date: dueDate || undefined,
        notes: notes || undefined,
      })
    }
    setSaving(false)
    if (result) {
      onSubmitted()
      onClose()
    } else {
      setSubmitError('Failed to submit assignment. Check that the engineering partner is configured and active.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Submit Engineering Assignment</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Project search */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Project *</label>
            {selectedProject ? (
              <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                <span className="text-white text-sm">{selectedProject.id} — {selectedProject.name}</span>
                <button onClick={() => { setSelectedProject(null); setProjectSearch('') }} className="text-gray-400 hover:text-white ml-auto"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  placeholder="Search by name or PROJ-XXXXX"
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-48 overflow-y-auto z-10">
                    {searchResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedProject({ id: p.id, name: p.name }); setSearchResults([]) }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                      >
                        <span className="text-green-400">{p.id}</span> — {p.name} <span className="text-gray-500 text-xs">({p.stage})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Engineering Partner */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Engineering Partner *</label>
            {isAutoRoute ? (
              <div className="bg-green-900/20 border border-green-800 rounded-lg px-3 py-2 text-sm text-green-400">
                All designs are automatically routed to Rush Engineering
              </div>
            ) : (
              <select
                value={assignedOrg}
                onChange={e => setAssignedOrg(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">-- Select Partner --</option>
                {engineeringOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </div>

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Assignment Type</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {ASSIGNMENT_TYPES.map(t => <option key={t} value={t}>{ASSIGNMENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Design requirements, special instructions..."
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-none"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-800 space-y-2">
          {submitError && (
            <p className="text-xs text-red-400 font-medium">{submitError}</p>
          )}
          <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving || !selectedProject || (!isAutoRoute && !assignedOrg)}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Submitting...' : 'Submit Assignment'}
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}
