import { describe, it, expect } from 'vitest'
import { daysAgo, fmtDate, fmt$, cn, escapeIlike, escapeFilterValue, STAGE_ORDER, STAGE_LABELS, SLA_THRESHOLDS, STAGE_TASKS, INACTIVE_DISPOSITIONS, INACTIVE_DISPOSITION_FILTER } from '@/lib/utils'

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

  // ── Timestamp handling (bare date vs ISO timestamp) ────────────────────

  it('handles bare date string (YYYY-MM-DD)', () => {
    const d = new Date()
    d.setDate(d.getDate() - 10)
    const tenDaysAgo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    expect(daysAgo(tenDaysAgo)).toBe(10)
  })

  it('handles ISO timestamp with timezone offset', () => {
    const d = new Date()
    d.setDate(d.getDate() - 3)
    const ts = d.toISOString() // e.g. 2026-03-25T12:30:00.000Z
    const result = daysAgo(ts)
    // Should be approximately 3 (could be 2 or 3 depending on time of day)
    expect(result).toBeGreaterThanOrEqual(2)
    expect(result).toBeLessThanOrEqual(4)
  })

  it('handles timestamp with positive timezone offset', () => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    const bare = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const ts = `${bare}T23:50:55+00:00`
    const result = daysAgo(ts)
    expect(result).toBeGreaterThanOrEqual(6)
    expect(result).toBeLessThanOrEqual(8)
  })

  it('returns consistent result for bare date and midnight timestamp of same day', () => {
    const d = new Date()
    d.setDate(d.getDate() - 5)
    const bare = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const bareDays = daysAgo(bare)
    const tsDays = daysAgo(`${bare}T00:00:00+00:00`)
    // Both should give approximately the same result (within 1 day of rounding)
    expect(Math.abs(bareDays - tsDays)).toBeLessThanOrEqual(1)
  })

  it('handles negative timezone offset', () => {
    // Supabase can return timestamps with negative offsets: 2026-03-28T23:50:55-05:00
    const d = new Date()
    d.setDate(d.getDate() - 4)
    const bare = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const ts = `${bare}T23:50:55-05:00`
    const result = daysAgo(ts)
    // The -05:00 offset shifts the effective UTC time forward by 5 hours
    // So the result should still be approximately 4 days (within 1 day of rounding)
    expect(result).toBeGreaterThanOrEqual(3)
    expect(result).toBeLessThanOrEqual(5)
  })

  it('handles Supabase-style timestamptz format', () => {
    // Supabase returns timestamps like: 2026-03-28T23:50:55+00:00
    const d = new Date()
    d.setDate(d.getDate() - 2)
    const bare = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const supabaseTs = `${bare}T23:50:55+00:00`
    const result = daysAgo(supabaseTs)
    expect(result).toBeGreaterThanOrEqual(1)
    expect(result).toBeLessThanOrEqual(3)
  })
})

