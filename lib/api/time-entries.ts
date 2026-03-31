// lib/api/time-entries.ts — Clock in/out for field crews
import { db } from '@/lib/db'

export interface TimeEntry {
  id: string
  user_id: string
  user_name: string | null
  project_id: string | null
  schedule_id: string | null
  work_order_id: string | null
  clock_in: string
  clock_out: string | null
  clock_in_lat: number | null
  clock_in_lng: number | null
  clock_out_lat: number | null
  clock_out_lng: number | null
  duration_minutes: number | null
  notes: string | null
  job_type: string | null
  created_at: string
}

/** Load time entries for a user, optionally filtered by date range */
export async function loadTimeEntries(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<TimeEntry[]> {
  let q = db()
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .order('clock_in', { ascending: false })
    .limit(200)

  if (dateFrom) q = q.gte('clock_in', dateFrom)
  if (dateTo) q = q.lte('clock_in', dateTo)

  const { data, error } = await q
  if (error) { console.error('[loadTimeEntries]', error.message); return [] }
  return (data ?? []) as TimeEntry[]
}

/** Get the user's currently open time entry (clocked in but not out) */
export async function getOpenEntry(userId: string): Promise<TimeEntry | null> {
  const { data, error } = await db()
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)

  if (error) { console.error('[getOpenEntry]', error.message); return null }
  const entries = (data ?? []) as TimeEntry[]
  return entries[0] ?? null
}

/** Clock in — create a new time entry */
export async function clockIn(entry: {
  user_id: string
  user_name?: string
  project_id?: string | null
  schedule_id?: string | null
  work_order_id?: string | null
  clock_in_lat?: number | null
  clock_in_lng?: number | null
  job_type?: string | null
  notes?: string | null
}): Promise<TimeEntry | null> {
  const { data, error } = await db()
    .from('time_entries')
    .insert({
      ...entry,
      clock_in: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) { console.error('[clockIn]', error.message); return null }
  return data as TimeEntry
}

/** Clock out — close an open time entry and compute duration */
export async function clockOut(
  entryId: string,
  options?: {
    clock_out_lat?: number | null
    clock_out_lng?: number | null
    notes?: string | null
  },
): Promise<boolean> {
  const now = new Date()

  // Get the entry to compute duration
  const { data: entry } = await db()
    .from('time_entries')
    .select('clock_in')
    .eq('id', entryId)
    .single()

  const clockInTime = entry ? new Date((entry as { clock_in: string }).clock_in) : null
  const durationMinutes = clockInTime
    ? Math.round((now.getTime() - clockInTime.getTime()) / 60000)
    : null

  const { error } = await db()
    .from('time_entries')
    .update({
      clock_out: now.toISOString(),
      duration_minutes: durationMinutes,
      ...(options?.clock_out_lat != null ? { clock_out_lat: options.clock_out_lat } : {}),
      ...(options?.clock_out_lng != null ? { clock_out_lng: options.clock_out_lng } : {}),
      ...(options?.notes != null ? { notes: options.notes } : {}),
    })
    .eq('id', entryId)

  if (error) { console.error('[clockOut]', error.message); return false }
  return true
}

/** Load today's entries for a user */
export async function loadTodayEntries(userId: string): Promise<TimeEntry[]> {
  const today = new Date().toISOString().split('T')[0]
  return loadTimeEntries(userId, today + 'T00:00:00', today + 'T23:59:59')
}

/** Sum duration for a user's entries in a date range */
export async function sumDuration(
  userId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  const entries = await loadTimeEntries(userId, dateFrom, dateTo)
  return entries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0)
}
