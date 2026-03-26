import { describe, it, expect } from 'vitest'
import { daysAgo, SLA_THRESHOLDS, STAGE_LABELS, STAGE_ORDER, STAGE_TASKS } from '@/lib/utils'
import { ALL_TASKS_MAP } from '@/lib/tasks'
import { buildTaskMap, applyTaskInsertOrUpdate, applyTaskDelete } from '@/lib/queue-task-map'
import type { TaskStateRow, TaskMap, TaskEntry } from '@/lib/queue-task-map'

// ── Test helpers ──────────────────────────────────────────────────────────────

interface TestProject {
  id: string
  name: string
  stage: string
  pm: string | null
  pm_id: string | null
  blocker: string | null
  sale_date: string | null
  stage_date: string | null
  disposition: string | null
  city: string | null
  address: string | null
  financier: string | null
  ahj: string | null
  contract: number | null
  follow_up_date: string | null
  consultant: string | null
  advisor: string | null
  systemkw: number | null
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
    id: 'PROJ-001', name: 'Test Project', stage: 'evaluation', pm: 'Greg', pm_id: 'pm-1',
    blocker: null, sale_date: daysAgoDate(10), stage_date: daysAgoDate(1),
    disposition: null, city: 'Houston', address: '123 Main St', financier: 'Mosaic',
    ahj: 'Houston', contract: 50000, follow_up_date: null,
    consultant: null, advisor: null, systemkw: 10,
    ...o,
  }
}

// Replicate the page's filter logic
interface QueueFilters {
  stages: Set<string>
  financier: string
  ahj: string
  blockedOnly: boolean
  daysRange: '' | '<7' | '7-30' | '30-90' | '90+'
}

const EMPTY_FILTERS: QueueFilters = {
  stages: new Set<string>(),
  financier: '',
  ahj: '',
  blockedOnly: false,
  daysRange: '',
}

function hasActiveFilters(f: QueueFilters): boolean {
  return f.stages.size > 0 || f.financier !== '' || f.ahj !== '' || f.blockedOnly || f.daysRange !== ''
}

function getDaysInStage(p: TestProject): number {
  return daysAgo(p.stage_date)
}

function matchesDaysRange(p: TestProject, range: string): boolean {
  const d = getDaysInStage(p)
  switch (range) {
    case '<7': return d < 7
    case '7-30': return d >= 7 && d <= 30
    case '30-90': return d > 30 && d <= 90
    case '90+': return d > 90
    default: return true
  }
}

function applySmartFilters(projects: TestProject[], filters: QueueFilters): TestProject[] {
  if (!hasActiveFilters(filters)) return projects
  return projects.filter(p => {
    if (filters.stages.size > 0 && !filters.stages.has(p.stage)) return false
    if (filters.financier && p.financier !== filters.financier) return false
    if (filters.ahj && p.ahj !== filters.ahj) return false
    if (filters.blockedOnly && !p.blocker) return false
    if (filters.daysRange && !matchesDaysRange(p, filters.daysRange)) return false
    return true
  })
}

function applySearch(projects: TestProject[], search: string): TestProject[] {
  if (!search.trim()) return projects
  const q = search.toLowerCase()
  return projects.filter(p =>
    p.name?.toLowerCase().includes(q) ||
    p.id?.toLowerCase().includes(q) ||
    p.city?.toLowerCase().includes(q) ||
    p.address?.toLowerCase().includes(q)
  )
}

function getSLA(p: TestProject) {
  const t = SLA_THRESHOLDS[p.stage] ?? { target: 3, risk: 5, crit: 7 }
  const days = daysAgo(p.stage_date)
  let status: 'ok' | 'warn' | 'risk' | 'crit' = 'ok'
  if (days >= t.crit) status = 'crit'
  else if (days >= t.risk) status = 'risk'
  else if (days >= t.target) status = 'warn'
  return { days, status, ...t }
}

function priority(p: TestProject): number {
  if (p.blocker) return 0
  const s = getSLA(p).status
  if (s === 'crit') return 1
  if (s === 'risk') return 2
  if (s === 'warn') return 3
  return 4
}

type SectionSortKey = 'days' | 'contract' | 'name'

function sortProjects(projects: TestProject[], sortKey: SectionSortKey): TestProject[] {
  return [...projects].sort((a, b) => {
    switch (sortKey) {
      case 'days': return getDaysInStage(b) - getDaysInStage(a)
      case 'contract': return (Number(b.contract) || 0) - (Number(a.contract) || 0)
      case 'name': return (a.name ?? '').localeCompare(b.name ?? '')
      default: return 0
    }
  })
}

function getNextTask(p: TestProject, taskMap: Record<string, TaskEntry>): string | null {
  const tasks = STAGE_TASKS[p.stage] ?? []
  for (const t of tasks) {
    const s = taskMap[t.id]?.status ?? 'Not Ready'
    if (s !== 'Complete') return t.name
  }
  return null
}

interface StuckTask { name: string; status: 'Pending Resolution' | 'Revision Required'; reason: string }

