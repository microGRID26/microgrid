import { JOB_COLORS, JOB_COMPLETE_TASK, JOB_COMPLETE_DATE, JOB_LABELS_SHORT } from '@/lib/tasks'
import type { WorkOrder, WOChecklistItem } from '@/lib/api/work-orders'
import type { TimeEntry } from '@/lib/api/time-entries'

// Re-export for convenience
export { JOB_COLORS, JOB_COMPLETE_TASK, JOB_COMPLETE_DATE }
export type { WorkOrder, WOChecklistItem, TimeEntry }

// Short labels for mobile (re-exported from central source)
export const JOB_LABELS = JOB_LABELS_SHORT

export const JOB_BADGE: Record<string, string> = Object.fromEntries(
  Object.entries(JOB_COLORS).map(([k, v]) => [k, `${v.bg} ${v.text} ${v.border ?? ''}`])
)

export const STATUS_DOT: Record<string, string> = {
  complete: 'bg-green-400', scheduled: 'bg-blue-400', in_progress: 'bg-amber-400', cancelled: 'bg-gray-500',
}

export const STATUS_LABEL: Record<string, string> = {
  complete: 'Complete', scheduled: 'Scheduled', in_progress: 'In Progress', cancelled: 'Cancelled',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function fmtTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h)) return ''
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  return m ? `${hr}:${String(m).padStart(2, '0')}${ampm}` : `${hr}${ampm}`
}

export function mapsLink(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`
}

export function telLink(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface FieldJob {
  id: string
  project_id: string
  crew_id: string
  job_type: string
  date: string
  time: string | null
  notes: string | null
  status: string
  // Merged project fields
  project_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  customer_city: string | null
  customer_zip: string | null
  systemkw: number | null
  module: string | null
  module_qty: number | null
  stage: string | null
  stage_date: string | null
  blocker: string | null
  survey_date: string | null
  install_complete_date: string | null
  pto_date: string | null
  crew_name: string | null
}

export interface SearchResult {
  id: string
  name: string
  city: string | null
  address: string | null
  phone: string | null
  email: string | null
  stage: string | null
  systemkw: number | null
}
