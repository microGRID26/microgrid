import { describe, it, expect } from 'vitest'
import { classify, cycleDays, getSLA, getStuckTasks } from '@/lib/classify'
import { daysAgo, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'
import type { Project } from '@/types/database'

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgoDate(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'PROJ-001',
    name: 'Test Project',
    city: null,
    zip: null,
    address: null,
    phone: null,
    email: null,
    sale_date: daysAgoDate(10),
    stage: 'evaluation' as any,
    stage_date: daysAgoDate(1),
    pm: 'Greg',
    pm_id: 'uuid-1',
    disposition: null,
    contract: 25000,
    systemkw: 8.5,
    financier: null,
    ahj: null,
    utility: null,
    advisor: null,
    consultant: null,
    blocker: null,
    loyalty: null,
    financing_type: null,
    down_payment: null,
    tpo_escalator: null,
    financier_adv_pmt: null,
    module: null,
    module_qty: null,
    inverter: null,
    inverter_qty: null,
    battery: null,
    battery_qty: null,
    optimizer: null,
    optimizer_qty: null,
    meter_location: null,
    panel_location: null,
    voltage: null,
    msp_bus_rating: null,
    mpu: null,
    shutdown: null,
    performance_meter: null,
    interconnection_breaker: null,
    main_breaker: null,
    hoa: null,
    esid: null,
    permit_number: null,
    utility_app_number: null,
    permit_fee: null,
    reinspection_fee: null,
    city_permit_date: null,
    utility_permit_date: null,
    ntp_date: null,
    survey_scheduled_date: null,
    survey_date: null,
    install_scheduled_date: null,
    install_complete_date: null,
    city_inspection_date: null,
    utility_inspection_date: null,
    pto_date: null,
    in_service_date: null,
    site_surveyor: null,
    consultant_email: null,
    dealer: null,
    follow_up_date: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── classify() ───────────────────────────────────────────────────────────────

describe('classify()', () => {
  it('returns On Track for a fresh project with no issues', () => {
    const p = makeProject({ stage_date: daysAgoDate(1) })
    const result = classify([p], new Set(), new Set())
    expect(result.ok).toHaveLength(1)
    expect(result.ok[0].id).toBe('PROJ-001')
    expect(result.blocked).toHaveLength(0)
    expect(result.crit).toHaveLength(0)
    expect(result.risk).toHaveLength(0)
    expect(result.stall).toHaveLength(0)
  })

  it('returns Blocked when project has a blocker', () => {
    const p = makeProject({ blocker: 'Missing documents' })
    const result = classify([p], new Set(), new Set())
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].blocker).toBe('Missing documents')
    expect(result.ok).toHaveLength(0)
  })

  it('returns Stalled when project has no stage change in 5+ days and SLA is ok', () => {
    // Use permit stage since SLA thresholds are set to 999 (paused), so 5 days in stage = SLA ok
    const p = makeProject({ stage: 'permit' as any, stage_date: daysAgoDate(6) })
    const result = classify([p], new Set(), new Set())
    expect(result.stall).toHaveLength(1)
  })

  it('returns Stalled for exactly 5 days in stage', () => {
    const p = makeProject({ stage: 'permit' as any, stage_date: daysAgoDate(5) })
    const result = classify([p], new Set(), new Set())
    expect(result.stall).toHaveLength(1)
  })

  it('does not return Stalled for 4 days in stage', () => {
    const p = makeProject({ stage: 'permit' as any, stage_date: daysAgoDate(4) })
    const result = classify([p], new Set(), new Set())
    expect(result.stall).toHaveLength(0)
    expect(result.ok).toHaveLength(1)
  })

  it('returns Aging when project has 90+ cycle days', () => {
    const p = makeProject({ sale_date: daysAgoDate(91), stage_date: daysAgoDate(1) })
    const result = classify([p], new Set(), new Set())
    expect(result.aging).toHaveLength(1)
  })

  it('does not return Aging for 89 cycle days', () => {
    const p = makeProject({ sale_date: daysAgoDate(89), stage_date: daysAgoDate(1) })
    const result = classify([p], new Set(), new Set())
    expect(result.aging).toHaveLength(0)
  })

  it('returns Loyalty when disposition is Loyalty', () => {
    const p = makeProject({ disposition: 'Loyalty' })
    const result = classify([p], new Set(), new Set())
    expect(result.loyalty).toHaveLength(1)
    // Loyalty projects are excluded from pipeline sections
    expect(result.ok).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
  })

  it('returns In Service when disposition is In Service', () => {
    const p = makeProject({ disposition: 'In Service' })
    const result = classify([p], new Set(), new Set())
    expect(result.inService).toHaveLength(1)
    expect(result.ok).toHaveLength(0)
  })

  it('excludes Cancelled projects from pipeline sections', () => {
    const p = makeProject({ disposition: 'Cancelled' })
    const result = classify([p], new Set(), new Set())
    expect(result.ok).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
    expect(result.loyalty).toHaveLength(0)
    expect(result.inService).toHaveLength(0)
  })

  it('excludes complete stage from active sections (blocked, ok, stall, etc.)', () => {
    const p = makeProject({ stage: 'complete' as any })
    const result = classify([p], new Set(), new Set())
    expect(result.ok).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
    expect(result.stall).toHaveLength(0)
  })

  it('overdue projects are identified by overduePids set', () => {
    const p = makeProject({ id: 'PROJ-OVERDUE' })
    const result = classify([p], new Set(['PROJ-OVERDUE']), new Set())
    expect(result.overdue).toHaveLength(1)
    expect(result.overdue[0].id).toBe('PROJ-OVERDUE')
  })

  it('pending projects are identified by pendingPids set (when SLA ok)', () => {
    const p = makeProject({ id: 'PROJ-PEND', stage_date: daysAgoDate(1) })
    const result = classify([p], new Set(), new Set(['PROJ-PEND']))
    expect(result.pending).toHaveLength(1)
  })

  it('blocked takes priority over SLA status', () => {
    const p = makeProject({ blocker: 'Issue', stage_date: daysAgoDate(200) })
    const result = classify([p], new Set(), new Set())
    expect(result.blocked).toHaveLength(1)
    // blocked projects should not appear in crit (crit filters out blocked)
    expect(result.crit).toHaveLength(0)
  })

  it('classifies multiple projects correctly', () => {
    const projects = [
      makeProject({ id: 'P1', stage_date: daysAgoDate(1) }),
      makeProject({ id: 'P2', blocker: 'Blocked!' }),
      makeProject({ id: 'P3', disposition: 'Loyalty' }),
      makeProject({ id: 'P4', sale_date: daysAgoDate(100), stage_date: daysAgoDate(1) }),
      makeProject({ id: 'P5', disposition: 'In Service' }),
    ]
    const result = classify(projects, new Set(), new Set())
    // P1 (ok, fresh) and P4 (aging but also ok since stage_date=1 day ago) are both in ok
    expect(result.ok.length).toBeGreaterThanOrEqual(1)
    expect(result.blocked).toHaveLength(1)
    expect(result.loyalty).toHaveLength(1)
    expect(result.aging).toHaveLength(1)
    expect(result.inService).toHaveLength(1)
  })
})

