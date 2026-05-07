// Mobile API layer — talks directly to Supabase (except account deletion which uses Vercel API)

import { supabase } from './supabase'
import Constants from 'expo-constants'
import type { CustomerAccount, CustomerProject, StageHistoryEntry, CustomerScheduleEntry, CustomerTicket, TicketComment, CustomerDocument, CustomerTaskState, EnergyStats, CustomerReferral, CustomerWarranty, BillingStatement, PaymentMethod, PaymentRecord, CustomerMessage, ActivityItem } from './types'
import { STAGE_LABELS, STAGE_DESCRIPTIONS, JOB_TYPE_LABELS } from './constants'

const API_BASE = Constants.expoConfig?.extra?.apiBaseUrl ?? 'https://app.gomicrogridenergy.com'

// Customer-safe fields only
const PROJECT_FIELDS = 'id, name, address, city, zip, stage, stage_date, sale_date, survey_scheduled_date, survey_date, city_permit_date, utility_permit_date, install_scheduled_date, install_complete_date, city_inspection_date, utility_inspection_date, pto_date, in_service_date, module, module_qty, inverter, inverter_qty, battery, battery_qty, systemkw, financier, disposition'

// ── Account ─────────────────────────────────────────────────────────────────

export async function getCustomerAccount(): Promise<CustomerAccount | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('customer_accounts')
    .select('*')
    .eq('auth_user_id', user.id)
    .eq('status', 'active')
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as CustomerAccount
}

// ── Project ─────────────────────────────────────────────────────────────────

export async function loadProject(projectId: string): Promise<CustomerProject | null> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_FIELDS)
    .eq('id', projectId)
    .single()

  if (error) { console.error('[loadProject]', error.message); return null }
  return data as CustomerProject
}

export async function loadTimeline(projectId: string): Promise<StageHistoryEntry[]> {
  const { data, error } = await supabase
    .from('stage_history')
    .select('id, project_id, stage, entered')
    .eq('project_id', projectId)
    .order('entered', { ascending: true })
    .limit(100)

  if (error) console.error('[loadTimeline]', error.message)
  return (data ?? []) as StageHistoryEntry[]
}

export async function loadSchedule(projectId: string): Promise<CustomerScheduleEntry[]> {
  const { data, error } = await supabase
    .from('schedule')
    .select('id, project_id, job_type, date, end_date, time, status, arrival_window')
    .eq('project_id', projectId)
    .order('date', { ascending: true })
    .limit(50)

  if (error) console.error('[loadSchedule]', error.message)
  return (data ?? []) as CustomerScheduleEntry[]
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export async function loadTickets(projectId: string): Promise<CustomerTicket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ticket_number, title, description, category, priority, status, created_at, resolved_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) console.error('[loadTickets]', error.message)
  return (data ?? []) as CustomerTicket[]
}

