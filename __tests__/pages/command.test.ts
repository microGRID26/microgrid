import { describe, it, expect } from 'vitest'
import { daysAgo, SLA_THRESHOLDS, STAGE_TASKS, STAGE_ORDER } from '@/lib/utils'
import { classify, cycleDays, getSLA, getStuckTasks } from '@/lib/classify'
import type { TaskEntry } from '@/lib/classify'
import type { Project } from '@/types/database'

// ── Helpers ────────────────────────────────────────────────────────────────────

function daysAgoDate(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function todayStr(): string { return daysAgoDate(0) }

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'PROJ-001', name: 'Test Project', stage: 'evaluation', pm: 'Greg', pm_id: 'user-greg',
    blocker: null, sale_date: daysAgoDate(10), stage_date: daysAgoDate(1),
    disposition: null, city: null, address: null, phone: null, email: null,
    contract: null, systemkw: null, financier: null, financing_type: null,
    consultant: null, advisor: null, dealer: null, follow_up_date: null,
    install_complete_date: null,
    ...overrides,
  } as unknown as Project
}

// Mirror the page's getNextTask logic
function getNextTask(p: Project, taskMap: Record<string, TaskEntry>): string {
  const tasks = STAGE_TASKS[p.stage] ?? []
  for (const t of tasks) {
    const status = taskMap[t.id]?.status ?? 'Not Ready'
    if (status !== 'Complete') return t.name
  }
  return '—'
}

// Mirror the page's table sort logic
type SortCol = 'name' | 'stage' | 'days' | 'blocker' | 'nextTask' | 'contract' | 'followUp'
type SortDir = 'asc' | 'desc'

function sortProjects(
  list: Project[],
  sortCol: SortCol,
  sortDir: SortDir,
  taskMap: Record<string, Record<string, TaskEntry>>
): Project[] {
  return [...list].sort((a, b) => {
    let cmp = 0
    switch (sortCol) {
      case 'name':
        cmp = (a.name ?? '').localeCompare(b.name ?? '')
        break
      case 'stage': {
        const ai = STAGE_ORDER.indexOf(a.stage)
        const bi = STAGE_ORDER.indexOf(b.stage)
        cmp = ai - bi
        break
      }
      case 'days':
        cmp = daysAgo(a.stage_date) - daysAgo(b.stage_date)
        break
      case 'blocker':
        cmp = (a.blocker ? 1 : 0) - (b.blocker ? 1 : 0)
        break
      case 'nextTask': {
        const ntA = getNextTask(a, taskMap[a.id] ?? {})
        const ntB = getNextTask(b, taskMap[b.id] ?? {})
        cmp = ntA.localeCompare(ntB)
        break
      }
      case 'contract':
        cmp = (Number(a.contract) || 0) - (Number(b.contract) || 0)
        break
      case 'followUp':
        cmp = (a.follow_up_date ?? '9999').localeCompare(b.follow_up_date ?? '9999')
        break
    }
    return sortDir === 'asc' ? cmp : -cmp
  })
}

// Mirror the page's pipeline stage count logic
function pipelineCounts(projects: Project[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const s of STAGE_ORDER) c[s] = 0
  for (const p of projects) {
    if (p.disposition === 'Cancelled' || p.disposition === 'In Service' || p.disposition === 'Loyalty') continue
    c[p.stage] = (c[p.stage] ?? 0) + 1
  }
  return c
}

// ── TESTS ──────────────────────────────────────────────────────────────────────