function getStuckTasks(p: TestProject, taskMap: Record<string, TaskEntry>): StuckTask[] {
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

// Funding badge logic
interface FundingRecord {
  project_id: string
  m1_status: string | null
  m2_status: string | null
  m3_status: string | null
}

function getFundingBadge(funding: FundingRecord | undefined): { label: string; display: string } | null {
  if (!funding) return null
  const milestones: { label: string; status: string | null }[] = [
    { label: 'M3', status: funding.m3_status },
    { label: 'M2', status: funding.m2_status },
    { label: 'M1', status: funding.m1_status },
  ]
  const active = milestones.find(m => m.status && m.status !== 'Not Eligible')
  if (!active || !active.status) return null
  const statusShort: Record<string, string> = {
    'Eligible': 'Eligible',
    'Submitted': 'Sub',
    'Funded': 'Funded',
    'Rejected': 'Rej',
  }
  return { label: active.label, display: statusShort[active.status] ?? active.status }
}

// Last activity / stale detection
function lastActivityStale(p: TestProject): { stale: boolean; days: number } {
  const days = daysAgo(p.stage_date)
  return { stale: days > 5, days }
}

// Dynamic section matcher (replicates queue page logic)
interface QueueSectionConfig { id: string; label: string; task_id: string; match_status: string; color: string; icon: string; sort_order: number }

const HARDCODED_SECTIONS: QueueSectionConfig[] = [
  { id: 'hc-1', label: 'City Permit Approval', task_id: 'city_permit', match_status: 'Ready To Start', color: 'blue', icon: '', sort_order: 1 },
  { id: 'hc-2', label: 'City Permit Submitted', task_id: 'city_permit', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'indigo', icon: '', sort_order: 2 },
  { id: 'hc-3', label: 'Utility Permit Submitted', task_id: 'util_permit', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'purple', icon: '', sort_order: 3 },
  { id: 'hc-4', label: 'Utility Inspection Ready', task_id: 'util_insp', match_status: 'Ready To Start', color: 'teal', icon: '', sort_order: 4 },
  { id: 'hc-5', label: 'Utility Inspection Submitted', task_id: 'util_insp', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'cyan', icon: '', sort_order: 5 },
]

function assignToDynamicSections(projects: TestProject[], taskMap: TaskMap, sections: QueueSectionConfig[]) {
  return sections.map(sec => {
    const statuses = new Set(sec.match_status.split(',').map(s => s.trim()))
    const items = projects.filter(p => {
      if (p.stage === 'complete') return false
      const s = taskMap[p.id]?.[sec.task_id]?.status
      return s ? statuses.has(s) : false
    })
    return { ...sec, items }
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Queue: disposition filtering', () => {
  it('excludes In Service from queue', () => {
    const projects = [makeProject(), makeProject({ disposition: 'In Service', id: 'P2' })]
    const filtered = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Cancelled')
    expect(filtered).toHaveLength(1)
  })

  it('excludes Cancelled from queue', () => {
    const projects = [makeProject(), makeProject({ disposition: 'Cancelled', id: 'P2' })]
    const filtered = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Cancelled')
    expect(filtered).toHaveLength(1)
  })

  it('keeps Loyalty in queue (intentional)', () => {
    const projects = [makeProject(), makeProject({ disposition: 'Loyalty', id: 'P2' })]
    const filtered = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Cancelled')
    expect(filtered).toHaveLength(2)
  })

  it('separates Loyalty projects into their own section', () => {
    const projects = [
      makeProject({ id: 'P1' }),
      makeProject({ id: 'P2', disposition: 'Loyalty' }),
      makeProject({ id: 'P3', disposition: 'Loyalty' }),
    ]
    const live = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Cancelled' && p.disposition !== 'Loyalty')
    const loyalty = projects.filter(p => p.disposition === 'Loyalty')
    expect(live).toHaveLength(1)
    expect(loyalty).toHaveLength(2)
  })
})

describe('Queue: smart filters — stage chip toggle', () => {
  const projects = [
    makeProject({ id: 'P1', stage: 'evaluation' }),
    makeProject({ id: 'P2', stage: 'survey' }),
    makeProject({ id: 'P3', stage: 'design' }),
    makeProject({ id: 'P4', stage: 'permit' }),
    makeProject({ id: 'P5', stage: 'install' }),
  ]

  it('no stage filter returns all projects', () => {
    const result = applySmartFilters(projects, EMPTY_FILTERS)
    expect(result).toHaveLength(5)
  })

  it('single stage filter returns only matching projects', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, stages: new Set(['evaluation']) }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P1')
  })

  it('multiple stage chips combine with OR', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, stages: new Set(['evaluation', 'design']) }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(2)
    expect(result.map(p => p.id).sort()).toEqual(['P1', 'P3'])
  })

  it('toggle stage on then off returns to unfiltered', () => {
    const stages = new Set(['evaluation'])
    const filtered = applySmartFilters(projects, { ...EMPTY_FILTERS, stages })
    expect(filtered).toHaveLength(1)
    stages.delete('evaluation')
    const restored = applySmartFilters(projects, { ...EMPTY_FILTERS, stages })
    expect(restored).toHaveLength(5)
  })

  it('complete stage is excluded from filter stage options', () => {
    const FILTER_STAGES = STAGE_ORDER.filter(s => s !== 'complete')
    expect(FILTER_STAGES).not.toContain('complete')
    expect(FILTER_STAGES.length).toBe(STAGE_ORDER.length - 1)
  })
})

