import { describe, it, expect } from 'vitest'
import { daysAgo, STAGE_ORDER, STAGE_LABELS } from '@/lib/utils'

// ── Mirror helpers from mobile/leadership/page.tsx ──────────────────────────

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

function isThisMonth(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

// ── Test types ──────────────────────────────────────────────────────────────

interface TestProject {
  id: string
  name: string
  stage: string
  contract: number | null
  install_complete_date: string | null
  stage_date: string | null
  sale_date: string | null
  pm: string | null
  pm_id: string | null
  blocker: string | null
  financier: string | null
  disposition: string | null
  pto_date: string | null
}

interface TestFunding {
  project_id: string
  m2_funded_date: string | null
  m3_funded_date: string | null
  m2_amount: number | null
  m3_amount: number | null
  m2_status: string | null
  m3_status: string | null
}

// ── Mirror metrics computation from mobile/leadership/page.tsx ──────────────

function computeMetrics(projects: TestProject[], fundingRows: TestFunding[]) {
  const funding: Record<string, TestFunding> = {}
  fundingRows.forEach((f) => { funding[f.project_id] = f })

  const active = projects.filter(p => p.stage !== 'complete')
  const portfolioValue = active.reduce((s, p) => s + (Number(p.contract) || 0), 0)
  const blocked = active.filter(p => p.blocker)

  const installsThisMonth = projects.filter(p =>
    isThisMonth(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null))
  )

  const m2ThisMonth = projects.filter(p => {
    const f = funding[p.id]
    return f && isThisMonth(f.m2_funded_date)
  })
  const m2Amount = m2ThisMonth.reduce((s, p) => {
    const f = funding[p.id]
    return s + (Number(f?.m2_amount) || 0)
  }, 0)

  const m3ThisMonth = projects.filter(p => {
    const f = funding[p.id]
    return f && isThisMonth(f.m3_funded_date)
  })
  const m3Amount = m3ThisMonth.reduce((s, p) => {
    const f = funding[p.id]
    return s + (Number(f?.m3_amount) || 0)
  }, 0)

  const saleToInstall: number[] = []
  projects.forEach(p => {
    if (!p.sale_date || !p.install_complete_date) return
    const d1 = new Date(p.sale_date + 'T00:00:00')
    const d2 = new Date(p.install_complete_date + 'T00:00:00')
    if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
      const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000)
      if (diff >= 0) saleToInstall.push(diff)
    }
  })
  const avgSaleToInstall = saleToInstall.length > 0
    ? Math.round(saleToInstall.reduce((a, b) => a + b, 0) / saleToInstall.length)
    : null

  const aging = active.filter(p => {
    const cd = daysAgo(p.sale_date) || daysAgo(p.stage_date)
    return cd > 90
  })

  const stageCounts = STAGE_ORDER.map(s => ({
    stage: s,
    label: STAGE_LABELS[s],
    count: projects.filter(p => p.stage === s).length,
  }))

  const pmMap = new Map<string, string>()
  projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
  const pmStats = [...pmMap.entries()]
    .map(([pmId, pmName]) => {
      const ps = projects.filter(p => p.pm_id === pmId)
      const activePs = ps.filter(p => p.stage !== 'complete')
      return {
        name: pmName,
        active: activePs.length,
        blocked: activePs.filter(p => p.blocker).length,
      }
    })
    .sort((a, b) => b.active - a.active)

  return {
    activeCount: active.length,
    portfolioValue,
    installsThisMonth: installsThisMonth.length,
    m2Count: m2ThisMonth.length,
    m2Amount,
    m3Count: m3ThisMonth.length,
    m3Amount,
    blockedCount: blocked.length,
    avgSaleToInstall,
    agingCount: aging.length,
    stageCounts,
    pmStats,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function thisMonthDate(day: number = 15): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysAgoDate(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeProject(overrides: Partial<TestProject> = {}): TestProject {
  return {
    id: 'PROJ-001',
    name: 'Test Project',
    stage: 'design',
    contract: 25000,
    install_complete_date: null,
    stage_date: daysAgoDate(5),
    sale_date: daysAgoDate(30),
    pm: 'Alice',
    pm_id: 'pm-1',
    blocker: null,
    financier: 'GoodLeap',
    disposition: null,
    pto_date: null,
    ...overrides,
  }
}

function makeFunding(overrides: Partial<TestFunding> = {}): TestFunding {
  return {
    project_id: 'PROJ-001',
    m2_funded_date: null,
    m3_funded_date: null,
    m2_amount: null,
    m3_amount: null,
    m2_status: null,
    m3_status: null,
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Mobile Leadership — fmtCompact', () => {
  it('formats millions', () => {
    expect(fmtCompact(2_500_000)).toBe('$2.5M')
    expect(fmtCompact(1_000_000)).toBe('$1.0M')
  })

  it('formats thousands', () => {
    expect(fmtCompact(50_000)).toBe('$50K')
    expect(fmtCompact(1_000)).toBe('$1K')
  })

  it('formats small amounts', () => {
    expect(fmtCompact(500)).toBe('$500.00')
    expect(fmtCompact(0)).toBe('$0.00')
  })
})

describe('Mobile Leadership — isThisMonth', () => {
  it('returns true for a date in the current month', () => {
    expect(isThisMonth(thisMonthDate(1))).toBe(true)
  })

  it('returns false for null/undefined', () => {
    expect(isThisMonth(null)).toBe(false)
    expect(isThisMonth(undefined)).toBe(false)
  })

  it('returns false for invalid date string', () => {
    expect(isThisMonth('not-a-date')).toBe(false)
  })

  it('returns false for a date in a different month', () => {
    expect(isThisMonth('2020-01-15')).toBe(false)
  })
})

describe('Mobile Leadership — portfolio value calculation', () => {
  it('sums contracts of active (non-complete) projects', () => {
    const projects = [
      makeProject({ id: 'P1', contract: 30000, stage: 'design' }),
      makeProject({ id: 'P2', contract: 20000, stage: 'permit' }),
      makeProject({ id: 'P3', contract: 50000, stage: 'complete' }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.portfolioValue).toBe(50000) // P1 + P2, not P3
  })

  it('handles null/zero contracts', () => {
    const projects = [
      makeProject({ id: 'P1', contract: null }),
      makeProject({ id: 'P2', contract: 0 }),
      makeProject({ id: 'P3', contract: 10000 }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.portfolioValue).toBe(10000)
  })
})

describe('Mobile Leadership — installs this month', () => {
  it('counts projects with install_complete_date in current month', () => {
    const projects = [
      makeProject({ id: 'P1', install_complete_date: thisMonthDate(5) }),
      makeProject({ id: 'P2', install_complete_date: '2020-01-01' }),
      makeProject({ id: 'P3', install_complete_date: null }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.installsThisMonth).toBe(1)
  })

  it('falls back to stage_date for complete projects without install date', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'complete', install_complete_date: null, stage_date: thisMonthDate(10) }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.installsThisMonth).toBe(1)
  })

  it('does not fallback for non-complete projects', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'design', install_complete_date: null, stage_date: thisMonthDate(10) }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.installsThisMonth).toBe(0)
  })
})