describe('Auto-PM selection', () => {
  it('defaults pmFilter to currentUser.id, not "all"', () => {
    // The page initializes pmFilter to 'loading', then on first useEffect
    // sets it to currentUser.id when available
    const currentUser = { id: 'user-greg', name: 'Greg' }
    let pmFilter = 'loading'
    // Simulate the useEffect logic
    if (currentUser.id && pmFilter === 'loading') {
      pmFilter = currentUser.id
    }
    expect(pmFilter).toBe('user-greg')
    expect(pmFilter).not.toBe('all')
  })

  it('falls back to "all" when user has no projects', () => {
    const currentUser = { id: 'user-new' }
    let pmFilter = currentUser.id
    const projects = [
      makeProject({ pm_id: 'user-greg' }),
      makeProject({ pm_id: 'user-taylor', id: 'PROJ-002' }),
    ]
    // Simulate the fallback useEffect
    if (pmFilter !== 'loading' && pmFilter !== 'all' && projects.length > 0) {
      const hasProjects = projects.some(p => p.pm_id === pmFilter)
      if (!hasProjects) pmFilter = 'all'
    }
    expect(pmFilter).toBe('all')
  })

  it('keeps user PM filter when they have projects', () => {
    const currentUser = { id: 'user-greg' }
    let pmFilter = currentUser.id
    const projects = [
      makeProject({ pm_id: 'user-greg' }),
      makeProject({ pm_id: 'user-taylor', id: 'PROJ-002' }),
    ]
    if (pmFilter !== 'loading' && pmFilter !== 'all' && projects.length > 0) {
      const hasProjects = projects.some(p => p.pm_id === pmFilter)
      if (!hasProjects) pmFilter = 'all'
    }
    expect(pmFilter).toBe('user-greg')
  })
})

describe('My Projects / All toggle', () => {
  it('"My Projects" filters by pm_id', () => {
    const projects = [
      makeProject({ pm_id: 'user-greg', pm: 'Greg' }),
      makeProject({ pm_id: 'user-taylor', pm: 'Taylor', id: 'PROJ-002' }),
      makeProject({ pm_id: 'user-greg', pm: 'Greg', id: 'PROJ-003' }),
    ]
    const pmFilter = 'user-greg'
    const filtered = projects.filter(p => p.pm_id === pmFilter)
    expect(filtered).toHaveLength(2)
    expect(filtered.every(p => p.pm_id === 'user-greg')).toBe(true)
  })

  it('"All" shows all projects', () => {
    const projects = [
      makeProject({ pm_id: 'user-greg', pm: 'Greg' }),
      makeProject({ pm_id: 'user-taylor', pm: 'Taylor', id: 'PROJ-002' }),
    ]
    const pmFilter = 'all'
    const filtered = pmFilter === 'all' ? projects : projects.filter(p => p.pm_id === pmFilter)
    expect(filtered).toHaveLength(2)
  })

  it('isMyProjects is true when pmFilter is a user id', () => {
    const pmFilter = 'user-greg'
    const isMyProjects = pmFilter !== 'all' && pmFilter !== 'loading'
    expect(isMyProjects).toBe(true)
  })

  it('isMyProjects is false when pmFilter is "all"', () => {
    const pmFilter = 'all'
    const isMyProjects = pmFilter !== 'all' && pmFilter !== 'loading'
    expect(isMyProjects).toBe(false)
  })
})