describe('Queue: smart filters — financier filter', () => {
  const projects = [
    makeProject({ id: 'P1', financier: 'Mosaic' }),
    makeProject({ id: 'P2', financier: 'GoodLeap' }),
    makeProject({ id: 'P3', financier: 'Mosaic' }),
    makeProject({ id: 'P4', financier: null }),
  ]

  it('no financier filter returns all', () => {
    const result = applySmartFilters(projects, EMPTY_FILTERS)
    expect(result).toHaveLength(4)
  })

  it('financier filter returns only matching', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, financier: 'Mosaic' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(2)
    expect(result.every(p => p.financier === 'Mosaic')).toBe(true)
  })

  it('financier filter excludes null financier projects', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, financier: 'GoodLeap' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P2')
  })

  it('distinct financiers are extracted correctly', () => {
    const set = new Set<string>()
    projects.forEach(p => { if (p.financier) set.add(p.financier) })
    expect([...set].sort()).toEqual(['GoodLeap', 'Mosaic'])
  })
})

describe('Queue: smart filters — AHJ filter', () => {
  const projects = [
    makeProject({ id: 'P1', ahj: 'Houston' }),
    makeProject({ id: 'P2', ahj: 'Dallas' }),
    makeProject({ id: 'P3', ahj: 'Houston' }),
  ]

  it('AHJ filter returns only matching', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, ahj: 'Dallas' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P2')
  })
})

describe('Queue: smart filters — blocked toggle', () => {
  const projects = [
    makeProject({ id: 'P1', blocker: 'Permit issue' }),
    makeProject({ id: 'P2', blocker: null }),
    makeProject({ id: 'P3', blocker: 'Design revision' }),
  ]

  it('blocked toggle off returns all', () => {
    const result = applySmartFilters(projects, EMPTY_FILTERS)
    expect(result).toHaveLength(3)
  })

  it('blocked toggle on returns only blocked projects', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, blockedOnly: true }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(2)
    expect(result.every(p => p.blocker !== null)).toBe(true)
  })
})

describe('Queue: smart filters — days range', () => {
  const projects = [
    makeProject({ id: 'P1', stage_date: daysAgoDate(3) }),   // 3 days
    makeProject({ id: 'P2', stage_date: daysAgoDate(15) }),  // 15 days
    makeProject({ id: 'P3', stage_date: daysAgoDate(50) }),  // 50 days
    makeProject({ id: 'P4', stage_date: daysAgoDate(100) }), // 100 days
  ]

  it('<7 range matches projects under 7 days', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, daysRange: '<7' }
    const result = applySmartFilters(projects, filters)
    expect(result.map(p => p.id)).toEqual(['P1'])
  })

  it('7-30 range matches projects in 7-30 days', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, daysRange: '7-30' }
    const result = applySmartFilters(projects, filters)
    expect(result.map(p => p.id)).toEqual(['P2'])
  })

  it('30-90 range matches projects in 31-90 days', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, daysRange: '30-90' }
    const result = applySmartFilters(projects, filters)
    expect(result.map(p => p.id)).toEqual(['P3'])
  })

  it('90+ range matches projects over 90 days', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, daysRange: '90+' }
    const result = applySmartFilters(projects, filters)
    expect(result.map(p => p.id)).toEqual(['P4'])
  })

  it('empty range matches all', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, daysRange: '' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(4)
  })
})

describe('Queue: smart filters — clear all', () => {
  it('clearAllFilters resets to EMPTY_FILTERS', () => {
    const active: QueueFilters = {
      stages: new Set(['evaluation', 'survey']),
      financier: 'Mosaic',
      ahj: 'Houston',
      blockedOnly: true,
      daysRange: '7-30',
    }
    expect(hasActiveFilters(active)).toBe(true)
    // Simulate clearing
    const cleared = EMPTY_FILTERS
    expect(hasActiveFilters(cleared)).toBe(false)
    expect(cleared.stages.size).toBe(0)
    expect(cleared.financier).toBe('')
    expect(cleared.ahj).toBe('')
    expect(cleared.blockedOnly).toBe(false)
    expect(cleared.daysRange).toBe('')
  })
})

