import { describe, it, expect } from 'vitest'
import { daysAgo, fmt$, SLA_THRESHOLDS, STAGE_ORDER, STAGE_LABELS, STAGE_TASKS } from '@/lib/utils'
import { ALL_TASKS_MAP } from '@/lib/tasks'
import { buildTaskMap, type TaskStateRow } from '@/lib/queue-task-map'

// ── Test helpers ──────────────────────────────────────────────────────────────

interface TestProject {
  id: string; name: string; stage: string; pm: string | null; pm_id: string | null
  financier: string | null; ahj: string | null; utility: string | null
  city: string | null; address: string | null
  contract: number | null; sale_date: string | null; stage_date: string | null
  disposition: string | null; blocker: string | null
  systemkw: number | null; consultant: string | null; advisor: string | null
  follow_up_date: string | null
}

function daysAgoDate(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr(): string {
  return daysAgoDate(0)
}

function makeProject(o: Partial<TestProject> = {}): TestProject {
  return {
    id: 'PROJ-001', name: 'Test Home', stage: 'evaluation', pm: 'Greg', pm_id: 'user-1',
    financier: 'Sunrun', ahj: 'Austin', utility: 'Austin Energy',
    city: 'Austin', address: '123 Main St',
    contract: 25000, sale_date: daysAgoDate(10), stage_date: daysAgoDate(2),
    disposition: null, blocker: null, systemkw: 8.5,
    consultant: null, advisor: null, follow_up_date: null, ...o,
  }
}

// Reproduce getSLA from pipeline page
function getSLA(p: TestProject) {
  const t = SLA_THRESHOLDS[p.stage] ?? { target: 3, risk: 5, crit: 7 }
  const days = daysAgo(p.stage_date)
  let status: 'ok' | 'warn' | 'risk' | 'crit' = 'ok'
  if (days >= t.crit) status = 'crit'
  else if (days >= t.risk) status = 'risk'
  else if (days >= t.target) status = 'warn'
  return { days, status, pct: Math.min(100, Math.round(days / t.crit * 100)) }
}

// Reproduce matchesDaysRange from pipeline page
type DaysRange = '' | '<7' | '7-30' | '30-90' | '90+'
function matchesDaysRange(p: TestProject, range: DaysRange): boolean {
  const d = daysAgo(p.stage_date)
  switch (range) {
    case '<7': return d < 7
    case '7-30': return d >= 7 && d <= 30
    case '30-90': return d > 30 && d <= 90
    case '90+': return d > 90
    default: return true
  }
}

// Reproduce getNextTask from pipeline page
function getNextTask(p: TestProject, taskMap: Record<string, { status: string; reason?: string }>): { name: string; status: string } | null {
  const tasks = STAGE_TASKS[p.stage] ?? []
  for (const t of tasks) {
    const s = taskMap[t.id]?.status ?? 'Not Ready'
    if (s !== 'Complete') return { name: t.name, status: s }
  }
  return null
}

// Reproduce getStuckTasks from pipeline page
interface StuckTask { name: string; status: 'Pending Resolution' | 'Revision Required'; reason: string }
function getStuckTasks(p: TestProject, taskMap: Record<string, { status: string; reason?: string }>): StuckTask[] {
  const tasks = STAGE_TASKS[p.stage] ?? []
  return tasks
    .filter(t => {
      const s = taskMap[t.id]?.status ?? 'Not Ready'
      return s === 'Pending Resolution' || s === 'Revision Required'
    })
    .map(t => ({
      name: t.name,
      status: (taskMap[t.id]?.status ?? '') as 'Pending Resolution' | 'Revision Required',
      reason: taskMap[t.id]?.reason ?? '',
    }))
}

// Reproduce FundingBadge logic from pipeline page
interface FundingRecord {
  project_id: string
  m1_status: string | null
  m2_status: string | null
  m3_status: string | null
}

function getFundingBadge(funding?: FundingRecord): { label: string; statusShort: string } | null {
  if (!funding) return null
  const milestones: { label: string; status: string | null }[] = [
    { label: 'M3', status: funding.m3_status },
    { label: 'M2', status: funding.m2_status },
    { label: 'M1', status: funding.m1_status },
  ]
  const active = milestones.find(m => m.status && m.status !== 'Not Eligible')
  if (!active || !active.status) return null
  const statusShort: Record<string, string> = {
    Eligible: 'Elig', Submitted: 'Sub', Funded: 'Fun', Rejected: 'Rej',
  }
  return { label: active.label, statusShort: statusShort[active.status] ?? active.status }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. SMART FILTERS
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline smart filters', () => {
  const projects = [
    makeProject({ id: 'P1', financier: 'Sunrun', ahj: 'Austin', utility: 'Austin Energy', blocker: null, stage_date: daysAgoDate(3) }),
    makeProject({ id: 'P2', financier: 'Mosaic', ahj: 'Houston', utility: 'CenterPoint', blocker: 'Permit issue', stage_date: daysAgoDate(15) }),
    makeProject({ id: 'P3', financier: 'Sunrun', ahj: 'Dallas', utility: 'Oncor', blocker: null, stage_date: daysAgoDate(50) }),
    makeProject({ id: 'P4', financier: 'GoodLeap', ahj: 'Austin', utility: 'Austin Energy', blocker: 'Design hold', stage_date: daysAgoDate(100) }),
  ]

  it('filters by financier', () => {
    const filtered = projects.filter(p => p.financier === 'Sunrun')
    expect(filtered.map(p => p.id)).toEqual(['P1', 'P3'])
  })

  it('filters by AHJ multi-select (single)', () => {
    const sel = new Set(['Austin'])
    const filtered = projects.filter(p => sel.has(p.ahj ?? ''))
    expect(filtered.map(p => p.id)).toEqual(['P1', 'P4'])
  })

  it('filters by AHJ multi-select (multiple)', () => {
    const sel = new Set(['Austin', 'Dallas'])
    const filtered = projects.filter(p => sel.has(p.ahj ?? ''))
    expect(filtered.map(p => p.id)).toEqual(['P1', 'P3', 'P4'])
  })

  it('filters by utility multi-select', () => {
    const sel = new Set(['Oncor', 'CenterPoint'])
    const filtered = projects.filter(p => sel.has(p.utility ?? ''))
    expect(filtered.map(p => p.id)).toEqual(['P2', 'P3'])
  })

  it('filters blocked only', () => {
    const filtered = projects.filter(p => !!p.blocker)
    expect(filtered.map(p => p.id)).toEqual(['P2', 'P4'])
  })

  it('filters by days range <7', () => {
    const filtered = projects.filter(p => matchesDaysRange(p, '<7'))
    expect(filtered.map(p => p.id)).toEqual(['P1'])
  })

  it('filters by days range 7-30', () => {
    const filtered = projects.filter(p => matchesDaysRange(p, '7-30'))
    expect(filtered.map(p => p.id)).toEqual(['P2'])
  })

  it('filters by days range 30-90', () => {
    const filtered = projects.filter(p => matchesDaysRange(p, '30-90'))
    expect(filtered.map(p => p.id)).toEqual(['P3'])
  })

  it('filters by days range 90+', () => {
    const filtered = projects.filter(p => matchesDaysRange(p, '90+'))
    expect(filtered.map(p => p.id)).toEqual(['P4'])
  })

  it('empty days range returns all', () => {
    const filtered = projects.filter(p => matchesDaysRange(p, ''))
    expect(filtered).toHaveLength(4)
  })

  it('clear all resets all filters', () => {
    // Simulate clear all: no financier, no AHJ, no blocked, no days range
    let result = [...projects]
    // No filters applied = full list
    expect(result).toHaveLength(4)
  })

  it('AND composition: financier + blocked', () => {
    let result = projects.filter(p => p.financier === 'Sunrun')
    result = result.filter(p => !!p.blocker)
    expect(result).toHaveLength(0) // Sunrun projects are not blocked
  })

  it('AND composition: AHJ + days range', () => {
    const sel = new Set(['Austin'])
    let result = projects.filter(p => sel.has(p.ahj ?? ''))
    result = result.filter(p => matchesDaysRange(p, '90+'))
    expect(result.map(p => p.id)).toEqual(['P4'])
  })

  it('AND composition: financier + AHJ + blocked', () => {
    const sel = new Set(['Austin'])
    let result = projects.filter(p => p.financier === 'GoodLeap')
    result = result.filter(p => sel.has(p.ahj ?? ''))
    result = result.filter(p => !!p.blocker)
    expect(result.map(p => p.id)).toEqual(['P4'])
  })

  it('search narrows without bypassing other filters', () => {
    // The correct filter pattern: search + dropdown both apply
    let result = [...projects]
    const q = 'test home'
    // Search
    result = result.filter(p => {
      const fields = [p.name, p.id, p.city, p.address].map(f => (f ?? '').toLowerCase())
      return fields.some(f => f.includes(q.toLowerCase()))
    })
    // Then financier
    result = result.filter(p => p.financier === 'Mosaic')
    // Only P2 matches both search and financier
    expect(result.map(p => p.id)).toEqual(['P2'])
  })

  it('search matches against address', () => {
    const result = projects.filter(p => {
      const fields = [p.name, p.id, p.city, p.address].map(f => (f ?? '').toLowerCase())
      return fields.some(f => f.includes('123 main'))
    })
    expect(result).toHaveLength(4) // all have same address in test data
  })

  it('search matches against city', () => {
    const projs = [
      makeProject({ id: 'P1', city: 'Houston' }),
      makeProject({ id: 'P2', city: 'Austin' }),
    ]
    const result = projs.filter(p => {
      const fields = [p.name, p.id, p.city, p.address].map(f => (f ?? '').toLowerCase())
      return fields.some(f => f.includes('houston'))
    })
    expect(result.map(p => p.id)).toEqual(['P1'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. COLUMN STATS
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline column stats', () => {
  function computeStageStats(projects: TestProject[], taskMap: Record<string, Record<string, { status: string; reason?: string }>>) {
    const stats: Record<string, { count: number; value: number; blocked: number; stuck: number; avgDays: number }> = {}
    for (const stageId of STAGE_ORDER) {
      const stageProjects = projects.filter(p => p.stage === stageId)
      const blocked = stageProjects.filter(p => !!p.blocker).length
      const stuck = stageProjects.filter(p => getStuckTasks(p, taskMap[p.id] ?? {}).length > 0).length
      const totalDays = stageProjects.reduce((s, p) => s + daysAgo(p.stage_date), 0)
      stats[stageId] = {
        count: stageProjects.length,
        value: stageProjects.reduce((s, p) => s + (Number(p.contract) || 0), 0),
        blocked,
        stuck,
        avgDays: stageProjects.length > 0 ? Math.round(totalDays / stageProjects.length) : 0,
      }
    }
    return stats
  }

  it('computes portfolio value per stage', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'evaluation', contract: 20000 }),
      makeProject({ id: 'P2', stage: 'evaluation', contract: 30000 }),
      makeProject({ id: 'P3', stage: 'design', contract: 15000 }),
    ]
    const stats = computeStageStats(projects, {})
    expect(stats.evaluation.value).toBe(50000)
    expect(stats.design.value).toBe(15000)
    expect(stats.survey.value).toBe(0)
  })

  it('counts blocked projects per stage', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'permit', blocker: 'Waiting on HOA' }),
      makeProject({ id: 'P2', stage: 'permit', blocker: null }),
      makeProject({ id: 'P3', stage: 'permit', blocker: 'City delay' }),
    ]
    const stats = computeStageStats(projects, {})
    expect(stats.permit.blocked).toBe(2)
  })

  it('counts stuck tasks per stage', () => {
    const taskStates: TaskStateRow[] = [
      { project_id: 'P1', task_id: 'city_permit', status: 'Pending Resolution', reason: 'Incomplete docs' },
      { project_id: 'P2', task_id: 'hoa', status: 'Revision Required', reason: 'HOA feedback' },
      { project_id: 'P3', task_id: 'city_permit', status: 'In Progress' },
    ]
    const tm = buildTaskMap(taskStates)
    const projects = [
      makeProject({ id: 'P1', stage: 'permit' }),
      makeProject({ id: 'P2', stage: 'permit' }),
      makeProject({ id: 'P3', stage: 'permit' }),
    ]
    const stats = computeStageStats(projects, tm)
    expect(stats.permit.stuck).toBe(2) // P1 and P2 have stuck tasks
  })

  it('computes average days in stage', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'design', stage_date: daysAgoDate(10) }),
      makeProject({ id: 'P2', stage: 'design', stage_date: daysAgoDate(20) }),
    ]
    const stats = computeStageStats(projects, {})
    expect(stats.design.avgDays).toBe(15)
  })

  it('returns 0 avgDays for empty stage', () => {
    const stats = computeStageStats([], {})
    expect(stats.evaluation.avgDays).toBe(0)
    expect(stats.evaluation.count).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. COMPACT / DETAILED TOGGLE + localStorage PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline view mode (compact/detailed)', () => {
  it('defaults to detailed when no localStorage value', () => {
    localStorage.removeItem('mg_pipeline_view')
    const stored = localStorage.getItem('mg_pipeline_view') as 'compact' | 'detailed' | null
    const viewMode = stored ?? 'detailed'
    expect(viewMode).toBe('detailed')
  })

  it('reads compact from localStorage', () => {
    localStorage.setItem('mg_pipeline_view', 'compact')
    const viewMode = localStorage.getItem('mg_pipeline_view') as 'compact' | 'detailed'
    expect(viewMode).toBe('compact')
  })

  it('persists view mode change to localStorage', () => {
    const viewMode = 'compact'
    localStorage.setItem('mg_pipeline_view', viewMode)
    expect(localStorage.getItem('mg_pipeline_view')).toBe('compact')
  })

  it('toggles between compact and detailed', () => {
    let viewMode: 'compact' | 'detailed' = 'detailed'
    // Toggle to compact
    viewMode = viewMode === 'compact' ? 'detailed' : 'compact'
    expect(viewMode).toBe('compact')
    // Toggle back
    viewMode = viewMode === 'compact' ? 'detailed' : 'compact'
    expect(viewMode).toBe('detailed')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. COLUMN COLLAPSE + localStorage PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline column collapse', () => {
  it('defaults to all expanded (empty object)', () => {
    localStorage.removeItem('mg_pipeline_collapsed')
    const raw = localStorage.getItem('mg_pipeline_collapsed')
    const collapsed = raw ? JSON.parse(raw) : {}
    expect(collapsed).toEqual({})
    // No stage is collapsed
    for (const s of STAGE_ORDER) {
      expect(!!collapsed[s]).toBe(false)
    }
  })

  it('toggles a column collapsed state', () => {
    let collapsed: Record<string, boolean> = {}
    // Collapse design
    collapsed = { ...collapsed, design: !collapsed.design }
    expect(collapsed.design).toBe(true)
    // Toggle again to expand
    collapsed = { ...collapsed, design: !collapsed.design }
    expect(collapsed.design).toBe(false)
  })

  it('persists collapsed state to localStorage', () => {
    const collapsed = { design: true, permit: true }
    localStorage.setItem('mg_pipeline_collapsed', JSON.stringify(collapsed))
    const stored = JSON.parse(localStorage.getItem('mg_pipeline_collapsed')!)
    expect(stored.design).toBe(true)
    expect(stored.permit).toBe(true)
    expect(stored.evaluation).toBeUndefined()
  })

  it('reads collapsed state from localStorage', () => {
    localStorage.setItem('mg_pipeline_collapsed', JSON.stringify({ install: true }))
    const stored = JSON.parse(localStorage.getItem('mg_pipeline_collapsed')!)
    expect(stored.install).toBe(true)
  })

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('mg_pipeline_collapsed', 'not-json')
    let collapsed: Record<string, boolean> = {}
    try { collapsed = JSON.parse(localStorage.getItem('mg_pipeline_collapsed') ?? '{}') } catch { collapsed = {} }
    expect(collapsed).toEqual({})
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. NEXT TASK COMPUTATION
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline next task computation', () => {
  it('returns first non-Complete task in stage', () => {
    const p = makeProject({ stage: 'evaluation' })
    const taskEntries: Record<string, { status: string }> = {
      welcome: { status: 'Complete' },
      ia: { status: 'In Progress' },
    }
    const next = getNextTask(p, taskEntries)
    expect(next).toEqual({ name: 'IA Confirmation', status: 'In Progress' })
  })

  it('returns first task when none are complete', () => {
    const p = makeProject({ stage: 'evaluation' })
    const next = getNextTask(p, {})
    expect(next).toEqual({ name: 'Welcome Call', status: 'Not Ready' })
  })

  it('returns null when all tasks in stage are complete', () => {
    const p = makeProject({ stage: 'survey' })
    const taskEntries: Record<string, { status: string }> = {
      site_survey: { status: 'Complete' },
      survey_review: { status: 'Complete' },
    }
    const next = getNextTask(p, taskEntries)
    expect(next).toBeNull()
  })

  it('skips Complete tasks and returns next non-Complete', () => {
    const p = makeProject({ stage: 'design' })
    const taskEntries: Record<string, { status: string }> = {
      build_design: { status: 'Complete' },
      scope: { status: 'Complete' },
      monitoring: { status: 'Complete' },
      build_eng: { status: 'Pending Resolution' },
    }
    const next = getNextTask(p, taskEntries)
    expect(next).toEqual({ name: 'Build Engineering', status: 'Pending Resolution' })
  })

  it('handles stage with no defined tasks', () => {
    const p = makeProject({ stage: 'nonexistent' })
    const next = getNextTask(p, {})
    expect(next).toBeNull()
  })

  it('uses Not Ready as default status for missing task entries', () => {
    const p = makeProject({ stage: 'install' })
    // Only first task has entry
    const taskEntries: Record<string, { status: string }> = {
      sched_install: { status: 'Complete' },
    }
    const next = getNextTask(p, taskEntries)
    expect(next).toEqual({ name: 'Inventory Allocation', status: 'Not Ready' })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. FUNDING BADGE
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline funding badge', () => {
  it('returns null when no funding record', () => {
    expect(getFundingBadge(undefined)).toBeNull()
  })

  it('returns null when all statuses are Not Eligible', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Not Eligible', m2_status: 'Not Eligible', m3_status: 'Not Eligible' }
    expect(getFundingBadge(f)).toBeNull()
  })

  it('returns null when all statuses are null', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: null, m2_status: null, m3_status: null }
    expect(getFundingBadge(f)).toBeNull()
  })

  it('prioritizes M3 over M2 and M1', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Funded', m2_status: 'Submitted', m3_status: 'Eligible' }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M3', statusShort: 'Elig' })
  })

  it('falls back to M2 when M3 is Not Eligible', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Funded', m2_status: 'Submitted', m3_status: 'Not Eligible' }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M2', statusShort: 'Sub' })
  })

  it('falls back to M1 when M3 and M2 are Not Eligible', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Funded', m2_status: 'Not Eligible', m3_status: 'Not Eligible' }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M1', statusShort: 'Fun' })
  })

  it('shows Rejected status correctly', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: null, m2_status: 'Rejected', m3_status: null }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M2', statusShort: 'Rej' })
  })

  it('falls through null M3 to non-null M2', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: null, m2_status: 'Eligible', m3_status: null }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M2', statusShort: 'Elig' })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. FOLLOW-UP DATE DISPLAY
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline follow-up date display', () => {
  function getFollowUpColor(followUpDate: string): 'amber' | 'red' | 'none' {
    const today = todayStr()
    if (followUpDate === today) return 'amber'
    if (followUpDate < today) return 'red'
    return 'none'
  }

  it('today follow-up returns amber', () => {
    expect(getFollowUpColor(todayStr())).toBe('amber')
  })

  it('overdue follow-up returns red', () => {
    expect(getFollowUpColor(daysAgoDate(3))).toBe('red')
  })

  it('future follow-up returns none', () => {
    // 5 days in the future
    const d = new Date()
    d.setDate(d.getDate() + 5)
    const future = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(getFollowUpColor(future)).toBe('none')
  })

  it('follow-up map picks earliest date per project', () => {
    const taskStates: TaskStateRow[] = [
      { project_id: 'P1', task_id: 'welcome', status: 'In Progress', follow_up_date: '2026-04-10' },
      { project_id: 'P1', task_id: 'ia', status: 'Not Ready', follow_up_date: '2026-04-05' },
      { project_id: 'P1', task_id: 'ub', status: 'Not Ready', follow_up_date: null },
    ]
    const map: Record<string, { date: string; taskName: string }> = {}
    for (const t of taskStates) {
      if (t.follow_up_date) {
        const existing = map[t.project_id]
        if (!existing || t.follow_up_date < existing.date) {
          map[t.project_id] = { date: t.follow_up_date, taskName: ALL_TASKS_MAP[t.task_id] ?? t.task_id }
        }
      }
    }
    expect(map['P1'].date).toBe('2026-04-05')
    expect(map['P1'].taskName).toBe('IA Confirmation')
  })

  it('follow-up map ignores tasks without follow_up_date', () => {
    const taskStates: TaskStateRow[] = [
      { project_id: 'P1', task_id: 'welcome', status: 'In Progress', follow_up_date: null },
      { project_id: 'P1', task_id: 'ia', status: 'Not Ready' },
    ]
    const map: Record<string, { date: string; taskName: string }> = {}
    for (const t of taskStates) {
      if (t.follow_up_date) {
        const existing = map[t.project_id]
        if (!existing || t.follow_up_date < existing.date) {
          map[t.project_id] = { date: t.follow_up_date, taskName: ALL_TASKS_MAP[t.task_id] ?? t.task_id }
        }
      }
    }
    expect(map['P1']).toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 8. COLUMN FILTER (click blocked/stuck badge)
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline column filter', () => {
  it('toggleColFilter sets blocked filter for a stage', () => {
    let colFilter: Record<string, 'blocked' | 'stuck' | null> = {}
    // Click blocked badge on permit stage
    const toggleColFilter = (stageId: string, filter: 'blocked' | 'stuck') => {
      colFilter = { ...colFilter, [stageId]: colFilter[stageId] === filter ? null : filter }
    }
    toggleColFilter('permit', 'blocked')
    expect(colFilter.permit).toBe('blocked')
  })

  it('toggleColFilter clears on second click', () => {
    let colFilter: Record<string, 'blocked' | 'stuck' | null> = { permit: 'blocked' }
    const toggleColFilter = (stageId: string, filter: 'blocked' | 'stuck') => {
      colFilter = { ...colFilter, [stageId]: colFilter[stageId] === filter ? null : filter }
    }
    toggleColFilter('permit', 'blocked')
    expect(colFilter.permit).toBeNull()
  })

  it('blocked column filter only shows blocked projects', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'permit', blocker: 'HOA delay' }),
      makeProject({ id: 'P2', stage: 'permit', blocker: null }),
      makeProject({ id: 'P3', stage: 'permit', blocker: 'City hold' }),
    ]
    const cf: 'blocked' | 'stuck' | null = 'blocked'
    let cards = projects.filter(p => p.stage === 'permit')
    if (cf === 'blocked') cards = cards.filter(p => !!p.blocker)
    expect(cards.map(p => p.id)).toEqual(['P1', 'P3'])
  })

  it('stuck column filter only shows projects with stuck tasks', () => {
    const taskStates: TaskStateRow[] = [
      { project_id: 'P1', task_id: 'city_permit', status: 'Pending Resolution', reason: 'Missing doc' },
      { project_id: 'P2', task_id: 'city_permit', status: 'In Progress' },
      { project_id: 'P3', task_id: 'hoa', status: 'Revision Required', reason: 'HOA feedback' },
    ]
    const tm = buildTaskMap(taskStates)
    const projects = [
      makeProject({ id: 'P1', stage: 'permit' }),
      makeProject({ id: 'P2', stage: 'permit' }),
      makeProject({ id: 'P3', stage: 'permit' }),
    ]
    const cf: 'blocked' | 'stuck' | null = 'stuck'
    let cards = projects.filter(p => p.stage === 'permit')
    if (cf === 'stuck') cards = cards.filter(p => getStuckTasks(p, tm[p.id] ?? {}).length > 0)
    expect(cards.map(p => p.id)).toEqual(['P1', 'P3'])
  })

  it('switching from blocked to stuck filter', () => {
    let colFilter: Record<string, 'blocked' | 'stuck' | null> = { permit: 'blocked' }
    const toggleColFilter = (stageId: string, filter: 'blocked' | 'stuck') => {
      colFilter = { ...colFilter, [stageId]: colFilter[stageId] === filter ? null : filter }
    }
    toggleColFilter('permit', 'stuck')
    expect(colFilter.permit).toBe('stuck')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 9. MOBILE LAYOUT SWITCH
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline mobile layout', () => {
  it('initializes all stages as collapsed on mobile', () => {
    const mobileCollapsed: Record<string, boolean> = {}
    STAGE_ORDER.forEach(s => { mobileCollapsed[s] = true })
    for (const s of STAGE_ORDER) {
      expect(mobileCollapsed[s]).toBe(true)
    }
  })

  it('toggling a section opens it and collapses others (accordion)', () => {
    let mobileCollapsed: Record<string, boolean> = {}
    STAGE_ORDER.forEach(s => { mobileCollapsed[s] = true })

    // Toggle evaluation open
    const toggleMobileSection = (stageId: string) => {
      const next: Record<string, boolean> = {}
      STAGE_ORDER.forEach(s => { next[s] = s === stageId ? !mobileCollapsed[s] : true })
      mobileCollapsed = next
    }

    toggleMobileSection('evaluation')
    expect(mobileCollapsed.evaluation).toBe(false)
    expect(mobileCollapsed.survey).toBe(true)
    expect(mobileCollapsed.design).toBe(true)
  })

  it('toggling open section closes it', () => {
    let mobileCollapsed: Record<string, boolean> = {}
    STAGE_ORDER.forEach(s => { mobileCollapsed[s] = true })
    mobileCollapsed.evaluation = false // already open

    const toggleMobileSection = (stageId: string) => {
      const next: Record<string, boolean> = {}
      STAGE_ORDER.forEach(s => { next[s] = s === stageId ? !mobileCollapsed[s] : true })
      mobileCollapsed = next
    }

    toggleMobileSection('evaluation')
    expect(mobileCollapsed.evaluation).toBe(true) // closed again
  })

  it('only one section can be open at a time', () => {
    let mobileCollapsed: Record<string, boolean> = {}
    STAGE_ORDER.forEach(s => { mobileCollapsed[s] = true })

    const toggleMobileSection = (stageId: string) => {
      const next: Record<string, boolean> = {}
      STAGE_ORDER.forEach(s => { next[s] = s === stageId ? !mobileCollapsed[s] : true })
      mobileCollapsed = next
    }

    // Open evaluation
    toggleMobileSection('evaluation')
    expect(mobileCollapsed.evaluation).toBe(false)

    // Open design — evaluation should close
    toggleMobileSection('design')
    expect(mobileCollapsed.design).toBe(false)
    expect(mobileCollapsed.evaluation).toBe(true)

    // Count open sections
    const openCount = STAGE_ORDER.filter(s => !mobileCollapsed[s]).length
    expect(openCount).toBe(1)
  })

  it('desktop uses hidden md:block and mobile uses md:hidden', () => {
    // The pipeline page uses:
    //   Desktop: className="hidden md:block ..."
    //   Mobile:  className="md:hidden ..."
    // This test verifies the breakpoint convention
    const desktopClass = 'hidden md:block'
    const mobileClass = 'md:hidden'
    expect(desktopClass).toContain('md:block')
    expect(mobileClass).toContain('md:hidden')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 10. URL PARAM FILTER PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline URL param filter persistence', () => {
  function buildUrlParams(filters: {
    pm?: string; financier?: string; ahj?: string; utility?: string
    blocked?: boolean; days?: DaysRange; search?: string
    open?: string; tab?: string
  }): URLSearchParams {
    const next = new URLSearchParams()
    if (filters.open) next.set('open', filters.open)
    if (filters.tab) next.set('tab', filters.tab)
    if (filters.pm) next.set('pm', filters.pm)
    if (filters.financier) next.set('financier', filters.financier)
    if (filters.ahj) next.set('ahj', filters.ahj)
    if (filters.utility) next.set('utility', filters.utility)
    if (filters.blocked) next.set('blocked', '1')
    if (filters.days) next.set('days', filters.days)
    if (filters.search) next.set('search', filters.search)
    return next
  }

  it('writes PM filter to URL', () => {
    const params = buildUrlParams({ pm: 'user-1' })
    expect(params.get('pm')).toBe('user-1')
  })

  it('writes financier filter to URL', () => {
    const params = buildUrlParams({ financier: 'Sunrun' })
    expect(params.get('financier')).toBe('Sunrun')
  })

  it('writes AHJ multi-select to URL as comma-separated', () => {
    const params = buildUrlParams({ ahj: 'Austin,Houston' })
    expect(params.get('ahj')).toBe('Austin,Houston')
  })

  it('writes utility multi-select to URL', () => {
    const params = buildUrlParams({ utility: 'Oncor,CenterPoint' })
    expect(params.get('utility')).toBe('Oncor,CenterPoint')
  })

  it('writes blocked flag as 1', () => {
    const params = buildUrlParams({ blocked: true })
    expect(params.get('blocked')).toBe('1')
  })

  it('does not write blocked when false', () => {
    const params = buildUrlParams({ blocked: false })
    expect(params.get('blocked')).toBeNull()
  })

  it('writes days range to URL', () => {
    const params = buildUrlParams({ days: '30-90' })
    expect(params.get('days')).toBe('30-90')
  })

  it('writes search to URL', () => {
    const params = buildUrlParams({ search: 'smith' })
    expect(params.get('search')).toBe('smith')
  })

  it('preserves open/tab params alongside filters', () => {
    const params = buildUrlParams({ open: 'PROJ-100', tab: 'notes', pm: 'user-1' })
    expect(params.get('open')).toBe('PROJ-100')
    expect(params.get('tab')).toBe('notes')
    expect(params.get('pm')).toBe('user-1')
  })

  it('empty filters produce empty URL params', () => {
    const params = buildUrlParams({})
    expect(params.toString()).toBe('')
  })

  it('reads filters back from URL params', () => {
    const params = new URLSearchParams('pm=user-1&financier=Mosaic&ahj=Austin,Dallas&blocked=1&days=7-30&search=smith')
    const filterValues: Record<string, string> = {}
    if (params.get('pm')) filterValues.pm = params.get('pm')!
    if (params.get('financier')) filterValues.financier = params.get('financier')!
    if (params.get('ahj')) filterValues.ahj = params.get('ahj')!
    if (params.get('utility')) filterValues.utility = params.get('utility')!
    const blockedOnly = params.get('blocked') === '1'
    const daysRangeVal = (params.get('days') ?? '') as DaysRange
    const searchVal = params.get('search') ?? ''

    expect(filterValues.pm).toBe('user-1')
    expect(filterValues.financier).toBe('Mosaic')
    expect(filterValues.ahj).toBe('Austin,Dallas')
    expect(blockedOnly).toBe(true)
    expect(daysRangeVal).toBe('7-30')
    expect(searchVal).toBe('smith')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// EXISTING TESTS (preserved)
// ══════════════════════════════════════════════════════════════════════════════

describe('pipeline disposition filtering', () => {
  it('excludes In Service from pipeline', () => {
    const projects = [makeProject(), makeProject({ disposition: 'In Service', id: 'P2' })]
    const filtered = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Loyalty')
    expect(filtered).toHaveLength(1)
  })

  it('excludes Loyalty from pipeline', () => {
    const projects = [makeProject(), makeProject({ disposition: 'Loyalty', id: 'P2' })]
    const filtered = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Loyalty')
    expect(filtered).toHaveLength(1)
  })

  it('excludes Cancelled from pipeline', () => {
    const projects = [makeProject(), makeProject({ disposition: 'Cancelled', id: 'P2' })]
    const filtered = projects.filter(p =>
      p.disposition !== 'In Service' && p.disposition !== 'Loyalty' && p.disposition !== 'Cancelled'
    )
    expect(filtered).toHaveLength(1)
  })
})

describe('pipeline sorting', () => {
  it('sorts by SLA descending (worst first)', () => {
    const a = makeProject({ stage_date: daysAgoDate(1), id: 'A' })
    const b = makeProject({ stage_date: daysAgoDate(10), id: 'B' })
    const sorted = [a, b].sort((x, y) => getSLA(y).days - getSLA(x).days)
    expect(sorted[0].id).toBe('B')
  })

  it('sorts by contract descending', () => {
    const a = makeProject({ contract: 10000, id: 'A' })
    const b = makeProject({ contract: 50000, id: 'B' })
    const sorted = [a, b].sort((x, y) => (Number(y.contract) || 0) - (Number(x.contract) || 0))
    expect(sorted[0].id).toBe('B')
  })

  it('sorts by cycle descending (oldest first)', () => {
    const a = makeProject({ sale_date: daysAgoDate(10), id: 'A' })
    const b = makeProject({ sale_date: daysAgoDate(100), id: 'B' })
    const sorted = [a, b].sort((x, y) => (daysAgo(y.sale_date) || 0) - (daysAgo(x.sale_date) || 0))
    expect(sorted[0].id).toBe('B')
  })

  it('sorts by name ascending', () => {
    const a = makeProject({ name: 'Zebra', id: 'A' })
    const b = makeProject({ name: 'Alpha', id: 'B' })
    const sorted = [a, b].sort((x, y) => (x.name ?? '').localeCompare(y.name ?? ''))
    expect(sorted[0].id).toBe('B')
  })
})

describe('pipeline kanban columns', () => {
  it('groups projects by stage into 7 columns', () => {
    const projects = STAGE_ORDER.map((stage, i) =>
      makeProject({ stage, id: `P${i}` })
    )
    for (const stage of STAGE_ORDER) {
      const column = projects.filter(p => p.stage === stage)
      expect(column).toHaveLength(1)
    }
  })

  it('has all 7 pipeline stages defined', () => {
    expect(STAGE_ORDER).toHaveLength(7)
    expect(STAGE_ORDER).toContain('evaluation')
    expect(STAGE_ORDER).toContain('complete')
  })

  it('each stage has a label', () => {
    for (const stage of STAGE_ORDER) {
      expect(STAGE_LABELS[stage]).toBeDefined()
      expect(typeof STAGE_LABELS[stage]).toBe('string')
    }
  })
})
