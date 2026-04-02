// Mobile API layer — talks directly to Supabase (except Atlas chat which uses Vercel API)

import { supabase } from './supabase'
import Constants from 'expo-constants'
import type { CustomerAccount, CustomerProject, StageHistoryEntry, CustomerScheduleEntry, CustomerTicket, TicketComment } from './types'

const API_BASE = 'https://microgrid-crm.vercel.app'

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
    .single()

  if (error || !data) return null
  return data as CustomerAccount
}

// ── Project ─────────────────────────────────────────────────────────────────

export async function loadProject(projectId: string): Promise<CustomerProject | null> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_FIELDS)
    .eq('id', projectId)
    .single()

  if (error) return null
  return data as CustomerProject
}

export async function loadTimeline(projectId: string): Promise<StageHistoryEntry[]> {
  const { data } = await supabase
    .from('stage_history')
    .select('id, project_id, stage, entered')
    .eq('project_id', projectId)
    .order('entered', { ascending: true })
    .limit(100)

  return (data ?? []) as StageHistoryEntry[]
}

export async function loadSchedule(projectId: string): Promise<CustomerScheduleEntry[]> {
  const { data } = await supabase
    .from('schedule')
    .select('id, project_id, job_type, date, end_date, time, status, arrival_window')
    .eq('project_id', projectId)
    .order('date', { ascending: true })
    .limit(50)

  return (data ?? []) as CustomerScheduleEntry[]
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export async function loadTickets(projectId: string): Promise<CustomerTicket[]> {
  const { data } = await supabase
    .from('tickets')
    .select('id, ticket_number, title, description, category, priority, status, created_at, resolved_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100)

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

  const seq = existing?.[0] ? parseInt((existing[0] as any).ticket_number.slice(-3)) + 1 : 1
  const ticketNumber = `${prefix}-${String(seq).padStart(3, '0')}`

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
    })
    .select('id, ticket_number, title, description, category, priority, status, created_at, resolved_at')
    .single()

  if (error) return null
  return data as CustomerTicket
}

export async function loadComments(ticketId: string): Promise<TicketComment[]> {
  const { data } = await supabase
    .from('ticket_comments')
    .select('id, ticket_id, author, message, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .limit(200)

  return (data ?? []) as TicketComment[]
}

export async function addComment(ticketId: string, message: string, author: string): Promise<boolean> {
  const { error } = await supabase
    .from('ticket_comments')
    .insert({ ticket_id: ticketId, author, message, is_internal: false })

  return !error
}

// ── Atlas Chat ──────────────────────────────────────────────────────────────
// Uses the Vercel API route (needs ANTHROPIC_API_KEY server-side)

export async function sendAtlasMessage(
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')

  const url = `${API_BASE}/api/portal/chat`
  console.log('[atlas] POST', url)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ messages }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'unknown')
    console.error('[atlas] error:', res.status, errorText)
    throw new Error(`Chat failed: ${res.status}`)
  }
  const data = await res.json()
  return data.response
}
