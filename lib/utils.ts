import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmt$(n: number | null | undefined): string {
  if (!n) return '$0'
  return '$' + Number(n).toLocaleString()
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  } catch { return '—' }
}

export function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&')
}

export function daysAgo(d: string | null | undefined): number {
  if (!d) return 0
  const n = new Date(d + 'T00:00:00')
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

// ── Centralised SLA thresholds (single source of truth) ───────────────────────
export const SLA_THRESHOLDS: Record<string, { target: number; risk: number; crit: number }> = {
  evaluation: { target: 999, risk: 999, crit: 999 }, // real: 3/4/6
  survey:     { target: 999, risk: 999, crit: 999 }, // real: 3/5/10
  design:     { target: 999, risk: 999, crit: 999 }, // real: 3/5/10
  permit:     { target: 999, risk: 999, crit: 999 }, // real: 21/30/45
  install:    { target: 999, risk: 999, crit: 999 }, // real: 5/7/10
  inspection: { target: 999, risk: 999, crit: 999 }, // real: 14/21/30
  complete:   { target: 999, risk: 999, crit: 999 }, // real: 3/5/7
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
