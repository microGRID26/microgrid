'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { cn, escapeFilterValue } from '@/lib/utils'
import { db } from '@/lib/db'
import {
  loadPermitSubmissions,
  createPermitSubmission,
  updatePermitSubmission,
  loadAHJEligibility,
  SUBMISSION_TYPES,
  SUBMISSION_STATUSES,
  STATUS_TRANSITIONS,
} from '@/lib/api/permit-submissions'
import type { PermitSubmission, PermitSubmissionStatus, SubmissionType, AHJEligibility } from '@/lib/api/permit-submissions'
import { useOrg } from '@/lib/hooks'
import { FileCheck2, Plus, X, ChevronRight, Filter, Zap, Globe, Mail, ClipboardList } from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: PermitSubmissionStatus) {
  const found = SUBMISSION_STATUSES.find(s => s.value === status)
  return found ?? { label: status, color: 'bg-gray-700 text-gray-300' }
}

function typeIcon(type: SubmissionType) {
  switch (type) {
    case 'solarapp': return <Zap size={12} className="text-yellow-400" />
    case 'online_portal': return <Globe size={12} className="text-blue-400" />
    case 'email': return <Mail size={12} className="text-purple-400" />
    default: return <ClipboardList size={12} className="text-gray-400" />
  }
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PermitTracker() {
  const { orgId } = useOrg()
  const [submissions, setSubmissions] = useState<PermitSubmission[]>([])
  const [ahjs, setAhjs] = useState<AHJEligibility[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Filters
  const [filterStatus, setFilterStatus] = useState<PermitSubmissionStatus | ''>('')
  const [filterAhj, setFilterAhj] = useState('')
  const [filterType, setFilterType] = useState<SubmissionType | ''>('')

  // Form state
  const [formProjectSearch, setFormProjectSearch] = useState('')
  const [formProjectId, setFormProjectId] = useState('')
  const [formProjectName, setFormProjectName] = useState('')
  const [formAhjId, setFormAhjId] = useState<number | null>(null)
  const [formType, setFormType] = useState<SubmissionType>('manual')
  const [formPermitNumber, setFormPermitNumber] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [projectResults, setProjectResults] = useState<{ id: string; name: string; ahj?: string }[]>([])

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    const [subs, ahjData] = await Promise.all([
      loadPermitSubmissions(undefined, orgId ?? undefined),
      loadAHJEligibility(),
    ])
    setSubmissions(subs)
    setAhjs(ahjData)
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  // ── Project search ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!formProjectSearch.trim() || formProjectSearch.length < 2) {
      setProjectResults([])
      return
    }
    const timer = setTimeout(async () => {
      const supabase = db()
      const q = escapeFilterValue(formProjectSearch.trim())
      const { data } = await supabase
        .from('projects')
        .select('id, name, ahj')
        .or(`name.ilike.%${q}%,id.ilike.%${q}%`)
        .limit(8)
      setProjectResults((data ?? []) as { id: string; name: string; ahj?: string }[])
    }, 300)
    return () => clearTimeout(timer)
  }, [formProjectSearch])

  // ── Select project → auto-fill AHJ ────────────────────────────────────────

  function selectProject(p: { id: string; name: string; ahj?: string }) {
    setFormProjectId(p.id)
    setFormProjectName(p.name)
    setFormProjectSearch('')
    setProjectResults([])

    // Auto-match AHJ by name
    if (p.ahj) {
      const match = ahjs.find(a => a.name === p.ahj)
      if (match) {
        setFormAhjId(match.id)
        // Auto-set type from AHJ efiling_type
        if (match.efiling_type) {
          setFormType(match.efiling_type as SubmissionType)
        }
      }
    }
  }

  // ── Submit new permit ──────────────────────────────────────────────────────

  async function handleCreate() {
    if (!formProjectId) return
    setFormSubmitting(true)
    const result = await createPermitSubmission({
      project_id: formProjectId,
      ahj_id: formAhjId,
      submission_type: formType,
      permit_number: formPermitNumber || undefined,
      notes: formNotes || undefined,
    })
    if (result) {
      // Reload to get joined data
      await loadData()
      resetForm()
    }
    setFormSubmitting(false)
  }

  function resetForm() {
    setShowForm(false)
    setFormProjectSearch('')
    setFormProjectId('')
    setFormProjectName('')
    setFormAhjId(null)
    setFormType('manual')
    setFormPermitNumber('')
    setFormNotes('')
    setProjectResults([])
  }

  // ── Status transition ──────────────────────────────────────────────────────

  async function handleStatusChange(sub: PermitSubmission, newStatus: PermitSubmissionStatus) {
    const rejectionReason = newStatus === 'rejected'
      ? prompt('Enter rejection reason:')
      : undefined

    if (newStatus === 'rejected' && rejectionReason === null) return // cancelled prompt

    const result = await updatePermitSubmission(sub.id, {
      status: newStatus,
      ...(rejectionReason ? { rejection_reason: rejectionReason } : {}),
    })
    if (result) {
      setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, ...result } : s))
    }
  }

  // ── Filtered submissions ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = submissions
    if (filterStatus) list = list.filter(s => s.status === filterStatus)
    if (filterType) list = list.filter(s => s.submission_type === filterType)
    if (filterAhj) list = list.filter(s => (s.ahj_name ?? '').toLowerCase().includes(filterAhj.toLowerCase()))
    return list
  }, [submissions, filterStatus, filterType, filterAhj])

  // ── Summary stats ──────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = submissions.length
    const pending = submissions.filter(s => ['draft', 'submitted', 'under_review', 'revision_needed'].includes(s.status)).length
    const approved = submissions.filter(s => s.status === 'approved').length
    const rejected = submissions.filter(s => s.status === 'rejected').length
    const electronic = submissions.filter(s => s.submission_type !== 'manual').length
    return { total, pending, approved, rejected, electronic }
  }, [submissions])

  // ── AHJ dropdown options ───────────────────────────────────────────────────

  const ahjOptions = useMemo(() => ahjs.filter(a => a.name), [ahjs])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center text-gray-500 text-sm py-8 animate-pulse">
        Loading permit submissions...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-green-400" />
            Permit Submission Tracker
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5">
            Track permit applications across all projects — SolarAPP+, online portals, email, and manual submissions
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
        >
          {showForm ? <X size={13} /> : <Plus size={13} />}
          {showForm ? 'Cancel' : 'New Submission'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700/50">
          <div className="text-lg font-bold text-white">{stats.total}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700/50">
          <div className="text-lg font-bold text-amber-400">{stats.pending}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Pending</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700/50">
          <div className="text-lg font-bold text-green-400">{stats.approved}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Approved</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700/50">
          <div className="text-lg font-bold text-red-400">{stats.rejected}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Rejected</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700/50">
          <div className="text-lg font-bold text-blue-400">{stats.electronic}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Electronic</div>
        </div>
      </div>

      {/* New submission form */}
      {showForm && (
        <div className="bg-gray-800/80 rounded-lg border border-gray-700 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Log New Permit Submission</h3>

          {/* Project search */}
          <div className="relative">
            <label className="text-[10px] text-gray-500 block mb-1">Project</label>
            {formProjectId ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white bg-gray-700 px-2 py-1 rounded">
                  {formProjectName} <span className="text-gray-500">({formProjectId})</span>
                </span>
                <button
                  onClick={() => { setFormProjectId(''); setFormProjectName(''); setFormAhjId(null) }}
                  className="text-gray-500 hover:text-gray-300"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <input
                  value={formProjectSearch}
                  onChange={e => setFormProjectSearch(e.target.value)}
                  placeholder="Search by customer name or project ID..."
                  className="w-full bg-gray-900 border border-gray-700 rounded-md text-xs text-gray-200 px-3 py-2 focus:outline-none focus:border-green-500"
                />
                {projectResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {projectResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => selectProject(p)}
                        className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors flex items-center justify-between"
                      >
                        <span>{p.name}</span>
                        <span className="text-gray-600 text-[10px]">{p.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* AHJ */}
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">AHJ</label>
              <select
                value={formAhjId ?? ''}
                onChange={e => setFormAhjId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md text-xs text-gray-200 px-2 py-2 focus:outline-none focus:border-green-500"
              >
                <option value="">Select AHJ...</option>
                {ahjOptions.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.solarapp_eligible ? ' [SolarAPP+]' : ''}{a.efiling_type ? ` (${a.efiling_type})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Submission type */}
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Submission Type</label>
              <select
                value={formType}
                onChange={e => setFormType(e.target.value as SubmissionType)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md text-xs text-gray-200 px-2 py-2 focus:outline-none focus:border-green-500"
              >
                {SUBMISSION_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Permit number */}
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Permit Number (if known)</label>
              <input
                value={formPermitNumber}
                onChange={e => setFormPermitNumber(e.target.value)}
                placeholder="e.g., BLD-2026-12345"
                className="w-full bg-gray-900 border border-gray-700 rounded-md text-xs text-gray-200 px-3 py-2 focus:outline-none focus:border-green-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Notes</label>
            <textarea
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes about this submission..."
              className="w-full bg-gray-900 border border-gray-700 rounded-md text-xs text-gray-200 px-3 py-2 focus:outline-none focus:border-green-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={resetForm}
              className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!formProjectId || formSubmitting}
              className="text-xs bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-1.5 rounded-md transition-colors"
            >
              {formSubmitting ? 'Saving...' : 'Create Submission'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={12} className="text-gray-500" />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as PermitSubmissionStatus | '')}
          className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 px-2 py-1.5 focus:outline-none focus:border-green-500"
        >
          <option value="">All Statuses</option>
          {SUBMISSION_STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as SubmissionType | '')}
          className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 px-2 py-1.5 focus:outline-none focus:border-green-500"
        >
          <option value="">All Types</option>
          {SUBMISSION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          value={filterAhj}
          onChange={e => setFilterAhj(e.target.value)}
          placeholder="Filter by AHJ..."
          className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 px-2 py-1.5 focus:outline-none focus:border-green-500 w-40"
        />
        {(filterStatus || filterType || filterAhj) && (
          <button
            onClick={() => { setFilterStatus(''); setFilterType(''); setFilterAhj('') }}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Clear
          </button>
        )}
        <span className="text-[10px] text-gray-500 ml-auto">{filtered.length} submissions</span>
      </div>

      {/* Submissions list */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-600 text-sm py-8">
          {submissions.length === 0
            ? 'No permit submissions yet. Click "New Submission" to log one.'
            : 'No submissions match your filters.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(sub => {
            const badge = statusBadge(sub.status)
            const transitions = STATUS_TRANSITIONS[sub.status] ?? []
            return (
              <div
                key={sub.id}
                className="bg-gray-800/60 rounded-lg border border-gray-700/50 p-3 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: project + AHJ info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {typeIcon(sub.submission_type)}
                      <span className="text-xs font-medium text-white truncate">
                        {sub.project_id}
                      </span>
                      {sub.ahj_name && (
                        <>
                          <ChevronRight size={10} className="text-gray-600" />
                          <span className="text-xs text-gray-400 truncate">{sub.ahj_name}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', badge.color)}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {SUBMISSION_TYPES.find(t => t.value === sub.submission_type)?.label ?? sub.submission_type}
                      </span>
                      {sub.permit_number && (
                        <span className="text-[10px] text-gray-400">#{sub.permit_number}</span>
                      )}
                      <span className="text-[10px] text-gray-600">{relativeTime(sub.created_at)}</span>
                      {sub.submitted_at && sub.status !== 'draft' && (
                        <span className="text-[10px] text-gray-600">Submitted {relativeTime(sub.submitted_at)}</span>
                      )}
                      {sub.approved_at && (
                        <span className="text-[10px] text-green-600">Approved {relativeTime(sub.approved_at)}</span>
                      )}
                    </div>
                    {sub.rejection_reason && (
                      <div className="text-[10px] text-red-400 mt-1 bg-red-900/20 px-2 py-1 rounded">
                        Rejection: {sub.rejection_reason}
                      </div>
                    )}
                    {sub.notes && (
                      <div className="text-[10px] text-gray-500 mt-1 truncate max-w-md">{sub.notes}</div>
                    )}
                  </div>

                  {/* Right: workflow buttons */}
                  {transitions.length > 0 && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {transitions.map(next => {
                        const nextBadge = statusBadge(next)
                        return (
                          <button
                            key={next}
                            onClick={() => handleStatusChange(sub, next)}
                            className={cn(
                              'text-[10px] px-2 py-1 rounded font-medium transition-colors hover:brightness-125',
                              nextBadge.color
                            )}
                          >
                            {nextBadge.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