describe('Personal stats', () => {
  it('active count excludes Cancelled, In Service, Loyalty, and complete', () => {
    const projects = [
      makeProject({ id: 'P-1', stage: 'evaluation' }),
      makeProject({ id: 'P-2', stage: 'design' }),
      makeProject({ id: 'P-3', stage: 'complete' }),
      makeProject({ id: 'P-4', disposition: 'Cancelled' }),
      makeProject({ id: 'P-5', disposition: 'In Service' }),
      makeProject({ id: 'P-6', disposition: 'Loyalty' }),
    ]
    const active = projects.filter(p =>
      p.disposition !== 'Cancelled' &&
      p.disposition !== 'In Service' &&
      p.disposition !== 'Loyalty' &&
      p.stage !== 'complete'
    )
    expect(active).toHaveLength(2)
  })

  it('blocked count is projects with non-null blocker in active set', () => {
    const projects = [
      makeProject({ id: 'P-1', blocker: 'Missing docs' }),
      makeProject({ id: 'P-2', blocker: 'Waiting on permit' }),
      makeProject({ id: 'P-3', blocker: null }),
      makeProject({ id: 'P-4', blocker: 'Issue', stage: 'complete' }), // complete, should not count
      makeProject({ id: 'P-5', blocker: 'Test', disposition: 'Cancelled' }), // cancelled
    ]
    const active = projects.filter(p =>
      p.disposition !== 'Cancelled' &&
      p.disposition !== 'In Service' &&
      p.disposition !== 'Loyalty' &&
      p.stage !== 'complete'
    )
    const blocked = active.filter(p => p.blocker)
    expect(blocked).toHaveLength(2)
  })

  it('follow-ups due counts tasks with follow_up_date <= today', () => {
    const today = todayStr()
    const followUpTasks = [
      { project_id: 'P-1', task_id: 'welcome', follow_up_date: daysAgoDate(2) }, // overdue
      { project_id: 'P-2', task_id: 'ia', follow_up_date: today },                // today
      { project_id: 'P-3', task_id: 'ub', follow_up_date: daysAgoDate(-3) },      // future, skip
    ]
    const due = followUpTasks.filter(t => t.follow_up_date && t.follow_up_date <= today)
    expect(due).toHaveLength(2)
  })

  it('follow-ups due includes project-level follow_up_date', () => {
    const today = todayStr()
    const projects = [
      makeProject({ id: 'P-1', follow_up_date: daysAgoDate(1) }),  // overdue
      makeProject({ id: 'P-2', follow_up_date: today }),            // today
      makeProject({ id: 'P-3', follow_up_date: daysAgoDate(-5) }), // future
      makeProject({ id: 'P-4', follow_up_date: null }),             // no follow-up
    ]
    const active = projects.filter(p => p.stage !== 'complete' && p.disposition !== 'Cancelled')
    const projectFollowUps = active.filter(p => p.follow_up_date && p.follow_up_date <= today)
    expect(projectFollowUps).toHaveLength(2)
  })

  it('installs this month counts install_complete_date in current month', () => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-15`
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15)
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth()+1).padStart(2,'0')}-15`

    const projects = [
      makeProject({ id: 'P-1', install_complete_date: thisMonth } as Partial<Project>),
      makeProject({ id: 'P-2', install_complete_date: thisMonth } as Partial<Project>),
      makeProject({ id: 'P-3', install_complete_date: lastMonthStr } as Partial<Project>),
      makeProject({ id: 'P-4', install_complete_date: null } as Partial<Project>),
    ]

    const year = now.getFullYear()
    const month = now.getMonth()
    const count = projects.filter(p => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (p as any).install_complete_date
      if (!d) return false
      const dt = new Date(d + 'T00:00:00')
      return dt.getFullYear() === year && dt.getMonth() === month
    }).length
    expect(count).toBe(2)
  })

  it('portfolio value sums contract amounts of active projects', () => {
    const projects = [
      makeProject({ id: 'P-1', contract: '50000' as unknown as null }),
      makeProject({ id: 'P-2', contract: '75000' as unknown as null }),
      makeProject({ id: 'P-3', contract: null }),
    ]
    const total = projects.reduce((s, p) => s + (Number(p.contract) || 0), 0)
    expect(total).toBe(125000)
  })

  it('portfolio value formats as $X.XM for millions', () => {
    const total = 2500000
    const formatted = total >= 1000000 ? `$${(total / 1000000).toFixed(1)}M` : `$${total.toLocaleString()}`
    expect(formatted).toBe('$2.5M')
  })
})

describe('Action items: follow-ups', () => {
  it('sorts follow-ups by days overdue descending', () => {
    const items = [
      { daysOverdue: 1 },
      { daysOverdue: 5 },
      { daysOverdue: 0 },
      { daysOverdue: 3 },
    ]
    const sorted = items.sort((a, b) => b.daysOverdue - a.daysOverdue)
    expect(sorted[0].daysOverdue).toBe(5)
    expect(sorted[1].daysOverdue).toBe(3)
    expect(sorted[2].daysOverdue).toBe(1)
    expect(sorted[3].daysOverdue).toBe(0)
  })

  it('respects PM filter for follow-ups', () => {
    const pmFilter = 'user-greg'
    const followUpItems = [
      { project: makeProject({ id: 'P-1', pm_id: 'user-greg' }), daysOverdue: 2 },
      { project: makeProject({ id: 'P-2', pm_id: 'user-taylor' }), daysOverdue: 1 },
    ]
    const filtered = followUpItems.filter(item =>
      pmFilter === 'all' || item.project.pm_id === pmFilter
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].project.id).toBe('P-1')
  })

  it('excludes future follow-up dates', () => {
    const today = todayStr()
    const dates = [daysAgoDate(2), today, daysAgoDate(-1), daysAgoDate(-7)]
    const due = dates.filter(d => d <= today)
    expect(due).toHaveLength(2)
  })
})

