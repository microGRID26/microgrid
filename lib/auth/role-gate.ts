// Server-side role-gate helper for API routes that need to enforce
// "must be a manager+ internal user" beyond just "must be authenticated."
//
// CRITICAL CONTEXT (R2 audit 2026-04-28):
// - public.users does NOT have an `auth_user_id` column. Only `id`, `email`, `role`, `active`.
// - public.users.id ≠ auth.users.id for 12 of 15 active role-bearing users
//   (legacy data; only 3 users were provisioned with matching ids).
// - Therefore the ONLY reliable join from auth.users → public.users is by email.
// - Supabase Auth marks email as verified on the auth.users row before a session
//   is issued, so trusting authUser.email is safe for this purpose.
//
// All API routes doing "manager+" gating MUST use this helper. Inline lookups
// against `public.users` by `id` will silently 403 most legitimate users.

import type { SupabaseClient } from '@supabase/supabase-js'

export const MANAGER_PLUS = ['manager', 'admin', 'super_admin', 'finance'] as const
export const MANAGER_PLUS_NO_FINANCE = ['manager', 'admin', 'super_admin'] as const
export const ADMIN_PLUS = ['admin', 'super_admin'] as const

export type AllowedRoleSet =
  | typeof MANAGER_PLUS
  | typeof MANAGER_PLUS_NO_FINANCE
  | typeof ADMIN_PLUS

export interface RoleCheckInput {
  /** Service-role or user-scoped Supabase client used for the lookup. */
  db: SupabaseClient
  /** auth.getUser().email — Supabase Auth verifies this before issuing a session. */
  authUserEmail: string | null | undefined
  /** Allow-list of roles permitted to pass the gate. */
  allowedRoles: readonly string[]
}

export interface RoleCheckResult {
  ok: boolean
  /** When ok=true, the resolved internal users.role value. */
  role: string | null
  /** When ok=true, the public.users.id of the caller. Needed by callers that want to
   * resolve org membership (org_memberships.user_id is keyed by public.users.id, not
   * auth.users.id — see #353/#363). Null when ok=false. */
  user_id: string | null
  /** When ok=false, the reason — for diagnostic logging only, NOT to leak to client. */
  reason: 'no-email' | 'no-public-user' | 'inactive' | 'no-role' | 'role-not-allowed' | 'db-error' | null
}

/**
 * Resolve the caller's internal role and check it against an allow-list.
 * Always returns ok=false when the caller has no public.users row OR is inactive
 * OR has no role assigned OR the role is not in `allowedRoles`. Returns the
 * resolved role value when ok=true so the caller can branch on it if needed.
 *
 * Lookup uses lower(email) match + active=true. Returns first match (there
 * should not be duplicates; if there are, that's a separate data-integrity bug
 * to file but this function won't crash on it).
 */
export async function checkRole(input: RoleCheckInput): Promise<RoleCheckResult> {
  const { db, authUserEmail, allowedRoles } = input
  if (!authUserEmail) {
    return { ok: false, role: null, user_id: null, reason: 'no-email' }
  }
  const { data, error } = await db
    .from('users')
    .select('id, role, active')
    .ilike('email', authUserEmail.trim())
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (error) {
    return { ok: false, role: null, user_id: null, reason: 'db-error' }
  }
  if (!data) {
    return { ok: false, role: null, user_id: null, reason: 'no-public-user' }
  }
  if (data.active === false) {
    return { ok: false, role: null, user_id: null, reason: 'inactive' }
  }
  const role = (data.role as string | null) ?? null
  const user_id = (data.id as string | null) ?? null
  if (!role) {
    return { ok: false, role: null, user_id, reason: 'no-role' }
  }
  if (!allowedRoles.includes(role)) {
    return { ok: false, role, user_id, reason: 'role-not-allowed' }
  }
  return { ok: true, role, user_id, reason: null }
}

/**
 * Resolve the org_ids the caller belongs to via `org_memberships`. Keyed by
 * public.users.id (NOT auth.users.id — only 3 of 15 active internal users have
 * matching ids; see #353/#363).
 *
 * Returns `{ ok: true, orgIds: [] }` when the user has no memberships.
 * Returns `{ ok: false }` when the lookup itself failed (caller should
 * surface a 500, not silently produce an empty list — R1 audit on #362).
 *
 * Admin and super_admin roles intentionally bypass org checks at the route
 * level — pass `role` and short-circuit before calling this if you want
 * unrestricted access.
 */
export type OrgIdsResult = { ok: true; orgIds: string[] } | { ok: false }
export async function getCallerOrgIds(
  db: SupabaseClient,
  publicUserId: string | null | undefined,
): Promise<OrgIdsResult> {
  if (!publicUserId) return { ok: true, orgIds: [] }
  const { data, error } = await db
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', publicUserId)
  if (error) return { ok: false }
  if (!data) return { ok: true, orgIds: [] }
  return { ok: true, orgIds: data.map((r: { org_id: string }) => r.org_id).filter(Boolean) }
}
