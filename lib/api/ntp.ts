// lib/api/ntp.ts — NTP (Notice to Proceed) request data access layer
// EPCs submit projects for underwriting; EDGE (platform org) reviews and approves/rejects.

import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────
// Canonical definitions are in types/database.ts — re-export for consumer convenience
export type { NTPStatusType as NTPStatus } from '@/types/database'
export type { NTPRequest } from '@/types/database'
import type { NTPStatusType as NTPStatus } from '@/types/database'
import type { NTPRequest } from '@/types/database'

export const NTP_STATUSES = ['pending', 'under_review', 'approved', 'rejected', 'revision_required'] as const

export const NTP_STATUS_LABELS: Record<NTPStatus, string> = {
  pending: 'Pending',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  revision_required: 'Revision Required',
}

export const NTP_STATUS_BADGE: Record<NTPStatus, string> = {
  pending: 'bg-amber-900 text-amber-300',
  under_review: 'bg-blue-900 text-blue-300',
  approved: 'bg-green-900 text-green-300',
  rejected: 'bg-red-900 text-red-300',
  revision_required: 'bg-orange-900 text-orange-300',
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Load NTP requests, optionally filtered by org and/or status.
 */
export async function loadNTPRequests(orgId?: string | null, status?: NTPStatus | null): Promise<NTPRequest[]> {
  const supabase = db()
  let q = supabase
    .from('ntp_requests')
    .select('*')
    .order('submitted_at', { ascending: false })
    .limit(500)
  if (orgId) q = q.eq('requesting_org', orgId)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) console.error('[loadNTPRequests]', error.message)
  return (data ?? []) as NTPRequest[]
}

/**
 * Load the most recent NTP request for a specific project.
 */
export async function loadNTPRequestByProject(projectId: string): Promise<NTPRequest | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('ntp_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[loadNTPRequestByProject]', error.message)
    return null
  }
  return (data ?? null) as NTPRequest | null
}

/**
 * Load all NTP requests for a specific project (history).
 */
export async function loadNTPHistory(projectId: string): Promise<NTPRequest[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('ntp_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('submitted_at', { ascending: false })
    .limit(50)
  if (error) console.error('[loadNTPHistory]', error.message)
  return (data ?? []) as NTPRequest[]
}

/**
 * Submit a new NTP request (EPC action).
 */
export async function submitNTPRequest(
  projectId: string,
  orgId: string,
  userId: string,
  userName: string,
  evidence?: Record<string, unknown>,
  notes?: string,
): Promise<NTPRequest | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('ntp_requests')
    .insert({
      project_id: projectId,
      requesting_org: orgId,
      submitted_by: userName,
      submitted_by_id: userId,
      status: 'pending',
      evidence: evidence ?? {},
      notes: notes ?? null,
    })
    .select()
    .single()
  if (error) {
    console.error('[submitNTPRequest]', error.message)
    return null
  }
  return data as NTPRequest
}

/**
 * Review an NTP request (EDGE/platform action).
 * status must be: 'under_review', 'approved', 'rejected', or 'revision_required'
 */
export async function reviewNTPRequest(
  requestId: string,
  status: NTPStatus,
  reviewerId: string,
  reviewerName: string,
  reason?: string,
): Promise<NTPRequest | null> {
  const supabase = db()
  const updates: Record<string, unknown> = {
    status,
    reviewed_by: reviewerName,
    reviewed_by_id: reviewerId,
    reviewed_at: new Date().toISOString(),
  }
  if (status === 'rejected') {
    updates.rejection_reason = reason ?? null
  }
  if (status === 'revision_required') {
    updates.revision_notes = reason ?? null
  }
  const { data, error } = await supabase
    .from('ntp_requests')
    .update(updates)
    .eq('id', requestId)
    .select()
    .single()
  if (error) {
    console.error('[reviewNTPRequest]', error.message)
    return null
  }

  // Auto-update project readiness when NTP is approved
  if (status === 'approved' && data?.project_id) {
    const { data: existing } = await supabase.from('project_readiness').select('id').eq('project_id', data.project_id).maybeSingle()
    if (existing) {
      await supabase.from('project_readiness').update({ ntp_approved: true }).eq('project_id', data.project_id)
    } else {
      await supabase.from('project_readiness').insert({ project_id: data.project_id, ntp_approved: true, readiness_score: 20 })
    }
  }

  return data as NTPRequest
}

/**
 * Load the NTP approval queue for platform users.
 * Returns all requests across orgs, optionally filtered by status.
 */
export async function loadNTPQueue(status?: NTPStatus | null): Promise<NTPRequest[]> {
  const supabase = db()
  let q = supabase
    .from('ntp_requests')
    .select('*')
    .order('submitted_at', { ascending: false })
    .limit(500)
  if (status) {
    q = q.eq('status', status)
  }
  // Without filter, all statuses are returned (all 5 are the only possible values)
  const { data, error } = await q
  if (error) console.error('[loadNTPQueue]', error.message)
  return (data ?? []) as NTPRequest[]
}

/**
 * Resubmit an NTP request after revision (EPC action).
 * Resets status to 'pending' and updates evidence/notes.
 */
export async function resubmitNTPRequest(
  requestId: string,
  evidence?: Record<string, unknown>,
  notes?: string,
): Promise<NTPRequest | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('ntp_requests')
    .update({
      status: 'pending',
      evidence: evidence ?? {},
      notes: notes ?? null,
      reviewed_at: null,
      reviewed_by: null,
      reviewed_by_id: null,
      rejection_reason: null,
      revision_notes: null,
    })
    .eq('id', requestId)
    .select()
    .single()
  if (error) {
    console.error('[resubmitNTPRequest]', error.message)
    return null
  }
  return data as NTPRequest
}