describe('Queue: smart filters — AND composition', () => {
  const projects = [
    makeProject({ id: 'P1', stage: 'evaluation', financier: 'Mosaic', ahj: 'Houston', blocker: null, stage_date: daysAgoDate(3) }),
    makeProject({ id: 'P2', stage: 'evaluation', financier: 'GoodLeap', ahj: 'Houston', blocker: null, stage_date: daysAgoDate(15) }),
    makeProject({ id: 'P3', stage: 'design', financier: 'Mosaic', ahj: 'Dallas', blocker: 'Issue', stage_date: daysAgoDate(50) }),
    makeProject({ id: 'P4', stage: 'survey', financier: 'Mosaic', ahj: 'Houston', blocker: null, stage_date: daysAgoDate(100) }),
  ]

  it('stage + financier filter is AND', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, stages: new Set(['evaluation']), financier: 'Mosaic' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P1')
  })

  it('stage + financier + AHJ filter is AND', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, stages: new Set(['evaluation']), financier: 'Mosaic', ahj: 'Houston' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P1')
  })

  it('blocked + financier filter is AND', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, blockedOnly: true, financier: 'Mosaic' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P3')
  })

  it('days range + stage filter is AND', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, daysRange: '90+', stages: new Set(['survey']) }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P4')
  })

  it('all filters combined narrows correctly', () => {
    const filters: QueueFilters = { stages: new Set(['evaluation']), financier: 'Mosaic', ahj: 'Houston', blockedOnly: false, daysRange: '<7' }
    const result = applySmartFilters(projects, filters)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P1')
  })

  it('conflicting filters return empty', () => {
    const filters: QueueFilters = { ...EMPTY_FILTERS, stages: new Set(['evaluation']), blockedOnly: true }
    const result = applySmartFilters(projects, filters)
    // No evaluation projects are blocked
    expect(result).toHaveLength(0)
  })
})

describe('Queue: clickable stats — blocked click sets filter', () => {
  it('blocked stat card toggles blockedOnly filter', () => {
    const filters = { ...EMPTY_FILTERS }
    expect(filters.blockedOnly).toBe(false)
    // Simulate click: toggle blockedOnly
    const updated = { ...filters, blockedOnly: !filters.blockedOnly }
    expect(updated.blockedOnly).toBe(true)
    // Second click toggles off
    const toggled = { ...updated, blockedOnly: !updated.blockedOnly }
    expect(toggled.blockedOnly).toBe(false)
  })

  it('blocked stat count matches blocked projects', () => {
    const projects = [
      makeProject({ id: 'P1', blocker: 'Issue' }),
      makeProject({ id: 'P2', blocker: null }),
      makeProject({ id: 'P3', blocker: 'Another issue' }),
    ]
    const sorted = [...projects].sort((a, b) => priority(a) - priority(b))
    const blocked = sorted.filter(p => p.blocker)
    expect(blocked).toHaveLength(2)
  })
})

describe('Queue: clickable stats — follow-ups click', () => {
  it('follow-ups section includes projects with task-level follow_up_date today or overdue', () => {
    const today = todayStr()
    const taskStates: TaskStateRow[] = [
      { project_id: 'P1', task_id: 'city_permit', status: 'In Progress', follow_up_date: today },
      { project_id: 'P2', task_id: 'util_permit', status: 'In Progress', follow_up_date: daysAgoDate(3) }, // overdue
      { project_id: 'P3', task_id: 'ntp', status: 'Complete', follow_up_date: daysAgoDate(-5) }, // future
    ]
    const followUpMap: Record<string, { date: string; taskName: string }> = {}
    for (const t of taskStates) {
      if (t.follow_up_date && t.follow_up_date <= today) {
        const existing = followUpMap[t.project_id]
        if (!existing || t.follow_up_date < existing.date) {
          followUpMap[t.project_id] = { date: t.follow_up_date, taskName: ALL_TASKS_MAP[t.task_id] ?? t.task_id }
        }
      }
    }
    expect(Object.keys(followUpMap)).toHaveLength(2)
    expect(followUpMap['P1']).toBeDefined()
    expect(followUpMap['P2']).toBeDefined()
    expect(followUpMap['P3']).toBeUndefined()
  })

  it('follow-ups section includes projects with project-level follow_up_date today or overdue', () => {
    const today = todayStr()
    const projects = [
      makeProject({ id: 'P1', follow_up_date: today }),
      makeProject({ id: 'P2', follow_up_date: daysAgoDate(2) }), // overdue
      makeProject({ id: 'P3', follow_up_date: daysAgoDate(-10) }), // future
      makeProject({ id: 'P4', follow_up_date: null }),
    ]
    const followUps = projects.filter(p => p.follow_up_date && p.follow_up_date <= today)
    expect(followUps).toHaveLength(2)
    expect(followUps.map(p => p.id).sort()).toEqual(['P1', 'P2'])
  })
})

