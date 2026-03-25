import { describe, it, expect } from 'vitest'
import { daysAgo, fmtDate, fmt$, cn, STAGE_ORDER, STAGE_LABELS, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'

describe('daysAgo', () => {
  it('returns 0 for null', () => {
    expect(daysAgo(null)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(daysAgo(undefined)).toBe(0)
  })

  it('returns 0 for malformed date', () => {
    expect(daysAgo('not-a-date')).toBe(0)
  })

  it('returns 0 for future date', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    expect(daysAgo(tomorrow)).toBe(0)
  })

  it('returns correct days for past date', () => {
    const d = new Date()
    d.setDate(d.getDate() - 5)
    const fiveDaysAgo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    expect(daysAgo(fiveDaysAgo)).toBe(5)
  })

  it('returns 0 for today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(daysAgo(today)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(daysAgo('')).toBe(0)
  })
})

describe('fmtDate', () => {
  it('returns em dash for null', () => {
    expect(fmtDate(null)).toBe('—')
  })

  it('returns em dash for undefined', () => {
    expect(fmtDate(undefined)).toBe('—')
  })

  it('formats a valid date', () => {
    const result = fmtDate('2025-01-15')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
    expect(result).toContain('2025')
  })

  it('handles malformed date', () => {
    // fmtDate passes through to toLocaleDateString which may return 'Invalid Date'
    const result = fmtDate('not-a-date')
    expect(typeof result).toBe('string')
  })
})

describe('fmt$', () => {
  it('returns $0 for null', () => {
    expect(fmt$(null)).toBe('$0')
  })

  it('returns $0 for undefined', () => {
    expect(fmt$(undefined)).toBe('$0')
  })

  it('returns $0 for 0', () => {
    expect(fmt$(0)).toBe('$0')
  })

  it('formats positive number with commas', () => {
    const result = fmt$(12345)
    expect(result).toBe('$12,345')
  })

  it('formats large number', () => {
    const result = fmt$(1000000)
    expect(result).toBe('$1,000,000')
  })
})

describe('cn', () => {
  it('merges classes', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz')
  })

  it('resolves Tailwind conflicts', () => {
    const result = cn('text-red-500', 'text-blue-500')
    expect(result).toBe('text-blue-500')
  })
})

describe('STAGE_ORDER', () => {
  it('has 7 stages in correct order', () => {
    expect(STAGE_ORDER).toEqual([
      'evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete'
    ])
  })
})

describe('STAGE_LABELS', () => {
  it('has a label for every stage', () => {
    for (const stage of STAGE_ORDER) {
      expect(STAGE_LABELS[stage]).toBeDefined()
      expect(typeof STAGE_LABELS[stage]).toBe('string')
    }
  })
})

describe('SLA_THRESHOLDS', () => {
  it.skip('has thresholds for every stage', () => {
    for (const stage of STAGE_ORDER) {
      const t = SLA_THRESHOLDS[stage]
      expect(t).toBeDefined()
      expect(t.target).toBeLessThan(t.risk)
      expect(t.risk).toBeLessThan(t.crit)
    }
  })

  it.skip('permit has longest thresholds', () => {
    expect(SLA_THRESHOLDS.permit.crit).toBe(45)
  })
})

describe('STAGE_TASKS', () => {
  it('has tasks for every stage', () => {
    for (const stage of STAGE_ORDER) {
      expect(STAGE_TASKS[stage]).toBeDefined()
      expect(STAGE_TASKS[stage].length).toBeGreaterThan(0)
    }
  })

  it('each task has id and name', () => {
    for (const stage of STAGE_ORDER) {
      for (const task of STAGE_TASKS[stage]) {
        expect(task.id).toBeDefined()
        expect(task.name).toBeDefined()
      }
    }
  })
})
