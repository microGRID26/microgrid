import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'
import { checkCronSecret } from '@/lib/auth/check-cron-secret'

// Reminder scan + per-recipient send. Audit 2026-05 H2.
export const maxDuration = 60

/**
 * GET /api/email/onboarding-reminder
 *
 * Sends reminder emails for onboarding documents that have been in 'sent' status
 * for more than 24 hours without being viewed. Called by cron job alongside send-daily.
 *
 * Auth: CRON_SECRET bearer token required.
 */
export async function GET(req: Request) {
  // Rate limit: 10 requests per minute per endpoint
  const { success } = await rateLimit('onboarding-reminder', { max: 10, prefix: 'onboarding-reminder' })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  if (!checkCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim()
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const fleetStartedAt = new Date()
  let fleetStatus: FleetRunStatus = 'success'
  let fleetItems: number | null = 0
  let fleetSummary: string | null = null
  let fleetError: string | null = null

  try {

  // Find docs in 'sent' status where sent_at is > 24 hours ago
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: staleDocs, error } = await supabase
    .from('onboarding_documents')
    .select('id, rep_id, requirement_id, sent_at, notes')
    .eq('status', 'sent')
    .lt('sent_at', cutoff)
    .limit(200)

  if (error) {
    console.error('[onboarding-reminder] query error:', error.message)
    fleetStatus = 'error'
    fleetError = `Query failed: ${error.message}`
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (!staleDocs || staleDocs.length === 0) {
    fleetSummary = 'No stale documents found'
    return NextResponse.json({ sent: 0, message: 'No stale documents found' })
  }

  // Get rep details for email sending
  const repIds = Array.from(new Set(staleDocs.map((d: { rep_id: string }) => d.rep_id)))
  const { data: reps } = await supabase
    .from('sales_reps')
    .select('id, first_name, last_name, email')
    .in('id', repIds)
    .limit(200)

  const repMap = new Map<string, { first_name: string; last_name: string; email: string }>()
  for (const r of (reps ?? []) as { id: string; first_name: string; last_name: string; email: string }[]) {
    repMap.set(r.id, r)
  }

  // Get requirement names
  const reqIds = Array.from(new Set(staleDocs.map((d: { requirement_id: string }) => d.requirement_id)))
  const { data: requirements } = await supabase
    .from('onboarding_requirements')
    .select('id, name')
    .in('id', reqIds)
    .limit(200)

  const reqMap = new Map<string, string>()
  for (const r of (requirements ?? []) as { id: string; name: string }[]) {
    reqMap.set(r.id, r.name)
  }

  // Send reminders
  let sent = 0
  const errors: string[] = []
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nova.gomicrogridenergy.com'

  for (const doc of staleDocs as { id: string; rep_id: string; requirement_id: string; sent_at: string }[]) {
    const rep = repMap.get(doc.rep_id)
    if (!rep || !rep.email) continue

    const docName = reqMap.get(doc.requirement_id) ?? 'Document'
    const sentDate = new Date(doc.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    const html = `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111827; color: #e5e7eb; padding: 32px; border-radius: 8px;">
        <h2 style="color: #34d399; margin: 0 0 16px;">Reminder: Document Awaiting Review</h2>
        <p style="margin: 0 0 12px;">Hi ${rep.first_name},</p>
        <p style="margin: 0 0 12px;">
          We sent you <strong style="color: white;">${docName}</strong> on ${sentDate} and haven't received a response yet.
          Please review and complete this document at your earliest convenience.
        </p>
        <p style="margin: 24px 0;">
          <a href="${appUrl}" style="background: #059669; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
            Open MicroGRID
          </a>
        </p>
        <p style="font-size: 12px; color: #6b7280; margin: 24px 0 0;">
          This is an automated reminder from MicroGRID. If you've already completed this document, please disregard.
        </p>
      </div>
    `

    const ok = await sendEmail(
      rep.email,
      `Reminder: ${docName} needs your attention`,
      html,
    )

    if (ok) {
      sent++
      // Add a note to the doc that a reminder was sent
      await supabase
        .from('onboarding_documents')
        .update({ notes: `Reminder sent ${new Date().toISOString().split('T')[0]}` })
        .eq('id', doc.id)
    } else {
      errors.push(`Failed to send to ${rep.email}`)
    }
  }

  console.log(`[onboarding-reminder] Sent ${sent} reminders, ${errors.length} errors`)
  fleetItems = sent
  fleetSummary = `Sent ${sent} reminders (${staleDocs.length} stale docs, ${errors.length} errors)`
  if (errors.length > 0) fleetStatus = 'partial'
  return NextResponse.json({ sent, errors: errors.length, staleCount: staleDocs.length })
  } catch (err) {
    fleetStatus = 'error'
    fleetError = err instanceof Error ? err.message : String(err)
    console.error('[onboarding-reminder] fatal:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  } finally {
    await reportFleetRun({
      slug: 'mg-email-onboarding-reminder',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: fleetItems,
      outputSummary: fleetSummary,
      errorMessage: fleetError,
    })
  }
}