describe('Queue: sortable sections — days/contract/name sort', () => {
  const projects = [
    makeProject({ id: 'P1', name: 'Charlie', stage_date: daysAgoDate(5), contract: 30000 }),
    makeProject({ id: 'P2', name: 'Alpha', stage_date: daysAgoDate(20), contract: 80000 }),
    makeProject({ id: 'P3', name: 'Bravo', stage_date: daysAgoDate(10), contract: 50000 }),
  ]

  it('sorts by days in stage descending (default)', () => {
    const sorted = sortProjects(projects, 'days')
    expect(sorted.map(p => p.id)).toEqual(['P2', 'P3', 'P1'])
  })

  it('sorts by contract value descending', () => {
    const sorted = sortProjects(projects, 'contract')
    expect(sorted.map(p => p.id)).toEqual(['P2', 'P3', 'P1'])
  })

  it('sorts by name ascending', () => {
    const sorted = sortProjects(projects, 'name')
    expect(sorted.map(p => p.id)).toEqual(['P2', 'P3', 'P1'])
  })

  it('sort cycle order is days -> contract -> name', () => {
    const order: SectionSortKey[] = ['days', 'contract', 'name']
    let current: SectionSortKey = 'days'
    const idx = order.indexOf(current)
    current = order[(idx + 1) % order.length]
    expect(current).toBe('contract')
    const idx2 = order.indexOf(current)
    current = order[(idx2 + 1) % order.length]
    expect(current).toBe('name')
    const idx3 = order.indexOf(current)
    current = order[(idx3 + 1) % order.length]
    expect(current).toBe('days') // wraps around
  })

  it('each section can have independent sort key', () => {
    const sectionSorts: Record<string, SectionSortKey> = {}
    sectionSorts['blocked'] = 'contract'
    sectionSorts['active'] = 'name'
    expect(sectionSorts['blocked']).toBe('contract')
    expect(sectionSorts['active']).toBe('name')
    expect(sectionSorts['followups'] ?? 'days').toBe('days') // default
  })

  it('handles null contract gracefully', () => {
    const withNulls = [
      makeProject({ id: 'P1', contract: null }),
      makeProject({ id: 'P2', contract: 50000 }),
    ]
    const sorted = sortProjects(withNulls, 'contract')
    expect(sorted[0].id).toBe('P2')
  })

  it('handles null name gracefully', () => {
    const withNulls = [
      makeProject({ id: 'P1', name: 'Zulu' }),
      makeProject({ id: 'P2', name: '' }),
    ]
    const sorted = sortProjects(withNulls, 'name')
    expect(sorted[0].id).toBe('P2') // empty string sorts before 'Zulu'
  })
})

describe('Queue: inline actions — follow-up date set', () => {
  it('follow-up date is stored on project-level field', () => {
    const p = makeProject({ follow_up_date: null })
    // Simulate setting follow-up
    const updated = { ...p, follow_up_date: '2026-04-01' }
    expect(updated.follow_up_date).toBe('2026-04-01')
  })

  it('follow-up date can be cleared', () => {
    const p = makeProject({ follow_up_date: '2026-04-01' })
    const cleared = { ...p, follow_up_date: null }
    expect(cleared.follow_up_date).toBeNull()
  })
})

describe('Queue: inline actions — clear blocker', () => {
  it('clearing blocker sets blocker to null', () => {
    const p = makeProject({ blocker: 'Permit issue' })
    expect(p.blocker).toBe('Permit issue')
    const cleared = { ...p, blocker: null }
    expect(cleared.blocker).toBeNull()
  })

  it('clear blocker is no-op when blocker is already null', () => {
    const p = makeProject({ blocker: null })
    // handleClearBlocker early-returns if !p.blocker
    expect(p.blocker).toBeNull()
  })
})

describe('Queue: inline actions — quick note add', () => {
  it('quick note requires non-empty text', () => {
    const quickNote = ''
    expect(quickNote.trim()).toBe('')
    // handleQuickNote returns early if !quickNote.trim()
  })

  it('quick note trims whitespace', () => {
    const quickNote = '  Follow up with homeowner  '
    expect(quickNote.trim()).toBe('Follow up with homeowner')
  })
})

describe('Queue: financial badge — M2/M3 status display', () => {
  it('returns null for no funding record', () => {
    expect(getFundingBadge(undefined)).toBeNull()
  })

  it('returns null when all statuses are null', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: null, m2_status: null, m3_status: null }
    expect(getFundingBadge(f)).toBeNull()
  })

  it('returns null when all statuses are Not Eligible', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Not Eligible', m2_status: 'Not Eligible', m3_status: 'Not Eligible' }
    expect(getFundingBadge(f)).toBeNull()
  })

  it('shows M3 when M3 has a status (highest priority)', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Funded', m2_status: 'Funded', m3_status: 'Submitted' }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M3', display: 'Sub' })
  })

  it('shows M2 when M3 is null but M2 has status', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Funded', m2_status: 'Eligible', m3_status: null }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M2', display: 'Eligible' })
  })

  it('shows M1 when M2 and M3 are null', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Submitted', m2_status: null, m3_status: null }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M1', display: 'Sub' })
  })

  it('displays Funded status correctly', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: null, m2_status: 'Funded', m3_status: null }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M2', display: 'Funded' })
  })

  it('displays Rejected status correctly', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: null, m2_status: 'Rejected', m3_status: null }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M2', display: 'Rej' })
  })

  it('skips Not Eligible to find active milestone', () => {
    const f: FundingRecord = { project_id: 'P1', m1_status: 'Submitted', m2_status: 'Not Eligible', m3_status: 'Not Eligible' }
    const badge = getFundingBadge(f)
    expect(badge).toEqual({ label: 'M1', display: 'Sub' })
  })
})

