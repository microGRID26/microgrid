'use client'

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { fmtDate, cn, INTERNAL_DOMAINS } from '@/lib/utils'
import { db } from '@/lib/db'
import { loadProjectById, loadUsers, searchProjects } from '@/lib/api'
import {
  loadTickets, createTicket, updateTicket, updateTicketStatus,
  loadTicketComments, addTicketComment, deleteTicketComment, loadDeletedComments, loadTicketHistory, addTicketHistory,
  loadTicketCategories, loadResolutionCodes,
  getValidTransitions, getSLAStatus,
  TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_STATUS_COLORS,
  TICKET_PRIORITIES, TICKET_PRIORITY_COLORS,
  TICKET_CATEGORIES, TICKET_CATEGORY_COLORS, TICKET_SOURCES,
} from '@/lib/api/tickets'
import type { Ticket, TicketComment, TicketHistory, TicketCategory, TicketResolutionCode } from '@/lib/api/tickets'
import type { Project } from '@/types/database'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { MentionNoteInput } from '@/components/project/MentionNoteInput'
import { useRealtimeSubscription } from '@/lib/hooks'
import { Plus, Search, X, Send, Download, Pencil } from 'lucide-react'

// ── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function TicketsPage() {
  return <Suspense fallback={<div className="min-h-screen bg-gray-950"><Nav active="Tickets" /></div>}><TicketsPageInner /></Suspense>
}

