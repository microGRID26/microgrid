import { db } from '@/lib/db'

// ── Schedule data access ─────────────────────────────────────────────────────

/** Load schedule entries for a date range with project name join.
 *  Catches multi-day jobs: date <= endDate AND (end_date >= startDate OR (end_date IS NULL AND date >= startDate))
 */
export async function loadScheduleByDateRange(startDate: string, endDate: string) {
  const { data, error } = await db().from('schedule')
    .select('*')
    .lte('date', endDate)
    .or(`end_date.gte.${startDate},and(end_date.is.null,date.gte.${startDate})`)
    .limit(2000)
  if (error) console.error('schedule load failed:', error)

  // Manually join project names since FK doesn't exist
  const entries = (data ?? []) as any[]
  if (entries.length > 0) {
    const projectIds = [...new Set(entries.map(e => e.project_id).filter(Boolean))]
    if (projectIds.length > 0) {
      const { data: projects } = await db().from('projects').select('id, name, city, address, zip, phone, systemkw, module, inverter, battery').in('id', projectIds).limit(2000)
      const projectMap = new Map((projects ?? []).map((p: any) => [p.id, p]))
      for (const entry of entries) {
        entry.project = projectMap.get(entry.project_id) ?? null
      }
    }
  }

  return { data: entries, error }
}
