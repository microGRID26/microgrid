'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { fmt$, fmtDate, cn } from '@/lib/utils'
import type { Project } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import {
  Send,
  Download,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Loader2,
  Sparkles,
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
  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"'
    }
    return v
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
  a.download = `nova-report-${Date.now()}.csv`
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

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Role gate: Manager+ only (Manager, Finance, Admin, Super Admin)
  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <>
        <Nav active="Reports" />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">AI Reports is available to Managers and above.</p>
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

  // Load a project by ID for ProjectPanel
  const handleClickProject = useCallback(async (id: string) => {
    const supabase = createClient()
    const { data } = await supabase.from('projects').select('*').eq('id', id).single()
    if (data) setSelectedProject(data as Project)
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
        throw new Error(`Request failed (${res.status})`)
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
      <Nav active="Reports" />

      <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-4">
        {/* Header */}
        <div className="pt-6 pb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-green-400" />
            <h1 className="text-xl font-semibold">Reports</h1>
          </div>
          <p className="text-gray-400 text-sm mt-1">Ask a question about your projects</p>
        </div>

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
                  /* User message - right aligned green bubble */
                  <div key={msg.id} className="flex justify-end mb-4">
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
