// lib/api/customer-portal.ts — Data access layer for customer portal
// All queries scoped to a single project_id. Never exposes internal/financial data.

import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CustomerAccount {
  id: string
  auth_user_id: string | null
  email: string
  name: string
  phone: string | null
  project_id: string
  status: 'invited' | 'active' | 'suspended'
  last_login_at: string | null
  notification_prefs: { email_updates: boolean; sms_updates: boolean }
  created_at: string
}

export interface CustomerProject {
  id: string
  name: string
  address: string | null
  city: string | null
  zip: string | null
  stage: string
  stage_date: string | null
  sale_date: string | null
  survey_scheduled_date: string | null
  survey_date: string | null
  city_permit_date: string | null
  utility_permit_date: string | null
  install_scheduled_date: string | null
  install_complete_date: string | null
  city_inspection_date: string | null
  utility_inspection_date: string | null
  pto_date: string | null
  in_service_date: string | null
  module: string | null
  module_qty: number | null
  inverter: string | null
  inverter_qty: number | null
  battery: string | null
  battery_qty: number | null
  systemkw: number | null
  financier: string | null
  disposition: string | null
}

// Customer-safe fields only — no contract, blocker, pm_id, org_id, pricing
const CUSTOMER_PROJECT_FIELDS = 'id, name, address, city, zip, stage, stage_date, sale_date, survey_scheduled_date, survey_date, city_permit_date, utility_permit_date, install_scheduled_date, install_complete_date, city_inspection_date, utility_inspection_date, pto_date, in_service_date, module, module_qty, inverter, inverter_qty, battery, battery_qty, systemkw, financier, disposition'

export interface StageHistoryEntry {
  id: string
  project_id: string
  stage: string
  entered: string
}

export interface CustomerScheduleEntry {
  id: string
  project_id: string
  job_type: string
  date: string
  end_date: string | null
  time: string | null
  status: string | null
  arrival_window: string | null
}

export interface CustomerTicket {
  id: string
  ticket_number: string
  title: string
  description: string | null
  category: string
  priority: string
  status: string
  created_at: string
  resolved_at: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

// ── Customer Account ────────────────────────────────────────────────────────

export async function getCustomerAccount(): Promise<CustomerAccount | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await db()
    .from('customer_accounts')
    .select('id, auth_user_id, email, name, phone, project_id, status, last_login_at, notification_prefs, created_at')
    .eq('auth_user_id', user.id)
    .eq('status', 'active')
    .single()

  if (error || !data) return null
  return data as CustomerAccount
}

export async function getCustomerAccountByEmail(email: string): Promise<CustomerAccount | null> {
  const { data, error } = await db()
    .from('customer_accounts')
    .select('id, auth_user_id, email, name, phone, project_id, status, last_login_at, notification_prefs, created_at')
    .eq('email', email.toLowerCase())
    .single()

  if (error || !data) return null
  return data as CustomerAccount
}

// ── Project Data ────────────────────────────────────────────────────────────

export async function loadCustomerProject(projectId: string): Promise<CustomerProject | null> {
  const { data, error } = await db()
    .from('projects')
    .select(CUSTOMER_PROJECT_FIELDS)
    .eq('id', projectId)
    .single()

  if (error) { console.error('[loadCustomerProject]', error); return null }
  return data as CustomerProject
}

export async function loadProjectTimeline(projectId: string): Promise<StageHistoryEntry[]> {
  const { data, error } = await db()
    .from('stage_history')
    .select('id, project_id, stage, entered')
    .eq('project_id', projectId)
    .order('entered', { ascending: true })
    .limit(100)

  if (error) { console.error('[loadProjectTimeline]', error); return [] }
  return (data ?? []) as StageHistoryEntry[]
}