describe('fmtDate', () => {
  it('returns em dash for null', () => {
    expect(fmtDate(null)).toBe('—')
  })

  it('returns em dash for undefined', () => {
    expect(fmtDate(undefined)).toBe('—')
  })

  it('formats a valid bare date', () => {
    const result = fmtDate('2025-01-15')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
    expect(result).toContain('2025')
  })

  it('returns em dash for malformed date', () => {
    expect(fmtDate('not-a-date')).toBe('—')
  })

  it('returns em dash for invalid date string', () => {
    expect(fmtDate('invalid')).toBe('—')
  })

  it('returns em dash for empty string', () => {
    expect(fmtDate('')).toBe('—')
  })

  // ── Timestamp handling (the fix) ───────────────────────────────────────

  it('formats ISO timestamp correctly', () => {
    const result = fmtDate('2026-03-28T23:50:55+00:00')
    expect(result).toContain('Mar')
    expect(result).toContain('2026')
    // The day might be 28 or 29 depending on local timezone
    expect(result).toMatch(/28|29/)
  })

  it('formats bare date and timestamp to the same date', () => {
    // A bare date 2025-06-15 should format the same regardless of T suffix
    const bareResult = fmtDate('2025-06-15')
    expect(bareResult).toContain('Jun')
    expect(bareResult).toContain('15')
    expect(bareResult).toContain('2025')

    // Timestamp at midnight UTC
    const tsResult = fmtDate('2025-06-15T00:00:00+00:00')
    expect(tsResult).toContain('Jun')
    expect(tsResult).toContain('2025')
  })

  it('formats timestamp with Z suffix', () => {
    const result = fmtDate('2025-12-25T12:00:00Z')
    expect(result).toContain('Dec')
    expect(result).toContain('25')
    expect(result).toContain('2025')
  })

  it('formats timestamp with negative timezone offset', () => {
    const result = fmtDate('2025-07-04T18:30:00-05:00')
    expect(result).toContain('Jul')
    expect(result).toContain('2025')
  })

  it('handles date at end of year', () => {
    const result = fmtDate('2025-12-31')
    expect(result).toContain('Dec')
    expect(result).toContain('31')
    expect(result).toContain('2025')
  })

  it('handles date at start of year', () => {
    const result = fmtDate('2026-01-01')
    expect(result).toContain('Jan')
    expect(result).toContain('1')
    expect(result).toContain('2026')
  })

  it('formats Supabase timestamptz with microseconds and full offset (+00:00)', () => {
    const result = fmtDate('2026-03-28T23:50:55.236187+00:00')
    expect(result).toContain('Mar')
    expect(result).toContain('2026')
    expect(result).toMatch(/28|29/) // timezone-dependent
  })

  it('returns em dash for Supabase short offset format (+00) which JS cannot parse', () => {
    // Supabase can return timestamps like "2026-03-28 23:50:55.236187+00"
    // JavaScript Date constructor cannot parse the abbreviated +00 offset
    // fmtDate should gracefully return em dash rather than crashing
    expect(fmtDate('2026-03-28T23:50:55.236187+00')).toBe('—')
  })

  it('returns em dash for string containing T but not a valid date: "This is Text"', () => {
    // The string contains 'T' which triggers the timestamp branch,
    // but it is not a valid date — should return em dash
    expect(fmtDate('This is Text')).toBe('—')
  })

  it('returns em dash for tricky non-date with T: "Total"', () => {
    expect(fmtDate('Total')).toBe('—')
  })

  it('handles late-night timestamp without timezone shift', () => {
    // This was the original bug: late-night UTC timestamps shifting the date
    // With the fix, bare dates append T00:00:00 to avoid timezone offset
    const result = fmtDate('2026-03-15')
    expect(result).toContain('Mar')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })
})

describe('escapeIlike', () => {
  it('escapes percent signs', () => {
    expect(escapeIlike('100%')).toBe('100\\%')
  })

  it('escapes underscores', () => {
    expect(escapeIlike('project_name')).toBe('project\\_name')
  })

  it('escapes backslashes', () => {
    expect(escapeIlike('path\\to')).toBe('path\\\\to')
  })

  it('returns plain text unchanged', () => {
    expect(escapeIlike('hello world')).toBe('hello world')
  })

  it('escapes multiple special chars', () => {
    expect(escapeIlike('100%_test\\')).toBe('100\\%\\_test\\\\')
  })
})

describe('escapeFilterValue', () => {
  it('escapes SQL LIKE special chars', () => {
    expect(escapeFilterValue('100%')).toBe('100\\%')
  })

  it('strips commas (PostgREST .or() delimiter)', () => {
    expect(escapeFilterValue('Corpus Christi, TX')).toBe('Corpus Christi TX')
  })

  it('strips parentheses (PostgREST syntax)', () => {
    expect(escapeFilterValue('test(value)')).toBe('testvalue')
  })

  it('handles combined special chars', () => {
    expect(escapeFilterValue('100%_test(a,b)')).toBe('100\\%\\_testab')
  })

  it('returns plain text unchanged', () => {
    expect(escapeFilterValue('hello world')).toBe('hello world')
  })
})

describe('INACTIVE_DISPOSITIONS', () => {
  it('contains exactly In Service, Loyalty, Cancelled', () => {
    expect(INACTIVE_DISPOSITIONS).toEqual(['In Service', 'Loyalty', 'Cancelled'])
  })

  it('filter string matches array', () => {
    expect(INACTIVE_DISPOSITION_FILTER).toBe('("In Service","Loyalty","Cancelled")')
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
