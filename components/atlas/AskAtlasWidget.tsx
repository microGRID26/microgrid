'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn } from '@/lib/utils'
import { Sparkles, X, ThumbsUp, ThumbsDown, Send, Inbox } from 'lucide-react'

type Citation = {
  id: number
  title: string
  owner: string | null
  source_of_truth: string | null
  similarity: number
}

type AskResponse = {
  id: number | null
  answer: string | null
  citations: Citation[]
  confidence: 'high' | 'medium' | 'low'
  escalation_suggested: boolean
}

type InboxItem = {
  question_id: number
  question: string
  asked_at: string
  action_id: number
  answer: string
  answered_at: string
}

const INBOX_POLL_MS = 120_000

export function AskAtlasWidget() {
  const { user } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'ask' | 'inbox'>('ask')

  // Ask state
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [showEscalate, setShowEscalate] = useState(false)
  const [escalateNote, setEscalateNote] = useState('')
  const [escalating, setEscalating] = useState(false)
  const [escalated, setEscalated] = useState(false)

  // Inbox state
  const [inbox, setInbox] = useState<InboxItem[]>([])

  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  const loadInbox = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch('/api/atlas/inbox', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setInbox((data.items ?? []) as InboxItem[])
    } catch {
      // silent — background poll
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    loadInbox()
    const t = setInterval(loadInbox, INBOX_POLL_MS)
    return () => clearInterval(t)
  }, [user, loadInbox])

  if (typeof window !== 'undefined' && window.location.pathname === '/login') return null
  if (!user) return null

  const flashToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }

  const reset = () => {
    setQuestion('')
    setResult(null)
    setErrorMsg('')
    setFeedback(null)
    setShowEscalate(false)
    setEscalateNote('')
    setEscalated(false)
  }

  const close = () => {
    setOpen(false)
    setTimeout(reset, 200)
  }

  const openWidget = () => {
    setOpen(true)
    setTab(inbox.length > 0 ? 'inbox' : 'ask')
  }

  const ask = async () => {
    const q = question.trim()
    if (q.length < 3) return
    setAsking(true)
    setErrorMsg('')
    setResult(null)
    setFeedback(null)
    setEscalated(false)
    try {
      const res = await fetch('/api/atlas/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          page_path: typeof window !== 'undefined' ? window.location.pathname : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data?.error ?? 'Something went wrong')
      } else {
        setResult(data as AskResponse)
        if ((data as AskResponse).escalation_suggested) setShowEscalate(true)
      }
    } catch {
      setErrorMsg('Network error')
    } finally {
      setAsking(false)
    }
  }

  const sendFeedback = async (kind: 'up' | 'down') => {
    if (!result?.id) return
    setFeedback(kind)
    const res = await fetch('/api/atlas/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: result.id, feedback: kind }),
    })
    if (!res.ok) {
      setFeedback(null)
      flashToast('Failed to record feedback')
    } else if (kind === 'down') {
      setShowEscalate(true)
    }
  }

  const escalate = async () => {
    const q = question.trim()
    if (q.length < 3) return
    setEscalating(true)
    const res = await fetch('/api/atlas/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id: result?.id ?? null,
        question: q,
        note: escalateNote.trim() || null,
        page_path: typeof window !== 'undefined' ? window.location.pathname : null,
      }),
    })
    setEscalating(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      flashToast(data?.error ?? 'Failed to escalate')
    } else {
      setEscalated(true)
      setShowEscalate(false)
      flashToast('Sent to Greg — you\'ll see the answer in-app.')
    }
  }

  const dismissInboxItem = async (questionId: number) => {
    setInbox(prev => prev.filter(i => i.question_id !== questionId))
    const res = await fetch('/api/atlas/inbox/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: questionId }),
    })
    if (!res.ok) {
      flashToast('Failed to mark as read')
      loadInbox()
    }
  }

  const confidenceBadge = (c: 'high' | 'medium' | 'low') => {
    const map = {
      high: 'bg-green-900/40 border-green-700/50 text-green-300',
      medium: 'bg-amber-900/40 border-amber-700/50 text-amber-300',
      low: 'bg-red-900/40 border-red-700/50 text-red-300',
    } as const
    return (
      <span className={cn('text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border', map[c])}>
        {c} confidence
      </span>
    )
  }

  const hasUnread = inbox.length > 0

  return (
    <>
      <button
        onClick={openWidget}
        className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 px-2 py-2 md:px-3 bg-indigo-900/70 border border-indigo-700 rounded-lg
                   text-indigo-200 hover:text-white hover:border-indigo-500 shadow-lg transition-colors text-xs"
      >
        <span className="relative">
          <Sparkles className="w-4 h-4" />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full ring-2 ring-gray-950" />
          )}
        </span>
        <span className="hidden md:inline">Ask Atlas</span>
        {hasUnread && (
          <span className="hidden md:inline bg-red-600/80 text-white text-[10px] px-1.5 py-[1px] rounded-full">
            {inbox.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-semibold text-white">Ask Atlas</h2>
              </div>
              <button onClick={close} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex border-b border-gray-800 text-xs">
              <button
                onClick={() => setTab('ask')}
                className={cn(
                  'flex-1 px-4 py-2 font-medium transition-colors',
                  tab === 'ask' ? 'text-white border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'
                )}
              >
                Ask
              </button>
              <button
                onClick={() => setTab('inbox')}
                className={cn(
                  'flex-1 px-4 py-2 font-medium transition-colors flex items-center justify-center gap-1.5',
                  tab === 'inbox' ? 'text-white border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'
                )}
              >
                <Inbox className="w-3.5 h-3.5" />
                Inbox
                {hasUnread && (
                  <span className="bg-red-600 text-white text-[10px] px-1.5 py-[1px] rounded-full">
                    {inbox.length}
                  </span>
                )}
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {tab === 'ask' ? (
                <>
                  <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Ask anything about MicroGRID, solar, financing, or install. Atlas answers from the internal knowledge base.
                      If it doesn&apos;t know, you can send the question to Greg.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Your question</label>
                    <textarea
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      placeholder="e.g. How do I mark a project as signed?"
                      rows={3}
                      disabled={asking}
                      className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white
                                 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none disabled:opacity-50"
                    />
                  </div>

                  {errorMsg && (
                    <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded px-3 py-2">
                      {errorMsg}
                    </div>
                  )}

                  {result && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        {confidenceBadge(result.confidence)}
                        {result.answer && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => sendFeedback('up')}
                              disabled={feedback !== null}
                              className={cn(
                                'p-1 rounded transition-colors',
                                feedback === 'up' ? 'text-green-400 bg-green-900/40' : 'text-gray-500 hover:text-green-400 disabled:opacity-30'
                              )}
                              title="Helpful"
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => sendFeedback('down')}
                              disabled={feedback !== null}
                              className={cn(
                                'p-1 rounded transition-colors',
                                feedback === 'down' ? 'text-red-400 bg-red-900/40' : 'text-gray-500 hover:text-red-400 disabled:opacity-30'
                              )}
                              title="Not helpful"
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {result.answer ? (
                        <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2.5">
                          <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{result.answer}</p>
                        </div>
                      ) : (
                        <div className="bg-amber-950/30 border border-amber-900/50 rounded-lg px-3 py-2.5">
                          <p className="text-sm text-amber-200">
                            I don&apos;t have a confident answer for that. Send it to Greg?
                          </p>
                        </div>
                      )}

                      {result.citations.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">Sources</div>
                          <ul className="space-y-1">
                            {result.citations.map(c => (
                              <li key={c.id} className="text-xs text-gray-400 flex items-start gap-2">
                                <span className="text-gray-600">•</span>
                                <span className="flex-1">
                                  <span className="text-gray-300">{c.title}</span>
                                  {c.owner && <span className="text-gray-600"> — {c.owner}</span>}
                                  <span className="text-gray-700"> · {(c.similarity * 100).toFixed(0)}%</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {showEscalate && !escalated && (
                        <div className="bg-indigo-950/40 border border-indigo-900/60 rounded-lg px-3 py-3 space-y-2">
                          <p className="text-xs text-indigo-200">
                            Send this question to Greg. You&apos;ll see the answer in-app next time.
                          </p>
                          <textarea
                            value={escalateNote}
                            onChange={e => setEscalateNote(e.target.value)}
                            placeholder="Optional: add context Greg should know"
                            rows={2}
                            className="w-full bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                                       placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setShowEscalate(false)}
                              className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                            >
                              Not now
                            </button>
                            <button
                              onClick={escalate}
                              disabled={escalating}
                              className={cn(
                                'px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1',
                                escalating ? 'bg-gray-700 text-gray-500' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                              )}
                            >
                              <Send className="w-3 h-3" />
                              {escalating ? 'Sending…' : 'Send to Greg'}
                            </button>
                          </div>
                        </div>
                      )}

                      {escalated && (
                        <div className="bg-green-950/30 border border-green-900/50 rounded-lg px-3 py-2 text-xs text-green-300">
                          Sent. Greg will answer and you&apos;ll see it in-app.
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  {inbox.length === 0 ? (
                    <div className="text-center py-8 text-xs text-gray-500">
                      No new answers. When Greg replies to questions you&apos;ve sent, they show up here.
                    </div>
                  ) : (
                    inbox.map(item => (
                      <div key={item.question_id} className="bg-gray-800/60 border border-indigo-900/50 rounded-lg p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[10px] uppercase tracking-wide text-indigo-400 font-medium">
                            Greg answered
                          </div>
                          <button
                            onClick={() => dismissInboxItem(item.question_id)}
                            className="text-gray-500 hover:text-white transition-colors"
                            title="Mark as read"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 italic border-l-2 border-gray-700 pl-2">
                          {item.question}
                        </div>
                        <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                          {item.answer}
                        </div>
                        <div className="text-[10px] text-gray-600">
                          {new Date(item.answered_at).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {tab === 'ask' && (
              <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-800">
                <div className="text-[10px] text-gray-600">
                  {user?.email ?? ''}
                </div>
                <div className="flex gap-2">
                  {result && (
                    <button
                      onClick={reset}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors"
                    >
                      New question
                    </button>
                  )}
                  <button
                    onClick={ask}
                    disabled={question.trim().length < 3 || asking}
                    className={cn(
                      'px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
                      question.trim().length >= 3 && !asking
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    )}
                  >
                    {asking ? 'Thinking…' : 'Ask'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={cn(
          'fixed bottom-4 right-5 z-[200] text-white text-xs px-4 py-2 rounded-md shadow-lg',
          toast.includes('Failed') ? 'bg-red-700' : 'bg-green-700'
        )}>
          {toast}
        </div>
      )}
    </>
  )
}
