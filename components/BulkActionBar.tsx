'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateProject, loadUsers } from '@/lib/api/projects'
import { clearQueryCache } from '@/lib/hooks'
import { Users, ShieldAlert, Tag, Calendar, X, Loader2, CheckSquare, Square } from 'lucide-react'
import type { Project } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

export type BulkAction = 'reassign' | 'blocker' | 'disposition' | 'followup' | null

export interface BulkProgress {
  current: number
  total: number
  action: string
}

interface CurrentUser {
  id: string
  name: string
  email?: string
  role?: string
}

// ── Disposition rules ─────────────────────────────────────────────────────────

export function getAllowedDispositions(current: string | null): string[] {
  const disp = current ?? 'Sale'
  switch (disp) {
    case 'Sale':       return ['Sale', 'Loyalty']
    case 'Loyalty':    return ['Sale', 'Loyalty', 'Cancelled']
    case 'In Service': return ['Sale', 'In Service']
    case 'Cancelled':  return ['Loyalty', 'Cancelled']
    default:           return ['Sale', 'Loyalty']
  }
}

// ── Selection Hook ────────────────────────────────────────────────────────────

export function useBulkSelect(allProjects: Project[]) {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const selectedProjects = useMemo(
    () => allProjects.filter(p => selectedIds.has(p.id)),
    [allProjects, selectedIds]
  )

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
  }, [])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  return {
    selectMode,
    setSelectMode,
    selectedIds,
    selectedProjects,
    toggleSelect,
    selectAll,
    deselectAll,
    exitSelectMode,
  }
}

// ── Selection Checkbox ────────────────────────────────────────────────────────

export function SelectCheckbox({ selected }: { selected: boolean }) {
  return (
    <div className="absolute top-1.5 right-1.5 z-10">
      {selected
        ? <CheckSquare className="w-4 h-4 text-green-400" />
        : <Square className="w-4 h-4 text-gray-600" />
      }
    </div>
  )
}

// ── Audit log helper ──────────────────────────────────────────────────────────

async function logAudit(projectId: string, field: string, oldValue: string | null, newValue: string | null, currentUser: CurrentUser | null) {
  const supabase = createClient()
  await (supabase as any).from('audit_log').insert({
    project_id: projectId,
    field,
    old_value: oldValue,
    new_value: newValue,
    changed_by: currentUser?.name ?? null,
    changed_by_id: currentUser?.id ?? null,
  })
}

// ── Main Component ────────────────────────────────────────────────────────────

interface BulkActionBarProps {
  selectedIds: Set<string>
  selectedProjects: Project[]
  currentUser: CurrentUser | null
  onComplete: () => void  // called after any bulk action completes (refresh + exit select)
  onExit: () => void      // exit select mode
  /** Which actions to show. Defaults to all. */
  actions?: ('reassign' | 'blocker' | 'disposition' | 'followup')[]
  /** Custom action buttons rendered after the built-in actions */
  customActions?: React.ReactNode
}