export async function createTicket(
  projectId: string,
  title: string,
  description: string,
  category: string,
  customerName: string,
): Promise<CustomerTicket | null> {
  const prefix = `TKT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const { data: existing } = await supabase
    .from('tickets')
    .select('ticket_number')
    .like('ticket_number', `${prefix}%`)
    .order('ticket_number', { ascending: false })
    .limit(1)

  const seq = existing?.[0] ? parseInt((existing[0] as { ticket_number: string }).ticket_number.slice(-3)) + 1 : 1
  const ticketNumber = `${prefix}-${String(seq).padStart(3, '0')}`

  // Get org_id from project so CRM can see the ticket
  const { data: proj } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .single()

  const { data, error } = await supabase
    .from('tickets')
    .insert({
      ticket_number: ticketNumber,
      project_id: projectId,
      title,
      description,
      category,
      priority: 'normal',
      source: 'customer_portal',
      status: 'open',
      reported_by: customerName,
      org_id: proj?.org_id ?? null,
    })
    .select('id, ticket_number, title, description, category, priority, status, created_at, resolved_at')
    .single()

  if (error) return null
  return data as CustomerTicket
}

export async function loadComments(ticketId: string): Promise<TicketComment[]> {
  const { data } = await supabase
    .from('ticket_comments')
    .select('id, ticket_id, author, message, image_url, image_path, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .limit(200)

  return (data ?? []) as TicketComment[]
}

export async function addComment(ticketId: string, message: string, author: string, imageUrl?: string | null, imagePath?: string | null): Promise<boolean> {
  const { error } = await supabase
    .from('ticket_comments')
    .insert({ ticket_id: ticketId, author, message, is_internal: false, image_url: imageUrl ?? null, image_path: imagePath ?? null })

  return !error
}

// ── Photo Upload ────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain',
}

export async function uploadTicketPhoto(uri: string, ticketId: string, overrideMime?: string, overrideExt?: string): Promise<{ url: string | null; path: string } | null> {
  try {
    const ext = overrideExt ?? uri.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mimeType = overrideMime ?? MIME_MAP[ext] ?? 'application/octet-stream'
    const fileName = `${ticketId}/${Date.now()}.${ext}`

    // Read file as base64 via fetch + arraybuffer (works on iOS/Android)
    const response = await fetch(uri)
    const arrayBuffer = await response.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    // upsert:false — path prefix is `{ticket_id}/{timestamp}.{ext}` which is
    // already unique; upserting only masks bugs (e.g., Date.now() collisions
    // under rapid retries) and weakens the new path-prefix RLS posture.
    const { error } = await supabase.storage
      .from('ticket-attachments')
      .upload(fileName, uint8, { contentType: mimeType, upsert: false })

    if (error) { console.error('[upload]', error); return null }

    // Bucket flipped private (migration 154). image_url is dead — the reader
    // path uses image_path via resolveMgSignedUrl() server-side. Return null
    // for url so callers stop populating ticket_comments.image_url.
    return { url: null, path: fileName }
  } catch (err) {
    console.error('[upload] failed:', err)
    return null
  }
}

// ── Documents ──────────────────────────────────────────────────────────────

export async function loadDocuments(projectId: string): Promise<CustomerDocument[]> {
  // Try project_files first (primary table)
  const { data: files, error: filesErr } = await supabase
    .from('project_files')
    .select('id, project_id, file_name, file_type, file_url, category, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (filesErr) console.error('[loadDocuments:project_files]', filesErr.message)

  // Also try project_documents table if it exists
  const { data: docs, error: docsErr } = await supabase
    .from('project_documents')
    .select('id, project_id, file_name, file_type, file_url, category, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (docsErr && !docsErr.message.includes('does not exist')) {
    console.error('[loadDocuments:project_documents]', docsErr.message)
  }

  // Merge and deduplicate by id
  const all = [...(files ?? []), ...(docs ?? [])]
  const seen = new Set<string>()
  const unique: CustomerDocument[] = []
  for (const doc of all) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id)
      unique.push(doc as CustomerDocument)
    }
  }
  return unique
}

// ── Task States ────────────────────────────────────────────────────────────

export async function loadTaskStates(projectId: string): Promise<CustomerTaskState[]> {
  const { data, error } = await supabase
    .from('task_state')
    .select('task_id, status, completed_date, started_date')
    .eq('project_id', projectId)
    .limit(200)

  if (error) console.error('[loadTaskStates]', error.message)
  return (data ?? []) as CustomerTaskState[]
}

// ── Energy Stats (calculated from system size — no external API needed) ────

export async function loadEnergyStats(projectId: string, systemkw: number): Promise<EnergyStats> {
  const estimated_monthly_kwh = systemkw * 4.5 * 30
  const estimated_annual_kwh = estimated_monthly_kwh * 12
  const co2_offset_tons = estimated_annual_kwh * 0.0007
  const trees_equivalent = Math.round(co2_offset_tons / 0.06)
  const cost_savings_monthly = estimated_monthly_kwh * 0.12

  return {
    estimated_monthly_kwh,
    estimated_annual_kwh,
    co2_offset_tons,
    trees_equivalent,
    cost_savings_monthly,
  }
}

// ── Notification Preferences ───────────────────────────────────────────────

export async function updateNotificationPrefs(
  accountId: string,
  prefs: CustomerAccount['notification_prefs'],
): Promise<boolean> {
  // Defense-in-depth: verify current user owns this account (RLS also enforces)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('customer_accounts')
    .update({ notification_prefs: prefs })
    .eq('id', accountId)
    .eq('auth_user_id', user.id)

  if (error) {
    console.error('[updateNotificationPrefs]', error.message)
    return false
  }
  return true
}


// ── Account Deletion ──────────────────────────────────────────────────────
// Apple App Store guideline 5.1.1(v): users must be able to delete their account in-app.
// Calls the web API which deletes customer_accounts (cascade) + auth.users.

export async function deleteCustomerAccount(): Promise<{ ok: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, error: 'Not signed in' }

  try {
    const res = await fetch(`${API_BASE}/api/customer/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data.error ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[deleteCustomerAccount]', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ── Warranties ────────────────────────────────────────────────────────────

export async function loadWarranties(projectId: string): Promise<CustomerWarranty[]> {
  const { data, error } = await supabase
    .from('equipment_warranties')
    .select('id, project_id, equipment_type, manufacturer, model, serial_number, quantity, install_date, warranty_start_date, warranty_end_date, warranty_years, notes, created_at, updated_at')
    .eq('project_id', projectId)
    .order('equipment_type')
    .limit(50)

  if (error) console.error('[loadWarranties]', error.message)
  return (data ?? []) as CustomerWarranty[]
}

export async function fileWarrantyClaim(
  projectId: string,
  equipmentType: string,
  description: string,
  accountName: string,
): Promise<boolean> {
  // Creates a ticket with category='warranty' and equipment info in description
  const title = `Warranty Claim: ${equipmentType.charAt(0).toUpperCase() + equipmentType.slice(1)}`
  const fullDescription = `Equipment: ${equipmentType}\n\n${description}`
  const ticket = await createTicket(projectId, title, fullDescription, 'warranty', accountName)
  return ticket !== null
}

// ── Billing ─────────────────────────────────────────────────────────────────

export async function loadBillingStatements(accountId: string): Promise<BillingStatement[]> {
  const { data, error } = await supabase
    .from('customer_billing_statements')
    .select('*')
    .eq('customer_account_id', accountId)
    .order('period_start', { ascending: false })
    .limit(24)

  if (error) console.error('[loadBillingStatements]', error.message)
  return (data ?? []) as BillingStatement[]
}

export async function loadPaymentMethods(accountId: string): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from('customer_payment_methods')
    .select('*')
    .eq('customer_account_id', accountId)
    .order('is_default', { ascending: false })
    .limit(50)

  if (error) console.error('[loadPaymentMethods]', error.message)
  return (data ?? []) as PaymentMethod[]
}

