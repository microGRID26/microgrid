// lib/api/tickets.ts — Ticketing system API layer
// Data-driven: every action generates queryable records

import { db } from '@/lib/db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Ticket {
  id: string
  ticket_number: string
  project_id: string | null
  category: string
  subcategory: string | null
  priority: string
  source: string
  title: string
  description: string | null
  status: string
  resolution_category: string | null
  resolution_notes: string | null
  assigned_to: string | null
  assigned_to_id: string | null
  assigned_team: string | null
  escalated_to: string | null
  escalated_at: string | null
  reported_by: string | null
  reported_by_id: string | null
  sales_rep_id: string | null
  pm_id: string | null
  sla_response_hours: number
  sla_resolution_hours: number
  first_response_at: string | null
  resolved_at: string | null
  closed_at: string | null
  tags: string[] | null
  related_ticket_id: string | null
  org_id: string | null
  created_by: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
}

export interface TicketComment {
  id: string
  ticket_id: string
  author: string
  author_id: string | null
  message: string
  is_internal: boolean
  created_at: string
}

export interface TicketHistory {
  id: string
  ticket_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_by_id: string | null
  created_at: string
}

export interface TicketCategory {
  id: string
  category: string
  subcategory: string | null
  label: string
  description: string | null
  default_priority: string
  default_sla_response: number
  default_sla_resolution: number
  active: boolean
  sort_order: number
  org_id: string | null
}

export interface TicketResolutionCode {
  id: string
  code: string
  label: string
  description: string | null
  applies_to: string[] | null
  active: boolean
  sort_order: number
}

// ── Constants ────────────────────────────────────────────────────────────────

export const TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'waiting_on_customer', 'waiting_on_vendor', 'escalated', 'resolved', 'closed'] as const
export type TicketStatus = typeof TICKET_STATUSES[number]

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  waiting_on_customer: 'Waiting on Customer',
  waiting_on_vendor: 'Waiting on Vendor',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const TICKET_STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-400',
  assigned: 'bg-indigo-500/20 text-indigo-400',
  in_progress: 'bg-amber-500/20 text-amber-400',
  waiting_on_customer: 'bg-purple-500/20 text-purple-400',
  waiting_on_vendor: 'bg-orange-500/20 text-orange-400',
  escalated: 'bg-red-500/20 text-red-400',
  resolved: 'bg-green-500/20 text-green-400',
  closed: 'bg-gray-500/20 text-gray-400',
}

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent', 'critical'] as const

export const TICKET_PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-500/20 text-gray-400',
  normal: 'bg-blue-500/20 text-blue-400',
  high: 'bg-amber-500/20 text-amber-400',
  urgent: 'bg-red-500/20 text-red-400',
  critical: 'bg-red-600/30 text-red-300 border border-red-500/30',
}

export const TICKET_CATEGORIES = ['service', 'sales', 'billing', 'warranty', 'permitting', 'installation', 'design', 'other'] as const

export const TICKET_CATEGORY_COLORS: Record<string, string> = {
  service: 'bg-blue-900/40 text-blue-400',
  sales: 'bg-amber-900/40 text-amber-400',
  billing: 'bg-green-900/40 text-green-400',
  warranty: 'bg-purple-900/40 text-purple-400',
  permitting: 'bg-cyan-900/40 text-cyan-400',
  installation: 'bg-orange-900/40 text-orange-400',
  design: 'bg-pink-900/40 text-pink-400',
  other: 'bg-gray-700/40 text-gray-400',
}

export const TICKET_SOURCES = ['internal', 'customer_call', 'customer_email', 'field_report', 'inspection', 'warranty_claim'] as const

// ── Status Transitions ───────────────────────────────────────────────────────

const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['assigned', 'in_progress', 'escalated', 'resolved', 'closed'],
  assigned: ['in_progress', 'waiting_on_customer', 'waiting_on_vendor', 'escalated', 'resolved'],
  in_progress: ['waiting_on_customer', 'waiting_on_vendor', 'escalated', 'resolved'],
  waiting_on_customer: ['in_progress', 'escalated', 'resolved', 'closed'],
  waiting_on_vendor: ['in_progress', 'escalated', 'resolved'],
  escalated: ['in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],  // can reopen
  closed: ['open'],  // can reopen
}

