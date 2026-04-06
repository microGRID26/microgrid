import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'
import { listCalendarEvents } from '@/lib/google-calendar'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY

function getServiceClient() {
  if (!supabaseKey) throw new Error('SUPABASE_SECRET_KEY is required for calendar webhook')
  return createClient(supabaseUrl, supabaseKey)
}

const WEBHOOK_TOKEN = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN ?? ''

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60 // Google can burst notifications
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

/** Timing-safe token comparison to prevent timing attacks */
function verifyToken(provided: string): boolean {
  if (!WEBHOOK_TOKEN || !provided) return false
  try {
    const a = Buffer.from(provided, 'utf8')
    const b = Buffer.from(WEBHOOK_TOKEN, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── GET: Health check ────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'calendar-webhook',
    timestamp: new Date().toISOString(),
  })
}

// ── POST: Receive Google Calendar push notifications ─────────────────────────
// Google sends a notification when events change on a watched calendar.
// Headers include: X-Goog-Channel-Token, X-Goog-Resource-State, X-Goog-Channel-ID

export async function POST(req: NextRequest) {
  // Rate limit: 60 per minute (Google can burst)
  if (!checkRateLimit('calendar-webhook')) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const channelToken = req.headers.get('x-goog-channel-token')
  const resourceState = req.headers.get('x-goog-resource-state')
  const channelId = req.headers.get('x-goog-channel-id')

  // Verify webhook token (timing-safe comparison)
  if (!channelToken || !verifyToken(channelToken)) {
    console.warn('Calendar webhook: invalid token')
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  }

  // Google sends a 'sync' event when the watch is first set up — acknowledge it
  if (resourceState === 'sync') {
    console.log('Calendar webhook: sync confirmation received for channel', channelId)
    return NextResponse.json({ status: 'sync acknowledged' })
  }

  // 'exists' means events were changed
  if (resourceState !== 'exists') {
    return NextResponse.json({ status: 'ignored', resourceState })
  }

  if (!supabaseKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const db = getServiceClient()

  try {
    // Find which crew's calendar this notification is for
    // Channel ID format: "nova-crew-{crew_id}"
    const crewId = channelId?.replace('nova-crew-', '') ?? null
    if (!crewId) {
      console.warn('Calendar webhook: cannot extract crew_id from channel', channelId)
      return NextResponse.json({ status: 'ignored' })
    }

    // Load calendar settings for this crew
    const { data: settingsArr } = await db
      .from('calendar_settings')
      .select('*')
      .eq('crew_id', crewId)
      .limit(1)

    const settings = settingsArr?.[0] as Record<string, unknown> | undefined
    if (!settings?.calendar_id) {
      return NextResponse.json({ status: 'no calendar configured for crew' })
    }

    const calendarId = settings.calendar_id as string

    // Fetch recent events from Google Calendar to detect changes
    const now = new Date()
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const monthAhead = new Date(now)
    monthAhead.setDate(monthAhead.getDate() + 60)

    const events = await listCalendarEvents(
      calendarId,
      weekAgo.toISOString().slice(0, 10),
      monthAhead.toISOString().slice(0, 10)
    )

    // Load all sync entries for this crew
    const { data: syncEntries } = await db
      .from('calendar_sync')
      .select('*')
      .eq('crew_id', crewId)

    const syncByEventId = new Map(
      (syncEntries ?? []).map((s: Record<string, unknown>) => [s.event_id, s])
    )

    let updated = 0

    // Collect tracked events that need schedule comparison
    const trackedEvents: { eventId: string; scheduleId: string; syncId: string; newDate: string; newTime: string | null; newEndDate: string | null }[] = []

    for (const event of events) {
      const e = event as unknown as Record<string, unknown>
      const eventId = e.id as string
      const syncEntry = syncByEventId.get(eventId) as Record<string, unknown> | undefined
      if (!syncEntry) continue

      const startObj = e.start as Record<string, string> | undefined
      const endObj = e.end as Record<string, string> | undefined
      if (!startObj) continue

      const newDate = startObj.date ?? startObj.dateTime?.slice(0, 10)
      const newTime = startObj.dateTime ? startObj.dateTime.slice(11, 16) : null

      let newEndDate: string | null = null
      if (endObj?.date) {
        const endDate = new Date(endObj.date + 'T00:00:00')
        endDate.setDate(endDate.getDate() - 1)
        const endStr = endDate.toISOString().slice(0, 10)
        if (endStr !== newDate) newEndDate = endStr
      }

      if (!newDate) continue

      trackedEvents.push({
        eventId,
        scheduleId: syncEntry.schedule_id as string,
        syncId: syncEntry.id as string,
        newDate,
        newTime,
        newEndDate,
      })
    }

    // Batch-load all schedule entries at once (avoids N+1)
    if (trackedEvents.length > 0) {
      const scheduleIds = trackedEvents.map(t => t.scheduleId)
      const { data: scheduleRows } = await db
        .from('schedule')
        .select('id, date, time, end_date')
        .in('id', scheduleIds)

      const scheduleMap = new Map(
        (scheduleRows ?? []).map((r: Record<string, unknown>) => [r.id as string, r])
      )

      for (const tracked of trackedEvents) {
        const curr = scheduleMap.get(tracked.scheduleId) as Record<string, unknown> | undefined
        if (!curr) continue

        const dateChanged = curr.date !== tracked.newDate
        const timeChanged = (curr.time ?? null) !== tracked.newTime
        const endDateChanged = (curr.end_date ?? null) !== tracked.newEndDate

        if (dateChanged || timeChanged || endDateChanged) {
          const updateFields: Record<string, unknown> = {}
          if (dateChanged) updateFields.date = tracked.newDate
          if (timeChanged) updateFields.time = tracked.newTime
          if (endDateChanged) updateFields.end_date = tracked.newEndDate

          const { error: updateErr } = await db
            .from('schedule')
            .update(updateFields)
            .eq('id', tracked.scheduleId)

          if (!updateErr) {
            await db
              .from('calendar_sync')
              .update({ last_synced_at: new Date().toISOString() })
              .eq('id', tracked.syncId)
            updated++
          }
        }
      }
    }

    return NextResponse.json({
      status: 'processed',
      crew_id: crewId,
      events_checked: events.length,
      updated,
    })
  } catch (err) {
    console.error('Calendar webhook processing error:', err)
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }
}