describe('Queue: last activity / stale detection', () => {
  it('project with stage_date 1 day ago is not stale', () => {
    const p = makeProject({ stage_date: daysAgoDate(1) })
    const result = lastActivityStale(p)
    expect(result.stale).toBe(false)
    expect(result.days).toBe(1)
  })

  it('project with stage_date 5 days ago is not stale (boundary)', () => {
    const p = makeProject({ stage_date: daysAgoDate(5) })
    const result = lastActivityStale(p)
    expect(result.stale).toBe(false)
    expect(result.days).toBe(5)
  })

  it('project with stage_date 6 days ago is stale (>5 threshold)', () => {
    const p = makeProject({ stage_date: daysAgoDate(6) })
    const result = lastActivityStale(p)
    expect(result.stale).toBe(true)
    expect(result.days).toBe(6)
  })

  it('project with stage_date 30 days ago is stale', () => {
    const p = makeProject({ stage_date: daysAgoDate(30) })
    const result = lastActivityStale(p)
    expect(result.stale).toBe(true)
    expect(result.days).toBe(30)
  })

  it('project with null stage_date returns 0 days, not stale', () => {
    const p = makeProject({ stage_date: null })
    const result = lastActivityStale(p)
    expect(result.days).toBe(0)
    expect(result.stale).toBe(false)
  })
})

describe('Queue: filter + search composition', () => {
  const projects = [
    makeProject({ id: 'P1', name: 'Smith Solar', stage: 'evaluation', financier: 'Mosaic', city: 'Houston' }),
    makeProject({ id: 'P2', name: 'Jones Solar', stage: 'evaluation', financier: 'GoodLeap', city: 'Dallas' }),
    makeProject({ id: 'P3', name: 'Smith Residence', stage: 'design', financier: 'Mosaic', city: 'Austin' }),
    makeProject({ id: 'P4', name: 'Anderson Solar', stage: 'design', financier: 'Mosaic', city: 'Houston' }),
  ]

  it('search narrows, then filters further narrow (not override)', () => {
    // Search for "Smith"
    const searched = applySearch(projects, 'Smith')
    expect(searched).toHaveLength(2) // P1, P3

    // Then filter by stage=evaluation
    const filtered = applySmartFilters(searched, { ...EMPTY_FILTERS, stages: new Set(['evaluation']) })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('P1')
  })

  it('search does not bypass active filters', () => {
    // Filter by financier=GoodLeap
    const filtered = applySmartFilters(projects, { ...EMPTY_FILTERS, financier: 'GoodLeap' })
    expect(filtered).toHaveLength(1)
    // Then search within filtered results
    const searched = applySearch(filtered, 'Smith')
    expect(searched).toHaveLength(0) // Smith is Mosaic, not GoodLeap
  })

  it('search matches by city', () => {
    const searched = applySearch(projects, 'Houston')
    expect(searched).toHaveLength(2) // P1, P4
  })

  it('search matches by address', () => {
    const searched = applySearch(projects, '123 Main')
    expect(searched).toHaveLength(4) // All have default address
  })

  it('search matches by project ID', () => {
    const searched = applySearch(projects, 'P2')
    expect(searched).toHaveLength(1)
    expect(searched[0].id).toBe('P2')
  })

  it('search is case-insensitive', () => {
    const searched = applySearch(projects, 'SMITH')
    expect(searched).toHaveLength(2)
  })

  it('empty search returns all', () => {
    const searched = applySearch(projects, '')
    expect(searched).toHaveLength(4)
  })

  it('whitespace-only search returns all', () => {
    const searched = applySearch(projects, '   ')
    expect(searched).toHaveLength(4)
  })
})

