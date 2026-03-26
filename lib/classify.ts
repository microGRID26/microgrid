import { daysAgo, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'
import type { Project } from '@/types/database'

// ── TYPES ─────────────────────────────────────────────────────────────────────
export type Section = 'overdue' | 'blocked' | 'pending' | 'crit' | 'risk' | 'stall' | 'aging' | 'ok' | 'loyalty' | 'inService'

export interface Classified {
  overdue: Project[]
  blocked: Project[]
  pending: Project[]
  crit: Project[]
  risk: Project[]
  stall: Project[]
  aging: Project[]
  ok: Project[]
  loyalty: Project[]
  inService: Project[]
}

export interface TaskEntry { status: string; reason?: string; completed_date?: string | null }

export interface StuckTask { name: string; status: 'Pending Resolution' | 'Revision Required'; reason: string }

// ── HELPERS ───────────────────────────────────────────────────────────────────
export function cycleDays(p: Project): number {
  return daysAgo(p.sale_date) || daysAgo(p.stage_date)
}

export function getSLA(p: Project) {
  const t = SLA_THRESHOLDS[p.stage] ?? { target: 3, risk: 5, crit: 7 }
  const days = daysAgo(p.stage_date)
  let status: 'ok' | 'warn' | 'risk' | 'crit' = 'ok'
  if (days >= t.crit) status = 'crit'
  else if (days >= t.risk) status = 'risk'
  else if (days >= t.target) status = 'warn'
  return { days, status, ...t }
}

function isBlocked(p: Project) { return !!p.blocker }
function isStalled(p: Project) { return !p.blocker && daysAgo(p.stage_date) >= 5 }

// ── CLASSIFY PROJECTS ─────────────────────────────────────────────────────────
export function classify(projects: Project[], overduePids: Set<string>, pendingPids: Set<string>): Classified {
  const pipeline = projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Loyalty' && p.disposition !== 'Cancelled')
  const active = pipeline.filter(p => p.stage !== 'complete')
  return {
    overdue:   pipeline.filter(p => overduePids.has(p.id)),
    blocked:   active.filter(p => isBlocked(p)),
    pending:   active.filter(p => !isBlocked(p) && !overduePids.has(p.id) && pendingPids.has(p.id) && getSLA(p).status !== 'crit' && getSLA(p).status !== 'risk'),
    crit:      active.filter(p => !isBlocked(p) && getSLA(p).status === 'crit'),
    risk:      active.filter(p => !isBlocked(p) && getSLA(p).status === 'risk'),
    stall:     active.filter(p => !isBlocked(p) && getSLA(p).status === 'ok' && isStalled(p)),
    aging:     pipeline.filter(p => p.stage !== 'complete' && cycleDays(p) >= 90),
    ok:        active.filter(p => !isBlocked(p) && getSLA(p).status === 'ok' && !isStalled(p)),
    loyalty:   projects.filter(p => p.disposition === 'Loyalty'),
    inService: projects.filter(p => p.disposition === 'In Service'),
  }
}

/** Format a raw task_id into a human-readable name (underscore → space, capitalize words) */
function formatTaskId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function getStuckTasks(p: Project, taskMap: Record<string, TaskEntry>): StuckTask[] {
  const tasks = STAGE_TASKS[p.stage] ?? []
  return tasks
    .filter(t => {
      const s = taskMap[t.id]?.status ?? 'Not Ready'
      return s === 'Pending Resolution' || s === 'Revision Required'
    })
    .map(t => {
      if (!t.name) {
        console.warn(`Task ID "${t.id}" has no name in STAGE_TASKS for stage "${p.stage}"`)
      }
      return {
        name: t.name || formatTaskId(t.id),
        status: (taskMap[t.id]?.status ?? '') as 'Pending Resolution' | 'Revision Required',
        reason: taskMap[t.id]?.reason ?? '',
      }
    })
}
