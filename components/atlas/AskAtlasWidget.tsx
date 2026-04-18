'use client'

import { useEffect, useRef, useState } from 'react'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn } from '@/lib/utils'
import { Sparkles, X, ThumbsUp, ThumbsDown, Send } from 'lucide-react'

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

export function AskAtlasWidget() {
  const { user } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [showEscalate, setShowEscalate] = useState(false)
  const [escalateNote, setEscalateNote] = useState('')
  const [escalating, setEscalating] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-16 right-3 z-[90] flex items-center gap-2 px-2 py-2 md:px-3 bg-indigo-900/70 border border-indigo-700 rounded-lg
                   text-indigo-200 hover:text-white hover:border-indigo-500 shadow-lg transition-colors text-xs"
      >
        <Sparkles className="w-4 h-4" />
        <span className="hidden md:inline">Ask Atlas</span>
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

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
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
            </div>

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
          </div>
        </div>
      )}

      {toast && (
        <div className={cn(
          'fixed bottom-16 right-5 z-[200] text-white text-xs px-4 py-2 rounded-md shadow-lg',
          toast.includes('Failed') ? 'bg-red-700' : 'bg-green-700'
        )}>
          {toast}
        </div>
      )}
    </>
  )
}