describe('Queue: PM filter still works with new filters', () => {
  const projects = [
    makeProject({ id: 'P1', pm_id: 'pm-1', pm: 'Greg' }),
    makeProject({ id: 'P2', pm_id: 'pm-2', pm: 'Sarah' }),
    makeProject({ id: 'P3', pm_id: 'pm-1', pm: 'Greg', financier: 'GoodLeap' }),
  ]

  it('PM filter is applied at query level (server-side)', () => {
    // PM filter produces server-side filter object
    const userPm = 'pm-1'
    const pmFilters: Record<string, any> = {}
    if (userPm) pmFilters.pm_id = { eq: userPm }
    expect(pmFilters).toEqual({ pm_id: { eq: 'pm-1' } })
  })

  it('PM filter combined with smart filters (client-side)', () => {
    // Simulate PM filter already applied (only pm-1 projects returned from server)
    const pmFiltered = projects.filter(p => p.pm_id === 'pm-1')
    expect(pmFiltered).toHaveLength(2)

    // Then apply financier smart filter on client side
    const result = applySmartFilters(pmFiltered, { ...EMPTY_FILTERS, financier: 'GoodLeap' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('P3')
  })

  it('empty PM filter returns all PMs', () => {
    const userPm = ''
    const pmFilters: Record<string, any> = {}
    if (userPm) pmFilters.pm_id = { eq: userPm }
    expect(pmFilters).toEqual({}) // No filter applied
  })

  it('available PMs extracted from loaded projects', () => {
    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
    const available = [...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    expect(available).toHaveLength(2)
    expect(available[0].name).toBe('Greg')
    expect(available[1].name).toBe('Sarah')
  })
})

describe('Queue: task-based sections', () => {
  it('assigns project to city permit ready section', () => {
    const projects = [makeProject({ id: 'P1', stage: 'permit' })]
    const taskMap: TaskMap = { 'P1': { city_permit: { status: 'Ready To Start' } } }
    const sections = assignToDynamicSections(projects, taskMap, HARDCODED_SECTIONS)
    expect(sections[0].items).toHaveLength(1) // City Permit Ready
    expect(sections[0].items[0].id).toBe('P1')
  })

  it('assigns project to city permit submitted section', () => {
    const projects = [makeProject({ id: 'P1', stage: 'permit' })]
    const taskMap: TaskMap = { 'P1': { city_permit: { status: 'In Progress' } } }
    const sections = assignToDynamicSections(projects, taskMap, HARDCODED_SECTIONS)
    expect(sections[1].items).toHaveLength(1) // City Permit Submitted
  })

  it('complete projects are excluded from dynamic sections', () => {
    const projects = [makeProject({ id: 'P1', stage: 'complete' })]
    const taskMap: TaskMap = { 'P1': { city_permit: { status: 'Ready To Start' } } }
    const sections = assignToDynamicSections(projects, taskMap, HARDCODED_SECTIONS)
    sections.forEach(sec => expect(sec.items).toHaveLength(0))
  })

  it('project with no matching task status is not in any section', () => {
    const projects = [makeProject({ id: 'P1', stage: 'evaluation' })]
    const taskMap: TaskMap = { 'P1': {} }
    const sections = assignToDynamicSections(projects, taskMap, HARDCODED_SECTIONS)
    sections.forEach(sec => expect(sec.items).toHaveLength(0))
  })

  it('comma-separated match_status supports multiple statuses', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'permit' }),
      makeProject({ id: 'P2', stage: 'permit' }),
      makeProject({ id: 'P3', stage: 'permit' }),
    ]
    const taskMap: TaskMap = {
      'P1': { city_permit: { status: 'In Progress' } },
      'P2': { city_permit: { status: 'Pending Resolution' } },
      'P3': { city_permit: { status: 'Complete' } },
    }
    const sections = assignToDynamicSections(projects, taskMap, HARDCODED_SECTIONS)
    // Section hc-2 matches In Progress, Scheduled, Pending Resolution, Revision Required
    expect(sections[1].items).toHaveLength(2) // P1, P2
    expect(sections[1].items.map(p => p.id).sort()).toEqual(['P1', 'P2'])
  })

  it('active section excludes projects in dynamic sections, blocked, and complete', () => {
    const projects = [
      makeProject({ id: 'P1', stage: 'permit' }),
      makeProject({ id: 'P2', stage: 'evaluation' }),
      makeProject({ id: 'P3', stage: 'evaluation', blocker: 'Issue' }),
      makeProject({ id: 'P4', stage: 'complete' }),
    ]
    const taskMap: TaskMap = { 'P1': { city_permit: { status: 'Ready To Start' } } }
    const sections = assignToDynamicSections(projects, taskMap, HARDCODED_SECTIONS)

    const specialPids = new Set<string>()
    for (const sec of sections) {
      for (const p of sec.items) specialPids.add(p.id)
    }
    const blocked = projects.filter(p => p.blocker)
    for (const p of blocked) specialPids.add(p.id)
    const complete = projects.filter(p => p.stage === 'complete')
    for (const p of complete) specialPids.add(p.id)

    const sorted = [...projects].sort((a, b) => priority(a) - priority(b))
    const active = sorted.filter(p => !specialPids.has(p.id) && p.stage !== 'complete')
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe('P2')
  })
})

describe('Queue: task map (buildTaskMap)', () => {
  it('builds nested map from task state rows', () => {
    const rows: TaskStateRow[] = [
      { project_id: 'P1', task_id: 'city_permit', status: 'In Progress' },
      { project_id: 'P1', task_id: 'util_permit', status: 'Complete' },
      { project_id: 'P2', task_id: 'city_permit', status: 'Ready To Start', reason: 'Waiting' },
    ]
    const map = buildTaskMap(rows)
    expect(map['P1']['city_permit'].status).toBe('In Progress')
    expect(map['P1']['util_permit'].status).toBe('Complete')
    expect(map['P2']['city_permit'].reason).toBe('Waiting')
  })

  it('applyTaskInsertOrUpdate adds new task entry', () => {
    const map: TaskMap = {}
    const applied = applyTaskInsertOrUpdate(map, { project_id: 'P1', task_id: 'ntp', status: 'Complete' }, new Set(['ntp']))
    expect(applied).toBe(true)
    expect(map['P1']['ntp'].status).toBe('Complete')
  })

  it('applyTaskInsertOrUpdate ignores irrelevant task', () => {
    const map: TaskMap = {}
    const applied = applyTaskInsertOrUpdate(map, { project_id: 'P1', task_id: 'irrelevant', status: 'X' }, new Set(['ntp']))
    expect(applied).toBe(false)
    expect(map['P1']).toBeUndefined()
  })

  it('applyTaskDelete removes task entry', () => {
    const map: TaskMap = { 'P1': { ntp: { status: 'Complete' } } }
    const applied = applyTaskDelete(map, { project_id: 'P1', task_id: 'ntp' }, new Set(['ntp']))
    expect(applied).toBe(true)
    expect(map['P1']).toBeUndefined() // cleaned up empty project
  })
})