function TicketsPageInner() {
  const { user, loading: authLoading } = useCurrentUser()
  const isManager = user?.isManager ?? false
  const userName = user?.name ?? null
  const { orgId } = useOrg()
  const searchParams = useSearchParams()
  const assignedParam = searchParams.get('assigned')

  // Data
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [resolutionCodes, setResolutionCodes] = useState<TicketResolutionCode[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [sortCol, setSortCol] = useState<'created_at' | 'priority' | 'status' | 'category'>('created_at')
  const [sortAsc, setSortAsc] = useState(false)
  const [filterSLA, setFilterSLA] = useState(false)
  const [filterResolved, setFilterResolved] = useState(false)
  const [filterAssigned, setFilterAssigned] = useState(assignedParam ?? '')
  const [filterRepId, setFilterRepId] = useState('')
  const [repNames, setRepNames] = useState<Map<string, string>>(new Map())
  const [showAnalytics, setShowAnalytics] = useState(false)

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [page, setPage] = useState(1)

  // Expanded ticket state
  const [comments, setComments] = useState<TicketComment[]>([])
  const [history, setHistory] = useState<TicketHistory[]>([])
  const [newComment, setNewComment] = useState('')
  const [commentInternal, setCommentInternal] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const [deletedComments, setDeletedComments] = useState<any[]>([])
  const [detailTab, setDetailTab] = useState<'comments' | 'history' | 'details'>('comments')

  // Resolution modal
  const [resolveModal, setResolveModal] = useState<{ ticketId: string; targetStatus: string } | null>(null)
  const [resolveCategory, setResolveCategory] = useState('')
  const [resolveNotes, setResolveNotes] = useState('')

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<Ticket>>({})

  // Users for assignment dropdown
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])

  // Project panel
  const [panelProject, setPanelProject] = useState<Project | null>(null)

  // Create ticket state
  const [createForm, setCreateForm] = useState({
    title: '', description: '', category: 'service', subcategory: '',
    priority: 'normal', source: 'internal', project_id: '', assigned_to: '',
  })
  const [projectSearch, setProjectSearch] = useState('')
  const [projectResults, setProjectResults] = useState<{ id: string; name: string }[]>([])
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [tix, cats, codes] = await Promise.all([
      loadTickets({ orgId }),
      loadTicketCategories(),
      loadResolutionCodes(),
    ])
    setTickets(tix)
    setCategories(cats)
    setResolutionCodes(codes)
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { loadUsers(INTERNAL_DOMAINS).then(r => setUsers((r.data ?? []).map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {}) }, [])
  // Load sales rep names for the rep filter dropdown
  useEffect(() => {
    db().from('sales_reps').select('id, first_name, last_name').limit(500)
      .then(({ data }: any) => {
        if (data) setRepNames(new Map(data.map((r: any) => [r.id, `${r.first_name} ${r.last_name}`])))
      }).catch(() => {})
  }, [])

  // Realtime — auto-refresh on ticket and comment changes
  useRealtimeSubscription('tickets' as any, { onChange: loadAll, debounceMs: 500 })
  useRealtimeSubscription('ticket_comments' as any, {
    onChange: () => {
      loadAll()
      // Also refresh comments if a ticket is expanded
      if (expandedId) {
        loadTicketComments(expandedId).then(setComments)
      }
    },
    debounceMs: 500,
  })

  // Expand a ticket → load comments + history
  const expandTicket = useCallback(async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setDetailTab('comments')
    const [c, h] = await Promise.all([loadTicketComments(id), loadTicketHistory(id)])
    setComments(c)
    setHistory(h)
  }, [expandedId])

  // Create ticket
  const handleCreate = useCallback(async () => {
    if (!createForm.title.trim() || creating) return
    setCreating(true)
    const ticket = await createTicket({
      title: createForm.title.trim(),
      description: createForm.description.trim() || null,
      category: createForm.category,
      subcategory: createForm.subcategory || null,
      priority: createForm.priority,
      source: createForm.source,
      project_id: createForm.project_id || null,
      assigned_to: createForm.assigned_to || null,
      status: 'open',
      org_id: orgId,
      created_by: userName,
      created_by_id: user?.id,
    } as any)
    if (ticket) {
      setShowCreate(false)
      setCreateForm({ title: '', description: '', category: 'service', subcategory: '', priority: 'normal', source: 'internal', project_id: '', assigned_to: '' })
      setProjectSearch('')
      setProjectResults([])
      loadAll()
    }
    setCreating(false)
  }, [createForm, orgId, userName, user, creating, loadAll])

  // Status change — show resolution modal for 'resolved'
  const handleStatusChange = useCallback(async (ticketId: string, newStatus: string) => {
    if (newStatus === 'resolved') {
      setResolveModal({ ticketId, targetStatus: newStatus })
      setResolveCategory('')
      setResolveNotes('')
      return
    }
    await updateTicketStatus(ticketId, newStatus, userName ?? 'System', user?.id)
    loadAll()
    if (expandedId === ticketId) {
      const h = await loadTicketHistory(ticketId)
      setHistory(h)
    }
  }, [userName, user, loadAll, expandedId])

  const handleResolve = useCallback(async () => {
    if (!resolveModal) return
    await updateTicketStatus(resolveModal.ticketId, 'resolved', userName ?? 'System', user?.id, resolveCategory || undefined, resolveNotes || undefined)
    setResolveModal(null)
    loadAll()
    if (expandedId === resolveModal.ticketId) {
      const h = await loadTicketHistory(resolveModal.ticketId)
      setHistory(h)
    }
  }, [resolveModal, resolveCategory, resolveNotes, userName, user, loadAll, expandedId])

  // Edit ticket fields
  const startEdit = useCallback((t: Ticket) => {
    setEditingId(t.id)
    setEditDraft({ title: t.title, description: t.description, priority: t.priority, category: t.category, subcategory: t.subcategory, assigned_to: t.assigned_to, assigned_team: t.assigned_team })
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editingId || !user?.name) return
    // Fetch fresh ticket to avoid stale comparison
    const { loadTicket } = await import('@/lib/api/tickets')
    const ticket = await loadTicket(editingId)
    if (!ticket) return
    // Log changes to history
    const fields = ['title', 'priority', 'category', 'assigned_to', 'assigned_team'] as const
    for (const f of fields) {
      const oldVal = ticket[f] ?? null
      const newVal = editDraft[f as keyof typeof editDraft] as string | null ?? null
      if (oldVal !== newVal) {
        await addTicketHistory(editingId, f, oldVal, newVal, user.name, user.id)
      }
    }
    const ok = await updateTicket(editingId, editDraft)
    if (!ok) { alert('Failed to save changes'); return }
    setEditingId(null)
    loadAll()
  }, [editingId, editDraft, user, loadAll])

  // Add comment
  const handleAddComment = useCallback(async () => {
    if (!newComment.trim() || !expandedId) return
    await addTicketComment(expandedId, userName ?? 'Unknown', user?.id, newComment.trim())
    setNewComment('')
    const c = await loadTicketComments(expandedId)
    setComments(c)
  }, [newComment, expandedId, userName, user])

  // Filter + sort
  const filtered = useMemo(() => {
    let list = [...tickets]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.ticket_number.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.project_id ?? '').toLowerCase().includes(q) ||
        (t.assigned_to ?? '').toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
      )
    }
    if (filterStatus) list = list.filter(t => t.status === filterStatus)
    if (filterCategory) list = list.filter(t => t.category === filterCategory)
    if (filterPriority) list = list.filter(t => t.priority === filterPriority)
    if (filterSLA) list = list.filter(t => { const s = getSLAStatus(t); return !['resolved', 'closed'].includes(t.status) && (s.response === 'breached' || s.resolution === 'breached') })
    if (filterResolved) list = list.filter(t => t.resolved_at && t.resolved_at.slice(0, 10) === new Date().toISOString().slice(0, 10))
    if (filterAssigned) list = list.filter(t => t.assigned_to === filterAssigned)
    if (filterRepId) list = list.filter(t => t.sales_rep_id === filterRepId)

    list.sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'created_at': cmp = a.created_at.localeCompare(b.created_at); break
        case 'priority': {
          const order = { critical: 0, urgent: 1, high: 2, normal: 3, low: 4 }
          cmp = (order[a.priority as keyof typeof order] ?? 3) - (order[b.priority as keyof typeof order] ?? 3)
          break
        }
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'category': cmp = a.category.localeCompare(b.category); break
      }
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [tickets, search, filterStatus, filterCategory, filterPriority, filterRepId, filterSLA, filterResolved, filterAssigned, sortCol, sortAsc])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Stats
  const openCount = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length
  const escalatedCount = tickets.filter(t => t.status === 'escalated').length
  const criticalCount = tickets.filter(t => ['urgent', 'critical'].includes(t.priority) && !['resolved', 'closed'].includes(t.status)).length
  const resolvedToday = tickets.filter(t => t.resolved_at && t.resolved_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length
  const slaBreachedCount = tickets.filter(t => { const s = getSLAStatus(t); return !['resolved', 'closed'].includes(t.status) && (s.response === 'breached' || s.resolution === 'breached') }).length

  // Subcategories for selected category
  const subcategories = useMemo(() => {
    return categories.filter(c => c.category === createForm.category && c.subcategory)
  }, [categories, createForm.category])

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(col === 'priority') }
  }

  // CSV export
  const exportCSV = () => {
    const header = ['Ticket #', 'Title', 'Category', 'Subcategory', 'Priority', 'Status', 'Project', 'Assigned To', 'Created', 'Resolved', 'Resolution', 'SLA Response (hrs)', 'SLA Resolution (hrs)']
    const rows = filtered.map(t => [
      t.ticket_number, t.title, t.category, t.subcategory ?? '', t.priority, t.status,
      t.project_id ?? '', t.assigned_to ?? '', t.created_at.slice(0, 10),
      t.resolved_at?.slice(0, 10) ?? '', t.resolution_category ?? '',
      t.sla_response_hours, t.sla_resolution_hours,
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  // Open project panel
  const openProject = async (projectId: string) => {
    const p = await loadProjectById(projectId)
    if (p) setPanelProject(p)
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950"><Nav active="Tickets" /></div>
  if (!isManager) return <div className="min-h-screen bg-gray-950"><Nav active="Tickets" /><div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Not authorized. Manager+ required.</div></div>

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Nav active="Tickets" />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Tickets</h1>
            <p className="text-xs text-gray-500 mt-1">Track issues, complaints, and requests tied to projects</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-md">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-md">
              <Plus className="w-3.5 h-3.5" /> New Ticket
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className={cn('bg-gray-800 rounded-lg p-3 cursor-pointer border', filterStatus === '' && !filterPriority ? 'border-green-500/50' : 'border-transparent hover:border-gray-600')} onClick={() => { setFilterStatus(''); setFilterPriority('') }}>
            <div className="text-xs text-gray-400">Total Open</div>
            <div className="text-2xl font-bold text-white mt-1">{openCount}</div>
          </div>
          <div className={cn('bg-gray-800 rounded-lg p-3 cursor-pointer border', filterStatus === 'escalated' ? 'border-red-500/50' : 'border-transparent hover:border-gray-600')} onClick={() => setFilterStatus(filterStatus === 'escalated' ? '' : 'escalated')}>
            <div className="text-xs text-gray-400">Escalated</div>
            <div className={cn('text-2xl font-bold mt-1', escalatedCount > 0 ? 'text-red-400' : 'text-white')}>{escalatedCount}</div>
          </div>
          <div className={cn('bg-gray-800 rounded-lg p-3 cursor-pointer border', filterPriority === 'urgent' ? 'border-amber-500/50' : 'border-transparent hover:border-gray-600')} onClick={() => setFilterPriority(filterPriority ? '' : 'urgent')}>
            <div className="text-xs text-gray-400">Critical / Urgent</div>
            <div className={cn('text-2xl font-bold mt-1', criticalCount > 0 ? 'text-amber-400' : 'text-white')}>{criticalCount}</div>
          </div>
          <div className={cn('bg-gray-800 rounded-lg p-3 cursor-pointer border', filterSLA ? 'border-red-500/50' : 'border-transparent hover:border-gray-600')} onClick={() => setFilterSLA(!filterSLA)}>
            <div className="text-xs text-gray-400">SLA Breached</div>
            <div className={cn('text-2xl font-bold mt-1', slaBreachedCount > 0 ? 'text-red-400' : 'text-white')}>{slaBreachedCount}</div>
          </div>
          <div className={cn('bg-gray-800 rounded-lg p-3 cursor-pointer border', filterResolved ? 'border-green-500/50' : 'border-transparent hover:border-gray-600')} onClick={() => setFilterResolved(!filterResolved)}>
            <div className="text-xs text-gray-400">Resolved Today</div>
            <div className="text-2xl font-bold text-green-400 mt-1">{resolvedToday}</div>
          </div>
        </div>

        {/* SLA Legend */}
        <div className="flex items-center gap-6 bg-gray-800/50 rounded-lg px-4 py-2">
          <span className="text-[10px] text-gray-500 uppercase font-medium tracking-wider">SLA Key:</span>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /><span className="w-2.5 h-2.5 rounded-full bg-green-500" /></div>
              <span className="text-[10px] text-gray-400">On Track</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span className="w-2.5 h-2.5 rounded-full bg-green-500" /></div>
              <span className="text-[10px] text-gray-400">Response Near Target</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className="w-2.5 h-2.5 rounded-full bg-red-500" /></div>
              <span className="text-[10px] text-gray-400">Both Breached</span>
            </div>
          </div>
          <span className="text-[10px] text-gray-600 ml-auto">Left dot = Response &middot; Right dot = Resolution</span>
        </div>

        {/* Analytics Toggle + Panel */}
        <div className="flex justify-end">
          <button onClick={() => setShowAnalytics(!showAnalytics)}
            className="text-[10px] text-gray-400 hover:text-white">
            {showAnalytics ? 'Hide Analytics' : 'Show Analytics'}
          </button>
        </div>
        {showAnalytics && (() => {
          const resolved = tickets.filter(t => t.status === 'resolved' || t.status === 'closed')
          const avgResponseHrs = resolved.filter(t => t.first_response_at).length > 0
            ? resolved.filter(t => t.first_response_at).reduce((sum, t) => sum + (new Date(t.first_response_at!).getTime() - new Date(t.created_at).getTime()) / 3600000, 0) / resolved.filter(t => t.first_response_at).length
            : 0
          const avgResolutionHrs = resolved.filter(t => t.resolved_at).length > 0
            ? resolved.filter(t => t.resolved_at).reduce((sum, t) => sum + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 3600000, 0) / resolved.filter(t => t.resolved_at).length
            : 0

          // By category
          const byCat = new Map<string, { total: number; open: number; resolved: number }>()
          for (const t of tickets) {
            const c = byCat.get(t.category) ?? { total: 0, open: 0, resolved: 0 }
            c.total++
            if (['resolved', 'closed'].includes(t.status)) c.resolved++
            else c.open++
            byCat.set(t.category, c)
          }

          // By resolution
          const byRes = new Map<string, number>()
          for (const t of resolved) {
            if (t.resolution_category) byRes.set(t.resolution_category, (byRes.get(t.resolution_category) ?? 0) + 1)
          }

          // By assignee
          const byAssignee = new Map<string, { total: number; open: number }>()
          for (const t of tickets) {
            const name = t.assigned_to ?? 'Unassigned'
            const a = byAssignee.get(name) ?? { total: 0, open: 0 }
            a.total++
            if (!['resolved', 'closed'].includes(t.status)) a.open++
            byAssignee.set(name, a)
          }

          return (
            <div className="bg-gray-800 rounded-lg p-4 space-y-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ticket Analytics</h3>

              {/* KPI Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-gray-500 uppercase">Avg Response Time</div>
                  <div className="text-lg font-bold text-blue-400">{avgResponseHrs > 0 ? (avgResponseHrs >= 24 ? `${(avgResponseHrs / 24).toFixed(1)}d` : `${Math.round(avgResponseHrs)}h`) : '\u2014'}</div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-gray-500 uppercase">Avg Resolution Time</div>
                  <div className="text-lg font-bold text-green-400">{avgResolutionHrs > 0 ? (avgResolutionHrs >= 24 ? `${(avgResolutionHrs / 24).toFixed(1)}d` : `${Math.round(avgResolutionHrs)}h`) : '\u2014'}</div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-gray-500 uppercase">Resolution Rate</div>
                  <div className="text-lg font-bold text-emerald-400">{tickets.length > 0 ? `${Math.round(resolved.length / tickets.length * 100)}%` : '\u2014'}</div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-gray-500 uppercase">SLA Compliance</div>
                  <div className="text-lg font-bold text-amber-400">
                    {(() => {
                      const checked = tickets.filter(t => t.first_response_at)
                      if (checked.length === 0) return '\u2014'
                      const compliant = checked.filter(t => {
                        const hrs = (new Date(t.first_response_at!).getTime() - new Date(t.created_at).getTime()) / 3600000
                        return hrs <= t.sla_response_hours
                      })
                      return `${Math.round(compliant.length / checked.length * 100)}%`
                    })()}
                  </div>
                </div>
              </div>

              {/* By Category + By Resolution + By Assignee */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">By Category</div>
                  <div className="space-y-1">
                    {[...byCat.entries()].sort((a, b) => b[1].total - a[1].total).map(([cat, v]) => (
                      <div key={cat} className="flex items-center justify-between text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TICKET_CATEGORY_COLORS[cat] ?? 'bg-gray-700 text-gray-400'}`}>{cat}</span>
                        <span className="text-gray-300">{v.open} open / {v.resolved} resolved</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">Top Resolutions</div>
                  <div className="space-y-1">
                    {[...byRes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, count]) => (
                      <div key={code} className="flex items-center justify-between text-xs">
                        <span className="text-gray-300 capitalize">{code.replace(/_/g, ' ')}</span>
                        <span className="text-gray-400">{count}</span>
                      </div>
                    ))}
                    {byRes.size === 0 && <span className="text-gray-500 text-[10px]">No resolutions yet</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">By Assignee</div>
                  <div className="space-y-1">
                    {[...byAssignee.entries()].sort((a, b) => b[1].open - a[1].open).slice(0, 6).map(([name, v]) => (
                      <div key={name} className="flex items-center justify-between text-xs">
                        <span className="text-gray-300">{name}</span>
                        <span className={v.open > 0 ? 'text-amber-400' : 'text-gray-400'}>{v.open} open</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search ticket #, title, project..."
              className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
          </div>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white">
            <option value="">All Statuses</option>
            {TICKET_STATUSES.map(s => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}
          </select>
          <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1) }}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white">
            <option value="">All Categories</option>
            {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
          <select value={filterPriority} onChange={e => { setFilterPriority(e.target.value); setPage(1) }}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white">
            <option value="">All Priorities</option>
            {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
          {/* Sales rep filter — shows reps with tickets */}
          {(() => {
            const repIds = [...new Set(tickets.filter(t => t.sales_rep_id).map(t => t.sales_rep_id!))]
            return repIds.length > 0 ? (
              <select value={filterRepId} onChange={e => { setFilterRepId(e.target.value); setPage(1) }}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white">
                <option value="">All Reps</option>
                {repIds.sort((a, b) => (repNames.get(a) ?? a).localeCompare(repNames.get(b) ?? b))
                  .map(id => <option key={id} value={id}>{repNames.get(id) ?? id.slice(0, 8)}</option>)}
              </select>
            ) : null
          })()}
          {(filterStatus || filterCategory || filterPriority || filterRepId || search || filterSLA || filterResolved || filterAssigned) && (
            <button onClick={() => { setFilterStatus(''); setFilterCategory(''); setFilterPriority(''); setSearch(''); setFilterSLA(false); setFilterResolved(false); setFilterAssigned('') }}
              className="text-xs text-gray-400 hover:text-white">Clear All</button>
          )}
        </div>

        {/* Category breakdown bar */}
        {tickets.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {TICKET_CATEGORIES.map(cat => {
              const count = tickets.filter(t => t.category === cat && !['resolved', 'closed'].includes(t.status)).length
              if (count === 0) return null
              return (
                <button key={cat} onClick={() => setFilterCategory(filterCategory === cat ? '' : cat)}
                  className={cn('px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                    filterCategory === cat ? TICKET_CATEGORY_COLORS[cat] + ' ring-1 ring-white/20' : TICKET_CATEGORY_COLORS[cat] + ' opacity-70 hover:opacity-100')}>
                  {cat} ({count})
                </button>
              )
            })}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-16 text-gray-500">Loading tickets...</div>
        ) : (
          <div className="bg-gray-800/50 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="px-4 py-2 text-left font-medium cursor-pointer hover:text-white" onClick={() => handleSort('created_at')}>
                    Ticket # {sortCol === 'created_at' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Title</th>
                  <th className="px-4 py-2 text-left font-medium cursor-pointer hover:text-white" onClick={() => handleSort('category')}>
                    Category {sortCol === 'category' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium cursor-pointer hover:text-white" onClick={() => handleSort('priority')}>
                    Priority {sortCol === 'priority' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium cursor-pointer hover:text-white" onClick={() => handleSort('status')}>
                    Status {sortCol === 'status' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Project</th>
                  <th className="px-4 py-2 text-left font-medium">Assigned</th>
                  <th className="px-4 py-2 text-left font-medium" title="Left dot = Response SLA, Right dot = Resolution SLA">SLA</th>
                  <th className="px-4 py-2 text-left font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(t => {
                  const isExpanded = expandedId === t.id
                  const sla = getSLAStatus(t)
                  const ageHours = Math.round((Date.now() - new Date(t.created_at).getTime()) / 3600000)
                  const ageDays = Math.floor(ageHours / 24)
                  const ageStr = ageDays > 0 ? `${ageDays}d` : `${ageHours}h`

                  return (
                    <React.Fragment key={t.id}>
                      <tr className={cn('border-b border-gray-700/50 hover:bg-gray-750 cursor-pointer transition-colors', isExpanded && 'bg-gray-750')}
                        onClick={() => expandTicket(t.id)}>
                        <td className="px-4 py-2.5">
                          <span className="text-blue-400 font-mono font-medium">{t.ticket_number}</span>
                        </td>
                        <td className="px-4 py-2.5 text-white font-medium max-w-[250px] truncate">{t.title}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', TICKET_CATEGORY_COLORS[t.category])}>
                            {t.category}
                          </span>
                          {t.subcategory && <span className="text-gray-500 text-[10px] ml-1">{t.subcategory.replace(/_/g, ' ')}</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', TICKET_PRIORITY_COLORS[t.priority])}>
                            {t.priority}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', TICKET_STATUS_COLORS[t.status])}>
                            {TICKET_STATUS_LABELS[t.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {t.project_id ? (
                            <button onClick={e => { e.stopPropagation(); openProject(t.project_id!) }} className="text-green-400 hover:text-green-300 font-mono text-[11px]">
                              {t.project_id}
                            </button>
                          ) : <span className="text-gray-600">&mdash;</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-300 truncate max-w-[100px]">{t.assigned_to ?? <span className="text-gray-600">&mdash;</span>}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1" title={`Response: ${sla.response} (${t.sla_response_hours}h target)\nResolution: ${sla.resolution} (${t.sla_resolution_hours}h target)`}>
                            <span className={cn('w-2.5 h-2.5 rounded-full', sla.response === 'ok' ? 'bg-green-500' : sla.response === 'warning' ? 'bg-amber-500' : 'bg-red-500')} />
                            <span className={cn('w-2.5 h-2.5 rounded-full', sla.resolution === 'ok' ? 'bg-green-500' : sla.resolution === 'warning' ? 'bg-amber-500' : 'bg-red-500')} />
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-400">{ageStr}</td>
                      </tr>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="px-4 py-4 bg-gray-900/50 border-b border-gray-700">
                            <div className="space-y-4">
                              {/* Description */}
                              {t.description && (
                                <div className="bg-gray-800 rounded-lg p-3">
                                  <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">Description</div>
                                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{t.description}</p>
                                </div>
                              )}

                              {/* Quick info row */}
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                                <div><span className="text-gray-500 block text-[10px]">Source</span><span className="text-gray-300 capitalize">{t.source?.replace(/_/g, ' ') ?? '\u2014'}</span></div>
                                <div><span className="text-gray-500 block text-[10px]">Reported By</span><span className="text-gray-300">{t.reported_by ?? t.created_by ?? '\u2014'}</span></div>
                                <div><span className="text-gray-500 block text-[10px]">Created</span><span className="text-gray-300">{fmtDate(t.created_at)}</span></div>
                                <div><span className="text-gray-500 block text-[10px]">SLA Response</span><span className={cn(sla.response === 'breached' ? 'text-red-400 font-medium' : 'text-gray-300')}>{t.sla_response_hours}h target</span></div>
                                <div><span className="text-gray-500 block text-[10px]">SLA Resolution</span><span className={cn(sla.resolution === 'breached' ? 'text-red-400 font-medium' : 'text-gray-300')}>{t.sla_resolution_hours}h target</span></div>
                              </div>

                              {/* Resolution info */}
                              {t.resolution_category && (
                                <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3">
                                  <div className="text-[10px] text-green-400 uppercase font-medium mb-1">Resolution</div>
                                  <span className="text-xs text-green-300 capitalize">{t.resolution_category.replace(/_/g, ' ')}</span>
                                  {t.resolution_notes && <p className="text-xs text-gray-400 mt-1">{t.resolution_notes}</p>}
                                </div>
                              )}

                              {/* Status actions + edit */}
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] text-gray-500 uppercase font-medium mr-1">Actions:</span>
                                {getValidTransitions(t.status).map(s => (
                                  <button key={s} onClick={() => handleStatusChange(t.id, s)}
                                    className={cn('px-2.5 py-1 rounded text-[11px] font-medium transition-colors', TICKET_STATUS_COLORS[s], 'hover:opacity-80')}>
                                    → {TICKET_STATUS_LABELS[s]}
                                  </button>
                                ))}
                                <button onClick={() => startEdit(t)} className="px-2.5 py-1 rounded text-[11px] font-medium bg-gray-700 text-gray-300 hover:text-white ml-auto">
                                  <Pencil className="w-3 h-3 inline mr-1" />Edit
                                </button>
                              </div>

                              {/* Inline edit form */}
                              {editingId === t.id && (
                                <div className="bg-gray-800 rounded-lg p-3 space-y-2" onClick={e => e.stopPropagation()}>
                                  <div className="text-[10px] text-gray-500 uppercase font-medium">Edit Ticket</div>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                                    <div className="col-span-full">
                                      <label className="text-[10px] text-gray-500">Title</label>
                                      <input value={editDraft.title ?? ''} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white" />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-gray-500">Priority</label>
                                      <select value={editDraft.priority ?? ''} onChange={e => setEditDraft(d => ({ ...d, priority: e.target.value }))}
                                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white">
                                        {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-gray-500">Category</label>
                                      <select value={editDraft.category ?? ''} onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))}
                                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white">
                                        {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-gray-500">Assigned To</label>
                                      <select value={editDraft.assigned_to ?? ''} onChange={e => setEditDraft(d => ({ ...d, assigned_to: e.target.value }))}
                                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white">
                                        <option value="">Unassigned</option>
                                        {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button onClick={saveEdit} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-[10px] text-white font-medium">Save</button>
                                    <button onClick={() => setEditingId(null)} className="px-3 py-1 text-gray-400 hover:text-white text-[10px]">Cancel</button>
                                  </div>
                                </div>
                              )}

                              {/* Tab bar */}
                              <div className="flex gap-4 border-b border-gray-700 pb-0">
                                {(['comments', 'history', 'details'] as const).map(tab => (
                                  <button key={tab} onClick={() => setDetailTab(tab)}
                                    className={cn('text-xs pb-2 border-b-2 transition-colors capitalize',
                                      detailTab === tab ? 'text-white border-green-500' : 'text-gray-500 border-transparent hover:text-gray-300')}>
                                    {tab === 'comments' ? `Comments (${comments.length})` : tab === 'history' ? `History (${history.length})` : 'Details'}
                                  </button>
                                ))}
                              </div>

                              {/* Comments */}
                              {detailTab === 'comments' && (
                                <div className="space-y-2">
                                  {comments.length === 0 && <p className="text-[11px] text-gray-500">No comments yet.</p>}
                                  {comments.map(c => (
                                    <div key={c.id} className={cn('rounded-lg p-2.5 text-xs group relative', c.is_internal ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-gray-800')}>
                                      <div className="flex justify-between mb-1">
                                        <span className="text-white font-medium">{c.author}</span>
                                        <div className="flex items-center gap-2">
                                          <span className="text-gray-500 text-[10px]">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                                          {user?.isSuperAdmin && (
                                            <button
                                              onClick={async () => {
                                                if (!confirm('Delete this comment? It will be hidden but preserved in audit history.')) return
                                                await deleteTicketComment(c.id, userName ?? 'Admin')
                                                const updated = await loadTicketComments(t.id)
                                                setComments(updated)
                                              }}
                                              className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all">
                                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      {(c as any).image_url && (
                                        <a href={(c as any).image_url} target="_blank" rel="noopener noreferrer">
                                          <img src={(c as any).image_url} alt="Attachment" className="max-w-[200px] rounded-lg mt-1 mb-1 cursor-pointer hover:opacity-80" />
                                        </a>
                                      )}
                                      {!(c as any).image_url && (
                                        <p className="text-gray-300 whitespace-pre-wrap">{c.message.split(/(@[A-Z][a-z]+ [A-Z][a-z]+)/g).map((part, i) =>
                                          part.startsWith('@') ? <span key={i} className="text-green-400 font-medium">{part}</span> : <React.Fragment key={i}>{part}</React.Fragment>
                                        )}</p>
                                      )}
                                      {c.is_internal && <span className="text-[9px] text-amber-400 font-medium mt-1 block">INTERNAL NOTE — not visible to customer</span>}
                                    </div>
                                  ))}
                                  <div className="mt-2">
                                    <div className="flex gap-2 items-end">
                                      <div className="flex-1">
                                        <MentionNoteInput
                                          compact
                                          placeholder={commentInternal ? "Internal note (hidden from customer)..." : "Reply to customer... Type @ to mention someone"}
                                          projectId={t.project_id ?? ''}
                                          currentUserName={userName ?? 'Unknown'}
                                          onSubmit={async (text) => {
                                            await addTicketComment(t.id, userName ?? 'Unknown', user?.id, text, commentInternal)
                                            const c = await loadTicketComments(t.id)
                                            setComments(c)
                                          }}
                                        />
                                      </div>
                                      <label className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400 hover:text-white cursor-pointer transition-colors mb-[1px]">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                        Photo
                                        <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                          const file = e.target.files?.[0]
                                          if (!file) return
                                          const fileName = `${t.id}/${Date.now()}.${file.name.split('.').pop() ?? 'jpg'}`
                                          const supabaseClient = (await import('@/lib/supabase/client')).createClient()
                                          const { error: uploadErr } = await supabaseClient.storage
                                            .from('ticket-attachments')
                                            .upload(fileName, file, { contentType: file.type })
                                          if (uploadErr) { console.error('[upload]', uploadErr); return }
                                          const { data: urlData } = supabaseClient.storage
                                            .from('ticket-attachments')
                                            .getPublicUrl(fileName)
                                          await addTicketComment(t.id, userName ?? 'Unknown', user?.id, '📷 Photo', commentInternal, urlData.publicUrl)
                                          const c = await loadTicketComments(t.id)
                                          setComments(c)
                                          e.target.value = ''
                                        }} />
                                      </label>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1.5">
                                      <button
                                        onClick={() => setCommentInternal(!commentInternal)}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                          commentInternal
                                            ? 'bg-amber-900/30 text-amber-400 border border-amber-700/50'
                                            : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                                        }`}>
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={commentInternal ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z"} />
                                          {!commentInternal && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />}
                                        </svg>
                                        {commentInternal ? 'Internal (hidden from customer)' : 'Visible to customer'}
                                      </button>
                                      {user?.isAdmin && (
                                        <button
                                          onClick={async () => {
                                            if (showDeleted) {
                                              setShowDeleted(false)
                                              setDeletedComments([])
                                            } else {
                                              const del = await loadDeletedComments(t.id)
                                              setDeletedComments(del)
                                              setShowDeleted(true)
                                            }
                                          }}
                                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            showDeleted
                                              ? 'bg-red-900/30 text-red-400 border border-red-700/50'
                                              : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                                          }`}>
                                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                          {showDeleted ? 'Hide audit history' : 'Show deleted'}
                                        </button>
                                      )}
                                    </div>
                                    {/* Deleted comments audit trail */}
                                    {showDeleted && deletedComments.length > 0 && (
                                      <div className="mt-3 pt-3 border-t border-red-800/30">
                                        <p className="text-[10px] text-red-400 font-medium uppercase tracking-wider mb-2">Deleted Comments (Audit Trail)</p>
                                        <div className="space-y-2">
                                          {deletedComments.map((c: any) => (
                                            <div key={c.id} className="rounded-lg p-2.5 text-xs bg-red-900/10 border border-red-800/20 opacity-70">
                                              <div className="flex justify-between mb-1">
                                                <span className="text-gray-400 font-medium">{c.author}</span>
                                                <span className="text-gray-600 text-[10px]">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                                              </div>
                                              <p className="text-gray-500 whitespace-pre-wrap line-through">{c.message}</p>
                                              <span className="text-[9px] text-red-400 mt-1 block">
                                                Deleted by {c.deleted_by} on {new Date(c.deleted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {showDeleted && deletedComments.length === 0 && (
                                      <p className="mt-2 text-[10px] text-gray-600">No deleted comments for this ticket.</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* History */}
                              {detailTab === 'history' && (
                                <div className="space-y-1">
                                  {history.length === 0 && <p className="text-[11px] text-gray-500">No history yet.</p>}
                                  {history.map(h => (
                                    <div key={h.id} className="flex items-center gap-3 text-[11px] py-1.5 border-b border-gray-800/50">
                                      <span className="text-gray-500 w-24 flex-shrink-0">{fmtDate(h.created_at)}</span>
                                      <span className="text-gray-400">{h.changed_by}</span>
                                      <span className="text-gray-500">changed</span>
                                      <span className="text-white font-medium">{h.field}</span>
                                      {h.old_value && <><span className="text-gray-500">from</span><span className="text-red-400">{h.old_value}</span></>}
                                      <span className="text-gray-500">to</span>
                                      <span className="text-green-400">{h.new_value}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Details */}
                              {detailTab === 'details' && (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                                  <div><span className="text-gray-500 block text-[10px]">Ticket #</span><span className="text-gray-300 font-mono">{t.ticket_number}</span></div>
                                  <div><span className="text-gray-500 block text-[10px]">Category</span><span className="text-gray-300 capitalize">{t.category}</span></div>
                                  <div><span className="text-gray-500 block text-[10px]">Subcategory</span><span className="text-gray-300 capitalize">{t.subcategory?.replace(/_/g, ' ') ?? '\u2014'}</span></div>
                                  <div><span className="text-gray-500 block text-[10px]">Assigned Team</span><span className="text-gray-300">{t.assigned_team ?? '\u2014'}</span></div>
                                  <div><span className="text-gray-500 block text-[10px]">First Response</span><span className="text-gray-300">{t.first_response_at ? fmtDate(t.first_response_at) : '—'}</span></div>
                                  <div><span className="text-gray-500 block text-[10px]">Resolved</span><span className="text-gray-300">{t.resolved_at ? fmtDate(t.resolved_at) : 'Open'}</span></div>
                                  {t.tags && t.tags.length > 0 && (
                                    <div className="col-span-full">
                                      <span className="text-gray-500 block text-[10px] mb-1">Tags</span>
                                      <div className="flex gap-1">{t.tags.map(tag => <span key={tag} className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-[10px]">{tag}</span>)}</div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {paginated.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                    {tickets.length === 0 ? 'No tickets yet. Click "New Ticket" to create one.' : 'No tickets match your filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <Pagination currentPage={page} totalCount={filtered.length} pageSize={PAGE_SIZE} hasMore={page < totalPages}
            onPrevPage={() => setPage(p => Math.max(1, p - 1))} onNextPage={() => setPage(p => Math.min(totalPages, p + 1))} />
        )}
      </div>

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">New Ticket</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Title *</label>
                <input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Brief description of the issue"
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Description</label>
                <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Full details..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white resize-none focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Category</label>
                  <select value={createForm.category} onChange={e => setCreateForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                    {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Subcategory</label>
                  <select value={createForm.subcategory} onChange={e => setCreateForm(f => ({ ...f, subcategory: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                    <option value="">-- General --</option>
                    {subcategories.map(c => <option key={c.id} value={c.subcategory!}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Priority</label>
                  <select value={createForm.priority} onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                    {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Source</label>
                  <select value={createForm.source} onChange={e => setCreateForm(f => ({ ...f, source: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                    {TICKET_SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Project (search by name or ID)</label>
                <div className="relative">
                  <input value={projectSearch || createForm.project_id}
                    onChange={async e => {
                      const v = e.target.value
                      setProjectSearch(v)
                      setCreateForm(f => ({ ...f, project_id: '' }))
                      if (v.length >= 2) {
                        const results = await searchProjects(v)
                        setProjectResults(results.slice(0, 8))
                        setShowProjectDropdown(true)
                      } else {
                        setShowProjectDropdown(false)
                      }
                    }}
                    onFocus={() => projectResults.length > 0 && setShowProjectDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProjectDropdown(false), 200)}
                    placeholder="Search project name or PROJ-XXXXX..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
                  {showProjectDropdown && projectResults.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-xl max-h-48 overflow-y-auto">
                      {projectResults.map(p => (
                        <button key={p.id} onClick={() => { setCreateForm(f => ({ ...f, project_id: p.id })); setProjectSearch(`${p.name} (${p.id})`); setShowProjectDropdown(false) }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition-colors">
                          <span className="text-green-400 font-mono">{p.id}</span>
                          <span className="text-gray-300 ml-2">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Assign To</label>
                <select value={createForm.assigned_to} onChange={e => setCreateForm(f => ({ ...f, assigned_to: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleCreate} disabled={creating || !createForm.title.trim()}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium rounded-md">
                {creating ? 'Creating...' : 'Create Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Modal */}
      {resolveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setResolveModal(null)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Resolve Ticket</h2>
              <button onClick={() => setResolveModal(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Resolution Category *</label>
                <select value={resolveCategory} onChange={e => setResolveCategory(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                  <option value="">Select resolution...</option>
                  {resolutionCodes.map(r => <option key={r.id} value={r.code}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Resolution Notes</label>
                <textarea value={resolveNotes} onChange={e => setResolveNotes(e.target.value)}
                  rows={3} placeholder="Describe what was done to resolve this ticket..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white resize-none focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setResolveModal(null)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleResolve} disabled={!resolveCategory}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium rounded-md">
                Resolve Ticket
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Panel */}
      {panelProject && (
        <ProjectPanel
          project={panelProject}
          onClose={() => setPanelProject(null)}
          onProjectUpdated={() => {}}
        />
      )}
    </div>
  )
}