export function getValidTransitions(current: string): string[] {
  return STATUS_TRANSITIONS[current] ?? []
}

// ── Ticket Number Generation ─────────────────────────────────────────────────

export async function generateTicketNumber(): Promise<string> {
  const d = new Date()
  const prefix = `TKT-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  // Retry up to 3x on collision (race condition mitigation)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await db().from('tickets').select('ticket_number').like('ticket_number', `${prefix}%`).order('ticket_number', { ascending: false }).limit(1)
    const last = (data ?? [])[0] as { ticket_number: string } | undefined
    const seq = last ? parseInt(last.ticket_number.slice(-3)) + 1 + attempt : 1 + attempt
    const number = `${prefix}-${String(seq).padStart(3, '0')}`
    // Check if number already exists
    const { data: existing } = await db().from('tickets').select('id').eq('ticket_number', number).limit(1)
    if (!(existing ?? []).length) return number
  }
  // Fallback: append timestamp milliseconds
  return `${prefix}-${String(Date.now() % 1000).padStart(3, '0')}`
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function loadTickets(filters?: {
  status?: string
  category?: string
  priority?: string
  assignedToId?: string
  projectId?: string
  orgId?: string | null
}): Promise<Ticket[]> {
  let q = db().from('tickets').select('*').order('created_at', { ascending: false }).limit(2000)
  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.category) q = q.eq('category', filters.category)
  if (filters?.priority) q = q.eq('priority', filters.priority)
  if (filters?.assignedToId) q = q.eq('assigned_to_id', filters.assignedToId)
  if (filters?.projectId) q = q.eq('project_id', filters.projectId)
  if (filters?.orgId) q = q.eq('org_id', filters.orgId)
  const { data, error } = await q
  if (error) console.error('[loadTickets]', error.message)
  return (data ?? []) as Ticket[]
}

export async function loadTicket(id: string): Promise<Ticket | null> {
  const { data, error } = await db().from('tickets').select('*').eq('id', id).single()
  if (error) { console.error('[loadTicket]', error.message); return null }
  return data as Ticket
}

export async function loadProjectTickets(projectId: string): Promise<Ticket[]> {
  const { data, error } = await db().from('tickets').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(50)
  if (error) console.error('[loadProjectTickets]', error.message)
  return (data ?? []) as Ticket[]
}

export async function createTicket(ticket: Partial<Ticket>): Promise<Ticket | null> {
  const number = await generateTicketNumber()
  const { data, error } = await db().from('tickets').insert({ ...ticket, ticket_number: number }).select().single()
  if (error) { console.error('[createTicket]', error.message); return null }
  return data as Ticket
}

export async function updateTicket(id: string, updates: Partial<Ticket>): Promise<boolean> {
  const { error } = await db().from('tickets').update(updates).eq('id', id)
  if (error) { console.error('[updateTicket]', error.message); return false }
  return true
}

export async function updateTicketStatus(
  id: string,
  newStatus: string,
  changedBy: string,
  changedById?: string,
  resolutionCategory?: string,
  resolutionNotes?: string,
): Promise<boolean> {
  const ticket = await loadTicket(id)
  if (!ticket) return false

  const valid = getValidTransitions(ticket.status)
  if (!valid.includes(newStatus)) {
    console.error(`[updateTicketStatus] Invalid transition: ${ticket.status} → ${newStatus}`)
    return false
  }

  const updates: Record<string, unknown> = { status: newStatus }

  // Auto-set timestamps
  if (newStatus === 'resolved') {
    updates.resolved_at = new Date().toISOString()
    if (resolutionCategory) updates.resolution_category = resolutionCategory
    if (resolutionNotes) updates.resolution_notes = resolutionNotes
  }
  if (newStatus === 'closed') updates.closed_at = new Date().toISOString()
  if (newStatus === 'escalated') updates.escalated_at = new Date().toISOString()
  if (newStatus === 'in_progress' && !ticket.first_response_at) {
    updates.first_response_at = new Date().toISOString()
  }
  if (newStatus === 'assigned' && !ticket.first_response_at) {
    updates.first_response_at = new Date().toISOString()
  }

  // Reopen clears resolution
  if (newStatus === 'open' || newStatus === 'in_progress') {
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      updates.resolved_at = null
      updates.closed_at = null
      updates.resolution_category = null
      updates.resolution_notes = null
    }
  }

  const ok = await updateTicket(id, updates as Partial<Ticket>)
  if (ok) {
    await addTicketHistory(id, 'status', ticket.status, newStatus, changedBy, changedById)
  }
  return ok
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function loadTicketComments(ticketId: string): Promise<TicketComment[]> {
  const { data, error } = await db().from('ticket_comments').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true }).limit(500)
  if (error) console.error('[loadTicketComments]', error.message)
  return (data ?? []) as TicketComment[]
}

export async function addTicketComment(ticketId: string, author: string, authorId: string | undefined, message: string, isInternal = false): Promise<boolean> {
  const { error } = await db().from('ticket_comments').insert({ ticket_id: ticketId, author, author_id: authorId, message, is_internal: isInternal })
  if (error) { console.error('[addTicketComment]', error.message); return false }

  // Auto-set first_response_at if this is the first comment
  const ticket = await loadTicket(ticketId)
  if (ticket && !ticket.first_response_at) {
    await updateTicket(ticketId, { first_response_at: new Date().toISOString() } as any)
  }
  return true
}

// ── History ──────────────────────────────────────────────────────────────────

export async function loadTicketHistory(ticketId: string): Promise<TicketHistory[]> {
  const { data, error } = await db().from('ticket_history').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: false }).limit(200)
  if (error) console.error('[loadTicketHistory]', error.message)
  return (data ?? []) as TicketHistory[]
}

export async function addTicketHistory(ticketId: string, field: string, oldValue: string | null, newValue: string | null, changedBy: string, changedById?: string): Promise<void> {
  await db().from('ticket_history').insert({ ticket_id: ticketId, field, old_value: oldValue, new_value: newValue, changed_by: changedBy, changed_by_id: changedById })
}

// ── Categories & Resolution Codes ────────────────────────────────────────────

export async function loadTicketCategories(): Promise<TicketCategory[]> {
  const { data, error } = await db().from('ticket_categories').select('*').eq('active', true).order('sort_order').limit(200)
  if (error) console.error('[loadTicketCategories]', error.message)
  return (data ?? []) as TicketCategory[]
}

export async function loadResolutionCodes(): Promise<TicketResolutionCode[]> {
  const { data, error } = await db().from('ticket_resolution_codes').select('*').eq('active', true).order('sort_order').limit(100)
  if (error) console.error('[loadResolutionCodes]', error.message)
  return (data ?? []) as TicketResolutionCode[]
}

// ── SLA Helpers ──────────────────────────────────────────────────────────────

export function getSLAStatus(ticket: Ticket): { response: 'ok' | 'warning' | 'breached'; resolution: 'ok' | 'warning' | 'breached' } {
  const now = new Date()
  const created = new Date(ticket.created_at)
  const hoursElapsed = (now.getTime() - created.getTime()) / 3600000

  const responseHours = ticket.first_response_at
    ? (new Date(ticket.first_response_at).getTime() - created.getTime()) / 3600000
    : hoursElapsed

  const resolutionHours = ticket.resolved_at
    ? (new Date(ticket.resolved_at).getTime() - created.getTime()) / 3600000
    : hoursElapsed

  const isTerminal = ticket.status === 'resolved' || ticket.status === 'closed'

  return {
    response: ticket.first_response_at
      ? (responseHours > ticket.sla_response_hours ? 'breached' : 'ok')
      : (hoursElapsed > ticket.sla_response_hours ? 'breached' : hoursElapsed > ticket.sla_response_hours * 0.75 ? 'warning' : 'ok'),
    resolution: isTerminal
      ? (resolutionHours > ticket.sla_resolution_hours ? 'breached' : 'ok')
      : (hoursElapsed > ticket.sla_resolution_hours ? 'breached' : hoursElapsed > ticket.sla_resolution_hours * 0.75 ? 'warning' : 'ok'),
  }
}