export async function loadProjectSchedule(projectId: string): Promise<CustomerScheduleEntry[]> {
  // Only return customer-safe fields — no crew_id, notes, electrical_notes, etc.
  const { data, error } = await db()
    .from('schedule')
    .select('id, project_id, job_type, date, end_date, time, status, arrival_window')
    .eq('project_id', projectId)
    .order('date', { ascending: true })
    .limit(50)

  if (error) { console.error('[loadProjectSchedule]', error); return [] }
  return (data ?? []) as CustomerScheduleEntry[]
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export async function loadCustomerTickets(projectId: string): Promise<CustomerTicket[]> {
  const { data, error } = await db()
    .from('tickets')
    .select('id, ticket_number, title, description, category, priority, status, created_at, resolved_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) { console.error('[loadCustomerTickets]', error); return [] }
  return (data ?? []) as CustomerTicket[]
}

export async function createCustomerTicket(
  projectId: string,
  title: string,
  description: string,
  category: string,
  customerName: string,
): Promise<CustomerTicket | null> {
  // Generate ticket number
  const prefix = `TKT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const { data: existing } = await db()
    .from('tickets')
    .select('ticket_number')
    .like('ticket_number', `${prefix}%`)
    .order('ticket_number', { ascending: false })
    .limit(1)

  const seq = existing?.[0] ? parseInt((existing[0] as { ticket_number: string }).ticket_number.slice(-3)) + 1 : 1
  const ticketNumber = `${prefix}-${String(seq).padStart(3, '0')}`

  const { data, error } = await db()
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

  if (error) { console.error('[createCustomerTicket]', error); return null }
  return data as CustomerTicket
}

export interface TicketComment {
  id: string
  ticket_id: string
  author: string
  message: string
  created_at: string
}

export async function loadTicketComments(ticketId: string): Promise<TicketComment[]> {
  // RLS policy already filters out is_internal=true for customers
  const { data, error } = await db()
    .from('ticket_comments')
    .select('id, ticket_id, author, message, image_url, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) { console.error('[loadTicketComments]', error); return [] }
  return (data ?? []) as TicketComment[]
}

export async function addTicketComment(ticketId: string, message: string, author: string): Promise<boolean> {
  const { error } = await db()
    .from('ticket_comments')
    .insert({
      ticket_id: ticketId,
      author,
      message,
      is_internal: false,
    })

  if (error) { console.error('[addTicketComment]', error); return false }
  return true
}

// ── Chat Sessions ───────────────────────────────────────────────────────────

export async function loadChatSession(accountId: string, projectId: string): Promise<{ id: string; messages: ChatMessage[] } | null> {
  const { data, error } = await db()
    .from('customer_chat_sessions')
    .select('id, messages')
    .eq('account_id', accountId)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null
  return { id: data.id, messages: (data.messages as ChatMessage[]) ?? [] }
}

export async function saveChatMessages(sessionId: string, messages: ChatMessage[]): Promise<boolean> {
  const { error } = await db()
    .from('customer_chat_sessions')
    .update({ messages })
    .eq('id', sessionId)

  if (error) { console.error('[saveChatMessages]', error); return false }
  return true
}

export async function createChatSession(accountId: string, projectId: string): Promise<string | null> {
  const { data, error } = await db()
    .from('customer_chat_sessions')
    .insert({ account_id: accountId, project_id: projectId, messages: [] })
    .select('id')
    .single()

  if (error) { console.error('[createChatSession]', error); return null }
  return data.id
}

// ── Admin: Invite Customer ──────────────────────────────────────────────────

export async function inviteCustomer(
  email: string,
  name: string,
  projectId: string,
  phone?: string,
  invitedBy?: string,
): Promise<CustomerAccount | null> {
  const { data, error } = await db()
    .from('customer_accounts')
    .insert({
      email: email.toLowerCase(),
      name,
      phone: phone ?? null,
      project_id: projectId,
      status: 'invited',
      invited_by: invitedBy ?? null,
    })
    .select()
    .single()

  if (error) { console.error('[inviteCustomer]', error); return null }
  return data as CustomerAccount
}

// ── Stage Label Mapping ─────────────────────────────────────────────────────

export const CUSTOMER_STAGE_LABELS: Record<string, string> = {
  evaluation: 'Getting Started',
  survey: 'Site Survey',
  design: 'System Design',
  permit: 'Permitting',
  install: 'Installation',
  inspection: 'Final Inspection',
  complete: 'System Active',
}

export const CUSTOMER_STAGE_DESCRIPTIONS: Record<string, string> = {
  evaluation: 'We\'re reviewing your home and preparing for your site survey.',
  survey: 'Our team is surveying your property to design the optimal system.',
  design: 'Engineers are designing your custom solar and storage system.',
  permit: 'Your permits are being processed with the city and utility.',
  install: 'Your solar panels and battery system are being installed.',
  inspection: 'City and utility inspectors are verifying your installation.',
  complete: 'Your system is live and generating clean energy.',
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  survey: 'Site Survey',
  install: 'Installation',
  inspection: 'Inspection',
  service: 'Service Visit',
}
