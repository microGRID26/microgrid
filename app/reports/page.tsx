'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { fmt$, fmtDate, cn } from '@/lib/utils'
import type { Project } from '@/types/database'
import { loadProjectById, loadSavedQueries, saveQuery, deleteSavedQuery, recordQueryRun } from '@/lib/api'
import type { SavedQuery } from '@/lib/api'
import {
  Send,
  Download,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Loader2,
  Sparkles,
  Bookmark,
  BookmarkPlus,
  Trash2,
  Clock,
  Share2,
  Code,
  AlertTriangle,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  results?: Record<string, unknown>[]
  columns?: string[]
  count?: number
  queryPlan?: Record<string, unknown>
  followUp?: string
  loading?: boolean
  error?: string
}

// ── Starter prompts ──────────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  'Show me all blocked projects',
  'Which permit stage projects have been stuck more than 30 days?',
  'List projects by financier with contract values',
  'What projects are missing a survey date?',
  'Show me installs scheduled this month',
  'Which PMs have the most projects?',
]

// ── Currency / date columns ──────────────────────────────────────────────────

const CURRENCY_FIELDS = new Set([
  'contract_value', 'system_price', 'ppw', 'adder_total', 'redline',
  'permit_fee', 'reinspection_fee', 'm1_amount', 'm2_amount', 'm3_amount',
  'total_funding', 'price',
])

const DATE_FIELDS = new Set([
  'sale_date', 'stage_date', 'survey_date', 'install_date', 'install_complete_date',
  'pto_date', 'inspection_date', 'ntp_date', 'permit_submit_date', 'created_at',
  'updated_at', 'follow_up_date', 'm1_funded_date', 'm2_funded_date', 'm3_funded_date',
])

function formatCell(key: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (CURRENCY_FIELDS.has(key)) return fmt$(Number(value))
  if (DATE_FIELDS.has(key)) return fmtDate(String(value))
  return String(value)
}

function isProjectId(value: unknown): boolean {
  return typeof value === 'string' && /^PROJ-\d+$/.test(value)
}

// ── CSV Export ───────────────────────────────────────────────────────────────

