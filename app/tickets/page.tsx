'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { fmtDate, cn } from '@/lib/utils'
import { loadProjectById, loadUsers, searchProjects } from '@/lib/api'
import {
  loadTickets, createTicket, updateTicket, updateTicketStatus,
  loadTicketComments, addTicketComment, loadTicketHistory, addTicketHistory,
  loadTicketCategories, loadResolutionCodes,
  getValidTransitions, getSLAStatus,
  TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_STATUS_COLORS,
  TICKET_PRIORITIES, TICKET_PRIORITY_COLORS,
  TICKET_CATEGORIES, TICKET_CATEGORY_COLORS, TICKET_SOURCES,
} from '@/lib/api/tickets'
import type { Ticket, TicketComment, TicketHistory, TicketCategory, TicketResolutionCode } from '@/lib/api/tickets'
import type { Project } from '@/types/database'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useRealtimeSubscription } from '@/lib/hooks'
import { Plus, Search, X, Send, Download, Pencil } from 'lucide-react'

// ── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function TicketsPage() {
  const { user, loading: authLoading } = useCurrentUser()
  const isManager = user?.isManager ?? false
  const userName = user?.name ?? null
  const { orgId } = useOrg()

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

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [page, setPage] = useState(1)

  // Expanded ticket state
  const [comments, setComments] = useState<TicketComment[]>([])
  const [history, setHistory] = useState<TicketHistory[]>([])
  const [newComment, setNewComment] = useState('')
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
  useEffect(() => { loadUsers('gomicrogridenergy.com').then(r => setUsers((r.data ?? []).map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {}) }, [])

  // Realtime — auto-refresh on ticket changes
  useRealtimeSubscription('tickets' as any, { onChange: loadAll, debounceMs: 500 })

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
    if (!createForm.title.trim()) return
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
      loadAll()
    }
  }, [createForm, orgId, userName, user, loadAll])

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
  }, [tickets, search, filterStatus, filterCategory, filterPriority, filterSLA, filterResolved, sortCol, sortAsc])

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
          {(filterStatus || filterCategory || filterPriority || search || filterSLA || filterResolved) && (
            <button onClick={() => { setFilterStatus(''); setFilterCategory(''); setFilterPriority(''); setSearch(''); setFilterSLA(false); setFilterResolved(false) }}
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
                  <th className="px-4 py-2 text-left font-medium">SLA</th>
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
                                    <div key={c.id} className={cn('rounded-lg p-2.5 text-xs', c.is_internal ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-gray-800')}>
                                      <div className="flex justify-between mb-1">
                                        <span className="text-white font-medium">{c.author}</span>
                                        <span className="text-gray-500 text-[10px]">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                                      </div>
                                      <p className="text-gray-300 whitespace-pre-wrap">{c.message.split(/(@[A-Z][a-z]+ [A-Z][a-z]+)/g).map((part, i) =>
                                        part.startsWith('@') ? <span key={i} className="text-green-400 font-medium">{part}</span> : <React.Fragment key={i}>{part}</React.Fragment>
                                      )}</p>
                                      {c.is_internal && <span className="text-[9px] text-amber-400 font-medium mt-1 block">INTERNAL NOTE</span>}
                                    </div>
                                  ))}
                                  <div className="flex gap-2 mt-2">
                                    <input value={newComment} onChange={e => setNewComment(e.target.value)}
                                      placeholder="Add a comment..."
                                      onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                                      className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
                                    <button onClick={handleAddComment} disabled={!newComment.trim()}
                                      className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded">
                                      <Send className="w-3 h-3" />
                                    </button>
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
                                  <div><span className="text-gray-500 block text-[10px]">First Response</span><span className="text-gray-300">{t.first_response_at ? fmtDate(t.first_response_at) : 'None'}</span></div>
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
              <button onClick={handleCreate} disabled={!createForm.title.trim()}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium rounded-md">
                Create Ticket
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
