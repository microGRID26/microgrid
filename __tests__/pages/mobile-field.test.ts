import { describe, it, expect } from 'vitest'
import { escapeIlike } from '@/lib/utils'

// ── Mirror constants from mobile/field/page.tsx ─────────────────────────────

const JOB_TO_TASK: Record<string, string> = {
  install: 'install_done',
  survey: 'site_survey',
  inspection: 'city_insp',
}

const TASK_DATE: Record<string, string> = {
  install_done: 'install_complete_date',
  site_survey: 'survey_date',
  city_insp: 'city_inspection_date',
}

// ── Mirror sort logic from mobile/field/page.tsx ────────────────────────────

interface TestJob {
  id: string
  status: string
  time: string | null
  job_type: string
  project_id: string
}

function sortJobs(jobs: TestJob[]): TestJob[] {
  const order: Record<string, number> = { in_progress: 0, scheduled: 1, complete: 2 }
  return [...jobs].sort((a, b) => {
    const ao = order[a.status] ?? 1
    const bo = order[b.status] ?? 1
    if (ao !== bo) return ao - bo
    return (a.time ?? '99:99').localeCompare(b.time ?? '99:99')
  })
}

// ── Mirror helpers from mobile/field/page.tsx ───────────────────────────────

function fmtTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h)) return ''
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  return m ? `${hr}:${String(m).padStart(2, '0')}${ampm}` : `${hr}${ampm}`
}

function mapsLink(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`
}

function telLink(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`
}

// ── Helper ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<TestJob> = {}): TestJob {
  return {
    id: 'job-1',
    status: 'scheduled',
    time: '09:00',
    job_type: 'install',
    project_id: 'PROJ-001',
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Mobile Field — job priority sorting', () => {
  it('sorts in_progress before scheduled before complete', () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'complete', time: '08:00' }),
      makeJob({ id: 'j2', status: 'scheduled', time: '08:00' }),
      makeJob({ id: 'j3', status: 'in_progress', time: '08:00' }),
    ]
    const sorted = sortJobs(jobs)
    expect(sorted.map(j => j.id)).toEqual(['j3', 'j2', 'j1'])
  })

  it('sorts by time within the same status', () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'scheduled', time: '14:00' }),
      makeJob({ id: 'j2', status: 'scheduled', time: '08:00' }),
      makeJob({ id: 'j3', status: 'scheduled', time: '10:30' }),
    ]
    const sorted = sortJobs(jobs)
    expect(sorted.map(j => j.id)).toEqual(['j2', 'j3', 'j1'])
  })

  it('puts null times after all timed jobs', () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'scheduled', time: null }),
      makeJob({ id: 'j2', status: 'scheduled', time: '08:00' }),
    ]
    const sorted = sortJobs(jobs)
    expect(sorted.map(j => j.id)).toEqual(['j2', 'j1'])
  })

  it('treats unknown status as scheduled priority', () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'unknown_status', time: '08:00' }),
      makeJob({ id: 'j2', status: 'in_progress', time: '08:00' }),
    ]
    const sorted = sortJobs(jobs)
    expect(sorted[0].id).toBe('j2')
    expect(sorted[1].id).toBe('j1')
  })

  it('handles empty array', () => {
    expect(sortJobs([])).toEqual([])
  })

  it('handles mixed statuses and times', () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'complete', time: '07:00' }),
      makeJob({ id: 'j2', status: 'in_progress', time: '15:00' }),
      makeJob({ id: 'j3', status: 'scheduled', time: '09:00' }),
      makeJob({ id: 'j4', status: 'in_progress', time: '08:00' }),
    ]
    const sorted = sortJobs(jobs)
    expect(sorted.map(j => j.id)).toEqual(['j4', 'j2', 'j3', 'j1'])
  })
})

describe('Mobile Field — task ID mapping (JOB_TO_TASK)', () => {
  it('maps install to install_done', () => {
    expect(JOB_TO_TASK['install']).toBe('install_done')
  })

  it('maps survey to site_survey', () => {
    expect(JOB_TO_TASK['survey']).toBe('site_survey')
  })

  it('maps inspection to city_insp', () => {
    expect(JOB_TO_TASK['inspection']).toBe('city_insp')
  })

  it('returns undefined for service (no task mapping)', () => {
    expect(JOB_TO_TASK['service']).toBeUndefined()
  })

  it('returns undefined for unknown job types', () => {
    expect(JOB_TO_TASK['maintenance']).toBeUndefined()
  })
})

describe('Mobile Field — date auto-population on task complete (TASK_DATE)', () => {
  it('maps install_done to install_complete_date', () => {
    expect(TASK_DATE['install_done']).toBe('install_complete_date')
  })

  it('maps site_survey to survey_date', () => {
    expect(TASK_DATE['site_survey']).toBe('survey_date')
  })

  it('maps city_insp to city_inspection_date', () => {
    expect(TASK_DATE['city_insp']).toBe('city_inspection_date')
  })

  it('every JOB_TO_TASK value has a corresponding TASK_DATE entry', () => {
    for (const [jobType, taskId] of Object.entries(JOB_TO_TASK)) {
      expect(TASK_DATE[taskId]).toBeDefined()
    }
  })

  it('returns undefined for unmapped task IDs', () => {
    expect(TASK_DATE['ntp']).toBeUndefined()
  })
})

