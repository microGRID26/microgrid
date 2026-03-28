import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  isGoogleCalendarConfigured,
  createCalendar,
  upsertCalendarEvent,
  deleteCalendarEvent as deleteGCalEvent,
  buildEventTitle,
  buildEventDescription,
} from '@/lib/google-calendar'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY

function getServiceClient() {
  if (!supabaseKey) throw new Error('SUPABASE_SECRET_KEY is required for calendar sync')
  return createClient(supabaseUrl, supabaseKey)
}

/** Max schedule entries per sync request to prevent abuse */
const MAX_BATCH_SIZE = 200

// ── GET: Health check ────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    configured: isGoogleCalendarConfigured(),
    timestamp: new Date().toISOString(),
  })
}

// ── POST: Sync schedule entries to Google Calendar ───────────────────────────

export async function POST(req: NextRequest) {
  if (!supabaseKey) {
    return NextResponse.json({ error: 'SUPABASE_SECRET_KEY not configured' }, { status: 500 })
  }

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json(
      { error: 'Google Calendar not configured' },
      { status: 503 }
    )
  }

  // Verify auth — require a valid Supabase session via cookie
  const authHeader = req.headers.get('authorization')
  const cookieHeader = req.headers.get('cookie')
  if (!authHeader && !cookieHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { crew_id, schedule_ids, action } = body as {
    crew_id?: string
    schedule_ids?: string[]
    action?: 'sync' | 'delete' | 'full_sync'
  }

  // Enforce batch size limit
  if (schedule_ids && schedule_ids.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` },
      { status: 400 }
    )
  }

  const db = getServiceClient()

  try {
    // Full sync for a crew
    if (action === 'full_sync' && crew_id) {
      return await handleFullSync(db, crew_id)
    }

    // Delete sync entries
    if (action === 'delete' && schedule_ids?.length) {
      return await handleDelete(db, schedule_ids)
    }

    // Single or batch sync
    if (schedule_ids?.length) {
      return await handleSync(db, schedule_ids)
    }

    return NextResponse.json({ error: 'Missing schedule_ids or action' }, { status: 400 })
  } catch (err) {
    console.error('Calendar sync error:', err)
    return NextResponse.json(
      { error: 'Internal sync error' },
      { status: 500 }
    )
  }
}

// ── Sync specific schedule entries ───────────────────────────────────────────

async function handleSync(db: ReturnType<typeof getServiceClient>, scheduleIds: string[]) {
  // Load schedule entries with project data
  const { data: schedules, error: schedErr } = await db
    .from('schedule')
    .select('*, project:projects(name, city, address)')
    .in('id', scheduleIds)

  if (schedErr || !schedules) {
    return NextResponse.json({ error: 'Failed to load schedule entries' }, { status: 500 })
  }

  // Load crews for names
  const crewIds = [...new Set(schedules.map((s: Record<string, unknown>) => s.crew_id).filter(Boolean))]
  const { data: crews } = await db.from('crews').select('id, name').in('id', crewIds)
  const crewMap = new Map((crews ?? []).map((c: Record<string, unknown>) => [c.id, c.name as string]))

  // Load calendar settings for involved crews
  const { data: settings } = await db.from('calendar_settings').select('*').in('crew_id', crewIds)
  const settingsMap = new Map(
    (settings ?? []).map((s: Record<string, unknown>) => [s.crew_id, s])
  )

  // Load existing sync entries
  const { data: existingSyncs } = await db.from('calendar_sync').select('*').in('schedule_id', scheduleIds)
  const syncMap = new Map(
    (existingSyncs ?? []).map((s: Record<string, unknown>) => [s.schedule_id, s])
  )

  const results: { schedule_id: string; status: string; event_id?: string; error?: string }[] = []

  for (const sched of schedules) {
    const s = sched as Record<string, unknown>
    const crewId = s.crew_id as string
    const crewName = crewMap.get(crewId) ?? 'Unknown Crew'
    let setting = settingsMap.get(crewId) as Record<string, unknown> | undefined

    // If no calendar settings, create a calendar for this crew
    if (!setting?.calendar_id) {
      const calId = await createCalendar(crewName)
      if (!calId) {
        results.push({ schedule_id: s.id as string, status: 'error', error: 'Failed to create calendar' })
        continue
      }
      // Save calendar settings
      await db.from('calendar_settings').upsert({
        crew_id: crewId,
        calendar_id: calId,
        enabled: true,
        auto_sync: true,
      }, { onConflict: 'crew_id' })
      setting = { calendar_id: calId, enabled: true } as Record<string, unknown>
      settingsMap.set(crewId, setting)
    }

    if (!(setting as Record<string, unknown>).enabled) {
      results.push({ schedule_id: s.id as string, status: 'skipped', error: 'Sync disabled for crew' })
      continue
    }

    const calendarId = (setting as Record<string, unknown>).calendar_id as string
    const project = s.project as { name: string; city: string | null; address: string | null } | null
    const projectName = project?.name ?? (s.project_id as string)
    const projectId = s.project_id as string

    const existingSync = syncMap.get(s.id as string) as Record<string, unknown> | undefined
    const existingEventId = existingSync?.event_id as string | null ?? null

    const eventId = await upsertCalendarEvent(calendarId, existingEventId, {
      title: buildEventTitle(s.job_type as string, projectName, projectId),
      location: project?.address ? `${project.address}${project.city ? ', ' + project.city : ''}` : null,
      date: s.date as string,
      endDate: s.end_date as string | null,
      time: s.time as string | null,
      description: buildEventDescription({
        jobType: s.job_type as string,
        crewName,
        notes: s.notes as string | null,
        projectId,
      }),
      jobType: s.job_type as string,
    })

    if (eventId) {
      await db.from('calendar_sync').upsert({
        schedule_id: s.id,
        calendar_id: calendarId,
        event_id: eventId,
        crew_id: crewId,
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        error_message: null,
      }, { onConflict: 'schedule_id,calendar_id' })

      results.push({ schedule_id: s.id as string, status: 'synced', event_id: eventId })
    } else {
      await db.from('calendar_sync').upsert({
        schedule_id: s.id,
        calendar_id: calendarId,
        event_id: existingEventId ?? 'none',
        crew_id: crewId,
        sync_status: 'error',
        last_synced_at: new Date().toISOString(),
        error_message: 'Failed to create/update event',
      }, { onConflict: 'schedule_id,calendar_id' })

      results.push({ schedule_id: s.id as string, status: 'error', error: 'Failed to create/update event' })
    }
  }

  const synced = results.filter(r => r.status === 'synced').length
  const failed = results.filter(r => r.status === 'error').length

  return NextResponse.json({ synced, failed, results })
}

// ── Full sync for a crew ─────────────────────────────────────────────────────

async function handleFullSync(db: ReturnType<typeof getServiceClient>, crewId: string) {
  // Get all non-cancelled schedule entries for this crew (future and recent past)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10)

  const { data: schedules } = await db
    .from('schedule')
    .select('id')
    .eq('crew_id', crewId)
    .gte('date', thirtyDaysAgoStr)
    .neq('status', 'cancelled')
    .limit(500)

  if (!schedules?.length) {
    // Update last_full_sync timestamp
    await db.from('calendar_settings').upsert({
      crew_id: crewId,
      last_full_sync: new Date().toISOString(),
    }, { onConflict: 'crew_id' })
    return NextResponse.json({ synced: 0, failed: 0, results: [] })
  }

  const ids = schedules.map((s: { id: string }) => s.id)

  // Delegate to the sync handler
  const syncResponse = await handleSync(db, ids)

  // Update last_full_sync timestamp
  await db.from('calendar_settings').upsert({
    crew_id: crewId,
    last_full_sync: new Date().toISOString(),
  }, { onConflict: 'crew_id' })

  return syncResponse
}

// ── Delete calendar events ───────────────────────────────────────────────────

async function handleDelete(db: ReturnType<typeof getServiceClient>, scheduleIds: string[]) {
  const { data: syncEntries } = await db
    .from('calendar_sync')
    .select('*')
    .in('schedule_id', scheduleIds)

  let deleted = 0
  let failed = 0

  for (const entry of (syncEntries ?? [])) {
    const e = entry as Record<string, unknown>
    const ok = await deleteGCalEvent(e.calendar_id as string, e.event_id as string)
    if (ok) {
      await db.from('calendar_sync').delete().eq('id', e.id)
      deleted++
    } else {
      failed++
    }
  }

  return NextResponse.json({ deleted, failed })
}