describe('Mobile Leadership — M2/M3 funded this month', () => {
  it('counts and sums M2 funded this month', () => {
    const projects = [
      makeProject({ id: 'P1' }),
      makeProject({ id: 'P2' }),
    ]
    const funding = [
      makeFunding({ project_id: 'P1', m2_funded_date: thisMonthDate(3), m2_amount: 8000 }),
      makeFunding({ project_id: 'P2', m2_funded_date: '2020-06-01', m2_amount: 5000 }),
    ]
    const m = computeMetrics(projects, funding)
    expect(m.m2Count).toBe(1)
    expect(m.m2Amount).toBe(8000)
  })

  it('counts and sums M3 funded this month', () => {
    const projects = [
      makeProject({ id: 'P1' }),
      makeProject({ id: 'P2' }),
    ]
    const funding = [
      makeFunding({ project_id: 'P1', m3_funded_date: thisMonthDate(10), m3_amount: 12000 }),
      makeFunding({ project_id: 'P2', m3_funded_date: thisMonthDate(12), m3_amount: 6000 }),
    ]
    const m = computeMetrics(projects, funding)
    expect(m.m3Count).toBe(2)
    expect(m.m3Amount).toBe(18000)
  })

  it('returns zero when no funding records exist', () => {
    const m = computeMetrics([makeProject()], [])
    expect(m.m2Count).toBe(0)
    expect(m.m2Amount).toBe(0)
    expect(m.m3Count).toBe(0)
    expect(m.m3Amount).toBe(0)
  })
})

describe('Mobile Leadership — blocked count', () => {
  it('counts active projects with non-null blocker', () => {
    const projects = [
      makeProject({ id: 'P1', blocker: 'Missing docs' }),
      makeProject({ id: 'P2', blocker: null }),
      makeProject({ id: 'P3', blocker: 'Permit issue', stage: 'complete' }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.blockedCount).toBe(1) // P3 is complete, not counted
  })

  it('returns zero when no projects are blocked', () => {
    const m = computeMetrics([makeProject()], [])
    expect(m.blockedCount).toBe(0)
  })
})

describe('Mobile Leadership — stage distribution counts', () => {
  it('counts projects per stage across all STAGE_ORDER stages', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'design' }),
      makeProject({ id: 'P2', stage: 'design' }),
      makeProject({ id: 'P3', stage: 'permit' }),
      makeProject({ id: 'P4', stage: 'complete' }),
    ]
    const m = computeMetrics(projects, [])
    const designCount = m.stageCounts.find(s => s.stage === 'design')!.count
    const permitCount = m.stageCounts.find(s => s.stage === 'permit')!.count
    const completeCount = m.stageCounts.find(s => s.stage === 'complete')!.count
    const evalCount = m.stageCounts.find(s => s.stage === 'evaluation')!.count

    expect(designCount).toBe(2)
    expect(permitCount).toBe(1)
    expect(completeCount).toBe(1)
    expect(evalCount).toBe(0)
  })

  it('returns all 7 stages even when empty', () => {
    const m = computeMetrics([], [])
    expect(m.stageCounts).toHaveLength(7)
    m.stageCounts.forEach(s => expect(s.count).toBe(0))
  })

  it('includes label from STAGE_LABELS for each stage', () => {
    const m = computeMetrics([], [])
    m.stageCounts.forEach(s => {
      expect(s.label).toBe(STAGE_LABELS[s.stage])
    })
  })
})