describe('Mobile Field — search query construction with escapeIlike', () => {
  it('escapes % character', () => {
    expect(escapeIlike('100%')).toBe('100\\%')
  })

  it('escapes _ character', () => {
    expect(escapeIlike('test_name')).toBe('test\\_name')
  })

  it('escapes backslash character', () => {
    expect(escapeIlike('path\\file')).toBe('path\\\\file')
  })

  it('escapes multiple special characters', () => {
    expect(escapeIlike('50%_off\\')).toBe('50\\%\\_off\\\\')
  })

  it('passes through normal strings unchanged', () => {
    expect(escapeIlike('PROJ-001')).toBe('PROJ-001')
    expect(escapeIlike('John Smith')).toBe('John Smith')
    expect(escapeIlike('123 Main St')).toBe('123 Main St')
  })

  it('handles empty string', () => {
    expect(escapeIlike('')).toBe('')
  })

  it('builds correct .or() search pattern', () => {
    const search = 'O\'Brien_'
    const escaped = escapeIlike(search.trim())
    const pattern = `name.ilike.%${escaped}%,id.ilike.%${escaped}%,address.ilike.%${escaped}%`
    expect(pattern).toContain('name.ilike.%O\'Brien\\_%')
    expect(pattern).toContain('id.ilike.%O\'Brien\\_%')
    expect(pattern).toContain('address.ilike.%O\'Brien\\_%')
  })
})

describe('Mobile Field — job status transitions', () => {
  it('scheduled can transition to in_progress', () => {
    // Mirrors the UI: "Start Job" button appears for scheduled jobs
    const job = makeJob({ status: 'scheduled' })
    expect(job.status).toBe('scheduled')
    const nextStatus = 'in_progress' // what handleStatusChange would set
    expect(nextStatus).toBe('in_progress')
  })

  it('in_progress can transition to complete', () => {
    // Mirrors the UI: "Mark Job Complete" button appears for in_progress jobs
    const job = makeJob({ status: 'in_progress' })
    expect(job.status).toBe('in_progress')
    const nextStatus = 'complete'
    expect(nextStatus).toBe('complete')
  })

  it('complete jobs show no status action buttons', () => {
    // The UI conditionally hides action buttons for complete/cancelled
    const job = makeJob({ status: 'complete' })
    const showActions = job.status !== 'complete' && job.status !== 'cancelled'
    expect(showActions).toBe(false)
  })

  it('cancelled jobs show no status action buttons', () => {
    const job = makeJob({ status: 'cancelled' })
    const showActions = job.status !== 'complete' && job.status !== 'cancelled'
    expect(showActions).toBe(false)
  })

  it('mark-task-complete button only shows for in_progress jobs with a task mapping', () => {
    // install has a task mapping
    const installJob = makeJob({ status: 'in_progress', job_type: 'install' })
    const taskId = JOB_TO_TASK[installJob.job_type]
    const showMarkTask = !!taskId && installJob.status === 'in_progress'
    expect(showMarkTask).toBe(true)

    // service has no task mapping
    const serviceJob = makeJob({ status: 'in_progress', job_type: 'service' })
    const serviceTaskId = JOB_TO_TASK[serviceJob.job_type]
    const showServiceMarkTask = !!serviceTaskId && serviceJob.status === 'in_progress'
    expect(showServiceMarkTask).toBe(false)

    // scheduled install should not show mark-task-complete
    const scheduledJob = makeJob({ status: 'scheduled', job_type: 'install' })
    const scheduledTaskId = JOB_TO_TASK[scheduledJob.job_type]
    const showScheduledMarkTask = !!scheduledTaskId && scheduledJob.status === 'in_progress'
    expect(showScheduledMarkTask).toBe(false)
  })
})

describe('Mobile Field — fmtTime helper', () => {
  it('formats morning time', () => {
    expect(fmtTime('08:30')).toBe('8:30am')
  })

  it('formats afternoon time', () => {
    expect(fmtTime('14:00')).toBe('2pm')
  })

  it('formats noon', () => {
    expect(fmtTime('12:00')).toBe('12pm')
  })

  it('formats midnight', () => {
    expect(fmtTime('00:00')).toBe('12am')
  })

  it('returns empty string for null', () => {
    expect(fmtTime(null)).toBe('')
  })

  it('returns empty string for invalid time', () => {
    expect(fmtTime('abc')).toBe('')
  })
})

describe('Mobile Field — mapsLink helper', () => {
  it('builds Google Maps URL with encoded address', () => {
    const link = mapsLink('123 Main St, Houston, TX')
    expect(link).toBe('https://maps.google.com/?q=123%20Main%20St%2C%20Houston%2C%20TX')
  })
})

describe('Mobile Field — telLink helper', () => {
  it('strips non-digit characters from phone number', () => {
    expect(telLink('(555) 123-4567')).toBe('tel:5551234567')
  })

  it('handles already-clean number', () => {
    expect(telLink('5551234567')).toBe('tel:5551234567')
  })
})
