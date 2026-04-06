import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** All internal company email domains — used for user filtering, @mentions, PM dropdowns */
export const INTERNAL_DOMAINS = ['gomicrogridenergy.com', 'energydevelopmentgroup.com', 'trismartsolar.com']

/** Check if an email belongs to an internal domain */
export function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return INTERNAL_DOMAINS.some(d => email.endsWith(`@${d}`))
}

export function fmt$(n: number | null | undefined): string {
  if (!n) return '$0'
  return '$' + Math.round(Number(n)).toLocaleString()
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  try {
    // Handle both bare dates (2026-03-28) and timestamps (2026-03-28T23:50:55+00:00)
    // Bare dates → UTC midnight to avoid timezone-dependent shifts
    const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00Z')
    if (isNaN(date.getTime())) return '—'
    return date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
    })
  } catch { return '—' }
}

export function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&')
}

/** Escape user input for use inside PostgREST `.or()` filter strings.
 *  Handles both SQL LIKE special chars AND PostgREST syntax chars (comma, parens). */
export function escapeFilterValue(s: string): string {
  return escapeIlike(s).replace(/[,()]/g, '')
}

export function daysAgo(d: string | null | undefined): number {
  if (!d) return 0
  // Bare dates → UTC noon to avoid ±1 day errors at midnight boundaries
  const n = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00Z')
  if (isNaN(n.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - n.getTime()) / 86400000))
}

export const STAGE_LABELS: Record<string, string> = {
  evaluation: 'Evaluation',
  survey: 'Site Survey',
  design: 'Design',
  permit: 'Permitting',
  install: 'Installation',
  inspection: 'Inspection',
  complete: 'Complete',
}

export const STAGE_ORDER = ['evaluation','survey','design','permit','install','inspection','complete']

/** Dispositions excluded from active project views (pipeline, queue, command, etc.).
 *  Use with .not('disposition', 'in', `(${INACTIVE_DISPOSITIONS.map(d => `"${d}"`).join(',')})`) */
export const INACTIVE_DISPOSITIONS = ['In Service', 'Loyalty', 'Cancelled'] as const

/** PostgREST-formatted exclusion string for .not('disposition', 'in', ...) */
export const INACTIVE_DISPOSITION_FILTER = `("In Service","Loyalty","Cancelled")`

// ── Centralised SLA thresholds (single source of truth) ───────────────────────
export const SLA_THRESHOLDS: Record<string, { target: number; risk: number; crit: number }> = {
  evaluation: { target: 3,  risk: 4,  crit: 6  },
  survey:     { target: 3,  risk: 5,  crit: 10 },
  design:     { target: 3,  risk: 5,  crit: 10 },
  permit:     { target: 21, risk: 30, crit: 45 },
  install:    { target: 5,  risk: 7,  crit: 10 },
  inspection: { target: 14, risk: 21, crit: 30 },
  complete:   { target: 3,  risk: 5,  crit: 7  },
}

// ── Simplified task list per stage (required tasks only, no prereq chains) ────
// ProjectPanel uses its own richer version with prereqs + optional tasks.
export const STAGE_TASKS: Record<string, { id: string; name: string }[]> = {
  evaluation: [
    { id: 'welcome',      name: 'Welcome Call'           },
    { id: 'ia',           name: 'IA Confirmation'         },
    { id: 'ub',           name: 'UB Confirmation'         },
    { id: 'sched_survey', name: 'Schedule Site Survey'    },
    { id: 'ntp',          name: 'NTP Procedure'           },
  ],
  survey: [
    { id: 'site_survey',  name: 'Site Survey'             },
    { id: 'survey_review',name: 'Survey Review'           },
  ],
  design: [
    { id: 'build_design', name: 'Build Design'            },
    { id: 'scope',        name: 'Scope of Work'           },
    { id: 'monitoring',   name: 'Monitoring'              },
    { id: 'build_eng',    name: 'Build Engineering'       },
    { id: 'eng_approval', name: 'Engineering Approval'    },
    { id: 'stamps',       name: 'Stamps Required'         },
  ],
  permit: [
    { id: 'hoa',          name: 'HOA Approval'            },
    { id: 'om_review',    name: 'OM Project Review'       },
    { id: 'city_permit',  name: 'City Permit Approval'    },
    { id: 'util_permit',  name: 'Utility Permit Approval' },
  ],
  install: [
    { id: 'sched_install',name: 'Schedule Installation'   },
    { id: 'inventory',    name: 'Inventory Allocation'    },
    { id: 'install_done', name: 'Installation Complete'   },
  ],
  inspection: [
    { id: 'insp_review',  name: 'Inspection Review'             },
    { id: 'sched_city',   name: 'Schedule City Inspection'      },
    { id: 'sched_util',   name: 'Schedule Utility Inspection'   },
    { id: 'city_insp',    name: 'City Inspection'               },
    { id: 'util_insp',    name: 'Utility Inspection'            },
  ],
  complete: [
    { id: 'pto',          name: 'Permission to Operate' },
    { id: 'in_service',   name: 'In Service'            },
  ],
}
