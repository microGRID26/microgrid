'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { isInternalEmail } from '@/lib/utils'
import { Nav } from '@/components/Nav'
import {
  ClipboardCheck, Flame, Trophy, Sparkles, Loader2, AlertTriangle,
  Award, Star, ListFilter, HelpCircle,
} from 'lucide-react'
import type { TestPlan, TestCase, TestResult, Status } from './types'
import { BADGE_DEFS, ADMIN_ROLES } from './types'
import { TestCard } from './components/TestCard'
import { SplitView } from './components/SplitView'
import { ActivityFeed } from './components/ActivityFeed'
import { HelpModal } from './components/HelpModal'
import { AdminPanel } from './components/AdminPanel'

// ── SVG Progress Ring ──────────────────────────────────────────────────────

function ProgressRing({ pct, size = 96, stroke = 7 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="url(#ring-grad)" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-1000 ease-out"
      />
      <defs>
        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ── Confetti Burst ─────────────────────────────────────────────────────────

function ConfettiBurst({ show }: { show: boolean }) {
  if (!show) return null
  const particles = Array.from({ length: 40 }, (_, i) => {
    const angle = (i / 40) * 360
    const distance = 60 + Math.random() * 120
    const size = 4 + Math.random() * 6
    const colors = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899']
    const color = colors[i % colors.length]
    const delay = Math.random() * 200
    return (
      <span
        key={i}
        className="absolute rounded-full animate-confetti"
        style={{
          width: size, height: size, backgroundColor: color,
          left: '50%', top: '50%',
          '--tx': `${Math.cos((angle * Math.PI) / 180) * distance}px`,
          '--ty': `${Math.sin((angle * Math.PI) / 180) * distance}px`,
          animationDelay: `${delay}ms`,
        } as React.CSSProperties}
      />
    )
  })
  return <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">{particles}</div>
}

// ── Achievement Badges ─────────────────────────────────────────────────────

function AchievementBadges({
  plans, casesByPlan, resultMap,
}: {
  plans: TestPlan[]
  casesByPlan: Map<string, TestCase[]>
  resultMap: Map<string, TestResult>
}) {
  const badges = useMemo(() => {
    return plans.map(plan => {
      const key = plan.name.toLowerCase().trim()
      const def = BADGE_DEFS[key]
      if (!def) return null
      const planCases = casesByPlan.get(plan.id) ?? []
      if (planCases.length === 0) return { ...def, earned: false, planName: plan.name }
      const allDone = planCases.every(c => {
        const r = resultMap.get(c.id)
        return r && r.status !== 'pending'
      })
      return { ...def, earned: allDone, planName: plan.name }
    }).filter(Boolean) as (typeof BADGE_DEFS[string] & { earned: boolean; planName: string })[]
  }, [plans, casesByPlan, resultMap])

  const earnedCount = badges.filter(b => b.earned).length
  if (badges.length === 0) return null

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Achievement Badges</h3>
        </div>
        <span className="text-xs font-medium text-gray-500">{earnedCount}/{badges.length} earned</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {badges.map((badge) => {
          const Icon = badge.icon
          return (
            <div
              key={badge.label}
              title={badge.earned ? `${badge.label} - Completed "${badge.planName}"` : `Complete "${badge.planName}" to earn`}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                badge.earned
                  ? `${badge.bg} border-white/10`
                  : 'bg-gray-800 border-gray-700 opacity-40 grayscale'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${badge.earned ? badge.bg : 'bg-gray-700'}`}>
                <Icon className={`w-4 h-4 ${badge.earned ? badge.color : 'text-gray-500'}`} />
              </div>
              <span className={`text-xs font-semibold ${badge.earned ? badge.color : 'text-gray-500'}`}>
                {badge.label}
              </span>
              {badge.earned && <Sparkles className="w-3 h-3 text-amber-400" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function TestingPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [plans, setPlans] = useState<TestPlan[]>([])
  const [cases, setCases] = useState<TestCase[]>([])
  const [results, setResults] = useState<TestResult[]>([])
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null)
  const [selectedCase, setSelectedCase] = useState<TestCase | null>(null)
  const [feedback, setFeedback] = useState('')
  const [screenshot, setScreenshot] = useState<{ file: File; preview: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [showHelp, setShowHelp] = useState(() => {
    if (typeof window === 'undefined') return false
    return !localStorage.getItem('microgrid-testing-onboarded')
  })
  const [planCelebration, setPlanCelebration] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [assignments, setAssignments] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'my' | 'all'>('all')
  const [tab, setTab] = useState<'testing' | 'admin'>('testing')

  // Screenshot paste
  const handleScreenshotFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 10 * 1024 * 1024) return
    const preview = URL.createObjectURL(file)
    setScreenshot({ file, preview })
  }, [])

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) handleScreenshotFile(file)
        }
      }
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [handleScreenshotFile])

  const uploadScreenshot = useCallback(async (caseId: string): Promise<string | null> => {
    if (!screenshot || !currentUser) return null
    const supabase = createClient()
    const ext = screenshot.file.type.includes('png') ? 'png' : 'jpg'
    const path = `testing/${currentUser.id}/${caseId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('recordings')
      .upload(path, screenshot.file, { contentType: screenshot.file.type, upsert: true })
    if (upErr) {
      console.error('Screenshot upload failed:', upErr)
      return null
    }
    return path
  }, [screenshot, currentUser])

  // Data loading
  const loadData = useCallback(async () => {
    if (!currentUser) return
    try {
      const isAdmin = ADMIN_ROLES.includes(currentUser.role)
      const roleFilters = isAdmin ? ['admin', 'user'] : ['user']

      const { data: plansData } = await db()
        .from('test_plans')
        .select('*')
        .in('role_filter', roleFilters)
        .order('sort_order')
      setPlans((plansData ?? []) as TestPlan[])

      const planIds = (plansData ?? []).map((p: TestPlan) => p.id)
      if (planIds.length === 0) { setLoading(false); return }

      const { data: casesData } = await db()
        .from('test_cases')
        .select('*')
        .in('plan_id', planIds)
        .order('sort_order')
      setCases((casesData ?? []) as TestCase[])

      const { data: resultsData } = await db()
        .from('test_results')
        .select('*')
        .eq('tester_id', currentUser.id)
      setResults((resultsData ?? []) as TestResult[])

      const { data: assignData } = await db()
        .from('test_assignments')
        .select('test_case_id')
        .eq('tester_id', currentUser.id)
      const assignSet = new Set<string>((assignData ?? []).map((a: { test_case_id: string }) => a.test_case_id))
      setAssignments(assignSet)
      if (assignSet.size > 0) setViewMode('my')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
    setLoading(false)
  }, [currentUser])

  useEffect(() => {
    if (!userLoading && currentUser) {
      if (!isInternalEmail(currentUser.email)) {
        setError('Access restricted to MicroGRID team members')
        setLoading(false)
        return
      }
      loadData()
    } else if (!userLoading && !currentUser) {
      setError('Not authenticated')
      setLoading(false)
    }
  }, [userLoading, currentUser, loadData])

  // Derived
  const resultMap = useMemo(() => {
    const m = new Map<string, TestResult>()
    results.forEach(r => m.set(r.test_case_id, r))
    return m
  }, [results])

  const casesByPlan = useMemo(() => {
    const m = new Map<string, TestCase[]>()
    cases.forEach(c => {
      const arr = m.get(c.plan_id) ?? []
      arr.push(c)
      m.set(c.plan_id, arr)
    })
    return m
  }, [cases])

  const stats = useMemo(() => {
    const visibleCases = viewMode === 'my' && assignments.size > 0
      ? cases.filter(c => assignments.has(c.id))
      : cases
    const total = visibleCases.length
    let completed = 0, passed = 0, failed = 0, blocked = 0
    visibleCases.forEach(c => {
      const r = resultMap.get(c.id)
      if (r && r.status !== 'pending') completed++
      if (r?.status === 'pass') passed++
      if (r?.status === 'fail') failed++
      if (r?.status === 'blocked') blocked++
    })
    const sorted = [...results].filter(r => r.status !== 'pending').sort((a, b) =>
      new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime()
    )
    let streak = 0
    for (const r of sorted) { if (r.status === 'pass') streak++; else break }
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, passed, failed, blocked, streak, pct }
  }, [cases, results, resultMap, viewMode, assignments])

  // Submit result
  const submitResult = useCallback(async (status: Status) => {
    if (!selectedCase || !currentUser) return
    if ((status === 'fail' || status === 'blocked') && !feedback.trim()) return

    setSubmitting(true)
    try {
      const screenshotPath = await uploadScreenshot(selectedCase.id)
      const existing = resultMap.get(selectedCase.id)

      if (existing) {
        await db().from('test_results').update({
          status,
          feedback: feedback.trim() || null,
          tested_at: new Date().toISOString(),
          ...(screenshotPath ? { screenshot_path: screenshotPath } : {}),
        }).eq('id', existing.id)
      } else {
        await db().from('test_results').insert({
          test_case_id: selectedCase.id,
          tester_id: currentUser.id,
          status,
          feedback: feedback.trim() || null,
          ...(screenshotPath ? { screenshot_path: screenshotPath } : {}),
        })
      }

      // Reload results
      const { data: fresh } = await db()
        .from('test_results')
        .select('*')
        .eq('tester_id', currentUser.id)
      setResults((fresh ?? []) as TestResult[])

      // Check plan completion
      const planCases = casesByPlan.get(selectedCase.plan_id) ?? []
      const freshMap = new Map<string, TestResult>()
      ;(fresh ?? []).forEach((r: TestResult) => freshMap.set(r.test_case_id, r))
      const planDone = planCases.every(c => {
        const r = freshMap.get(c.id)
        return r && r.status !== 'pending'
      })
      if (planDone) {
        setPlanCelebration(selectedCase.plan_id)
        setShowConfetti(true)
        setTimeout(() => { setShowConfetti(false); setPlanCelebration(null) }, 3000)
      }

      const allDone = cases.every(c => {
        const r = freshMap.get(c.id)
        return r && r.status !== 'pending'
      })
      if (allDone) {
        setShowConfetti(true)
        setTimeout(() => setShowConfetti(false), 4000)
      }

      // Auto-advance
      setFeedback('')
      if (screenshot) { URL.revokeObjectURL(screenshot.preview); setScreenshot(null) }
      const nextCase = planCases.find(c => {
        if (c.id === selectedCase.id) return false
        const r = freshMap.get(c.id)
        return !r || r.status === 'pending'
      })
      if (nextCase) {
        setSelectedCase(nextCase)
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        setSelectedCase(null)
      }
    } catch (err) {
      console.error('Submit error:', err)
    }
    setSubmitting(false)
  }, [selectedCase, currentUser, feedback, resultMap, casesByPlan, cases, uploadScreenshot, screenshot])

  const isAdmin = currentUser?.isAdmin || currentUser?.isManager

  if (userLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-900">
        <Nav active="Testing" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900">
        <Nav active="Testing" />
        <div className="max-w-xl mx-auto px-4 pt-12 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">Cannot Load Tests</p>
          <p className="text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <Nav active="Testing" />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-16">

        <ConfettiBurst show={showConfetti} />

        {/* Admin/Tester Tab Toggle */}
        {isAdmin && (
          <div className="flex items-center gap-2 mb-6">
            <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 p-0.5">
              <button
                onClick={() => setTab('testing')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  tab === 'testing' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                My Testing
              </button>
              <button
                onClick={() => setTab('admin')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  tab === 'admin' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                Admin Dashboard
              </button>
            </div>
          </div>
        )}

        {tab === 'admin' && isAdmin ? (
          <AdminPanel />
        ) : (
          <>
            {/* Hero Banner */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 mb-8 p-6 sm:p-8 border border-gray-700">
              <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-green-500/10 rounded-full blur-[100px] pointer-events-none" />
              <div className="absolute bottom-0 left-1/4 w-[200px] h-[200px] bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none" />

              <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                  <div className="relative flex-shrink-0">
                    <ProgressRing pct={stats.pct} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-white">{stats.pct}%</span>
                      <span className="text-[10px] text-white/40 uppercase tracking-wider">Done</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <ClipboardCheck className="w-5 h-5 text-green-400" />
                      <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-[-0.03em]">QA Testing</h1>
                      <button
                        onClick={() => setShowHelp(true)}
                        className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                        aria-label="How to use this page"
                      >
                        <HelpCircle className="w-4 h-4 text-white/60" />
                      </button>
                    </div>
                    <p className="text-white/40 text-sm">
                      {stats.pct === 100
                        ? 'All tests complete! Great work.'
                        : `${stats.completed} of ${stats.total} test cases completed`}
                    </p>
                  </div>
                </div>

                {/* Stats pills */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="bg-white/[0.04] backdrop-blur-sm rounded-lg border border-white/[0.06] px-3 py-2 text-center min-w-[70px]">
                    <p className="text-lg font-bold text-white">{stats.completed}<span className="text-white/30 text-sm">/{stats.total}</span></p>
                    <p className="text-[10px] text-white/30 uppercase">Tested</p>
                  </div>
                  <div className="bg-white/[0.04] backdrop-blur-sm rounded-lg border border-white/[0.06] px-3 py-2 text-center min-w-[70px]">
                    <p className="text-lg font-bold text-emerald-400">{stats.passed}</p>
                    <p className="text-[10px] text-white/30 uppercase">Passed</p>
                  </div>
                  <div className="bg-white/[0.04] backdrop-blur-sm rounded-lg border border-white/[0.06] px-3 py-2 text-center min-w-[70px]">
                    <p className="text-lg font-bold text-red-400">{stats.failed}</p>
                    <p className="text-[10px] text-white/30 uppercase">Failed</p>
                  </div>
                  <div className="bg-white/[0.04] backdrop-blur-sm rounded-lg border border-white/[0.06] px-3 py-2 text-center min-w-[70px]">
                    <p className="text-lg font-bold text-amber-400">{stats.blocked}</p>
                    <p className="text-[10px] text-white/30 uppercase">Blocked</p>
                  </div>
                  {stats.streak > 0 && (
                    <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 backdrop-blur-sm rounded-lg border border-amber-500/20 px-3 py-2 text-center min-w-[70px]">
                      <p className="text-lg font-bold text-amber-400 flex items-center justify-center gap-1">
                        <Flame className="w-4 h-4" />{stats.streak}
                      </p>
                      <p className="text-[10px] text-amber-400/60 uppercase">Streak</p>
                    </div>
                  )}
                </div>
              </div>

              {stats.pct === 100 && (
                <div className="relative z-10 mt-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                  <Trophy className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <p className="text-emerald-300 text-sm font-medium">
                    All tests complete! Thank you for helping make MicroGRID better.
                  </p>
                </div>
              )}
            </div>

            {/* Achievement Badges */}
            <AchievementBadges plans={plans} casesByPlan={casesByPlan} resultMap={resultMap} />

            {/* My Tests / All Tests Toggle */}
            {assignments.size > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <ListFilter className="w-4 h-4 text-gray-500" />
                <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 p-0.5">
                  <button
                    onClick={() => setViewMode('my')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      viewMode === 'my' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    My Tests
                  </button>
                  <button
                    onClick={() => setViewMode('all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      viewMode === 'all' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    All Tests
                  </button>
                </div>
                {viewMode === 'my' && (
                  <span className="text-xs text-gray-500">{assignments.size} assigned</span>
                )}
              </div>
            )}

            {/* Plan Cards */}
            {plans.length === 0 ? (
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
                <ClipboardCheck className="w-8 h-8 text-gray-500 mx-auto mb-3" />
                <p className="text-white font-semibold mb-1">No Test Plans Available</p>
                <p className="text-gray-400 text-sm">Test plans haven&apos;t been assigned to your role yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                {plans.filter(plan => {
                  if (viewMode === 'all') return true
                  const planCases = casesByPlan.get(plan.id) ?? []
                  return planCases.some(c => assignments.has(c.id))
                }).map(plan => (
                  <TestCard
                    key={plan.id}
                    plan={plan}
                    planCases={casesByPlan.get(plan.id) ?? []}
                    resultMap={resultMap}
                    isExpanded={expandedPlan === plan.id}
                    onToggle={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                    selectedCaseId={selectedCase?.id ?? null}
                    onSelectCase={(tc) => {
                      setSelectedCase(tc)
                      const result = resultMap.get(tc.id)
                      setFeedback(result?.feedback ?? '')
                      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                    }}
                    viewMode={viewMode}
                    assignments={assignments}
                    celebrating={planCelebration === plan.id}
                  />
                ))}
              </div>
            )}

            {/* Testing Panel */}
            {selectedCase && (
              <div ref={panelRef}>
                <SplitView
                  selectedCase={selectedCase}
                  resultMap={resultMap}
                  feedback={feedback}
                  setFeedback={setFeedback}
                  submitting={submitting}
                  submitResult={submitResult}
                  screenshot={screenshot}
                  setScreenshot={setScreenshot}
                  handleScreenshotFile={handleScreenshotFile}
                  fileInputRef={fileInputRef}
                  currentUser={currentUser ? { id: currentUser.id, name: currentUser.name } : null}
                />
              </div>
            )}

            {/* Team Activity Feed */}
            <ActivityFeed />
          </>
        )}

        {/* Help Modal */}
        {showHelp && (
          <HelpModal onClose={() => {
            setShowHelp(false)
            localStorage.setItem('microgrid-testing-onboarded', '1')
          }} />
        )}

        {/* Confetti keyframes */}
        <style jsx global>{`
          @keyframes confetti {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); opacity: 0; }
          }
          .animate-confetti {
            animation: confetti 1.2s ease-out forwards;
          }
        `}</style>
      </div>
    </div>
  )
}
