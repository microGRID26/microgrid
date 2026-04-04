import { db } from '@/lib/db'

// ── Schedule data access ─────────────────────────────────────────────────────

/** Load schedule entries for a date range with project name join.
 *  Catches multi-day jobs: date <= endDate AND (end_date >= startDate OR (end_date IS NULL AND date >= startDate))
 */
export async function loadScheduleByDateRange(startDate: string, endDate: string, orgId?: string) {
  let query = db().from('schedule')
    .select('id, project_id, crew_id, job_type, date, end_date, time, status, notes, pm, org_id')
    .lte('date', endDate)
    .or(`end_date.gte.${startDate},and(end_date.is.null,date.gte.${startDate})`)
    .limit(2000)
  if (orgId) query = query.eq('org_id', orgId)
  const { data, error } = await query
  if (error) console.error('schedule load failed:', error)

  // Manually join project names since FK doesn't exist
  type ScheduleEntry = Record<string, unknown> & { project_id: string; project?: Record<string, unknown> | null | undefined }
  const entries = (data ?? []) as ScheduleEntry[]
  if (entries.length > 0) {
    const projectIds = [...new Set(entries.map(e => e.project_id).filter(Boolean))]
    if (projectIds.length > 0) {
      const { data: projects } = await db().from('projects').select('id, name, city, address, zip, phone, systemkw, module, inverter, battery, ahj').in('id', projectIds).limit(2000)
      const projectMap = new Map((projects ?? []).map((p: { id: string; [k: string]: unknown }) => [p.id, p]))
      for (const entry of entries) {
        entry.project = (projectMap.get(entry.project_id) as Record<string, unknown>) ?? null
      }
    }
  }

  return { data: entries, error }
}