export function BulkActionBar({
  selectedIds,
  selectedProjects,
  currentUser,
  onComplete,
  onExit,
  actions = ['reassign', 'blocker', 'disposition'],
  customActions,
}: BulkActionBarProps) {
  const [bulkAction, setBulkAction] = useState<BulkAction>(null)
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null)

  // Form state
  const [bulkPmId, setBulkPmId] = useState('')
  const [bulkBlockerText, setBulkBlockerText] = useState('')
  const [bulkDisposition, setBulkDisposition] = useState('')
  const [bulkFollowUpDate, setBulkFollowUpDate] = useState('')

  // PM list
  const [pmList, setPmList] = useState<{ id: string; name: string; email: string }[]>([])
  useEffect(() => {
    if (actions.includes('reassign')) {
      loadUsers('gomicrogridenergy.com').then(({ data }) => {
        setPmList(data as { id: string; name: string; email: string }[])
      })
    }
  }, [])

  const count = selectedIds.size
  const plural = count !== 1 ? 's' : ''

  function confirmAndExecute(message: string, onConfirm: () => void) {
    setConfirmDialog({ message, onConfirm })
  }

  // ── Bulk Reassign PM ──────────────────────────────────────────────────
  const executeBulkReassign = useCallback(async () => {
    const pm = pmList.find(p => p.id === bulkPmId)
    if (!pm || selectedProjects.length === 0) return

    setBulkAction(null)
    setBulkProgress({ current: 0, total: selectedProjects.length, action: 'Reassigning PM' })

    for (let i = 0; i < selectedProjects.length; i++) {
      const proj = selectedProjects[i]
      setBulkProgress({ current: i + 1, total: selectedProjects.length, action: 'Reassigning PM' })
      await updateProject(proj.id, { pm: pm.name, pm_id: pm.id })
      await logAudit(proj.id, 'pm', proj.pm, pm.name, currentUser)
      await logAudit(proj.id, 'pm_id', proj.pm_id, pm.id, currentUser)
    }

    setBulkProgress(null)
    setBulkPmId('')
    clearQueryCache()
    onComplete()
  }, [bulkPmId, pmList, selectedProjects, currentUser, onComplete])

  // ── Bulk Set/Clear Blocker ────────────────────────────────────────────
  const executeBulkSetBlocker = useCallback(async () => {
    if (selectedProjects.length === 0) return

    setBulkAction(null)
    const blocker = bulkBlockerText.trim() || null
    setBulkProgress({ current: 0, total: selectedProjects.length, action: blocker ? 'Setting blocker' : 'Clearing blockers' })

    for (let i = 0; i < selectedProjects.length; i++) {
      const proj = selectedProjects[i]
      setBulkProgress({ current: i + 1, total: selectedProjects.length, action: blocker ? 'Setting blocker' : 'Clearing blockers' })
      await updateProject(proj.id, { blocker })
      await logAudit(proj.id, 'blocker', proj.blocker, blocker, currentUser)
    }

    setBulkProgress(null)
    setBulkBlockerText('')
    clearQueryCache()
    onComplete()
  }, [bulkBlockerText, selectedProjects, currentUser, onComplete])

  // ── Bulk Change Disposition ───────────────────────────────────────────
  const dispositionValid = useMemo(() => {
    if (!bulkDisposition || selectedProjects.length === 0) return false
    return selectedProjects.every(p => getAllowedDispositions(p.disposition).includes(bulkDisposition))
  }, [bulkDisposition, selectedProjects])

  const executeBulkDisposition = useCallback(async () => {
    if (!dispositionValid || selectedProjects.length === 0) return

    setBulkAction(null)
    setBulkProgress({ current: 0, total: selectedProjects.length, action: 'Changing disposition' })

    for (let i = 0; i < selectedProjects.length; i++) {
      const proj = selectedProjects[i]
      setBulkProgress({ current: i + 1, total: selectedProjects.length, action: 'Changing disposition' })
      await updateProject(proj.id, { disposition: bulkDisposition })
      await logAudit(proj.id, 'disposition', proj.disposition, bulkDisposition, currentUser)
    }

    setBulkProgress(null)
    setBulkDisposition('')
    clearQueryCache()
    onComplete()
  }, [dispositionValid, bulkDisposition, selectedProjects, currentUser, onComplete])

  // ── Bulk Set Follow-up Date ───────────────────────────────────────────
  const executeBulkFollowUp = useCallback(async () => {
    if (!bulkFollowUpDate || selectedProjects.length === 0) return

    setBulkAction(null)
    const dateVal = bulkFollowUpDate || null
    setBulkProgress({ current: 0, total: selectedProjects.length, action: 'Setting follow-up date' })

    for (let i = 0; i < selectedProjects.length; i++) {
      const proj = selectedProjects[i]
      setBulkProgress({ current: i + 1, total: selectedProjects.length, action: 'Setting follow-up date' })
      await updateProject(proj.id, { follow_up_date: dateVal })
      await logAudit(proj.id, 'follow_up_date', (proj as any).follow_up_date ?? null, dateVal, currentUser)
    }

    setBulkProgress(null)
    setBulkFollowUpDate('')
    clearQueryCache()
    onComplete()
  }, [bulkFollowUpDate, selectedProjects, currentUser, onComplete])

  if (bulkProgress) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl text-center min-w-[300px]">
          <Loader2 className="w-8 h-8 text-green-400 animate-spin mx-auto mb-3" />
          <div className="text-sm text-white font-medium mb-1">{bulkProgress.action}</div>
          <div className="text-xs text-gray-400">
            Updating {bulkProgress.current} of {bulkProgress.total}...
          </div>
          <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.round((bulkProgress.current / bulkProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Floating Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950 border-t border-gray-700 shadow-2xl px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
          <span className="text-sm text-white font-medium">{count} project{plural} selected</span>
          <div className="h-4 w-px bg-gray-700" />

          {/* Reassign PM */}
          {actions.includes('reassign') && (
            <div className="relative">
              <button
                onClick={() => setBulkAction(bulkAction === 'reassign' ? null : 'reassign')}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition-colors ${
                  bulkAction === 'reassign' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-300 hover:text-white border border-gray-700'
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Reassign PM
              </button>
              {bulkAction === 'reassign' && (
                <div className="absolute bottom-full mb-2 left-0 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[240px]">
                  <div className="text-xs text-gray-400 mb-2">Select new PM:</div>
                  <select
                    value={bulkPmId}
                    onChange={e => setBulkPmId(e.target.value)}
                    className="w-full text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1.5 mb-2"
                  >
                    <option value="">Choose PM...</option>
                    {pmList.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                  </select>
                  <button
                    disabled={!bulkPmId}
                    onClick={() => {
                      const pm = pmList.find(p => p.id === bulkPmId)
                      confirmAndExecute(
                        `Reassign ${count} project${plural} to ${pm?.name}?`,
                        executeBulkReassign
                      )
                    }}
                    className="w-full text-xs px-3 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Set/Clear Blocker */}
          {actions.includes('blocker') && (
            <div className="relative">
              <button
                onClick={() => setBulkAction(bulkAction === 'blocker' ? null : 'blocker')}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition-colors ${
                  bulkAction === 'blocker' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-300 hover:text-white border border-gray-700'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" /> Blocker
              </button>
              {bulkAction === 'blocker' && (
                <div className="absolute bottom-full mb-2 left-0 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[280px]">
                  <div className="text-xs text-gray-400 mb-2">Set blocker reason (or leave blank to clear):</div>
                  <input
                    value={bulkBlockerText}
                    onChange={e => setBulkBlockerText(e.target.value)}
                    placeholder="Blocker reason..."
                    className="w-full text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1.5 mb-2 focus:outline-none focus:border-green-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirmAndExecute(
                        `Set blocker "${bulkBlockerText.trim()}" on ${count} project${plural}?`,
                        executeBulkSetBlocker
                      )}
                      disabled={!bulkBlockerText.trim()}
                      className="flex-1 text-xs px-3 py-1.5 rounded-md bg-red-700 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Set Blocker
                    </button>
                    <button
                      onClick={() => {
                        setBulkBlockerText('')
                        confirmAndExecute(
                          `Clear blockers on ${count} project${plural}?`,
                          executeBulkSetBlocker
                        )
                      }}
                      className="flex-1 text-xs px-3 py-1.5 rounded-md bg-gray-700 text-white hover:bg-gray-600"
                    >
                      Clear Blockers
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Change Disposition */}
          {actions.includes('disposition') && (
            <div className="relative">
              <button
                onClick={() => setBulkAction(bulkAction === 'disposition' ? null : 'disposition')}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition-colors ${
                  bulkAction === 'disposition' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-300 hover:text-white border border-gray-700'
                }`}
              >
                <Tag className="w-3.5 h-3.5" /> Disposition
              </button>
              {bulkAction === 'disposition' && (
                <div className="absolute bottom-full mb-2 left-0 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[240px]">
                  <div className="text-xs text-gray-400 mb-2">Change disposition:</div>
                  <select
                    value={bulkDisposition}
                    onChange={e => setBulkDisposition(e.target.value)}
                    className="w-full text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1.5 mb-2"
                  >
                    <option value="">Choose...</option>
                    <option value="Sale">Sale</option>
                    <option value="Loyalty">Loyalty</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  {bulkDisposition && !dispositionValid && (
                    <div className="text-xs text-red-400 mb-2">
                      Some selected projects cannot transition to {bulkDisposition}. Check disposition rules.
                    </div>
                  )}
                  <button
                    disabled={!dispositionValid}
                    onClick={() => confirmAndExecute(
                      `Change disposition to "${bulkDisposition}" for ${count} project${plural}?`,
                      executeBulkDisposition
                    )}
                    className="w-full text-xs px-3 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Follow-up Date (Queue-specific) */}
          {actions.includes('followup') && (
            <div className="relative">
              <button
                onClick={() => setBulkAction(bulkAction === 'followup' ? null : 'followup')}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition-colors ${
                  bulkAction === 'followup' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-300 hover:text-white border border-gray-700'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" /> Follow-up Date
              </button>
              {bulkAction === 'followup' && (
                <div className="absolute bottom-full mb-2 left-0 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[260px]">
                  <div className="text-xs text-gray-400 mb-2">Set follow-up date for selected projects:</div>
                  <input
                    type="date"
                    value={bulkFollowUpDate}
                    onChange={e => setBulkFollowUpDate(e.target.value)}
                    className="w-full text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1.5 mb-2 focus:outline-none focus:border-green-500"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={!bulkFollowUpDate}
                      onClick={() => confirmAndExecute(
                        `Set follow-up date to ${bulkFollowUpDate} for ${count} project${plural}?`,
                        executeBulkFollowUp
                      )}
                      className="flex-1 text-xs px-3 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Set Date
                    </button>
                    <button
                      onClick={() => {
                        setBulkFollowUpDate('')
                        confirmAndExecute(
                          `Clear follow-up dates on ${count} project${plural}?`,
                          async () => {
                            setBulkAction(null)
                            setBulkProgress({ current: 0, total: selectedProjects.length, action: 'Clearing follow-up dates' })
                            for (let i = 0; i < selectedProjects.length; i++) {
                              const proj = selectedProjects[i]
                              setBulkProgress({ current: i + 1, total: selectedProjects.length, action: 'Clearing follow-up dates' })
                              await updateProject(proj.id, { follow_up_date: null })
                              await logAudit(proj.id, 'follow_up_date', (proj as any).follow_up_date ?? null, null, currentUser)
                            }
                            setBulkProgress(null)
                            clearQueryCache()
                            onComplete()
                          }
                        )
                      }}
                      className="flex-1 text-xs px-3 py-1.5 rounded-md bg-gray-700 text-white hover:bg-gray-600"
                    >
                      Clear Dates
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Custom actions */}
          {customActions}

          {/* Close */}
          <button onClick={onExit} className="ml-auto text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl max-w-sm">
            <div className="text-sm text-white mb-4">{confirmDialog.message}</div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="text-xs px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:text-white border border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm()
                  setConfirmDialog(null)
                }}
                className="text-xs px-4 py-2 rounded-md bg-green-700 text-white hover:bg-green-600 font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