// ── cycleDays() ──────────────────────────────────────────────────────────────

describe('cycleDays()', () => {
  it('returns 0 for null dates', () => {
    const p = makeProject({ sale_date: null, stage_date: null })
    expect(cycleDays(p)).toBe(0)
  })

  it('uses sale_date when available', () => {
    const p = makeProject({ sale_date: daysAgoDate(15), stage_date: daysAgoDate(3) })
    expect(cycleDays(p)).toBe(15)
  })

  it('falls back to stage_date when sale_date is null (|| fallback)', () => {
    const p = makeProject({ sale_date: null, stage_date: daysAgoDate(7) })
    expect(cycleDays(p)).toBe(7)
  })

  it('falls back to stage_date when sale_date returns 0 (future date / || behavior)', () => {
    // daysAgo returns 0 for today or future, || falls through to stage_date
    const today = daysAgoDate(0)
    const p = makeProject({ sale_date: today, stage_date: daysAgoDate(5) })
    // daysAgo(today) = 0, so || falls to daysAgo(stage_date) = 5
    expect(cycleDays(p)).toBe(5)
  })
})

// ── getSLA() ─────────────────────────────────────────────────────────────────

describe('getSLA()', () => {
  // Note: SLA thresholds are paused (all 999), so everything returns 'ok'
  // These tests verify the function structure works correctly

  it('returns ok status for project within all thresholds', () => {
    const p = makeProject({ stage: 'evaluation' as any, stage_date: daysAgoDate(2) })
    const sla = getSLA(p)
    expect(sla.status).toBe('ok')
    expect(sla.days).toBe(2)
  })

  it('returns correct threshold values from SLA_THRESHOLDS', () => {
    const p = makeProject({ stage: 'permit' as any, stage_date: daysAgoDate(5) })
    const sla = getSLA(p)
    expect(sla.target).toBe(SLA_THRESHOLDS.permit.target)
    expect(sla.risk).toBe(SLA_THRESHOLDS.permit.risk)
    expect(sla.crit).toBe(SLA_THRESHOLDS.permit.crit)
  })

  it('uses default thresholds for unknown stage', () => {
    const p = makeProject({ stage: 'unknown' as any, stage_date: daysAgoDate(2) })
    const sla = getSLA(p)
    expect(sla.target).toBe(3)
    expect(sla.risk).toBe(5)
    expect(sla.crit).toBe(7)
  })

  it('returns crit when days >= crit threshold (with custom thresholds)', () => {
    // Simulate real thresholds by using unknown stage with default 3/5/7
    const p = makeProject({ stage: 'unknown_stage' as any, stage_date: daysAgoDate(8) })
    const sla = getSLA(p)
    expect(sla.status).toBe('crit')
  })

  it('returns risk when days >= risk but < crit (default thresholds)', () => {
    const p = makeProject({ stage: 'unknown_stage' as any, stage_date: daysAgoDate(6) })
    const sla = getSLA(p)
    expect(sla.status).toBe('risk')
  })

  it('returns warn when days >= target but < risk (default thresholds)', () => {
    const p = makeProject({ stage: 'unknown_stage' as any, stage_date: daysAgoDate(4) })
    const sla = getSLA(p)
    expect(sla.status).toBe('warn')
  })

  it('returns ok when days < target (default thresholds)', () => {
    const p = makeProject({ stage: 'unknown_stage' as any, stage_date: daysAgoDate(2) })
    const sla = getSLA(p)
    expect(sla.status).toBe('ok')
  })

  it('returns 0 days for null stage_date', () => {
    const p = makeProject({ stage_date: null })
    const sla = getSLA(p)
    expect(sla.days).toBe(0)
    expect(sla.status).toBe('ok')
  })
})

