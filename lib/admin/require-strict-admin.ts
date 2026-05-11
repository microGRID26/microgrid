// lib/admin/require-strict-admin.ts — uid + lowercase-email match admin gate.
//
// R1 audit fix for action #807. The repo-wide helper
// `requireAdminSession` (lib/partner-api/admin/require-admin.ts) matches
// `public.users` by email alone via `.eq('email', user.email)`. Action
// #628 is filing a repo-wide hardening; until that lands, this helper
// gives newly-shipped admin routes the safer pattern:
//
//   1. Validate JWT via supabase.auth.getUser()
//   2. Match `public.users` by id = auth.uid()
//   3. Cross-check `LOWER(TRIM(public.users.email)) = LOWER(TRIM(auth.users.email))`
//   4. Require role ∈ admin/super_admin
//
// Any mismatch fails closed with 403. This kills the email-only auth
// bypass class identified by the red-teamer (email collision /
// re-provisioning leaves stale role on a row whose id no longer matches
// the auth user).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const ADMIN_ROLES = new Set(['admin', 'super_admin'])

export interface StrictAdminSession {
  userId: string
  userEmail: string
  role: string
}

export async function requireStrictAdmin(request: NextRequest): Promise<
  | { ok: true; session: StrictAdminSession }
  | { ok: false; response: NextResponse }
> {
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )

  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!user.email) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const authEmail = user.email.trim().toLowerCase()

  // Match by id (auth.uid()) — this is the strict part. We then verify
  // the email also matches case-insensitively, so a row whose email was
  // re-targeted after the auth user was created can't slip through.
  const { data: userRow } = await sb
    .from('users')
    .select('id, email, role')
    .eq('id', user.id)
    .maybeSingle()
  const row = userRow as { id: string; email: string | null; role: string } | null

  if (!row) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!row.email || row.email.trim().toLowerCase() !== authEmail) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!row.role || !ADMIN_ROLES.has(row.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Admin only' }, { status: 403 }) }
  }

  return { ok: true, session: { userId: row.id, userEmail: authEmail, role: row.role } }
}
