import { describe, it, expect } from 'vitest'
import { daysAgo, SLA_THRESHOLDS } from '@/lib/utils'

interface TestProject {
  id: string; name: string; stage: string; pm: string | null
  blocker: string | null; sale_date: string | null; stage_date: string | null
  disposition: string | null
}

function daysAgoDate(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function makeProject(o: Partial<TestProject> = {}): TestProject {
  return {
    id: 'PROJ-001', name: 'Test', stage: 'evaluation', pm: 'Greg',
    blocker: null, sale_date: daysAgoDate(10), stage_date: daysAgoDate(1),
    disposition: null, ...o,
  }
}

function getSLA(p: TestProject) {
  const t = SLA_THRESHOLDS[p.stage] ?? { target: 3, risk: 5, crit: 7 }
  const days = daysAgo(p.stage_date)
  let status: 'ok' | 'warn' | 'risk' | 'crit' = 'ok'
  if (days >= t.crit) status = 'crit'
  else if (days >= t.risk) status = 'risk'
  else if (days >= t.target) status = 'warn'
  return status
}

function priority(p: TestProject): number {
  if (p.blocker) return 0
  const sla = getSLA(p)
  if (sla === 'crit') return 1
  if (sla === 'risk') return 2
  if (sla === 'warn') return 3
  return 4
}

describe('queue disposition filtering', () => {
  it('excludes In Service from queue', () => {
    const projects = [makeProject(), makeProject({ disposition: 'In Service', id: 'P2' })]
    const filtered = projects.filter(p => p.disposition !== 'In Service')
    expect(filtered).toHaveLength(1)
  })

  it('keeps Loyalty in queue (intentional)', () => {
    const projects = [makeProject(), makeProject({ disposition: 'Loyalty', id: 'P2' })]
    const filtered = projects.filter(p => p.disposition !== 'In Service')
    expect(filtered).toHaveLength(2)
  })
})

describe('queue priority sorting', () => {
  it('blocked (0) sorts before critical (1)', () => {
    const blocked = makeProject({ blocker: 'Issue', id: 'B' })
    const critical = makeProject({ stage_date: daysAgoDate(100), id: 'C' })
    expect(priority(blocked)).toBeLessThan(priority(critical))
  })

  it.skip('critical (1) sorts before risk (2)', () => {
    const crit = makeProject({ stage_date: daysAgoDate(7), id: 'C' }) // eval crit=6
    const risk = makeProject({ stage_date: daysAgoDate(5), id: 'R' }) // eval risk=4
    expect(priority(crit)).toBeLessThan(priority(risk))
  })

  it('ok (4) sorts last', () => {
    const ok = makeProject({ stage_date: daysAgoDate(1), id: 'O' })
    expect(priority(ok)).toBe(4)
  })

  it.skip('sorts projects by priority', () => {
    const projects = [
      makeProject({ stage_date: daysAgoDate(1), id: 'ok' }),
      makeProject({ blocker: 'X', id: 'blocked' }),
      makeProject({ stage_date: daysAgoDate(7), id: 'crit' }),
    ]
    const sorted = [...projects].sort((a, b) => priority(a) - priority(b))
    expect(sorted[0].id).toBe('blocked')
    expect(sorted[1].id).toBe('crit')
    expect(sorted[2].id).toBe('ok')
  })
})

describe('queue cycle days', () => {
  it('uses || for fallback, not ??', () => {
    const p = makeProject({ sale_date: null, stage_date: daysAgoDate(5) })
    const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date)
    expect(cycle).toBe(5)
  })
})
