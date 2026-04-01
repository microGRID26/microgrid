import { describe, it, expect } from 'vitest'
import { getValidTransitions, getSLAStatus, TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_STATUS_COLORS, TICKET_PRIORITIES, TICKET_PRIORITY_COLORS, TICKET_CATEGORIES, TICKET_CATEGORY_COLORS } from '@/lib/api/tickets'
import type { Ticket } from '@/lib/api/tickets'

// ── Constants ────────────────────────────────────────────────────────────────

describe('Ticket constants', () => {
  it('has 8 statuses', () => {
    expect(TICKET_STATUSES).toHaveLength(8)
  })

  it('every status has a label', () => {
    for (const s of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABELS[s]).toBeDefined()
      expect(TICKET_STATUS_LABELS[s].length).toBeGreaterThan(0)
    }
  })

  it('every status has a color', () => {
    for (const s of TICKET_STATUSES) {
      expect(TICKET_STATUS_COLORS[s]).toBeDefined()
    }
  })

  it('has 5 priorities', () => {
    expect(TICKET_PRIORITIES).toHaveLength(5)
    expect(TICKET_PRIORITIES).toContain('low')
    expect(TICKET_PRIORITIES).toContain('critical')
  })

  it('every priority has a color', () => {
    for (const p of TICKET_PRIORITIES) {
      expect(TICKET_PRIORITY_COLORS[p]).toBeDefined()
    }
  })

  it('has 8 categories', () => {
    expect(TICKET_CATEGORIES).toHaveLength(8)
    expect(TICKET_CATEGORIES).toContain('service')
    expect(TICKET_CATEGORIES).toContain('sales')
    expect(TICKET_CATEGORIES).toContain('warranty')
  })

  it('every category has a color', () => {
    for (const c of TICKET_CATEGORIES) {
      expect(TICKET_CATEGORY_COLORS[c]).toBeDefined()
    }
  })
})

// ── Status Transitions ───────────────────────────────────────────────────────

describe('getValidTransitions', () => {
  it('open can go to assigned, in_progress, escalated, resolved, closed', () => {
    const t = getValidTransitions('open')
    expect(t).toContain('assigned')
    expect(t).toContain('in_progress')
    expect(t).toContain('escalated')
    expect(t).toContain('resolved')
    expect(t).toContain('closed')
  })

  it('in_progress can go to waiting states, escalated, resolved', () => {
    const t = getValidTransitions('in_progress')
    expect(t).toContain('waiting_on_customer')
    expect(t).toContain('waiting_on_vendor')
    expect(t).toContain('escalated')
    expect(t).toContain('resolved')
    expect(t).not.toContain('open')
    expect(t).not.toContain('closed')
  })

  it('escalated can only go to in_progress or resolved', () => {
    const t = getValidTransitions('escalated')
    expect(t).toEqual(['in_progress', 'resolved'])
  })

  it('resolved can close or reopen', () => {
    const t = getValidTransitions('resolved')
    expect(t).toContain('closed')
    expect(t).toContain('in_progress')
  })

  it('closed can only reopen', () => {
    const t = getValidTransitions('closed')
    expect(t).toEqual(['open'])
  })

  it('unknown status returns empty', () => {
    expect(getValidTransitions('nonexistent')).toEqual([])
  })

  it('every status has at least one valid transition', () => {
    for (const s of TICKET_STATUSES) {
      expect(getValidTransitions(s).length).toBeGreaterThan(0)
    }
  })

  it('no status can transition to itself', () => {
    for (const s of TICKET_STATUSES) {
      expect(getValidTransitions(s)).not.toContain(s)
    }
  })

  it('waiting_on_vendor cannot close directly', () => {
    const t = getValidTransitions('waiting_on_vendor')
    expect(t).not.toContain('closed')
  })

  it('assigned cannot go back to open', () => {
    const t = getValidTransitions('assigned')
    expect(t).not.toContain('open')
  })
})

