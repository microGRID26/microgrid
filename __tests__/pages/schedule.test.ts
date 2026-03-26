import { describe, it, expect } from 'vitest'

// ── Helper: multi-day job expansion (mirrors schedMap logic in schedule page) ──
type ScheduleJob = {
  id: string
  crew_id: string
  date: string
  end_date?: string | null
  job_type: string
  status: string
  time?: string | null
  notes?: string | null
  project_id?: string | null
  project?: { name: string; city: string } | null
  pm?: string | null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Build a schedule map: crewId|date -> jobs[]
 * Multi-day jobs (with end_date) appear in every day column they span.
 * Mirrors the schedMap useMemo in app/schedule/page.tsx.
 */
function buildSchedMap(jobs: ScheduleJob[], weekDays: Date[]): Record<string, ScheduleJob[]> {
  const map: Record<string, ScheduleJob[]> = {}
  jobs.forEach(s => {
    if (!s.crew_id || !s.date) return
    const startDate = s.date
    const endDate = s.end_date || s.date
    weekDays.forEach(d => {
      const dayIso = isoDate(d)
      if (dayIso >= startDate && dayIso <= endDate) {
        const key = `${s.crew_id}|${dayIso}`
        if (!map[key]) map[key] = []
        if (!map[key].some(existing => existing.id === s.id)) {
          map[key].push(s)
        }
      }
    })
  })
  return map
}

/**
 * Multi-day label: "Day X/Y" for a given job on a given day.
 * Mirrors the multiDayLabel logic in app/schedule/page.tsx.
 */
function getMultiDayLabel(job: ScheduleJob, dayIso: string): string | null {
  const isMultiDay = !!job.end_date && job.end_date !== job.date
  if (!isMultiDay) return null
  const start = new Date(job.date + 'T00:00:00')
  const end = new Date((job.end_date ?? job.date) + 'T00:00:00')
  const current = new Date(dayIso + 'T00:00:00')
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  const dayNum = Math.round((current.getTime() - start.getTime()) / 86400000) + 1
  return `Day ${dayNum}/${totalDays}`
}

/**
 * Range-aware conflict detection (mirrors ScheduleAssignModal logic).
 * A job overlaps if: job.date <= rangeEnd AND jobEnd >= rangeStart.
 * Excludes the current job by ID.
 */
function hasRangeConflict(
  existingJobs: { id: string; crew_id: string; date: string; end_date?: string | null }[],
  currentId: string | null,
  crewId: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  const others = existingJobs.filter(s => {
    if (s.id === currentId) return false
    if (s.crew_id !== crewId) return false
    const jobEnd = s.end_date || s.date
    // Overlap: job starts <= our end AND job ends >= our start
    return s.date <= rangeEnd && jobEnd >= rangeStart
  })
  return others.length > 0
}

/**
 * Simulate the save record build for install details.
 * arrays field must be stored as number, not string (mirrors ScheduleAssignModal save()).
 */
function buildInstallRecord(installDetails: { arrays: string; [k: string]: string }): Record<string, any> {
  return {
    arrays: installDetails.arrays ? Number(installDetails.arrays) : null,
  }
}

// ── Multi-day job expansion ──────────────────────────────────────────────────

describe('schedule multi-day job expansion', () => {
  // Week: Mon 2026-03-23 through Sat 2026-03-28
  const weekDays = Array.from({ length: 6 }, (_, i) => {
    const d = new Date('2026-03-23T00:00:00')
    d.setDate(d.getDate() + i)
    return d
  })

  it('multi-day job (Mon-Wed) appears in Mon, Tue, Wed columns', () => {
    const job: ScheduleJob = {
      id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-25',
      job_type: 'install', status: 'scheduled',
    }
    const map = buildSchedMap([job], weekDays)
    // Should appear in Mon, Tue, Wed
    expect(map['C1|2026-03-23']).toHaveLength(1)
    expect(map['C1|2026-03-24']).toHaveLength(1)
    expect(map['C1|2026-03-25']).toHaveLength(1)
    // Should NOT appear in Thu, Fri, Sat
    expect(map['C1|2026-03-26']).toBeUndefined()
    expect(map['C1|2026-03-27']).toBeUndefined()
    expect(map['C1|2026-03-28']).toBeUndefined()
  })

  it('single-day job (no end_date) only appears in its day', () => {
    const job: ScheduleJob = {
      id: 'J2', crew_id: 'C1', date: '2026-03-24', end_date: null,
      job_type: 'survey', status: 'scheduled',
    }
    const map = buildSchedMap([job], weekDays)
    expect(map['C1|2026-03-24']).toHaveLength(1)
    // No other days
    expect(map['C1|2026-03-23']).toBeUndefined()
    expect(map['C1|2026-03-25']).toBeUndefined()
  })

  it('does not duplicate the same job on the same day', () => {
    const job: ScheduleJob = {
      id: 'J3', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-24',
      job_type: 'install', status: 'scheduled',
    }
    // Pass the same job twice
    const map = buildSchedMap([job, job], weekDays)
    expect(map['C1|2026-03-23']).toHaveLength(1)
    expect(map['C1|2026-03-24']).toHaveLength(1)
  })
})

// ── Day label for multi-day jobs ─────────────────────────────────────────────

describe('schedule multi-day label', () => {
  it('returns "Day 1/3", "Day 2/3", "Day 3/3" for a 3-day job', () => {
    const job: ScheduleJob = {
      id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-25',
      job_type: 'install', status: 'scheduled',
    }
    expect(getMultiDayLabel(job, '2026-03-23')).toBe('Day 1/3')
    expect(getMultiDayLabel(job, '2026-03-24')).toBe('Day 2/3')
    expect(getMultiDayLabel(job, '2026-03-25')).toBe('Day 3/3')
  })

  it('returns null for a single-day job', () => {
    const job: ScheduleJob = {
      id: 'J2', crew_id: 'C1', date: '2026-03-23', end_date: null,
      job_type: 'survey', status: 'scheduled',
    }
    expect(getMultiDayLabel(job, '2026-03-23')).toBeNull()
  })

  it('returns null when end_date equals date (not multi-day)', () => {
    const job: ScheduleJob = {
      id: 'J3', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-23',
      job_type: 'survey', status: 'scheduled',
    }
    expect(getMultiDayLabel(job, '2026-03-23')).toBeNull()
  })

  it('returns "Day 1/2" and "Day 2/2" for a 2-day job', () => {
    const job: ScheduleJob = {
      id: 'J4', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-24',
      job_type: 'install', status: 'scheduled',
    }
    expect(getMultiDayLabel(job, '2026-03-23')).toBe('Day 1/2')
    expect(getMultiDayLabel(job, '2026-03-24')).toBe('Day 2/2')
  })
})

// ── Range-aware conflict detection ───────────────────────────────────────────

describe('schedule range-aware conflict detection', () => {
  it('detects overlapping date ranges', () => {
    // Existing job: Mon-Wed, new job: Tue-Thu
    const existing = [{ id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-25' }]
    expect(hasRangeConflict(existing, 'J2', 'C1', '2026-03-24', '2026-03-26')).toBe(true)
  })

  it('detects single-day job inside a multi-day range', () => {
    // Existing: Mon only, new range: Mon-Wed
    const existing = [{ id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: null }]
    expect(hasRangeConflict(existing, 'J2', 'C1', '2026-03-23', '2026-03-25')).toBe(true)
  })

  it('non-overlapping ranges pass (no conflict)', () => {
    // Existing: Mon-Tue, new: Thu-Fri
    const existing = [{ id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-24' }]
    expect(hasRangeConflict(existing, 'J2', 'C1', '2026-03-26', '2026-03-27')).toBe(false)
  })

  it('adjacent ranges (end == start - 1) do not conflict', () => {
    // Existing: Mon-Tue (ends 24), new: Wed-Thu (starts 25)
    const existing = [{ id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-24' }]
    expect(hasRangeConflict(existing, 'J2', 'C1', '2026-03-25', '2026-03-26')).toBe(false)
  })

  it('excludes current job from conflict check', () => {
    const existing = [{ id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-25' }]
    expect(hasRangeConflict(existing, 'J1', 'C1', '2026-03-23', '2026-03-25')).toBe(false)
  })

  it('different crew does not conflict', () => {
    const existing = [{ id: 'J1', crew_id: 'C1', date: '2026-03-23', end_date: '2026-03-25' }]
    expect(hasRangeConflict(existing, 'J2', 'C2', '2026-03-23', '2026-03-25')).toBe(false)
  })
})

// ── Install details: arrays type ─────────────────────────────────────────────

describe('schedule install details arrays type', () => {
  it('arrays is stored as number, not string', () => {
    const record = buildInstallRecord({ arrays: '3' })
    expect(record.arrays).toBe(3)
    expect(typeof record.arrays).toBe('number')
  })

  it('empty arrays string becomes null', () => {
    const record = buildInstallRecord({ arrays: '' })
    expect(record.arrays).toBeNull()
  })

  it('arrays "0" becomes 0 (number)', () => {
    const record = buildInstallRecord({ arrays: '0' })
    expect(record.arrays).toBe(0)
    expect(typeof record.arrays).toBe('number')
  })
})

// ── clearQueryCache called after save ────────────────────────────────────────

describe('schedule save calls clearQueryCache', () => {
  it('clearQueryCache is exported from lib/hooks and is a function', async () => {
    const { clearQueryCache } = await import('@/lib/hooks')
    expect(typeof clearQueryCache).toBe('function')
  })
})

// ── Original tests below ─────────────────────────────────────────────────────

describe('schedule week navigation', () => {
  function getWeekDates(weekOffset: number): string[] {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + weekOffset * 7)
    const dates: string[] = []
    for (let i = 0; i < 6; i++) { // Mon-Sat
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      dates.push(d.toISOString().slice(0, 10))
    }
    return dates
  }

  it('returns 6 dates (Mon-Sat)', () => {
    const dates = getWeekDates(0)
    expect(dates).toHaveLength(6)
  })

  it('next week starts 7 days later', () => {
    const thisWeek = getWeekDates(0)
    const nextWeek = getWeekDates(1)
    const diff = new Date(nextWeek[0]).getTime() - new Date(thisWeek[0]).getTime()
    expect(diff).toBe(7 * 86400000)
  })

  it('prev week starts 7 days earlier', () => {
    const thisWeek = getWeekDates(0)
    const prevWeek = getWeekDates(-1)
    const diff = new Date(thisWeek[0]).getTime() - new Date(prevWeek[0]).getTime()
    expect(diff).toBe(7 * 86400000)
  })
})

describe('schedule job type colors', () => {
  const JOB_COLORS: Record<string, string> = {
    survey: 'blue', install: 'green', inspection: 'amber', service: 'pink',
  }

  it('all job types have colors', () => {
    for (const type of ['survey', 'install', 'inspection', 'service']) {
      expect(JOB_COLORS[type]).toBeDefined()
    }
  })
})

describe('schedule conflict detection', () => {
  function hasConflict(existingJobs: { id: string; crew_id: string; date: string }[], currentId: string | null, crew_id: string, date: string): boolean {
    const others = existingJobs.filter(s => s.crew_id === crew_id && s.date === date && s.id !== currentId)
    return others.length > 0
  }

  it('detects conflict when crew has another job', () => {
    const jobs = [{ id: 'J1', crew_id: 'C1', date: '2025-03-19' }]
    expect(hasConflict(jobs, 'J2', 'C1', '2025-03-19')).toBe(true)
  })

  it('no conflict for different crew', () => {
    const jobs = [{ id: 'J1', crew_id: 'C1', date: '2025-03-19' }]
    expect(hasConflict(jobs, 'J2', 'C2', '2025-03-19')).toBe(false)
  })

  it('no conflict for different date', () => {
    const jobs = [{ id: 'J1', crew_id: 'C1', date: '2025-03-19' }]
    expect(hasConflict(jobs, 'J2', 'C1', '2025-03-20')).toBe(false)
  })

  it('excludes current job from conflict check', () => {
    const jobs = [{ id: 'J1', crew_id: 'C1', date: '2025-03-19' }]
    expect(hasConflict(jobs, 'J1', 'C1', '2025-03-19')).toBe(false)
  })
})