function exportCSV(columns: string[], rows: Record<string, unknown>[]) {
  // Neutralize Excel/Sheets formula-injection: any cell starting with =, +, -, @,
  // tab, or CR is treated as a formula by spreadsheet apps. Prefix with a single
  // quote so it renders as text. (R1 audit on #375 — Critical, 2026-04-29.)
  const neutralizeFormula = (v: string) =>
    /^[=+\-@\t\r]/.test(v) ? "'" + v : v
  const escape = (v: string) => {
    const safe = neutralizeFormula(v)
    if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
      return '"' + safe.replace(/"/g, '""') + '"'
    }
    return safe
  }
  const header = columns.map(escape).join(',')
  const body = rows.map(r =>
    columns.map(c => escape(formatCell(c, r[c]))).join(',')
  ).join('\n')
  const csv = header + '\n' + body
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `atlas-report-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Sortable Results Table ───────────────────────────────────────────────────

function ResultsTable({
  columns,
  rows,
  onClickProject,
}: {
  columns: string[]
  rows: Record<string, unknown>[]
  onClickProject: (id: string) => void
}) {
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  const sorted = useMemo(() => {
    if (!sortCol) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? ''
      const bv = b[sortCol] ?? ''
      const an = Number(av)
      const bn = Number(bv)
      if (!isNaN(an) && !isNaN(bn)) return sortAsc ? an - bn : bn - an
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  }, [rows, sortCol, sortAsc])

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(col)
      setSortAsc(true)
    }
  }

  return (
    <div className="max-h-[400px] overflow-auto rounded-lg border border-gray-700">
      <table className="w-full text-xs">
        <thead className="bg-gray-900 sticky top-0 z-10">
          <tr>
            {columns.map(col => (
              <th
                key={col}
                onClick={() => handleSort(col)}
                className="px-3 py-2 text-left text-gray-400 font-medium cursor-pointer select-none hover:text-white whitespace-nowrap"
              >
                <span className="flex items-center gap-1">
                  {col.replace(/_/g, ' ')}
                  {sortCol === col && (
                    sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-t border-gray-700/50 hover:bg-gray-700/30">
              {columns.map(col => {
                const val = row[col]
                const projId = isProjectId(val)
                return (
                  <td key={col} className="px-3 py-2 whitespace-nowrap">
                    {projId ? (
                      <button
                        onClick={() => onClickProject(String(val))}
                        className="text-green-400 hover:text-green-300 hover:underline font-mono"
                      >
                        {String(val)}
                      </button>
                    ) : (
                      <span className="text-gray-200">{formatCell(col, val)}</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Query Details Collapsible ────────────────────────────────────────────────

function QueryDetails({ plan }: { plan: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Query details
      </button>
      {open && (
        <pre className="mt-1 text-xs text-gray-500 bg-gray-900/50 rounded p-2 overflow-auto max-h-[200px]">
          {JSON.stringify(plan, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── Assistant Message ────────────────────────────────────────────────────────

function AssistantMessage({
  msg,
  onClickProject,
  onFollowUp,
}: {
  msg: ChatMessage
  onClickProject: (id: string) => void
  onFollowUp: (q: string) => void
}) {
  if (msg.loading) {
    return (
      <div className="flex items-start gap-3 mb-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 max-w-[85%]">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Analyzing your question...
          </div>
        </div>
      </div>
    )
  }

  if (msg.error) {
    return (
      <div className="flex items-start gap-3 mb-4">
        <div className="bg-red-900/20 border border-red-800/50 rounded-xl px-4 py-3 max-w-[85%]">
          <p className="text-red-400 text-sm">{msg.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 max-w-[85%] min-w-[300px]">
        {/* Description */}
        <p className="text-gray-400 text-sm mb-3">{msg.content}</p>

        {/* Results table */}
        {msg.results && msg.columns && msg.results.length > 0 && (
          <>
            <ResultsTable
              columns={msg.columns}
              rows={msg.results}
              onClickProject={onClickProject}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">
                {msg.count ?? msg.results.length} result{(msg.count ?? msg.results.length) !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => exportCSV(msg.columns!, msg.results!)}
                className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                <Download className="w-3 h-3" />
                Export CSV
              </button>
            </div>
          </>
        )}

        {msg.results && msg.results.length === 0 && (
          <p className="text-gray-500 text-sm italic">No results found.</p>
        )}

        {/* Query details */}
        {msg.queryPlan && <QueryDetails plan={msg.queryPlan} />}

        {/* Follow-up suggestion */}
        {msg.followUp && (
          <button
            onClick={() => onFollowUp(msg.followUp!)}
            className="mt-3 text-xs bg-gray-700/50 hover:bg-gray-700 border border-gray-600 text-gray-300 hover:text-white rounded-full px-3 py-1.5 transition-colors"
          >
            {msg.followUp}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Data Query Panel (one-shot NL→SQL) ──────────────────────────────────────
//
// Wraps POST /api/atlas/query (#367 backend, commit f944918). Different UX
// from the chat panel above — one question, one result table, no
// conversational history. Defense-in-depth via 29-table allowlist + SECURITY
// DEFINER RPC (atlas_safe_query) + per-user rate limits (10/min, 25/day).

const DATA_QUERY_STARTERS = [
  'every project signed since March over 15 kW',
  'sales today by rep',
  'projects in permit stage older than 30 days',
  'change orders pending site survey',
]

interface CanonicalVerification {
  verified_at: string | null
  verified_by: string | null
  method: string | null
  source: string | null
  expected_row_count: number | null
  drift_detected: boolean
}

interface DataQueryResult {
  ok: boolean
  explanation?: string
  sql?: string
  reason?: string
  // RPC payload — atlas_safe_query returns rows + columns + count
  rows?: Record<string, unknown>[]
  columns?: string[]
  count?: number
  truncated?: boolean
  // Canonical-router payload — present when the question matched a verified report
  canonical?: boolean
  report_id?: string
  params?: Record<string, unknown>
  verification?: CanonicalVerification
}

// Cap UI-rendered error messages at 500 chars so a regressed backend can't
// paint stack traces full-screen. (R1 M4 on #375.)
function capErr(s: string | undefined, fallback: string): string {
  const v = (s || fallback).toString()
  return v.length > 500 ? v.slice(0, 500) + '…' : v
}

// Defensive shape-validate the API response. Backend can ship malformed payloads
// after a deploy regression; this prevents a `columns.map is not a function`
// crash that would blank the whole /reports page. (R1 H2 on #375.)
function coerceVerification(v: unknown): CanonicalVerification | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return {
    verified_at: typeof o.verified_at === 'string' ? o.verified_at : null,
    verified_by: typeof o.verified_by === 'string' ? o.verified_by : null,
    method: typeof o.method === 'string' ? o.method : null,
    source: typeof o.source === 'string' ? o.source : null,
    expected_row_count: typeof o.expected_row_count === 'number' ? o.expected_row_count : null,
    drift_detected: o.drift_detected === true,
  }
}

function coerceQueryResult(body: unknown): DataQueryResult & { error?: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'Server returned an unexpected response.' }
  const b = body as Record<string, unknown>
  return {
    ok: b.ok === true,
    explanation: typeof b.explanation === 'string' ? b.explanation : undefined,
    sql: typeof b.sql === 'string' ? b.sql : undefined,
    reason: typeof b.reason === 'string' ? b.reason : undefined,
    rows: Array.isArray(b.rows) ? (b.rows as Record<string, unknown>[]) : [],
    columns: Array.isArray(b.columns) ? (b.columns as string[]).filter(c => typeof c === 'string') : [],
    count: typeof b.count === 'number' ? b.count : undefined,
    truncated: b.truncated === true,
    error: typeof b.error === 'string' ? b.error : undefined,
    canonical: b.canonical === true,
    report_id: typeof b.report_id === 'string' ? b.report_id : undefined,
    params: b.params && typeof b.params === 'object' ? (b.params as Record<string, unknown>) : undefined,
    verification: coerceVerification(b.verification),
  }
}

function DataQueryPanel({ onClickProject }: { onClickProject: (id: string) => Promise<boolean> }) {
  const [question, setQuestion] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [result, setResult] = useState<DataQueryResult | null>(null)
  const [errorBanner, setErrorBanner] = useState<{ kind: 'rate' | 'reject' | 'server'; msg: string } | null>(null)
  const [rowToast, setRowToast] = useState<string | null>(null)
  const [showSql, setShowSql] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // R1 M3 — surface "no access" feedback when a clicked PROJ-ID can't load
  // (RLS-filtered or missing). Auto-dismisses after 3s.
  const handleRowProjectClick = useCallback(async (id: string): Promise<void> => {
    const ok = await onClickProject(id)
    if (!ok) {
      setRowToast(`No access to ${id} (or it doesn't exist).`)
      setTimeout(() => setRowToast(null), 3000)
    }
  }, [onClickProject])

  const submit = useCallback(async (text: string) => {
    // Ref-gate prevents rapid-double-click race that would issue two parallel
    // fetches and render the wrong response. (R1 M2 on #375.)
    if (!text.trim() || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setErrorBanner(null)
    setResult(null)
    setShowSql(false)
    try {
      const res = await fetch('/api/atlas/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text.trim(), page_path: '/reports' }),
      })
      if (res.status === 429) {
        const body = await res.json().catch(() => null)
        const r = coerceQueryResult(body)
        setErrorBanner({ kind: 'rate', msg: capErr(r.error || r.reason, 'Rate limit exceeded.') })
        return
      }
      if (res.status === 401 || res.status === 403) {
        setErrorBanner({ kind: 'server', msg: 'Access denied. Manager role required.' })
        return
      }
      let raw: unknown
      try {
        raw = await res.json()
      } catch {
        // Non-JSON response (Vercel HTML 502, deploy boundary, etc.)
        setErrorBanner({ kind: 'server', msg: 'Server returned an unexpected response.' })
        return
      }
      const body = coerceQueryResult(raw)
      if (!res.ok && !body.ok) {
        setErrorBanner({
          kind: body.reason ? 'reject' : 'server',
          msg: capErr(body.reason || body.error, 'Query rejected.'),
        })
        // Surface the SQL even when rejected so the user can see what was tried.
        setResult(body)
        return
      }
      setResult(body)
    } catch (err) {
      // Generic network error (offline, DNS, etc.) — never leak the parser
      // error string. (R1 H2 on #375.)
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Request was canceled.'
        : 'Network error. Check connection and retry.'
      setErrorBanner({ kind: 'server', msg })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit(question)
  }

  const rows = result?.rows ?? []
  const columns = result?.columns ?? []
  const hasResults = result?.ok === true && rows.length > 0
  const noResults = result?.ok === true && rows.length === 0

  return (
    <div className="flex-1 overflow-auto pb-4 space-y-4">
      {/* Question textarea + Ask button */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          ref={inputRef}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a one-shot data question (e.g. 'every project signed since March over 15 kW')"
          rows={3}
          maxLength={2000}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-green-600 focus:ring-1 focus:ring-green-600 resize-none"
          disabled={submitting}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">
            Returns up to 5,000 rows. SELECT only. 10/min · 25/day per user.
            {question.length > 1800 && (
              <span className="text-yellow-400 ml-2">{question.length} / 2000</span>
            )}
          </span>
          <button
            type="submit"
            disabled={submitting || !question.trim()}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5',
              submitting || !question.trim()
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-500 text-white'
            )}
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Ask Atlas
          </button>
        </div>
      </form>

      {/* Starter prompts (only when nothing asked yet) */}
      {!result && !submitting && !errorBanner && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {DATA_QUERY_STARTERS.map(s => (
            <button
              key={s}
              onClick={() => { setQuestion(s); submit(s) }}
              className="text-left text-xs text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-2.5 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Error banners */}
      {errorBanner?.kind === 'rate' && (
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2 flex items-start gap-2">
          <Clock className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <p className="text-yellow-400 font-medium">Rate limit hit</p>
            <p className="text-yellow-300/80 mt-0.5">{errorBanner.msg}</p>
          </div>
        </div>
      )}
      {errorBanner?.kind === 'reject' && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <p className="text-red-400 font-medium">Query rejected</p>
            <p className="text-red-300/80 mt-0.5">{errorBanner.msg}</p>
          </div>
        </div>
      )}
      {errorBanner?.kind === 'server' && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-300/80">{errorBanner.msg}</p>
        </div>
      )}

      {/* Verified report banner — shown when canonical router matched */}
      {result?.canonical && result?.verification && (
        <div className="bg-green-950/30 border border-green-900/50 rounded-lg px-3 py-2 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-xs">
            <div className="text-green-300 font-medium mb-0.5">
              Verified report{result.report_id ? ` · ${result.report_id}` : ''}
              {result.verification.drift_detected && (
                <span className="ml-2 text-amber-400">⚠ Drift detected vs expected count</span>
              )}
            </div>
            <div className="text-gray-400 leading-snug">
              {result.verification.method && <span>Method: <span className="text-gray-300">{result.verification.method}</span>. </span>}
              {result.verification.verified_by && <span>Verified by <span className="text-gray-300">{result.verification.verified_by}</span></span>}
              {result.verification.verified_at && <span> on <span className="text-gray-300">{new Date(result.verification.verified_at).toLocaleDateString()}</span></span>}
              {result.verification.expected_row_count != null && <span>. Expected count: <span className="text-gray-300">{result.verification.expected_row_count}</span></span>}
              {result.verification.method !== 'spot_check_of_5_rows' && '.'}
            </div>
            {result.verification.source && (
              <div className="text-gray-500 mt-1 italic">{result.verification.source}</div>
            )}
          </div>
        </div>
      )}

      {/* Explanation */}
      {result?.explanation && (
        <p className="text-xs text-gray-300 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
          {result.explanation}
        </p>
      )}

      {/* Results table */}
      {hasResults && (
        <div>
          <ResultsTable columns={columns} rows={rows} onClickProject={handleRowProjectClick} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-500">
              {result?.count ?? rows.length} result{(result?.count ?? rows.length) !== 1 ? 's' : ''}
              {result?.truncated && <span className="text-yellow-500 ml-2">(truncated at 5,000)</span>}
            </span>
            <button
              onClick={() => exportCSV(columns, rows)}
              className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
            >
              <Download className="w-3 h-3" />
              Export CSV
            </button>
          </div>
        </div>
      )}
      {noResults && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400">
          No rows matched this query.
        </div>
      )}

      {/* Row-level toast (R1 M3 — silent no-op on cross-org PROJ-IDs) */}
      {rowToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-800 border border-yellow-700 text-yellow-300 text-xs px-4 py-2 rounded-lg shadow-lg">
          {rowToast}
        </div>
      )}

      {/* Show generated SQL */}
      {result?.sql && (
        <div>
          <button
            onClick={() => setShowSql(!showSql)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors"
          >
            <Code className="w-3 h-3" />
            {showSql ? 'Hide generated SQL' : 'Show generated SQL'}
            {showSql ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showSql && (
            <pre className="mt-1 text-[11px] text-gray-300 bg-gray-900/70 border border-gray-700 rounded p-2 overflow-auto max-h-[240px] font-mono whitespace-pre-wrap break-words">
              {result.sql.length > 8000 ? result.sql.slice(0, 8000) + '\n\n[truncated for display]' : result.sql}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [mode, setMode] = useState<'chat' | 'data'>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Saved queries
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const [showSaved, setShowSaved] = useState(false)
  const [saveModalQuery, setSaveModalQuery] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saveShared, setSaveShared] = useState(false)

  // Role gate: Manager+ only (Manager, Finance, Admin, Super Admin)
  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <>
        <Nav active="Atlas" />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">Atlas is available to Managers and above.</p>
          </div>
        </div>
      </>
    )
  }

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Load saved queries on mount
  useEffect(() => {
    if (currentUser?.id) {
      loadSavedQueries(currentUser.id).then(setSavedQueries)
    }
  }, [currentUser?.id])

  const handleSaveQuery = useCallback(async () => {
    if (!saveModalQuery || !saveName.trim() || !currentUser?.id) return
    const result = await saveQuery({
      name: saveName.trim(),
      query_text: saveModalQuery,
      created_by: currentUser.id,
      created_by_name: currentUser.name,
      shared: saveShared,
    })
    if (result) {
      setSavedQueries(prev => [result, ...prev])
    }
    setSaveModalQuery(null)
    setSaveName('')
    setSaveShared(false)
  }, [saveModalQuery, saveName, saveShared, currentUser?.id, currentUser?.name])

  const handleRunSaved = useCallback(async (sq: SavedQuery) => {
    setShowSaved(false)
    sendMessage(sq.query_text)
    recordQueryRun(sq.id)
    setSavedQueries(prev => prev.map(q => q.id === sq.id ? { ...q, run_count: q.run_count + 1, last_run_at: new Date().toISOString() } : q))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDeleteSaved = useCallback(async (id: string) => {
    await deleteSavedQuery(id)
    setSavedQueries(prev => prev.filter(q => q.id !== id))
  }, [])

  // Load a project by ID for ProjectPanel.
  // Returns true if the project was loaded; false on RLS-filtered / not-found
  // so the caller can surface "no access" feedback (R1 M3 on #375).
  const handleClickProject = useCallback(async (id: string): Promise<boolean> => {
    const data = await loadProjectById(id)
    if (data) {
      setSelectedProject(data)
      return true
    }
    return false
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
    }

    const loadingMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      loading: true,
    }

    setMessages(prev => [...prev, userMsg, loadingMsg])
    setInput('')
    setSending(true)

    try {
      const history = messages
        .filter(m => !m.loading)
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/reports/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), history }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        throw new Error(errBody?.error || `Request failed (${res.status})`)
      }

      const data = await res.json()

      const assistantMsg: ChatMessage = {
        id: loadingMsg.id,
        role: 'assistant',
        content: data.description ?? 'Here are your results.',
        results: data.results ?? [],
        columns: data.columns ?? (data.results?.[0] ? Object.keys(data.results[0]) : []),
        count: data.count ?? data.results?.length ?? 0,
        queryPlan: data.queryPlan,
        followUp: data.followUp,
      }

      setMessages(prev => prev.map(m => m.id === loadingMsg.id ? assistantMsg : m))
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: loadingMsg.id,
        role: 'assistant',
        content: '',
        error: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      }
      setMessages(prev => prev.map(m => m.id === loadingMsg.id ? errorMsg : m))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [messages, sending])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const isEmpty = messages.length === 0

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <Nav active="Atlas" />

      <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-4">
        {/* Catalog status banner — distinguishes verified-router answers
            (green Verified badge appears on the result) from legacy LLM-SQL
            answers (no badge — verify before trusting). */}
        <div className="mt-6 mb-4 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
          <div className="flex items-start gap-3">
            <Sparkles className="text-green-400 w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-gray-300 flex-1 leading-relaxed">
              <strong className="text-white">Verified canonical reports are rolling out.</strong>{' '}
              Questions that match a verified report show a green{' '}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-950/40 border border-green-900/50 text-green-300">
                Verified
              </span>{' '}
              footer with the source. Other questions still use on-the-fly SQL — treat those
              answers as drafts and verify against NetSuite.{' '}
              <a
                href="mailto:greg@gomicrogridenergy.com?subject=Atlas%20returned%20a%20wrong%20number"
                className="underline text-gray-400 hover:text-gray-200"
              >
                Report a wrong number
              </a>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="pb-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-green-400" />
              <h1 className="text-xl font-semibold">Atlas</h1>
            </div>
            <p className="text-gray-400 text-sm mt-1">
              {mode === 'chat'
                ? 'AI-powered project reports — ask me anything'
                : 'One-shot data query — natural language → SQL → table'}
            </p>
            {/* Mode tab toggle (#375) */}
            <div className="flex items-center gap-1 mt-3 bg-gray-800 border border-gray-700 rounded-lg p-1 w-fit">
              <button
                onClick={() => setMode('chat')}
                className={cn(
                  'text-xs px-3 py-1 rounded transition-colors',
                  mode === 'chat' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'
                )}
              >
                Chat
              </button>
              <button
                onClick={() => setMode('data')}
                className={cn(
                  'text-xs px-3 py-1 rounded transition-colors flex items-center gap-1',
                  mode === 'data' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'
                )}
              >
                <Code className="w-3 h-3" />
                Data Query
              </button>
            </div>
          </div>
          {savedQueries.length > 0 && (
            <button
              onClick={() => setShowSaved(!showSaved)}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors',
                showSaved ? 'bg-green-900/40 text-green-400 border border-green-700' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
              )}
            >
              <Bookmark className="w-3.5 h-3.5" />
              Saved ({savedQueries.length})
            </button>
          )}
        </div>

        {/* Mode dispatch — chat (default) vs data-query (#375) */}
        {mode === 'data' ? (
          <DataQueryPanel onClickProject={handleClickProject} />
        ) : (<>
        {/* Saved queries panel */}
        {showSaved && savedQueries.length > 0 && (
          <div className="mb-4 bg-gray-800/50 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Saved Queries</h3>
            <div className="space-y-1.5">
              {savedQueries.map(sq => (
                <div key={sq.id} className="flex items-center justify-between group bg-gray-900/50 rounded-lg px-3 py-2 hover:bg-gray-900">
                  <button
                    onClick={() => handleRunSaved(sq)}
                    className="flex-1 text-left text-sm text-gray-200 hover:text-white"
                  >
                    <span className="font-medium">{sq.name}</span>
                    {sq.shared && <Share2 className="w-3 h-3 inline ml-1.5 text-blue-400" />}
                    <span className="text-[10px] text-gray-500 ml-2">
                      {sq.run_count > 0 ? `${sq.run_count} runs` : 'Never run'}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDeleteSaved(sq.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 p-1 transition-opacity"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save query modal */}
        {saveModalQuery && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md">
              <h3 className="text-sm font-semibold text-white mb-4">Save Query</h3>
              <p className="text-xs text-gray-400 mb-3 truncate">&ldquo;{saveModalQuery}&rdquo;</p>
              <input
                type="text"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="Report name..."
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-green-500 outline-none mb-3"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSaveQuery() }}
              />
              <label className="flex items-center gap-2 text-xs text-gray-400 mb-4 cursor-pointer">
                <input type="checkbox" checked={saveShared} onChange={e => setSaveShared(e.target.checked)} className="rounded" />
                Share with team
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setSaveModalQuery(null)} className="text-xs text-gray-400 hover:text-white px-3 py-1.5">Cancel</button>
                <button onClick={handleSaveQuery} disabled={!saveName.trim()} className="text-xs bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Chat area */}
        <div className="flex-1 overflow-auto pb-4">
          {isEmpty ? (
            /* Starter prompts */
            <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
              <Sparkles className="w-10 h-10 text-green-400/40 mb-4" />
              <p className="text-gray-500 text-sm mb-6">Try one of these to get started</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
                {STARTER_PROMPTS.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="text-left text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg px-4 py-3 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message list */
            <div className="space-y-1 pt-2">
              {messages.map(msg =>
                msg.role === 'user' ? (
                  /* User message - right aligned green bubble with save button */
                  <div key={msg.id} className="flex justify-end mb-4 group/msg">
                    <button
                      onClick={() => setSaveModalQuery(msg.content)}
                      className="opacity-0 group-hover/msg:opacity-100 text-gray-500 hover:text-green-400 p-1 mr-1 transition-opacity self-center"
                      title="Save this query"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                    </button>
                    <div className="bg-green-900/30 border border-green-800 rounded-xl px-4 py-2.5 max-w-[70%]">
                      <p className="text-sm text-green-100">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  /* Assistant message */
                  <AssistantMessage
                    key={msg.id}
                    msg={msg}
                    onClickProject={handleClickProject}
                    onFollowUp={sendMessage}
                  />
                )
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input bar - sticky bottom */}
        <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 py-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about your projects..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-green-600 focus:ring-1 focus:ring-green-600"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className={cn(
                'px-4 py-3 rounded-lg transition-colors flex items-center gap-2',
                sending || !input.trim()
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-500 text-white'
              )}
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
        </>)}
      </div>

      {/* Project Panel */}
      {selectedProject && (
        <ProjectPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onProjectUpdated={() => {}}
        />
      )}
    </div>
  )
}