describe('Action items: blocked', () => {
  it('filters blocked projects by non-null blocker', () => {
    const projects = [
      makeProject({ id: 'P-1', blocker: 'Missing docs' }),
      makeProject({ id: 'P-2', blocker: null }),
      makeProject({ id: 'P-3', blocker: 'Waiting on homeowner' }),
    ]
    const active = projects.filter(p => p.stage !== 'complete' && p.disposition !== 'Cancelled')
    const blocked = active.filter(p => p.blocker)
    expect(blocked).toHaveLength(2)
  })

  it('sorts blocked by days in stage descending', () => {
    const projects = [
      makeProject({ id: 'P-1', blocker: 'A', stage_date: daysAgoDate(3) }),
      makeProject({ id: 'P-2', blocker: 'B', stage_date: daysAgoDate(10) }),
      makeProject({ id: 'P-3', blocker: 'C', stage_date: daysAgoDate(1) }),
    ]
    const sorted = projects
      .filter(p => p.blocker)
      .sort((a, b) => daysAgo(b.stage_date) - daysAgo(a.stage_date))
    expect(sorted[0].id).toBe('P-2')
    expect(sorted[1].id).toBe('P-1')
    expect(sorted[2].id).toBe('P-3')
  })

  it('excludes complete projects from blocked list', () => {
    const projects = [
      makeProject({ id: 'P-1', blocker: 'Issue', stage: 'complete' }),
      makeProject({ id: 'P-2', blocker: 'Issue', stage: 'permit' }),
    ]
    const active = projects.filter(p => p.stage !== 'complete')
    const blocked = active.filter(p => p.blocker)
    expect(blocked).toHaveLength(1)
    expect(blocked[0].id).toBe('P-2')
  })
})