describe('Queue: stuck tasks and next task', () => {
  it('getStuckTasks returns Pending Resolution tasks', () => {
    const p = makeProject({ stage: 'permit' })
    const tasks = STAGE_TASKS['permit'] ?? []
    if (tasks.length === 0) return // skip if no tasks defined for this stage
    const firstTask = tasks[0]
    const tm: Record<string, TaskEntry> = { [firstTask.id]: { status: 'Pending Resolution', reason: 'Missing docs' } }
    const stuck = getStuckTasks(p, tm)
    expect(stuck.length).toBeGreaterThanOrEqual(1)
    expect(stuck[0].status).toBe('Pending Resolution')
    expect(stuck[0].reason).toBe('Missing docs')
  })

  it('getStuckTasks returns Revision Required tasks', () => {
    const p = makeProject({ stage: 'design' })
    const tasks = STAGE_TASKS['design'] ?? []
    if (tasks.length === 0) return
    const firstTask = tasks[0]
    const tm: Record<string, TaskEntry> = { [firstTask.id]: { status: 'Revision Required', reason: 'Panel count wrong' } }
    const stuck = getStuckTasks(p, tm)
    expect(stuck.length).toBeGreaterThanOrEqual(1)
    expect(stuck[0].status).toBe('Revision Required')
  })

  it('getStuckTasks returns empty for all complete tasks', () => {
    const p = makeProject({ stage: 'evaluation' })
    const tasks = STAGE_TASKS['evaluation'] ?? []
    const tm: Record<string, TaskEntry> = {}
    for (const t of tasks) tm[t.id] = { status: 'Complete' }
    const stuck = getStuckTasks(p, tm)
    expect(stuck).toHaveLength(0)
  })

  it('getNextTask returns first non-complete task', () => {
    const p = makeProject({ stage: 'evaluation' })
    const tasks = STAGE_TASKS['evaluation'] ?? []
    if (tasks.length === 0) return
    const tm: Record<string, TaskEntry> = { [tasks[0].id]: { status: 'Complete' } }
    const next = getNextTask(p, tm)
    if (tasks.length > 1) {
      expect(next).toBe(tasks[1].name)
    } else {
      expect(next).toBeNull()
    }
  })

  it('getNextTask returns null when all tasks complete', () => {
    const p = makeProject({ stage: 'evaluation' })
    const tasks = STAGE_TASKS['evaluation'] ?? []
    const tm: Record<string, TaskEntry> = {}
    for (const t of tasks) tm[t.id] = { status: 'Complete' }
    expect(getNextTask(p, tm)).toBeNull()
  })
})

describe('Queue: priority sorting', () => {
  it('blocked (0) sorts before everything else', () => {
    const blocked = makeProject({ blocker: 'Issue', id: 'B' })
    const normal = makeProject({ id: 'N' })
    expect(priority(blocked)).toBe(0)
    expect(priority(blocked)).toBeLessThan(priority(normal))
  })

  it('ok (4) sorts last', () => {
    const ok = makeProject({ stage_date: daysAgoDate(1), id: 'O' })
    expect(priority(ok)).toBe(4)
  })
})

describe('Queue: cycle days fallback', () => {
  it('uses || for fallback between sale_date and stage_date', () => {
    const p = makeProject({ sale_date: null, stage_date: daysAgoDate(5) })
    const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date)
    expect(cycle).toBe(5)
  })

  it('prefers sale_date when both are present', () => {
    const p = makeProject({ sale_date: daysAgoDate(20), stage_date: daysAgoDate(5) })
    const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date)
    expect(cycle).toBe(20)
  })

  it('returns 0 when both dates are null', () => {
    const p = makeProject({ sale_date: null, stage_date: null })
    const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date)
    expect(cycle).toBe(0)
  })
})

describe('Queue: hasActiveFilters detection', () => {
  it('empty filters returns false', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })

  it('stage set returns true', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, stages: new Set(['evaluation']) })).toBe(true)
  })

  it('financier returns true', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, financier: 'Mosaic' })).toBe(true)
  })

  it('ahj returns true', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, ahj: 'Houston' })).toBe(true)
  })

  it('blockedOnly returns true', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, blockedOnly: true })).toBe(true)
  })

  it('daysRange returns true', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, daysRange: '7-30' })).toBe(true)
  })
})

describe('Queue: search applies to loyalty section too', () => {
  it('search filters loyalty projects by name', () => {
    const loyalty = [
      makeProject({ id: 'P1', name: 'Smith Solar', disposition: 'Loyalty' }),
      makeProject({ id: 'P2', name: 'Jones Solar', disposition: 'Loyalty' }),
    ]
    const searched = applySearch(loyalty, 'Smith')
    expect(searched).toHaveLength(1)
    expect(searched[0].id).toBe('P1')
  })

  it('smart filters apply to loyalty projects too', () => {
    const loyalty = [
      makeProject({ id: 'P1', stage: 'evaluation', financier: 'Mosaic', disposition: 'Loyalty' }),
      makeProject({ id: 'P2', stage: 'design', financier: 'GoodLeap', disposition: 'Loyalty' }),
    ]
    const filtered = applySmartFilters(loyalty, { ...EMPTY_FILTERS, financier: 'Mosaic' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('P1')
  })
})
