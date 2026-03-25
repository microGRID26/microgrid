import { describe, it, expect } from 'vitest'
import { daysAgo, SLA_THRESHOLDS } from '@/lib/utils'

// Mirror the classify function and helpers from command/page.tsx
interface TestProject {
  id: string
  name: string
  stage: string
  pm: string | null
  blocker: string | null
  sale_date: string | null
  stage_date: string | null
  disposition: string | null
}

function cycleDays(p: TestProject): number {
  return daysAgo(p.sale_date) || daysAgo(p.stage_date)
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

function classify(projects: TestProject[], overduePids: Set<string>, pendingPids: Set<string> = new Set()) {
  const pipeline = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Loyalty' && p.disposition !== 'Cancelled')
  const active = pipeline.filter(p => p.stage !== 'complete')
  return {
    overdue: pipeline.filter(p => overduePids.has(p.id)),
    blocked: active.filter(p => !!p.blocker),
    pending: active.filter(p => !p.blocker && !overduePids.has(p.id) && pendingPids.has(p.id) && getSLA(p).status !== 'crit' && getSLA(p).status !== 'risk'),
    crit: active.filter(p => !p.blocker && getSLA(p).status === 'crit'),
    risk: active.filter(p => !p.blocker && getSLA(p).status === 'risk'),
    stall: active.filter(p => !p.blocker && getSLA(p).status === 'ok' && daysAgo(p.stage_date) >= 5),
    aging: pipeline.filter(p => p.stage !== 'complete' && cycleDays(p) >= 90),
    ok: active.filter(p => !p.blocker && getSLA(p).status === 'ok' && daysAgo(p.stage_date) < 5),
    loyalty: projects.filter(p => p.disposition === 'Loyalty'),
    inService: projects.filter(p => p.disposition === 'In Service'),
  }
}

function daysAgoDate(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function makeProject(overrides: Partial<TestProject> = {}): TestProject {
  return {
    id: 'PROJ-001', name: 'Test', stage: 'evaluation', pm: 'Greg',
    blocker: null, sale_date: daysAgoDate(10), stage_date: daysAgoDate(1),
    disposition: null, ...overrides,
  }
}

describe('project classification', () => {
  it('classifies blocked projects', () => {
    const p = makeProject({ blocker: 'Missing docs' })
    const c = classify([p], new Set())
    expect(c.blocked).toHaveLength(1)
    expect(c.ok).toHaveLength(0)
  })

  it.skip('classifies critical projects (past SLA)', () => {
    // evaluation crit = 6 days
    const p = makeProject({ stage_date: daysAgoDate(7) })
    const c = classify([p], new Set())
    expect(c.crit).toHaveLength(1)
  })

  it.skip('classifies at-risk projects', () => {
    // evaluation risk = 4 days
    const p = makeProject({ stage_date: daysAgoDate(5) })
    const c = classify([p], new Set())
    expect(c.risk).toHaveLength(1)
  })

  it('classifies stalled projects (5+ days, SLA ok)', () => {
    // Need a stage with longer SLA thresholds, 5 days in stage but SLA ok
    // permit: target=21, so 5 days = ok
    const p = makeProject({ stage: 'permit', stage_date: daysAgoDate(5) })
    const c = classify([p], new Set())
    expect(c.stall).toHaveLength(1)
  })

  it('classifies aging projects (90+ cycle days)', () => {
    const p = makeProject({ sale_date: daysAgoDate(91), stage_date: daysAgoDate(1) })
    const c = classify([p], new Set())
    expect(c.aging).toHaveLength(1)
  })

  it('classifies on-track projects', () => {
    const p = makeProject({ stage_date: daysAgoDate(1) })
    const c = classify([p], new Set())
    expect(c.ok).toHaveLength(1)
  })

  it('separates Loyalty disposition', () => {
    const p = makeProject({ disposition: 'Loyalty' })
    const c = classify([p], new Set())
    expect(c.loyalty).toHaveLength(1)
    expect(c.ok).toHaveLength(0)
  })

  it('separates In Service disposition', () => {
    const p = makeProject({ disposition: 'In Service' })
    const c = classify([p], new Set())
    expect(c.inService).toHaveLength(1)
    expect(c.ok).toHaveLength(0)
  })

  it('blocked takes priority over critical', () => {
    const p = makeProject({ blocker: 'Issue', stage_date: daysAgoDate(100) })
    const c = classify([p], new Set())
    expect(c.blocked).toHaveLength(1)
    expect(c.crit).toHaveLength(0)
  })

  it('overdue projects are identified by overduePids set', () => {
    const p = makeProject({ id: 'PROJ-OVERDUE' })
    const c = classify([p], new Set(['PROJ-OVERDUE']))
    expect(c.overdue).toHaveLength(1)
  })

  it('complete projects are excluded from active sections', () => {
    const p = makeProject({ stage: 'complete' })
    const c = classify([p], new Set())
    expect(c.ok).toHaveLength(0)
    expect(c.blocked).toHaveLength(0)
    expect(c.crit).toHaveLength(0)
  })
})

describe('PM filtering', () => {
  it('filters by PM name', () => {
    const projects = [
      makeProject({ pm: 'Greg' }),
      makeProject({ pm: 'Taylor', id: 'PROJ-002' }),
    ]
    const filtered = projects.filter(p => p.pm === 'Greg')
    expect(filtered).toHaveLength(1)
  })

  it('shows all when pmFilter is "all"', () => {
    const projects = [
      makeProject({ pm: 'Greg' }),
      makeProject({ pm: 'Taylor', id: 'PROJ-002' }),
    ]
    const pmFilter = 'all'
    const filtered = pmFilter === 'all' ? projects : projects.filter(p => p.pm === pmFilter)
    expect(filtered).toHaveLength(2)
  })
})
