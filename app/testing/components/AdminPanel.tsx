'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { db } from '@/lib/db'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { isInternalEmail } from '@/lib/utils'
import {
  ClipboardCheck, CheckCircle2, XCircle, Ban, SkipForward,
  MessageSquare, Users, BarChart3, Loader2, Filter,
  ChevronDown, ChevronUp, Clock, AlertTriangle, RotateCcw, Send,
  UserPlus, X, Shield,
} from 'lucide-react'
import type { TestPlan, TestCase, TestResult, TestAssignment, TestComment } from '../types'

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  active: boolean
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pass:    { label: 'Pass',    color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  fail:    { label: 'Fail',    color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20' },
  blocked: { label: 'Blocked', color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
  skipped: { label: 'Skipped', color: 'text-gray-500',    bg: 'bg-gray-700 border-gray-600' },
  pending: { label: 'Pending', color: 'text-gray-500',    bg: 'bg-gray-700 border-gray-600' },
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function relativeTime(dateStr: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

export function AdminPanel() {
  const { user: currentUser } = useCurrentUser()
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<TestPlan[]>([])
  const [cases, setCases] = useState<TestCase[]>([])
  const [results, setResults] = useState<TestResult[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [allAssignments, setAllAssignments] = useState<TestAssignment[]>([])

  // Filters
  const [filterTester, setFilterTester] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPlan, setFilterPlan] = useState('all')

  // Assignment modal
  const [assignModalUser, setAssignModalUser] = useState<string | null>(null)
  const [assignChecked, setAssignChecked] = useState<Set<string>>(new Set())
  const [assignSaving, setAssignSaving] = useState(false)

  // Re-test
  const [retestingId, setRetestingId] = useState<string | null>(null)
  const [retestNote, setRetestNote] = useState('')
  const [retestSaving, setRetestSaving] = useState(false)

  // Comments
  const [feedbackComments, setFeedbackComments] = useState<Map<string, TestComment[]>>(new Map())
  const [replyText, setReplyText] = useState<Map<string, string>>(new Map())
  const [replySaving, setReplySaving] = useState<string | null>(null)
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set())

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [plansRes, casesRes, resultsRes, usersRes, assignRes, commentsRes] = await Promise.all([
        db().from('test_plans').select('id, name, role_filter').order('sort_order'),
        db().from('test_cases').select('id, plan_id, title, priority').order('sort_order'),
        db().from('test_results').select('*').order('tested_at', { ascending: false }),
        db().from('users').select('id, name, email, role, active').eq('active', true).order('name'),
        db().from('test_assignments').select('test_case_id, tester_id'),
        db().from('test_comments').select('id, test_result_id, author_id, body, created_at, author:users!test_comments_author_id_fkey ( name )').order('created_at', { ascending: true }),
      ])
      setPlans((plansRes.data ?? []) as TestPlan[])
      setCases((casesRes.data ?? []) as TestCase[])
      setResults((resultsRes.data ?? []) as TestResult[])
      setUsers(((usersRes.data ?? []) as UserRow[]).filter(u => isInternalEmail(u.email)))
      setAllAssignments((assignRes.data ?? []) as TestAssignment[])

      const cMap = new Map<string, TestComment[]>()
      for (const row of (commentsRes.data ?? []) as Record<string, unknown>[]) {
        const author = row.author as { name: string } | null
        const comment: TestComment = {
          id: row.id as string,
          test_result_id: row.test_result_id as string,
          author_id: row.author_id as string,
          body: row.body as string,
          created_at: row.created_at as string,
          author_name: author?.name ?? 'Unknown',
        }
        const arr = cMap.get(comment.test_result_id) ?? []
        arr.push(comment)
        cMap.set(comment.test_result_id, arr)
      }
      setFeedbackComments(cMap)
    } catch (err) {
      console.error('Admin testing load error:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Derived data
  const caseMap = useMemo(() => {
    const m = new Map<string, TestCase>()
    cases.forEach(c => m.set(c.id, c))
    return m
  }, [cases])

  const planMap = useMemo(() => {
    const m = new Map<string, TestPlan>()
    plans.forEach(p => m.set(p.id, p))
    return m
  }, [plans])

  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>()
    users.forEach(u => m.set(u.id, u))
    return m
  }, [users])

  // KPIs
  const kpis = useMemo(() => {
    const totalCases = cases.length
    const tested = results.filter(r => r.status !== 'pending').length
    const passed = results.filter(r => r.status === 'pass').length
    const failed = results.filter(r => r.status === 'fail').length
    const passRate = tested > 0 ? Math.round((passed / tested) * 100) : 0
    const feedbackCount = results.filter(r => r.feedback?.trim()).length
    return { totalCases, tested, passed, failed, passRate, feedbackCount }
  }, [cases, results])

  // Per-tester breakdown
  const testerRows = useMemo(() => {
    const byTester = new Map<string, TestResult[]>()
    results.forEach(r => {
      const arr = byTester.get(r.tester_id) ?? []
      arr.push(r)
      byTester.set(r.tester_id, arr)
    })
    return Array.from(byTester.entries()).map(([testerId, testerResults]) => {
      const u = userMap.get(testerId)
      const completed = testerResults.filter(r => r.status !== 'pending').length
      const pass = testerResults.filter(r => r.status === 'pass').length
      const fail = testerResults.filter(r => r.status === 'fail').length
      const blocked = testerResults.filter(r => r.status === 'blocked').length
      const pct = cases.length > 0 ? Math.round((completed / cases.length) * 100) : 0
      const lastActivity = testerResults.reduce((latest, r) => {
        const d = r.tested_at || ''
        return d > latest ? d : latest
      }, '')
      return { testerId, name: u?.name ?? 'Unknown', role: u?.role ?? '', completed, pass, fail, blocked, pct, lastActivity }
    }).sort((a, b) => b.pct - a.pct)
  }, [results, userMap, cases.length])

  const testersWithResults = useMemo(() => {
    const ids = new Set(results.map(r => r.tester_id))
    return users.filter(u => ids.has(u.id))
  }, [results, users])

  // Filtered feedback
  const feedbackEntries = useMemo(() => {
    return results
      .filter(r => {
        if (filterStatus === 'fail' && r.status !== 'fail') return false
        if (filterStatus === 'blocked' && r.status !== 'blocked') return false
        if (filterStatus === 'feedback' && !r.feedback?.trim()) return false
        if (filterTester !== 'all' && r.tester_id !== filterTester) return false
        if (filterPlan !== 'all') {
          const tc = caseMap.get(r.test_case_id)
          if (tc?.plan_id !== filterPlan) return false
        }
        if (filterStatus === 'all' && !r.feedback?.trim()) return false
        return true
      })
      .slice(0, 100)
  }, [results, filterStatus, filterTester, filterPlan, caseMap])

  // Assignment helpers
  const assignmentsByTester = useMemo(() => {
    const m = new Map<string, Set<string>>()
    allAssignments.forEach(a => {
      const s = m.get(a.tester_id) ?? new Set()
      s.add(a.test_case_id)
      m.set(a.tester_id, s)
    })
    return m
  }, [allAssignments])

  const unassignedCount = useMemo(() => {
    const assigned = new Set(allAssignments.map(a => a.test_case_id))
    return cases.filter(c => !assigned.has(c.id)).length
  }, [allAssignments, cases])

  const openAssignModal = useCallback((userId: string) => {
    const existing = assignmentsByTester.get(userId) ?? new Set()
    setAssignChecked(new Set(existing))
    setAssignModalUser(userId)
  }, [assignmentsByTester])

  const saveAssignments = useCallback(async () => {
    if (!assignModalUser) return
    setAssignSaving(true)
    const existing = assignmentsByTester.get(assignModalUser) ?? new Set()
    const toAdd = [...assignChecked].filter(id => !existing.has(id))
    const toRemove = [...existing].filter(id => !assignChecked.has(id))

    if (toAdd.length > 0) {
      await db().from('test_assignments').insert(
        toAdd.map(test_case_id => ({ test_case_id, tester_id: assignModalUser }))
      )
    }
    for (const caseId of toRemove) {
      await db().from('test_assignments').delete().eq('test_case_id', caseId).eq('tester_id', assignModalUser)
    }
    const { data } = await db().from('test_assignments').select('test_case_id, tester_id')
    setAllAssignments((data ?? []) as TestAssignment[])
    setAssignModalUser(null)
    setAssignSaving(false)
  }, [assignModalUser, assignChecked, assignmentsByTester])

  // Re-test
  const requestRetest = useCallback(async (resultId: string) => {
    setRetestSaving(true)
    await db().from('test_results').update({
      needs_retest: true,
      retest_note: retestNote.trim() || null,
    }).eq('id', resultId)
    const { data } = await db().from('test_results').select('*').order('tested_at', { ascending: false })
    setResults((data ?? []) as TestResult[])
    setRetestingId(null)
    setRetestNote('')
    setRetestSaving(false)
  }, [retestNote])

  // Comment reply
  const submitReply = useCallback(async (resultId: string) => {
    const text = replyText.get(resultId)?.trim()
    if (!text || !currentUser) return
    setReplySaving(resultId)

    const { data: newComment } = await db().from('test_comments')
      .insert({ test_result_id: resultId, author_id: currentUser.id, body: text })
      .select('id, test_result_id, author_id, body, created_at')
      .single()

    if (newComment) {
      setFeedbackComments(prev => {
        const updated = new Map(prev)
        const arr = [...(updated.get(resultId) ?? []), { ...newComment, author_name: currentUser.name }]
        updated.set(resultId, arr)
        return updated
      })
    }
    setReplyText(prev => { const m = new Map(prev); m.delete(resultId); return m })
    setReplySaving(null)
  }, [replyText, currentUser])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-green-400" />
        <h2 className="text-lg font-bold text-white">QA Admin Dashboard</h2>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Cases', value: kpis.totalCases, icon: ClipboardCheck, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Tested', value: kpis.tested, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Passed', value: kpis.passed, icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Failed', value: kpis.failed, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Pass Rate', value: `${kpis.passRate}%`, icon: BarChart3, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Feedback', value: kpis.feedbackCount, icon: MessageSquare, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${kpi.bg}`}>
                <kpi.icon className={`w-3.5 h-3.5 ${kpi.color}`} />
              </div>
            </div>
            <p className="text-2xl font-bold text-white tracking-tight">{kpi.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Assignment Management */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-gray-400" />
          <h3 className="font-bold text-white text-sm">Test Assignments</h3>
          <span className="text-xs text-gray-500 ml-auto">
            {unassignedCount > 0
              ? <span className="text-amber-400 font-medium">{unassignedCount} unassigned</span>
              : 'All assigned'}
          </span>
        </div>
        <div className="divide-y divide-gray-700/50">
          {users.map(u => {
            const count = assignmentsByTester.get(u.id)?.size ?? 0
            return (
              <div key={u.id} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-750 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{u.name}</p>
                  <p className="text-[11px] text-gray-500 capitalize">{u.role}</p>
                </div>
                <span className="text-xs text-gray-400 font-medium tabular-nums">
                  {count}<span className="text-gray-600">/{cases.length}</span> assigned
                </span>
                <button
                  onClick={() => openAssignModal(u.id)}
                  className="text-xs font-medium text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/15 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Assign Tests
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Assignment Modal */}
      {assignModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col border border-gray-700">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
              <h3 className="font-bold text-white text-sm">
                Assign Tests &mdash; {userMap.get(assignModalUser)?.name ?? 'Unknown'}
              </h3>
              <button onClick={() => setAssignModalUser(null)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {plans.map(plan => {
                const planCases = cases.filter(c => c.plan_id === plan.id)
                if (planCases.length === 0) return null
                return (
                  <div key={plan.id} className="mb-3">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{plan.name}</p>
                    {planCases.map(tc => (
                      <label key={tc.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={assignChecked.has(tc.id)}
                          onChange={() => {
                            setAssignChecked(prev => {
                              const next = new Set(prev)
                              if (next.has(tc.id)) next.delete(tc.id); else next.add(tc.id)
                              return next
                            })
                          }}
                          className="rounded border-gray-600 text-green-500 focus:ring-green-500 bg-gray-700"
                        />
                        <span className="text-sm text-gray-300 truncate">{tc.title}</span>
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-700">
              <span className="text-xs text-gray-500">{assignChecked.size} selected</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAssignModalUser(null)}
                  className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAssignments}
                  disabled={assignSaving}
                  className="text-xs font-medium text-white bg-green-600 hover:bg-green-500 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {assignSaving ? 'Saving...' : 'Save Assignments'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-Tester Progress */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          <h3 className="font-bold text-white text-sm">Tester Progress</h3>
          <span className="text-xs text-gray-500 ml-auto">{testerRows.length} testers</span>
        </div>

        {testerRows.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500">No test results yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900/50 text-[11px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-6 py-2.5 font-semibold">Tester</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Completed</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Pass</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Fail</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Blocked</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Progress</th>
                  <th className="text-right px-6 py-2.5 font-semibold">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {testerRows.map(row => (
                  <tr key={row.testerId} className="hover:bg-gray-750 transition-colors">
                    <td className="px-6 py-3">
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="text-[11px] text-gray-500 capitalize">{row.role}</p>
                    </td>
                    <td className="text-center px-3 py-3 font-medium text-gray-300">
                      {row.completed}<span className="text-gray-600">/{cases.length}</span>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="text-emerald-400 font-medium">{row.pass}</span>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className={`font-medium ${row.fail > 0 ? 'text-red-400' : 'text-gray-600'}`}>{row.fail}</span>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className={`font-medium ${row.blocked > 0 ? 'text-amber-400' : 'text-gray-600'}`}>{row.blocked}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              row.pct === 100 ? 'bg-emerald-500' : row.pct > 0 ? 'bg-green-500' : 'bg-gray-600'
                            }`}
                            style={{ width: `${row.pct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-gray-400 font-medium tabular-nums w-8 text-right">{row.pct}%</span>
                      </div>
                    </td>
                    <td className="text-right px-6 py-3 text-xs text-gray-500">
                      {row.lastActivity ? (
                        <span className="flex items-center gap-1 justify-end">
                          <Clock className="w-3 h-3" />
                          {fmtDate(row.lastActivity)}
                        </span>
                      ) : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Feedback Feed */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              <h3 className="font-bold text-white text-sm">Feedback Feed</h3>
            </div>
            <span className="text-xs text-gray-500">{feedbackEntries.length} entries</span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Filter className="w-3 h-3" />
              Filters:
            </div>
            <div className="relative">
              <select
                value={filterTester}
                onChange={e => setFilterTester(e.target.value)}
                className="appearance-none text-xs bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 pr-7 text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500/40"
              >
                <option value="all">All Testers</option>
                {testersWithResults.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <div className="relative">
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="appearance-none text-xs bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 pr-7 text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500/40"
              >
                <option value="all">All w/ Feedback</option>
                <option value="fail">Failures Only</option>
                <option value="blocked">Blocked Only</option>
                <option value="feedback">Has Feedback</option>
              </select>
              <ChevronDown className="w-3 h-3 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <div className="relative">
              <select
                value={filterPlan}
                onChange={e => setFilterPlan(e.target.value)}
                className="appearance-none text-xs bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 pr-7 text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500/40"
              >
                <option value="all">All Plans</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="max-h-[500px] overflow-y-auto divide-y divide-gray-700/50">
          {feedbackEntries.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No feedback entries match the current filters
            </div>
          ) : (
            feedbackEntries.map(entry => {
              const tc = caseMap.get(entry.test_case_id)
              const plan = tc ? planMap.get(tc.plan_id) : null
              const tester = userMap.get(entry.tester_id)
              const statusCfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.pending

              return (
                <div key={entry.id} className="px-6 py-4 hover:bg-gray-750 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      entry.status === 'fail' ? 'bg-red-500/10' : entry.status === 'blocked' ? 'bg-amber-500/10' : 'bg-gray-700'
                    }`}>
                      {entry.status === 'fail' ? <XCircle className="w-3.5 h-3.5 text-red-400" /> :
                       entry.status === 'blocked' ? <Ban className="w-3.5 h-3.5 text-amber-400" /> :
                       entry.status === 'pass' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> :
                       entry.status === 'skipped' ? <SkipForward className="w-3.5 h-3.5 text-gray-500" /> :
                       <AlertTriangle className="w-3.5 h-3.5 text-gray-500" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium text-white">{tester?.name ?? 'Unknown'}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${statusCfg.bg} ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                        {plan && (
                          <span className="text-[10px] text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">{plan.name}</span>
                        )}
                        <span className="text-[10px] text-gray-500 ml-auto flex-shrink-0">
                          {fmtDate(entry.tested_at)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-1">{tc?.title ?? 'Unknown case'}</p>
                      {entry.feedback && (
                        <p className="text-sm text-gray-300 bg-gray-900 rounded-lg px-3 py-2 border border-gray-700 mt-1.5">
                          {entry.feedback}
                        </p>
                      )}

                      {/* Re-test */}
                      {entry.needs_retest ? (
                        <div className="mt-2 flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-1.5">
                          <RotateCcw className="w-3.5 h-3.5 text-orange-400" />
                          <span className="text-xs font-medium text-orange-400">Re-test requested</span>
                          {entry.retest_note && (
                            <span className="text-xs text-orange-300 ml-1">&mdash; {entry.retest_note}</span>
                          )}
                        </div>
                      ) : retestingId === entry.id ? (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="text"
                            value={retestNote}
                            onChange={e => setRetestNote(e.target.value)}
                            placeholder="Note (e.g. Fixed in latest deploy)"
                            className="flex-1 text-xs border border-gray-600 rounded-lg px-2.5 py-1.5 bg-gray-900 text-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500/40"
                          />
                          <button
                            onClick={() => requestRetest(entry.id)}
                            disabled={retestSaving}
                            className="text-xs font-medium text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {retestSaving ? 'Saving...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => { setRetestingId(null); setRetestNote('') }}
                            className="text-xs text-gray-500 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRetestingId(entry.id)}
                          className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/15 px-2.5 py-1 rounded-lg transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Request Re-test
                        </button>
                      )}

                      {/* Comments */}
                      <div className="mt-2">
                        {(feedbackComments.get(entry.id) ?? []).length > 0 && (
                          <button
                            onClick={() => setExpandedComments(prev => {
                              const next = new Set(prev)
                              if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id)
                              return next
                            })}
                            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 mb-1"
                          >
                            <MessageSquare className="w-3 h-3" />
                            {(feedbackComments.get(entry.id) ?? []).length} comment{(feedbackComments.get(entry.id) ?? []).length !== 1 ? 's' : ''}
                            {expandedComments.has(entry.id)
                              ? <ChevronUp className="w-3 h-3" />
                              : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                        {expandedComments.has(entry.id) && (feedbackComments.get(entry.id) ?? []).map(c => (
                          <div key={c.id} className="bg-gray-900 rounded-lg px-3 py-1.5 border border-gray-700 mb-1 ml-4">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[11px] font-medium text-gray-300">{c.author_name}</span>
                              <span className="text-[10px] text-gray-500">{relativeTime(c.created_at)}</span>
                            </div>
                            <p className="text-xs text-gray-400">{c.body}</p>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 ml-4 mt-1">
                          <input
                            type="text"
                            value={replyText.get(entry.id) ?? ''}
                            onChange={e => setReplyText(prev => new Map(prev).set(entry.id, e.target.value))}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(entry.id) } }}
                            placeholder="Reply..."
                            className="flex-1 text-xs border border-gray-600 rounded-lg px-2.5 py-1 bg-gray-900 text-white focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500/40"
                          />
                          <button
                            onClick={() => submitReply(entry.id)}
                            disabled={!(replyText.get(entry.id)?.trim()) || replySaving === entry.id}
                            className="flex items-center gap-1 text-[11px] font-medium text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/15 px-2 py-1 rounded-lg transition-colors disabled:opacity-40"
                          >
                            <Send className="w-3 h-3" />
                            Reply
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
