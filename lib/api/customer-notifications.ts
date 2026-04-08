/**
 * Server-side customer push notification triggers.
 *
 * Sends Expo push notifications to customers when project milestones are
 * reached or ticket statuses change.  Uses the service-role Supabase client
 * so it can run from API routes, cron jobs, or webhooks — not just the
 * browser.
 *
 * The Expo Push API requires no API key — just a valid push token.
 */

import { createClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface MilestoneNotification {
  stage: string
  title: string
  body: string
  data?: Record<string, string>
}

interface ExpoPushMessage {
  to: string
  sound: 'default'
  title: string
  body: string
  data?: Record<string, string>
}

interface ExpoPushTicket {
  id?: string
  status: 'ok' | 'error'
  message?: string
  details?: Record<string, unknown>
}

// ── Milestone message map ──────────────────────────────────────────────────

export const MILESTONE_MESSAGES: Record<string, { title: string; body: string }> = {
  survey: {
    title: '📋 Site Survey Scheduled',
    body: 'Great news! Your site survey has been scheduled. Check your app for details.',
  },
  design: {
    title: '🎨 Design In Progress',
    body: 'Your solar system design is being created. We\'ll notify you when it\'s ready for review.',
  },
  permit: {
    title: '📄 Permit Submitted',
    body: 'Your permit application has been submitted to the local authority. This typically takes 2-4 weeks.',
  },
  install: {
    title: '🔧 Installation Scheduled',
    body: 'Your installation has been scheduled! Check your app for the date and preparation checklist.',
  },
  inspection: {
    title: '✅ Installation Complete!',
    body: 'Your solar system has been installed. Next step: city and utility inspections.',
  },
  complete: {
    title: '☀️ System Active!',
    body: 'Congratulations! Your solar system is now active and generating clean energy.',
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service credentials not configured')
  return createClient(url, key)
}

async function getCustomerPushTokens(projectId: string): Promise<string[]> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('customer_accounts')
    .select('push_token')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .not('push_token', 'is', null)
    .limit(500)

  if (error) {
    console.error('[customer-notifications] token lookup failed:', error.message)
    return []
  }

  return (data ?? [])
    .map((row: { push_token: string | null }) => row.push_token)
    .filter((t): t is string => typeof t === 'string' && t.length > 10)
}

async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return []

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(messages),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[customer-notifications] Expo push failed:', res.status, text)
    return []
  }

  const result = await res.json()
  // Expo returns { data: [...tickets] } for batch sends
  return result.data ?? [result]
}

async function logNotification(
  projectId: string,
  type: string,
  title: string,
  body: string,
  sent: boolean,
  tokenCount: number,
) {
  try {
    const supabase = getServiceSupabase()
    await supabase.from('notification_log').insert({
      project_id: projectId,
      channel: 'push',
      type,
      title,
      body,
      sent,
      recipient_count: tokenCount,
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    // Non-critical — don't let logging failures break the notification flow
    console.error('[customer-notifications] log insert failed:', err)
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Send a milestone push notification to all active customers for a project.
 *
 * Looks up push tokens from customer_accounts, maps the stage to a
 * customer-friendly message, and fires via Expo Push API.
 *
 * Returns true if at least one notification was sent successfully.
 */
export async function sendCustomerMilestoneNotification(
  projectId: string,
  newStage: string,
): Promise<boolean> {
  const milestone = MILESTONE_MESSAGES[newStage]
  if (!milestone) {
    console.log(`[customer-notifications] no milestone message for stage "${newStage}"`)
    return false
  }

  const tokens = await getCustomerPushTokens(projectId)
  if (tokens.length === 0) {
    console.log(`[customer-notifications] no push tokens for project ${projectId}`)
    await logNotification(projectId, `milestone:${newStage}`, milestone.title, milestone.body, false, 0)
    return false
  }

  const messages: ExpoPushMessage[] = tokens.map(token => ({
    to: token,
    sound: 'default' as const,
    title: milestone.title,
    body: milestone.body,
    data: { type: 'milestone', stage: newStage, screen: 'home' },
  }))

  const tickets = await sendExpoPush(messages)
  const anyOk = tickets.some(t => t.status === 'ok')

  await logNotification(projectId, `milestone:${newStage}`, milestone.title, milestone.body, anyOk, tokens.length)

  if (!anyOk) {
    console.error('[customer-notifications] all push tickets errored:', tickets)
  }

  return anyOk
}

/**
 * Send a ticket-update push notification to the customer.
 *
 * Used when a CRM user replies to or updates a customer-facing ticket.
 *
 * Returns true if at least one notification was sent successfully.
 */
export async function sendCustomerTicketNotification(
  projectId: string,
  ticketId: string,
  message: string,
): Promise<boolean> {
  const tokens = await getCustomerPushTokens(projectId)
  if (tokens.length === 0) {
    await logNotification(projectId, `ticket:${ticketId}`, 'Ticket Updated', message, false, 0)
    return false
  }

  const messages: ExpoPushMessage[] = tokens.map(token => ({
    to: token,
    sound: 'default' as const,
    title: '🔔 Ticket Updated',
    body: message,
    data: { type: 'ticket', ticketId, screen: 'tickets' },
  }))

  const tickets = await sendExpoPush(messages)
  const anyOk = tickets.some(t => t.status === 'ok')

  await logNotification(projectId, `ticket:${ticketId}`, 'Ticket Updated', message, anyOk, tokens.length)

  return anyOk
}
