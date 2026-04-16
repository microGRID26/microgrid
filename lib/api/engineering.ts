// lib/api/engineering.ts — Engineering assignment data access layer
// EPCs assign projects to engineering orgs (e.g., Rush Engineering) for design work.
// Engineering orgs complete work and submit deliverables back.
// Org filtering: inherited via project_id FK — RLS policies enforce org scope

import { db } from '@/lib/db'
import { escapeFilterValue } from '@/lib/utils'
import { emitPartnerEvent } from '@/lib/partner-api/events/emit'

// ── Types ────────────────────────────────────────────────────────────────────
// Canonical definitions are in types/database.ts — re-export for consumer convenience
export type { AssignmentStatus, AssignmentType, EngineeringAssignment } from '@/types/database'
import type { AssignmentStatus } from '@/types/database'
import type { EngineeringAssignment } from '@/types/database'

export const ASSIGNMENT_TYPES = ['new_design', 'redesign', 'review', 'stamp'] as const

export const ASSIGNMENT_STATUSES = ['pending', 'assigned', 'in_progress', 'review', 'revision_needed', 'complete', 'cancelled'] as const

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Under Review',
  revision_needed: 'Revision Needed',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

export const ASSIGNMENT_STATUS_BADGE: Record<AssignmentStatus, string> = {
  pending: 'bg-amber-900 text-amber-300',
  assigned: 'bg-blue-900 text-blue-300',
  in_progress: 'bg-cyan-900 text-cyan-300',
  review: 'bg-purple-900 text-purple-300',
  revision_needed: 'bg-orange-900 text-orange-300',
  complete: 'bg-green-900 text-green-300',
  cancelled: 'bg-gray-800 text-gray-400',
}

export const ASSIGNMENT_TYPE_LABELS: Record<string, string> = {
  new_design: 'New Design',
  redesign: 'Redesign',
  review: 'Review',
  stamp: 'Stamp',
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Load engineering assignments, optionally filtered by org and/or status.
 */
export async function loadAssignments(orgId?: string | null, status?: AssignmentStatus | null): Promise<EngineeringAssignment[]> {
  const supabase = db()
  let q = supabase
    .from('engineering_assignments')
    .select('id, project_id, assigned_org, requesting_org, assignment_type, status, priority, assigned_to, assigned_at, started_at, completed_at, due_date, notes, deliverables, revision_count, created_by, created_by_id, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (orgId) q = q.or(`requesting_org.eq.${escapeFilterValue(orgId)},assigned_org.eq.${escapeFilterValue(orgId)}`)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) console.error('[loadAssignments]', error.message)
  return (data ?? []) as EngineeringAssignment[]
}

/**
 * Load the most recent engineering assignment for a specific project.
 */
export async function loadAssignmentByProject(projectId: string): Promise<EngineeringAssignment | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('engineering_assignments')
    .select('id, project_id, assigned_org, requesting_org, assignment_type, status, priority, assigned_to, assigned_at, started_at, completed_at, due_date, notes, deliverables, revision_count, created_by, created_by_id, created_at, updated_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[loadAssignmentByProject]', error.message)
    return null
  }
  return (data ?? null) as EngineeringAssignment | null
}

/**
 * Load all engineering assignments for a specific project (history).
 */
export async function loadAssignmentHistory(projectId: string): Promise<EngineeringAssignment[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('engineering_assignments')
    .select('id, project_id, assigned_org, requesting_org, assignment_type, status, priority, assigned_to, assigned_at, started_at, completed_at, due_date, notes, deliverables, revision_count, created_by, created_by_id, created_at, updated_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) console.error('[loadAssignmentHistory]', error.message)
  return (data ?? []) as EngineeringAssignment[]
}

/**
 * Submit a new engineering assignment (EPC action).
 */
export async function submitAssignment(
  projectId: string,
  assignedOrg: string,
  requestingOrg: string,
  type: string,
  userId: string,
  userName: string,
  options?: {
    priority?: string
    due_date?: string
    notes?: string
    assigned_to?: string
  },
): Promise<EngineeringAssignment | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('engineering_assignments')
    .insert({
      project_id: projectId,
      assigned_org: assignedOrg,
      requesting_org: requestingOrg,
      assignment_type: type,
      status: 'pending',
      priority: options?.priority ?? 'normal',
      due_date: options?.due_date ?? null,
      notes: options?.notes ?? null,
      assigned_to: options?.assigned_to ?? null,
      created_by: userName,
      created_by_id: userId,
    })
    .select()
    .single()
  if (error) {
    console.error('[submitAssignment]', error.message)
    return null
  }
  const row = data as EngineeringAssignment
  // Fire-and-forget partner webhook event. Never blocks the caller.
  void emitPartnerEvent('engineering.assignment.created', {
    assignment_id: row.id,
    project_id: row.project_id,
    assigned_org: row.assigned_org,
    requesting_org: row.requesting_org,
    assignment_type: row.assignment_type,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date,
    created_at: row.created_at,
  })
  return row
}