describe('Action items: stuck tasks', () => {
  it('identifies Pending Resolution tasks as stuck', () => {
    const p = makeProject({ stage: 'evaluation' })
    const taskMap: Record<string, TaskEntry> = {
      welcome: { status: 'Complete', completed_date: null },
      ia: { status: 'Pending Resolution', reason: 'Missing info' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(1)
    expect(stuck[0].name).toBe('IA Confirmation')
    expect(stuck[0].status).toBe('Pending Resolution')
    expect(stuck[0].reason).toBe('Missing info')
  })

  it('identifies Revision Required tasks as stuck', () => {
    const p = makeProject({ stage: 'design' })
    const taskMap: Record<string, TaskEntry> = {
      build_design: { status: 'Complete', completed_date: null },
      scope: { status: 'Revision Required', reason: 'Design error' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(1)
    expect(stuck[0].name).toBe('Scope of Work')
    expect(stuck[0].status).toBe('Revision Required')
  })

  it('returns empty for projects with no stuck tasks', () => {
    const p = makeProject({ stage: 'evaluation' })
    const taskMap: Record<string, TaskEntry> = {
      welcome: { status: 'Complete', completed_date: null },
      ia: { status: 'In Progress' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(0)
  })

  it('returns multiple stuck tasks from same stage', () => {
    const p = makeProject({ stage: 'permit' })
    const taskMap: Record<string, TaskEntry> = {
      city_permit: { status: 'Pending Resolution', reason: 'Permit drop off' },
      util_permit: { status: 'Revision Required', reason: 'Wrong utility' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(2)
  })

  it('only checks tasks for the project current stage', () => {
    const p = makeProject({ stage: 'evaluation' })
    // design tasks should not be checked for an evaluation-stage project
    const taskMap: Record<string, TaskEntry> = {
      build_design: { status: 'Pending Resolution', reason: 'Issue' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(0)
  })
})

describe('Pipeline snapshot: stage counts', () => {
  it('counts projects per stage correctly', () => {
    const projects = [
      makeProject({ id: 'P-1', stage: 'evaluation' }),
      makeProject({ id: 'P-2', stage: 'evaluation' }),
      makeProject({ id: 'P-3', stage: 'design' }),
      makeProject({ id: 'P-4', stage: 'permit' }),
      makeProject({ id: 'P-5', stage: 'complete' }),
    ]
    const counts = pipelineCounts(projects)
    expect(counts.evaluation).toBe(2)
    expect(counts.design).toBe(1)
    expect(counts.permit).toBe(1)
    expect(counts.complete).toBe(1)
    expect(counts.survey).toBe(0)
  })

  it('excludes Cancelled, In Service, and Loyalty from pipeline counts', () => {
    const projects = [
      makeProject({ id: 'P-1', stage: 'evaluation' }),
      makeProject({ id: 'P-2', stage: 'evaluation', disposition: 'Cancelled' }),
      makeProject({ id: 'P-3', stage: 'design', disposition: 'In Service' }),
      makeProject({ id: 'P-4', stage: 'permit', disposition: 'Loyalty' }),
    ]
    const counts = pipelineCounts(projects)
    expect(counts.evaluation).toBe(1)
    expect(counts.design).toBe(0)
    expect(counts.permit).toBe(0)
  })

  it('initializes all stages to 0', () => {
    const counts = pipelineCounts([])
    for (const s of STAGE_ORDER) {
      expect(counts[s]).toBe(0)
    }
  })
})

describe('Project table sort', () => {
  const taskMap: Record<string, Record<string, TaskEntry>> = {}

  it('default sort is days descending (longest in stage first)', () => {
    const projects = [
      makeProject({ id: 'P-1', stage_date: daysAgoDate(2) }),
      makeProject({ id: 'P-2', stage_date: daysAgoDate(10) }),
      makeProject({ id: 'P-3', stage_date: daysAgoDate(5) }),
    ]
    const sorted = sortProjects(projects, 'days', 'desc', taskMap)
    expect(sorted[0].id).toBe('P-2')
    expect(sorted[1].id).toBe('P-3')
    expect(sorted[2].id).toBe('P-1')
  })

  it('sorts by blocker descending: blocked first', () => {
    const projects = [
      makeProject({ id: 'P-1', blocker: null }),
      makeProject({ id: 'P-2', blocker: 'Issue' }),
      makeProject({ id: 'P-3', blocker: null }),
      makeProject({ id: 'P-4', blocker: 'Another issue' }),
    ]
    const sorted = sortProjects(projects, 'blocker', 'desc', taskMap)
    // Blocked projects (blocker=1) should come first in desc order
    expect(sorted[0].blocker).toBeTruthy()
    expect(sorted[1].blocker).toBeTruthy()
    expect(sorted[2].blocker).toBeNull()
    expect(sorted[3].blocker).toBeNull()
  })

  it('sorts by name ascending', () => {
    const projects = [
      makeProject({ id: 'P-1', name: 'Charlie' }),
      makeProject({ id: 'P-2', name: 'Alpha' }),
      makeProject({ id: 'P-3', name: 'Bravo' }),
    ]
    const sorted = sortProjects(projects, 'name', 'asc', taskMap)
    expect(sorted[0].name).toBe('Alpha')
    expect(sorted[1].name).toBe('Bravo')
    expect(sorted[2].name).toBe('Charlie')
  })

  it('sorts by stage order', () => {
    const projects = [
      makeProject({ id: 'P-1', stage: 'permit' }),
      makeProject({ id: 'P-2', stage: 'evaluation' }),
      makeProject({ id: 'P-3', stage: 'install' }),
    ]
    const sorted = sortProjects(projects, 'stage', 'asc', taskMap)
    expect(sorted[0].stage).toBe('evaluation')
    expect(sorted[1].stage).toBe('permit')
    expect(sorted[2].stage).toBe('install')
  })

  it('sorts by contract value descending', () => {
    const projects = [
      makeProject({ id: 'P-1', contract: '30000' as unknown as null }),
      makeProject({ id: 'P-2', contract: '80000' as unknown as null }),
      makeProject({ id: 'P-3', contract: '50000' as unknown as null }),
    ]
    const sorted = sortProjects(projects, 'contract', 'desc', taskMap)
    expect(sorted[0].id).toBe('P-2')
    expect(sorted[1].id).toBe('P-3')
    expect(sorted[2].id).toBe('P-1')
  })

  it('sorts by follow-up date ascending (soonest first)', () => {
    const projects = [
      makeProject({ id: 'P-1', follow_up_date: daysAgoDate(-5) }),  // 5 days from now
      makeProject({ id: 'P-2', follow_up_date: null }),              // no follow-up (sorts last)
      makeProject({ id: 'P-3', follow_up_date: daysAgoDate(-1) }),  // tomorrow
    ]
    const sorted = sortProjects(projects, 'followUp', 'asc', taskMap)
    expect(sorted[0].id).toBe('P-3') // soonest
    expect(sorted[1].id).toBe('P-1')
    expect(sorted[2].id).toBe('P-2') // null sorts last ('9999')
  })

  it('sorts by nextTask alphabetically', () => {
    const tm: Record<string, Record<string, TaskEntry>> = {
      'P-1': { welcome: { status: 'Complete', completed_date: null } },  // next = IA Confirmation
      'P-2': {},                                                          // next = Welcome Call
      'P-3': {
        welcome: { status: 'Complete', completed_date: null },
        ia: { status: 'Complete', completed_date: null },
        ub: { status: 'Complete', completed_date: null },
      }, // next = Schedule Site Survey
    }
    const projects = [
      makeProject({ id: 'P-1', stage: 'evaluation' }),
      makeProject({ id: 'P-2', stage: 'evaluation' }),
      makeProject({ id: 'P-3', stage: 'evaluation' }),
    ]
    const sorted = sortProjects(projects, 'nextTask', 'asc', tm)
    // IA Confirmation < Schedule Site Survey < Welcome Call
    expect(sorted[0].id).toBe('P-1') // IA Confirmation
    expect(sorted[1].id).toBe('P-3') // Schedule Site Survey
    expect(sorted[2].id).toBe('P-2') // Welcome Call
  })
})

describe('Next task computation', () => {
  it('returns first non-Complete task in current stage', () => {
    const p = makeProject({ stage: 'evaluation' })
    const taskMap: Record<string, TaskEntry> = {
      welcome: { status: 'Complete', completed_date: '2026-01-01' },
      ia: { status: 'In Progress' },
    }
    expect(getNextTask(p, taskMap)).toBe('IA Confirmation')
  })

  it('returns first task when none are started', () => {
    const p = makeProject({ stage: 'evaluation' })
    expect(getNextTask(p, {})).toBe('Welcome Call')
  })

  it('returns dash when all tasks in stage are Complete', () => {
    const p = makeProject({ stage: 'survey' })
    const taskMap: Record<string, TaskEntry> = {
      site_survey: { status: 'Complete', completed_date: '2026-01-01' },
      survey_review: { status: 'Complete', completed_date: '2026-01-02' },
    }
    expect(getNextTask(p, taskMap)).toBe('—')
  })

  it('treats missing task_state as Not Ready', () => {
    const p = makeProject({ stage: 'design' })
    const taskMap: Record<string, TaskEntry> = {}
    // First task in design is 'Build Design'
    expect(getNextTask(p, taskMap)).toBe('Build Design')
  })

  it('skips Pending Resolution tasks correctly (they are not Complete)', () => {
    const p = makeProject({ stage: 'evaluation' })
    const taskMap: Record<string, TaskEntry> = {
      welcome: { status: 'Pending Resolution', reason: 'Issue' },
    }
    // Pending Resolution is not Complete, so it should be returned as the "next" task
    expect(getNextTask(p, taskMap)).toBe('Welcome Call')
  })

  it('works for each pipeline stage', () => {
    for (const stage of STAGE_ORDER) {
      const tasks = STAGE_TASKS[stage]
      if (!tasks || tasks.length === 0) continue
      const p = makeProject({ stage })
      expect(getNextTask(p, {})).toBe(tasks[0].name)
    }
  })
})

describe('Stage filter from pipeline bar click', () => {
  it('filters table to selected stage', () => {
    const projects = [
      makeProject({ id: 'P-1', stage: 'evaluation' }),
      makeProject({ id: 'P-2', stage: 'design' }),
      makeProject({ id: 'P-3', stage: 'evaluation' }),
      makeProject({ id: 'P-4', stage: 'permit' }),
    ]
    const stageFilter = 'evaluation'
    const filtered = projects.filter(p => p.stage === stageFilter)
    expect(filtered).toHaveLength(2)
    expect(filtered.every(p => p.stage === 'evaluation')).toBe(true)
  })

  it('shows all when stage filter is null (cleared)', () => {
    const projects = [
      makeProject({ id: 'P-1', stage: 'evaluation' }),
      makeProject({ id: 'P-2', stage: 'design' }),
    ]
    const stageFilter: string | null = null
    const filtered = stageFilter ? projects.filter(p => p.stage === stageFilter) : projects
    expect(filtered).toHaveLength(2)
  })

  it('clicking same stage toggles off (sets to null)', () => {
    let stageFilter: string | null = 'design'
    // Simulate: onStageClick(isActive ? null : stage)
    const clickedStage = 'design'
    const isActive = stageFilter === clickedStage
    stageFilter = isActive ? null : clickedStage
    expect(stageFilter).toBeNull()
  })

  it('clicking different stage switches filter', () => {
    let stageFilter: string | null = 'design'
    const clickedStage = 'permit'
    const isActive = stageFilter === clickedStage
    stageFilter = isActive ? null : clickedStage
    expect(stageFilter).toBe('permit')
  })
})

describe('Project classification (updated)', () => {
  it('classifies blocked projects', () => {
    const p = makeProject({ blocker: 'Missing docs' })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.blocked).toHaveLength(1)
    expect(c.ok).toHaveLength(0)
  })

  it('classifies stalled projects (5+ days, SLA ok)', () => {
    const p = makeProject({ stage: 'permit', stage_date: daysAgoDate(5) })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.stall).toHaveLength(1)
  })

  it('classifies aging projects (90+ cycle days)', () => {
    const p = makeProject({ sale_date: daysAgoDate(91), stage_date: daysAgoDate(1) })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.aging).toHaveLength(1)
  })

  it('classifies on-track projects', () => {
    const p = makeProject({ stage_date: daysAgoDate(1) })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.ok).toHaveLength(1)
  })

  it('separates Loyalty disposition', () => {
    const p = makeProject({ disposition: 'Loyalty' })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.loyalty).toHaveLength(1)
    expect(c.ok).toHaveLength(0)
  })

  it('separates In Service disposition', () => {
    const p = makeProject({ disposition: 'In Service' })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.inService).toHaveLength(1)
    expect(c.ok).toHaveLength(0)
  })

  it('blocked takes priority over critical', () => {
    const p = makeProject({ blocker: 'Issue', stage_date: daysAgoDate(100) })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.blocked).toHaveLength(1)
    expect(c.crit).toHaveLength(0)
  })

  it('overdue projects are identified by overduePids set', () => {
    const p = makeProject({ id: 'PROJ-OVERDUE' })
    const c = classify([p] as Project[], new Set(['PROJ-OVERDUE']), new Set())
    expect(c.overdue).toHaveLength(1)
  })

  it('complete projects are excluded from active sections', () => {
    const p = makeProject({ stage: 'complete' })
    const c = classify([p] as Project[], new Set(), new Set())
    expect(c.ok).toHaveLength(0)
    expect(c.blocked).toHaveLength(0)
    expect(c.crit).toHaveLength(0)
  })

  it('pending projects are identified by pendingPids set', () => {
    const p = makeProject({ id: 'PROJ-PEND', stage_date: daysAgoDate(1) })
    const c = classify([p] as Project[], new Set(), new Set(['PROJ-PEND']))
    expect(c.pending).toHaveLength(1)
  })
})

describe('PM filtering', () => {
  it('filters by pm_id (not pm name)', () => {
    const projects = [
      makeProject({ pm: 'Greg', pm_id: 'user-greg' }),
      makeProject({ pm: 'Taylor', pm_id: 'user-taylor', id: 'PROJ-002' }),
    ]
    const pmFilter = 'user-greg'
    const filtered = pmFilter === 'all' ? projects : projects.filter(p => p.pm_id === pmFilter)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].pm).toBe('Greg')
  })

  it('search narrows within PM filter', () => {
    const projects = [
      makeProject({ pm_id: 'user-greg', name: 'Smith Residence', id: 'PROJ-001' }),
      makeProject({ pm_id: 'user-greg', name: 'Jones Residence', id: 'PROJ-002' }),
      makeProject({ pm_id: 'user-taylor', name: 'Smith Home', id: 'PROJ-003' }),
    ]
    const pmFilter = 'user-greg'
    const search = 'smith'
    let result = projects
    if (pmFilter !== 'all') result = result.filter(p => p.pm_id === pmFilter)
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(p =>
        p.name?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q)
      )
    }
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('PROJ-001')
  })
})