// ── SLA Status ───────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'test-id',
    ticket_number: 'TKT-20260331-001',
    project_id: null,
    category: 'service',
    subcategory: null,
    priority: 'normal',
    source: 'internal',
    title: 'Test ticket',
    description: null,
    status: 'open',
    resolution_category: null,
    resolution_notes: null,
    assigned_to: null,
    assigned_to_id: null,
    assigned_team: null,
    escalated_to: null,
    escalated_at: null,
    reported_by: null,
    reported_by_id: null,
    sales_rep_id: null,
    pm_id: null,
    sla_response_hours: 24,
    sla_resolution_hours: 72,
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    tags: null,
    related_ticket_id: null,
    org_id: null,
    created_by: null,
    created_by_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('getSLAStatus', () => {
  it('new ticket is ok for both SLAs', () => {
    const t = makeTicket({ created_at: new Date().toISOString() })
    const sla = getSLAStatus(t)
    expect(sla.response).toBe('ok')
    expect(sla.resolution).toBe('ok')
  })

  it('response breached when no first_response and past SLA', () => {
    const t = makeTicket({
      created_at: new Date(Date.now() - 25 * 3600000).toISOString(),
      sla_response_hours: 24,
    })
    const sla = getSLAStatus(t)
    expect(sla.response).toBe('breached')
  })

  it('response warning when approaching SLA (75%+)', () => {
    const t = makeTicket({
      created_at: new Date(Date.now() - 20 * 3600000).toISOString(),
      sla_response_hours: 24,
    })
    const sla = getSLAStatus(t)
    expect(sla.response).toBe('warning')
  })

  it('response ok when first_response_at is within SLA', () => {
    const created = new Date(Date.now() - 48 * 3600000)
    const responded = new Date(created.getTime() + 12 * 3600000)
    const t = makeTicket({
      created_at: created.toISOString(),
      first_response_at: responded.toISOString(),
      sla_response_hours: 24,
    })
    const sla = getSLAStatus(t)
    expect(sla.response).toBe('ok')
  })

  it('response breached when first_response_at exceeds SLA', () => {
    const created = new Date(Date.now() - 48 * 3600000)
    const responded = new Date(created.getTime() + 30 * 3600000)
    const t = makeTicket({
      created_at: created.toISOString(),
      first_response_at: responded.toISOString(),
      sla_response_hours: 24,
    })
    const sla = getSLAStatus(t)
    expect(sla.response).toBe('breached')
  })

  it('resolution ok when resolved within SLA', () => {
    const created = new Date(Date.now() - 100 * 3600000)
    const resolved = new Date(created.getTime() + 48 * 3600000)
    const t = makeTicket({
      created_at: created.toISOString(),
      resolved_at: resolved.toISOString(),
      status: 'resolved',
      sla_resolution_hours: 72,
    })
    const sla = getSLAStatus(t)
    expect(sla.resolution).toBe('ok')
  })

  it('resolution breached when resolved past SLA', () => {
    const created = new Date(Date.now() - 200 * 3600000)
    const resolved = new Date(created.getTime() + 100 * 3600000)
    const t = makeTicket({
      created_at: created.toISOString(),
      resolved_at: resolved.toISOString(),
      status: 'resolved',
      sla_resolution_hours: 72,
    })
    const sla = getSLAStatus(t)
    expect(sla.resolution).toBe('breached')
  })

  it('resolution breached for open ticket past SLA', () => {
    const t = makeTicket({
      created_at: new Date(Date.now() - 100 * 3600000).toISOString(),
      sla_resolution_hours: 72,
    })
    const sla = getSLAStatus(t)
    expect(sla.resolution).toBe('breached')
  })

  it('urgent SLA (4h response) breaches quickly', () => {
    const t = makeTicket({
      created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
      sla_response_hours: 4,
    })
    const sla = getSLAStatus(t)
    expect(sla.response).toBe('breached')
  })
})