// ── getStuckTasks() ──────────────────────────────────────────────────────────

describe('getStuckTasks()', () => {
  it('finds Pending Resolution tasks', () => {
    const p = makeProject({ stage: 'evaluation' as any })
    const taskMap = {
      welcome: { status: 'Pending Resolution', reason: 'Customer Unresponsive' },
      ia: { status: 'Complete' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(1)
    expect(stuck[0].name).toBe('Welcome Call')
    expect(stuck[0].status).toBe('Pending Resolution')
    expect(stuck[0].reason).toBe('Customer Unresponsive')
  })

  it('finds Revision Required tasks', () => {
    const p = makeProject({ stage: 'design' as any })
    const taskMap = {
      build_design: { status: 'Revision Required', reason: 'Panel Count Change' },
      scope: { status: 'In Progress' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(1)
    expect(stuck[0].name).toBe('Build Design')
    expect(stuck[0].status).toBe('Revision Required')
    expect(stuck[0].reason).toBe('Panel Count Change')
  })

  it('returns empty array when no tasks are stuck', () => {
    const p = makeProject({ stage: 'evaluation' as any })
    const taskMap = {
      welcome: { status: 'Complete' },
      ia: { status: 'In Progress' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(0)
  })

  it('finds multiple stuck tasks', () => {
    const p = makeProject({ stage: 'evaluation' as any })
    const taskMap = {
      welcome: { status: 'Pending Resolution', reason: 'Customer Unresponsive' },
      ia: { status: 'Revision Required', reason: 'Incorrect Email' },
      ub: { status: 'Complete' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(2)
  })

  it('handles empty taskMap', () => {
    const p = makeProject({ stage: 'evaluation' as any })
    const stuck = getStuckTasks(p, {})
    expect(stuck).toHaveLength(0)
  })

  it('handles unknown stage gracefully', () => {
    const p = makeProject({ stage: 'nonexistent' as any })
    const stuck = getStuckTasks(p, { foo: { status: 'Pending Resolution', reason: 'test' } })
    expect(stuck).toHaveLength(0)
  })

  it('returns empty reason when reason is missing', () => {
    const p = makeProject({ stage: 'evaluation' as any })
    const taskMap = {
      welcome: { status: 'Pending Resolution' },
    }
    const stuck = getStuckTasks(p, taskMap)
    expect(stuck).toHaveLength(1)
    expect(stuck[0].reason).toBe('')
  })
})
