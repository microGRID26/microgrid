import { db } from '@/lib/db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CalendarSettings {
  id: string
  crew_id: string
  calendar_id: string | null
  enabled: boolean
  auto_sync: boolean
  last_full_sync: string | null
  created_at: string
}

export interface CalendarSyncEntry {
  id: string
  schedule_id: string
  calendar_id: string
  event_id: string
  crew_id: string | null
  last_synced_at: string
  sync_status: 'synced' | 'pending' | 'error'
  error_message: string | null
  created_at: string
}

export interface CalendarEvent {
  title: string
  location: string | null
  date: string
  end_date: string | null
  time: string | null
  description: string
  job_type: string
  project_id: string
}

// ── Google Calendar color IDs ────────────────────────────────────────────────
// Google Calendar API color IDs: 1=lavender 2=sage 3=grape 4=flamingo
// 5=banana 6=tangerine 7=peacock 8=graphite 9=blueberry 10=basil 11=tomato
export const JOB_TYPE_COLOR_ID: Record<string, string> = {
  survey: '9',      // blueberry (blue)
  install: '10',    // basil (green)
  inspection: '5',  // banana (amber/yellow)
  service: '11',    // tomato (red)
}

// ── Calendar Settings ────────────────────────────────────────────────────────

export async function loadCalendarSettings(): Promise<CalendarSettings[]> {
  const { data, error } = await db()
    .from('calendar_settings')
    .select('*')
    .order('crew_id', { ascending: true })
  if (error) console.error('loadCalendarSettings failed:', error)
  return (data as CalendarSettings[]) ?? []
}

export async function updateCalendarSettings(
  crewId: string,
  settings: Partial<Pick<CalendarSettings, 'calendar_id' | 'enabled' | 'auto_sync' | 'last_full_sync'>>
): Promise<boolean> {
  // Upsert — create if not exists
  const { error } = await db()
    .from('calendar_settings')
    .upsert({
      crew_id: crewId,
      ...settings,
    }, { onConflict: 'crew_id' })
  if (error) {
    console.error('updateCalendarSettings failed:', error)
    return false
  }
  return true
}

// ── Sync Status ──────────────────────────────────────────────────────────────

export async function loadSyncStatus(scheduleIds: string[]): Promise<CalendarSyncEntry[]> {
  if (scheduleIds.length === 0) return []
  const { data, error } = await db()
    .from('calendar_sync')
    .select('*')
    .in('schedule_id', scheduleIds)
  if (error) console.error('loadSyncStatus failed:', error)
  return (data as CalendarSyncEntry[]) ?? []
}

export async function upsertSyncEntry(entry: {
  schedule_id: string
  calendar_id: string
  event_id: string
  crew_id: string | null
  sync_status: string
  error_message?: string | null
}): Promise<boolean> {
  const { error } = await db()
    .from('calendar_sync')
    .upsert({
      ...entry,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'schedule_id,calendar_id' })
  if (error) {
    console.error('upsertSyncEntry failed:', error)
    return false
  }
  return true
}

export async function deleteSyncEntry(scheduleId: string): Promise<boolean> {
  const { error } = await db()
    .from('calendar_sync')
    .delete()
    .eq('schedule_id', scheduleId)
  if (error) {
    console.error('deleteSyncEntry failed:', error)
    return false
  }
  return true
}

export async function loadRecentSyncEntries(limit = 20): Promise<CalendarSyncEntry[]> {
  const { data, error } = await db()
    .from('calendar_sync')
    .select('*')
    .order('last_synced_at', { ascending: false })
    .limit(limit)
  if (error) console.error('loadRecentSyncEntries failed:', error)
  return (data as CalendarSyncEntry[]) ?? []
}

// ── Check if Google Calendar is configured ───────────────────────────────────
// Note: This checks a server-only env var. In client components, use the
// /api/calendar/sync GET endpoint to check configuration status instead.

export function isCalendarConfigured(): boolean {
  if (typeof window !== 'undefined') {
    console.warn('isCalendarConfigured() called on client — always returns false. Use the /api/calendar/sync health check instead.')
    return false
  }
  return !!process.env.GOOGLE_CALENDAR_CREDENTIALS
}