describe('Mobile Leadership — PM performance aggregation', () => {
  it('groups projects by PM and counts active/blocked', () => {
    const projects = [
      makeProject({ id: 'P1', pm: 'Alice', pm_id: 'pm-1', stage: 'design', blocker: null }),
      makeProject({ id: 'P2', pm: 'Alice', pm_id: 'pm-1', stage: 'permit', blocker: 'Issue' }),
      makeProject({ id: 'P3', pm: 'Bob', pm_id: 'pm-2', stage: 'survey', blocker: null }),
      makeProject({ id: 'P4', pm: 'Alice', pm_id: 'pm-1', stage: 'complete', blocker: null }),
    ]
    const m = computeMetrics(projects, [])

    expect(m.pmStats).toHaveLength(2)
    const alice = m.pmStats.find(p => p.name === 'Alice')!
    const bob = m.pmStats.find(p => p.name === 'Bob')!

    expect(alice.active).toBe(2) // P1, P2 (P4 is complete)
    expect(alice.blocked).toBe(1) // P2
    expect(bob.active).toBe(1)
    expect(bob.blocked).toBe(0)
  })

  it('sorts PMs by active count descending', () => {
    const projects = [
      makeProject({ id: 'P1', pm: 'Alice', pm_id: 'pm-1', stage: 'design' }),
      makeProject({ id: 'P2', pm: 'Bob', pm_id: 'pm-2', stage: 'design' }),
      makeProject({ id: 'P3', pm: 'Bob', pm_id: 'pm-2', stage: 'permit' }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.pmStats[0].name).toBe('Bob')
    expect(m.pmStats[1].name).toBe('Alice')
  })

  it('skips projects without pm_id', () => {
    const projects = [
      makeProject({ id: 'P1', pm: null, pm_id: null }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.pmStats).toHaveLength(0)
  })
})

describe('Mobile Leadership — avg sale-to-install days', () => {
  it('calculates average days between sale and install dates', () => {
    const projects = [
      makeProject({ id: 'P1', sale_date: '2026-01-01', install_complete_date: '2026-01-31' }), // 30 days
      makeProject({ id: 'P2', sale_date: '2026-02-01', install_complete_date: '2026-03-03' }), // 30 days
    ]
    const m = computeMetrics(projects, [])
    expect(m.avgSaleToInstall).toBe(30)
  })

  it('returns null when no projects have both dates', () => {
    const projects = [
      makeProject({ id: 'P1', sale_date: null, install_complete_date: null }),
      makeProject({ id: 'P2', sale_date: '2026-01-01', install_complete_date: null }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.avgSaleToInstall).toBeNull()
  })

  it('excludes projects with negative durations', () => {
    const projects = [
      makeProject({ id: 'P1', sale_date: '2026-03-01', install_complete_date: '2026-01-01' }), // negative
      makeProject({ id: 'P2', sale_date: '2026-01-01', install_complete_date: '2026-02-01' }), // 31 days
    ]
    const m = computeMetrics(projects, [])
    expect(m.avgSaleToInstall).toBe(31)
  })
})

describe('Mobile Leadership — aging projects count', () => {
  it('counts active projects with > 90 cycle days', () => {
    const projects = [
      makeProject({ id: 'P1', sale_date: daysAgoDate(100), stage: 'design' }),
      makeProject({ id: 'P2', sale_date: daysAgoDate(50), stage: 'permit' }),
      makeProject({ id: 'P3', sale_date: daysAgoDate(200), stage: 'complete' }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.agingCount).toBe(1) // P1 only (P3 is complete)
  })

  it('falls back to stage_date when sale_date returns 0 days', () => {
    const projects = [
      makeProject({ id: 'P1', sale_date: null, stage_date: daysAgoDate(95), stage: 'design' }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.agingCount).toBe(1)
  })

  it('returns zero when no projects exceed 90 days', () => {
    const projects = [
      makeProject({ id: 'P1', sale_date: daysAgoDate(10), stage: 'design' }),
    ]
    const m = computeMetrics(projects, [])
    expect(m.agingCount).toBe(0)
  })
})
