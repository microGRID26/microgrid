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
import { checkRole, getCallerOrgIds, MANAGER_PLUS, ADMIN_PLUS } from '@/lib/auth/role-gate'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim()

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

  // Verify auth — require a valid Supabase session AND a manager+ role on the
  // internal users table. Without the role check, any authenticated session
  // (including portal customers via customer_accounts) could trigger
  // service-role writes against arbitrary crew_id / schedule_ids — see
  // greg_action #353 (audit-rotation 2026-04-28 P0).
  const { createServerClient } = await import('@supabase/ssr')
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } }
  )
  const { data: { user: authUser } } = await supabaseAuth.auth.getUser()
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Role gate — manager+ only. Lookup is email-based via the shared helper
  // because public.users.id ≠ auth.users.id for legacy users (only 3 of 15
  // role-bearing rows match by id; 14 of 15 match by email). Trusts
  // authUser.email because Supabase Auth verifies it before issuing a session.
  const dbForRoleCheck = getServiceClient()
  const roleCheck = await checkRole({
    db: dbForRoleCheck,
    authUserEmail: authUser.email,
    allowedRoles: MANAGER_PLUS,
  })
  if (!roleCheck.ok) {
    return NextResponse.json({ error: 'Forbidden — manager+ required' }, { status: 403 })
  }

  // Crew-ownership gate (greg_action #362, R2 follow-up to #353).
  // The role gate above bounds the blast radius to ~15 internal staff, but
  // doesn't stop a manager in org A from wiping a crew in org B. Resolve the
  // caller's org_ids and reject any crew_id / schedule_id that points at a
  // crew outside those orgs. Admin and super_admin bypass — they're trusted
  // to act across orgs.
  const isAdmin = (ADMIN_PLUS as readonly string[]).includes(roleCheck.role ?? '')
  let callerOrgIds: string[] | null = null  // null = admin bypass
  if (!isAdmin) {
    const orgRes = await getCallerOrgIds(dbForRoleCheck, roleCheck.user_id)
    if (!orgRes.ok) {
      // DB error during membership lookup — fail closed but with 500 so we
      // don't silently mask infra issues as auth denials (R1 audit fix).
      return NextResponse.json({ error: 'Membership lookup failed' }, { status: 500 })
    }
    if (orgRes.orgIds.length === 0) {
      // Manager+ but no org_memberships row — likely the #363 backfill gap
      // (public.users.id ≠ auth.users.id for legacy users). Reject defensively
      // rather than allow unbounded access.
      return NextResponse.json({ error: 'Forbidden — no org membership' }, { status: 403 })
    }
    callerOrgIds = orgRes.orgIds
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
      // Verify the crew exists AND belongs to one of the caller's orgs
      // (admins skip this check via callerOrgIds === null).
      if (callerOrgIds !== null) {
        const { data: crewRow } = await db
          .from('crews')
          .select('id, org_id')
          .eq('id', crew_id)
          .maybeSingle()
        if (!crewRow) {
          return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
        }
        if (!callerOrgIds.includes(crewRow.org_id as string)) {
          return NextResponse.json({ error: 'Forbidden — crew not in your org' }, { status: 403 })
        }
      }
      return await handleFullSync(db, crew_id)
    }

    // Delete sync entries
    if (action === 'delete' && schedule_ids?.length) {
      const denied = await assertSchedulesInOrgs(db, schedule_ids, callerOrgIds)
      if (denied) return denied
      return await handleDelete(db, schedule_ids)
    }

    // Single or batch sync
    if (schedule_ids?.length) {
      const denied = await assertSchedulesInOrgs(db, schedule_ids, callerOrgIds)
      if (denied) return denied
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

// ── Crew-ownership helper (greg_action #362) ─────────────────────────────────

/**
 * Reject the request if any of the given schedule_ids points at a crew that
 * isn't in the caller's org list. callerOrgIds=null means admin/super_admin
 * (skip the check). Returns a NextResponse to short-circuit on denial, or
 * null to continue.
 *
 * R1 audit (HIGH) on first draft: PostgREST `crews!inner(org_id)` filters
 * out schedule rows whose `crew_id` is NULL or points at a deleted crew.
 * If we only loop the *returned* rows, an attacker could mix valid-owned
 * ids with orphan ids and the orphans would silently survive into
 * `handleSync`/`handleDelete` (which re-query without org filtering). Fix:
 * require the returned set to *exactly* match the requested set. Any
 * missing id → reject the whole batch.
 */
async function assertSchedulesInOrgs(
  db: ReturnType<typeof getServiceClient>,
  scheduleIds: string[],
  callerOrgIds: string[] | null,
): Promise<NextResponse | null> {
  if (callerOrgIds === null) return null
  const requested = new Set(scheduleIds)
  if (requested.size === 0) return null
  // Read with the inner join so cross-org rows are still surfaced (we need to
  // see them to deny on them, not just filter them out). Use a left-style
  // pattern: select id + crew_id, then resolve crews separately so orphan
  // schedules (NULL crew_id or deleted crew) appear as "missing org" and
  // trigger the deny path rather than vanish.
  const { data: rows, error } = await db
    .from('schedule')
    .select('id, crew_id')
    .in('id', Array.from(requested))
  if (error) {
    return NextResponse.json({ error: 'Failed to verify schedule ownership' }, { status: 500 })
  }
  const found = new Set((rows ?? []).map((r: { id: string }) => r.id))
  // Any requested id not found at all → reject. Prevents service-role probing
  // and closes the orphan-leak gap from the R1 audit.
  for (const id of requested) {
    if (!found.has(id)) {
      return NextResponse.json(
        { error: 'One or more schedule_ids do not exist' },
        { status: 404 },
      )
    }
  }
  // Resolve crews → org for the distinct crew_ids on the matched rows.
  const crewIds = Array.from(new Set(
    (rows ?? [])
      .map((r: { crew_id: string | null }) => r.crew_id)
      .filter((c): c is string => !!c),
  ))
  // If any matched schedule had a NULL crew_id, deny — we can't prove it's
  // in the caller's org.
  const hasNullCrew = (rows ?? []).some((r: { crew_id: string | null }) => !r.crew_id)
  if (hasNullCrew) {
    return NextResponse.json(
      { error: 'Forbidden — schedule has no crew assignment' },
      { status: 403 },
    )
  }
  if (crewIds.length === 0) return null
  const { data: crewRows, error: crewErr } = await db
    .from('crews')
    .select('id, org_id')
    .in('id', crewIds)
  if (crewErr) {
    return NextResponse.json({ error: 'Failed to verify crew ownership' }, { status: 500 })
  }
  const crewOrg = new Map(
    (crewRows ?? []).map((c: { id: string; org_id: string | null }) => [c.id, c.org_id]),
  )
  // Every distinct crew_id must resolve to an org in the caller's allow-list.
  // A crew that was deleted between the schedule load and now → not in
  // crewOrg map → deny.
  const allowed = new Set(callerOrgIds)
  for (const cid of crewIds) {
    const org = crewOrg.get(cid)
    if (!org || !allowed.has(org)) {
      return NextResponse.json(
        { error: 'Forbidden — one or more schedules belong to crews outside your org' },
        { status: 403 },
      )
    }
  }
  return null
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

    const { eventId, meetLink } = await upsertCalendarEvent(calendarId, existingEventId, {
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
        meet_link: meetLink ?? null,
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
