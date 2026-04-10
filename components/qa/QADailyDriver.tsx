'use client'

/**
 * QADailyDriver — banner mounted at the top of /command. Self-hides on 403
 * (no assignments + not admin). Hands the user one QA case per day with a
 * Skip / Start / Run-another flow.
 */
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Beaker, Flame, ArrowRight, CheckCircle2, SkipForward } from 'lucide-react'

interface TodayCase {
  id: string
  plan_name: string
  title: string
  instructions: string | null
  expected_result: string | null
  page_url: string | null
  priority: string
}

interface ActiveRun { id: string; test_case_id: string; status: string }

interface TodayResponse {
  done: boolean
  streak: number
  case?: TodayCase | null
  activeRun?: ActiveRun
  empty?: boolean
  hasMore?: boolean
}

const PRIORITY_BG: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  high:     'bg-amber-500/15 text-amber-300 border-amber-500/30',
  medium:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
  low:      'bg-gray-700 text-gray-400 border-gray-600',
}

export default function QADailyDriver() {
  const router = useRouter()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [starting, setStarting] = useState(false)

  const load = useCallback(async (force = false) => {
    try {
      const url = force ? '/api/qa/today?force=1' : '/api/qa/today'
      const res = await fetch(url, { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) { setHidden(true); return }
      if (!res.ok) { setHidden(true); return }
      setData(await res.json())
    } catch {
      setHidden(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  const handleRunAnother = useCallback(async () => {
    setLoading(true)
    await load(true)
  }, [load])

  const handleStart = useCallback(async () => {
    if (!data?.case) return
    setStarting(true)
    try {
      const res = await fetch('/api/qa/runs/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caseId: data.case.id,
          deviceType: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
          viewportWidth: window.innerWidth,
        }),
      })
      if (!res.ok) { setStarting(false); return }
      const { runId, pageUrl } = await res.json()
      const target = '/testing'
      const sep = target.includes('?') ? '&' : '?'
      router.push(`${target}${sep}qa_run=${runId}`)
    } catch {
      setStarting(false)
    }
  }, [data, router])

  const handleSkip = useCallback(async () => {
    if (data?.activeRun) {
      await fetch(`/api/qa/runs/${data.activeRun.id}/skip`, { method: 'POST' })
      setHidden(true)
      return
    }
    if (data?.case) {
      await fetch('/api/qa/skip-today', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.case.id }),
      })
    }
    setHidden(true)
  }, [data])

  if (hidden) return null
  if (loading) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-gray-800 bg-gray-900/60 p-3 animate-pulse">
        <div className="h-4 bg-gray-800 rounded w-2/3 mb-2" />
        <div className="h-3 bg-gray-800 rounded w-1/2" />
      </div>
    )
  }

  if (!data) return null

  if (data.done) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 flex items-center gap-3">
        <div className="w-7 h-7 rounded-md bg-emerald-500/20 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-emerald-300">Today&apos;s QA run complete — thanks</p>
          <p className="text-[10px] text-emerald-400/70 mt-0.5">
            {data.streak > 0 ? <><Flame className="w-3 h-3 inline -mt-0.5" /> {data.streak}-day streak</> : 'New tomorrow'}
          </p>
        </div>
        {data.hasMore !== false && (
          <button
            onClick={handleRunAnother}
            className="h-7 px-3 rounded-md text-[11px] font-semibold text-emerald-200 hover:text-white bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 transition-all inline-flex items-center gap-1 shrink-0"
          >
            Run another
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    )
  }

  if (data.empty || !data.case) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-2.5 flex items-center gap-3">
        <Beaker className="w-4 h-4 text-gray-500" />
        <div className="flex-1">
          <p className="text-[12px] font-semibold text-gray-400">QA: all caught up</p>
          <p className="text-[10px] text-gray-500">No cases due — next one unlocks tomorrow.</p>
        </div>
      </div>
    )
  }

  const c = data.case
  const isResuming = !!data.activeRun
  const priorityCls = PRIORITY_BG[c.priority] ?? PRIORITY_BG.medium

  return (
    <div className="mx-4 my-2 relative overflow-hidden rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-600/15 via-blue-600/10 to-violet-600/15 px-4 py-3">
      <div className="absolute top-0 right-0 w-[140px] h-[140px] bg-violet-500/10 rounded-full blur-[60px] pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-md bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
            <Beaker className="w-4 h-4 text-violet-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                {isResuming ? "Resume today's QA" : "Today's QA"}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${priorityCls}`}>
                {c.priority}
              </span>
              {data.streak > 0 && (
                <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-0.5">
                  <Flame className="w-3 h-3" /> {data.streak}-day streak
                </span>
              )}
            </div>
            <p className="text-[14px] font-bold text-white truncate">{c.title}</p>
            <p className="text-[11px] text-white/50 mt-0.5 truncate">
              {c.plan_name} &middot; ~3 min &middot; one bite-a-day
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleSkip}
            className="h-8 px-3 rounded-md text-[11px] font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all inline-flex items-center gap-1"
          >
            <SkipForward className="w-3 h-3" />
            Skip today
          </button>
          <button
            onClick={handleStart}
            disabled={starting}
            className="h-8 px-4 rounded-md text-[12px] font-semibold text-white bg-violet-500 hover:bg-violet-400 shadow-lg shadow-violet-500/30 transition-all inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {starting ? 'Starting…' : isResuming ? 'Resume' : 'Start'}
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