/**
 * Update assignment status with auto-set timestamps.
 * - assigned: sets assigned_at
 * - in_progress: sets started_at
 * - complete: sets completed_at
 * - revision_needed: increments revision_count
 */
export async function updateAssignmentStatus(
  assignmentId: string,
  status: AssignmentStatus,
  notes?: string,
): Promise<EngineeringAssignment | null> {
  const supabase = db()
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { status }

  if (status === 'assigned') {
    updates.assigned_at = now
  }
  if (status === 'in_progress') {
    updates.started_at = now
  }
  if (status === 'complete') {
    updates.completed_at = now
  }
  if (notes !== undefined) {
    updates.notes = notes
  }

  // For revision_needed, increment revision_count via a read-then-write.
  // NOTE: This is a non-atomic read-increment-write. Theoretically racy if two users
  // mark revision_needed on the same assignment simultaneously (sub-second window).
  // Practically safe: only one reviewer acts on an assignment at a time, and the UI
  // shows the current status preventing duplicate clicks. A Postgres RPC with
  // `SET revision_count = COALESCE(revision_count, 0) + 1` would be fully atomic
  // but requires a migration. Acceptable risk for now.
  if (status === 'revision_needed') {
    const { data: current } = await supabase
      .from('engineering_assignments')
      .select('revision_count')
      .eq('id', assignmentId)
      .single()
    updates.revision_count = ((current as { revision_count: number } | null)?.revision_count ?? 0) + 1
  }

  const { data, error } = await supabase
    .from('engineering_assignments')
    .update(updates)
    .eq('id', assignmentId)
    .select()
    .single()
  if (error) {
    console.error('[updateAssignmentStatus]', error.message)
    return null
  }
  const row = data as EngineeringAssignment
  void emitPartnerEvent('engineering.assignment.status_changed', {
    assignment_id: row.id,
    project_id: row.project_id,
    assigned_org: row.assigned_org,
    requesting_org: row.requesting_org,
    status: row.status,
    revision_count: row.revision_count,
    completed_at: row.completed_at,
  })
  return row
}

/**
 * Append a deliverable to the assignment's deliverables JSONB array.
 * Deliverable shape is flexible — typically { name, url, type, uploaded_at }.
 *
 * NOTE: This uses a read-modify-write pattern on the JSONB array, which is
 * theoretically racy if two users upload deliverables to the same assignment
 * at the exact same moment. Practically safe: only one engineer works on an
 * assignment at a time. A Postgres function using `jsonb_array_append` would
 * be fully atomic but requires a migration.
 */
export async function addDeliverable(
  assignmentId: string,
  deliverable: Record<string, unknown>,
): Promise<EngineeringAssignment | null> {
  const supabase = db()
  // Read current deliverables
  const { data: current, error: readErr } = await supabase
    .from('engineering_assignments')
    .select('deliverables')
    .eq('id', assignmentId)
    .single()
  if (readErr) {
    console.error('[addDeliverable] read', readErr.message)
    return null
  }
  const existing = (current as { deliverables: Record<string, unknown>[] } | null)?.deliverables ?? []
  const updated = [...existing, { ...deliverable, uploaded_at: new Date().toISOString() }]

  const { data, error } = await supabase
    .from('engineering_assignments')
    .update({ deliverables: updated })
    .eq('id', assignmentId)
    .select()
    .single()
  if (error) {
    console.error('[addDeliverable] update', error.message)
    return null
  }
  const row = data as EngineeringAssignment
  void emitPartnerEvent('engineering.deliverable.uploaded', {
    assignment_id: row.id,
    project_id: row.project_id,
    assigned_org: row.assigned_org,
    deliverable: { ...deliverable, uploaded_at: new Date().toISOString() },
    deliverable_count: updated.length,
  })
  return row
}

/**
 * Load the engineering assignment queue (for engineering org view).
 * Returns all assignments across requesting orgs, optionally filtered by status.
 */
export async function loadAssignmentQueue(status?: AssignmentStatus | null): Promise<EngineeringAssignment[]> {
  const supabase = db()
  let q = supabase
    .from('engineering_assignments')
    .select('id, project_id, assigned_org, requesting_org, assignment_type, status, priority, assigned_to, assigned_at, started_at, completed_at, due_date, notes, deliverables, revision_count, created_by, created_by_id, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (status) {
    q = q.eq('status', status)
  }
  const { data, error } = await q
  if (error) console.error('[loadAssignmentQueue]', error.message)
  return (data ?? []) as EngineeringAssignment[]
}