export async function loadPaymentHistory(accountId: string): Promise<PaymentRecord[]> {
  const { data, error } = await supabase
    .from('customer_payments')
    .select('*')
    .eq('customer_account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) console.error('[loadPaymentHistory]', error.message)
  return (data ?? []) as PaymentRecord[]
}

// ── Direct Messages ─────────────────────────────────────────────────────────

export async function loadMessages(projectId: string): Promise<CustomerMessage[]> {
  const { data, error } = await supabase
    .from('customer_messages')
    .select('id, project_id, author_type, author_name, message, read_at, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) console.error('[loadMessages]', error.message)
  return (data ?? []) as CustomerMessage[]
}

export async function sendMessage(projectId: string, message: string, authorName: string): Promise<boolean> {
  // Defense-in-depth: verify current user is authenticated (RLS also enforces)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  // Get org_id from project so CRM can see the message
  const { data: proj } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .single()

  const { error } = await supabase
    .from('customer_messages')
    .insert({
      project_id: projectId,
      author_type: 'customer',
      author_name: authorName,
      message,
      org_id: proj?.org_id ?? null,
    })

  if (error) {
    console.error('[sendMessage]', error.message)
    return false
  }
  return true
}

export async function loadUnreadMessageCount(projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from('customer_messages')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('author_type', ['pm', 'system'])
    .is('read_at', null)

  if (error) console.error('[loadUnreadMessageCount]', error.message)
  return count ?? 0
}

export async function markMessagesRead(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('customer_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .in('author_type', ['pm', 'system'])
    .is('read_at', null)

  if (error) console.error('[markMessagesRead]', error.message)
}

// ── Project Activity Feed ──────────────────────────────────────────────────
// Unifies stage transitions + schedule events + ticket lifecycle into one
// chronological feed. Each source is queried in parallel, normalized to
// ActivityItem, merged, and sorted descending by timestamp.
//
// Excluded sources:
//   - project_files: customer RLS gap (action #607). Re-add once policy ships.
//   - customer_messages: would duplicate the Messages tab; signal via tab badge.
//
// schedule rows have a `date` (text YYYY-MM-DD) but no row-creation timestamp,
// so we use `date` as the activity timestamp. That matches the customer's
// mental model — "this is when the visit is" rather than "this is when the
// PM typed it in."

const ACTIVITY_LIMIT_PER_SOURCE = 50
const ACTIVITY_LIMIT_TOTAL = 100

export async function loadProjectActivity(projectId: string): Promise<ActivityItem[]> {
  const [stagesRes, scheduleRes, ticketsRes] = await Promise.all([
    supabase
      .from('stage_history')
      .select('id, stage, entered')
      .eq('project_id', projectId)
      .order('entered', { ascending: false })
      .limit(ACTIVITY_LIMIT_PER_SOURCE),
    supabase
      .from('schedule')
      .select('id, job_type, date, status, arrival_window')
      .eq('project_id', projectId)
      .order('date', { ascending: false })
      .limit(ACTIVITY_LIMIT_PER_SOURCE),
    supabase
      .from('tickets')
      .select('id, ticket_number, title, category, status, created_at, resolved_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(ACTIVITY_LIMIT_PER_SOURCE),
  ])

  if (stagesRes.error) console.error('[loadProjectActivity:stage_history]', stagesRes.error.message)
  if (scheduleRes.error) console.error('[loadProjectActivity:schedule]', scheduleRes.error.message)
  if (ticketsRes.error) console.error('[loadProjectActivity:tickets]', ticketsRes.error.message)

  // If every source errored, surface a real failure to the caller instead of
  // pretending the project has no activity.
  if (stagesRes.error && scheduleRes.error && ticketsRes.error) {
    throw new Error('activity: all sources failed')
  }

  const items: ActivityItem[] = []

  for (const r of stagesRes.data ?? []) {
    if (!r.entered) continue
    const label = STAGE_LABELS[r.stage] ?? r.stage
    items.push({
      id: `stage:${r.id}`,
      kind: 'stage',
      ts: r.entered,
      title: `Entered ${label}`,
      description: STAGE_DESCRIPTIONS[r.stage] ?? null,
      metadata: { stage: r.stage },
    })
  }

  for (const r of scheduleRes.data ?? []) {
    if (!r.date) continue
    const label = JOB_TYPE_LABELS[r.job_type] ?? r.job_type
    items.push({
      id: `schedule:${r.id}`,
      kind: 'schedule',
      // schedule.date is text YYYY-MM-DD with no time component. Anchor to
      // LOCAL noon (no `Z`) so groupByDate's local-day grouping doesn't drift
      // across the UTC dateline for users in PT/AKDT/HST.
      ts: `${r.date}T12:00:00`,
      title: r.status === 'cancelled' ? `${label} cancelled` : `${label} scheduled`,
      description: r.arrival_window ?? null,
      metadata: {
        job_type: r.job_type,
        status: r.status ?? null,
        arrival_window: r.arrival_window ?? null,
      },
    })
  }

  for (const r of ticketsRes.data ?? []) {
    if (r.created_at) {
      items.push({
        id: `ticket_opened:${r.id}`,
        kind: 'ticket_opened',
        ts: r.created_at,
        title: `Ticket opened: ${r.title ?? r.ticket_number}`,
        description: r.ticket_number ?? null,
        metadata: {
          ticket_number: r.ticket_number,
          ticket_id: r.id,
          category: r.category,
          status: r.status,
        },
      })
    }
    if (r.resolved_at) {
      items.push({
        id: `ticket_resolved:${r.id}`,
        kind: 'ticket_resolved',
        ts: r.resolved_at,
        title: `Ticket resolved: ${r.title ?? r.ticket_number}`,
        description: r.ticket_number ?? null,
        metadata: {
          ticket_number: r.ticket_number,
          ticket_id: r.id,
          category: r.category,
          status: r.status,
        },
      })
    }
  }

  // Numeric sort over parsed Date — string-comparing ISO timestamps is unsafe
  // because Postgres timestamptz serializes with a `+00:00` offset while the
  // synthesized schedule timestamps have no offset ('+' < 'T' lexically).
  // Drop unparseable timestamps so a bad row (e.g. schedule.date = 'TBD')
  // doesn't poison sort ordering.
  return items
    .filter((i) => !Number.isNaN(Date.parse(i.ts)))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, ACTIVITY_LIMIT_TOTAL)
}

// ── Referrals ────────────────────────────────────────────────────────────────

export async function loadReferrals(accountId: string): Promise<CustomerReferral[]> {
  const { data, error } = await supabase
    .from('customer_referrals')
    .select('id, referrer_id, referrer_project_id, referee_name, referee_email, referee_phone, status, bonus_amount, notes, org_id, created_at, updated_at')
    .eq('referrer_id', accountId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) console.error('[loadReferrals]', error.message)
  return (data ?? []) as CustomerReferral[]
}

export async function submitReferral(
  accountId: string,
  projectId: string,
  refereeName: string,
  refereePhone: string,
  refereeEmail?: string,
): Promise<boolean> {
  // Defense-in-depth: verify current user owns this account (RLS also enforces)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  // Get org_id from project so CRM can see the referral
  const { data: proj } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .single()

  const { error } = await supabase
    .from('customer_referrals')
    .insert({
      referrer_id: accountId,
      referrer_project_id: projectId,
      referee_name: refereeName,
      referee_phone: refereePhone,
      referee_email: refereeEmail ?? null,
      org_id: proj?.org_id ?? null,
    })

  if (error) {
    console.error('[submitReferral]', error.message)
    return false
  }
  return true
}
