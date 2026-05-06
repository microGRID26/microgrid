import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { getTemplate, getMaxDay } from '@/lib/email-templates'
import { rateLimit } from '@/lib/rate-limit'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'
import { checkCronSecret } from '@/lib/auth/check-cron-secret'

// Daily onboarding email scan + per-recipient send. Audit 2026-05 H2.
export const maxDuration = 60

// Supabase admin client for server-side cron (no user auth)
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

export async function GET(req: Request) {
  // Rate limit: 10 requests per minute per endpoint
  const { success } = await rateLimit('send-daily', { max: 10, prefix: 'send-daily' })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  if (!checkCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fleetStartedAt = new Date()
  let fleetStatus: FleetRunStatus = 'success'
  let fleetItems: number | null = 0
  let fleetSummary: string | null = null
  let fleetError: string | null = null

  try {
    const supabase = getAdminClient()
    const today = new Date().toISOString().slice(0, 10)

    // Load all active (non-paused, non-completed) enrollments
    const { data: enrollments, error } = await supabase
      .from('email_onboarding')
      .select('*')
      .eq('paused', false)
      .eq('completed', false)
      .limit(500)

    if (error) {
      console.error('[send-daily] query error:', error)
      fleetStatus = 'error'
      fleetError = `Enrollment query failed: ${error.message}`
      return NextResponse.json({ error: 'Failed to load enrollments' }, { status: 500 })
    }

    if (!enrollments || enrollments.length === 0) {
      fleetSummary = 'No active enrollments'
      return NextResponse.json({ sent: 0, message: 'No active enrollments' })
    }

    let sent = 0
    let skipped = 0
    let completed = 0
    let failed = 0
    const errors: string[] = []

    for (const enrollment of enrollments) {
      // Double-send prevention (#8): Compare last_sent_at date to today's date.
      // This ensures that even if the cron fires multiple times per day (manual trigger,
      // retry, duplicate Vercel cron invocation), each user only receives one email per day.
      // The date comparison uses UTC ISO date strings (YYYY-MM-DD) for consistency.
      if (enrollment.last_sent_at) {
        const lastDate = new Date(enrollment.last_sent_at).toISOString().slice(0, 10)
        if (lastDate === today) {
          skipped++
          continue
        }
      }

      const nextDay = (enrollment.current_day || 0) + 1

      // If past max day, mark completed
      if (nextDay > getMaxDay()) {
        await supabase
          .from('email_onboarding')
          .update({ completed: true })
          .eq('id', enrollment.id)
        completed++
        continue
      }

      const template = getTemplate(nextDay, enrollment.user_name || 'there')
      if (!template) {
        errors.push(`No template for day ${nextDay}`)
        continue
      }

      const ok = await sendEmail(enrollment.user_email, template.subject, template.html)

      if (ok) {
        await supabase
          .from('email_onboarding')
          .update({
            current_day: nextDay,
            last_sent_at: new Date().toISOString(),
            completed: nextDay >= getMaxDay(),
          })
          .eq('id', enrollment.id)
        sent++
        if (nextDay >= getMaxDay()) completed++
      } else {
        failed++
        console.error(`[send-daily] Failed to send day ${nextDay} email to ${enrollment.user_email}`)
        errors.push(`Failed to send to ${enrollment.user_email}`)
      }
    }

    fleetItems = sent
    fleetSummary = `Sent ${sent}/${enrollments.length} daily emails (${completed} completed, ${skipped} skipped, ${failed} failed)`
    if (failed > 0) fleetStatus = 'partial'

    return NextResponse.json({
      sent,
      skipped,
      completed,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      total: enrollments.length,
    })
  } catch (err) {
    console.error('[send-daily] error:', err)
    fleetStatus = 'error'
    fleetError = String(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } finally {
    await reportFleetRun({
      slug: 'mg-email-send-daily',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: fleetItems,
      outputSummary: fleetSummary,
      errorMessage: fleetError,
    })
  }
}
