'use client'

import { cn, fmtDate } from '@/lib/utils'
import type { EngineeringAssignment, AssignmentStatus } from '@/lib/api/engineering'
import {
  X, CheckCircle, Play, Send, AlertTriangle, FileText,
} from 'lucide-react'

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export function AssignmentDetail({
  assignment,
  project,
  isEngineering,
  isPlatform,
  onStatusChange,
  onPriorityChange,
  onOpenProject,
}: {
  assignment: EngineeringAssignment
  project: { id: string; name: string; stage: string; pm: string | null; financier: string | null; systemkw: number | null; contract: number | null } | null
  isEngineering: boolean
  isPlatform: boolean
  onStatusChange: (status: AssignmentStatus) => void
  onPriorityChange: (priority: string) => void
  onOpenProject: (projectId: string) => void
}) {
  const deliverables = assignment.deliverables ?? []

  // Valid status transitions
  const getNextActions = (): { status: AssignmentStatus; label: string; icon: typeof Play; color: string }[] => {
    const s = assignment.status
    const actions: { status: AssignmentStatus; label: string; icon: typeof Play; color: string }[] = []

    if (isEngineering || isPlatform) {
      if (s === 'pending') actions.push({ status: 'assigned', label: 'Accept', icon: CheckCircle, color: 'bg-blue-600 hover:bg-blue-700' })
      if (s === 'assigned') actions.push({ status: 'in_progress', label: 'Start Work', icon: Play, color: 'bg-cyan-600 hover:bg-cyan-700' })
      if (s === 'in_progress') actions.push({ status: 'review', label: 'Submit for Review', icon: Send, color: 'bg-purple-600 hover:bg-purple-700' })
      if (s === 'revision_needed') actions.push({ status: 'in_progress', label: 'Resume Work', icon: Play, color: 'bg-cyan-600 hover:bg-cyan-700' })
    }

    if (!isEngineering || isPlatform) {
      if (s === 'review') actions.push({ status: 'complete', label: 'Approve & Complete', icon: CheckCircle, color: 'bg-green-600 hover:bg-green-700' })
      if (s === 'review') actions.push({ status: 'revision_needed', label: 'Request Revision', icon: AlertTriangle, color: 'bg-orange-600 hover:bg-orange-700' })
    }

    if (s !== 'complete' && s !== 'cancelled') {
      actions.push({ status: 'cancelled', label: 'Cancel', icon: X, color: 'bg-red-600 hover:bg-red-700' })
    }

    return actions
  }

  const actions = getNextActions()

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mt-2 space-y-3">
      {/* Project summary */}
      {project && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-gray-500">Stage</div>
            <div className="text-sm text-white capitalize">{project.stage}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">PM</div>
            <div className="text-sm text-white">{project.pm ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Financier</div>
            <div className="text-sm text-white">{project.financier ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">System</div>
            <div className="text-sm text-white">{project.systemkw ? `${project.systemkw} kW` : '—'}</div>
          </div>
        </div>
      )}

      {/* Assignment details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-gray-500">Created By</div>
          <div className="text-sm text-white">{assignment.created_by ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Assigned To</div>
          <div className="text-sm text-white">{assignment.assigned_to ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Started</div>
          <div className="text-sm text-white">{assignment.started_at ? fmtDate(assignment.started_at) : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Revisions</div>
          <div className="text-sm text-white">{assignment.revision_count}</div>
        </div>
      </div>

      {/* Editable Priority */}
      {assignment.status !== 'complete' && assignment.status !== 'cancelled' && (
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500">Priority</div>
          <select
            value={assignment.priority}
            onChange={e => onPriorityChange(e.target.value)}
            className="text-xs bg-gray-900 text-white border border-gray-700 rounded px-2 py-1"
          >
            {PRIORITIES.map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Notes */}
      {assignment.notes && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Notes</div>
          <div className="text-sm text-gray-300 bg-gray-900 rounded p-2">{assignment.notes}</div>
        </div>
      )}

      {/* Deliverables */}
      <div>
        <div className="text-xs text-gray-500 mb-1">Deliverables ({deliverables.length})</div>
        {deliverables.length === 0 ? (
          <div className="text-xs text-gray-600">No deliverables yet</div>
        ) : (
          <div className="space-y-1">
            {deliverables.map((d, i) => {
              const item = d as Record<string, unknown>
              const name = typeof item.name === 'string' ? item.name : `Deliverable ${i + 1}`
              const uploadedAt = typeof item.uploaded_at === 'string' ? item.uploaded_at : null
              return (
                <div key={i} className="flex items-center gap-2 bg-gray-900 rounded p-2 text-xs text-gray-300">
                  <FileText className="w-3 h-3 text-green-400 shrink-0" />
                  <span>{name}</span>
                  {uploadedAt && (
                    <span className="text-gray-600 ml-auto">{fmtDate(uploadedAt)}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-700">
          {actions.map(a => {
            const Icon = a.icon
            return (
              <button
                key={a.status + a.label}
                onClick={() => {
                  if (a.status === 'cancelled' && !confirm('Cancel this assignment?')) return
                  onStatusChange(a.status)
                }}
                className={cn('px-3 py-1.5 text-xs text-white rounded-lg flex items-center gap-1', a.color)}
              >
                <Icon className="w-3 h-3" /> {a.label}
              </button>
            )
          })}
          <button
            onClick={() => onOpenProject(assignment.project_id)}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg ml-auto"
          >
            Open Project
          </button>
        </div>
      )}
    </div>
  )
}
