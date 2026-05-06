/**
 * GET /api/atlas/canonical/list
 *
 * Returns all canonical-report catalog rows visible to the caller. Admins
 * (and Heidi by email) see drafts + verified + deprecated. Manager+ see
 * only verified rows. RLS policies enforce; this route just queries.
 *
 * Used by the /atlas/reports admin page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(_request: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    },
  )

  const { data: authData } = await supabase.auth.getUser()
  const authUser = authData?.user
  if (!authUser?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Explicit role gate (defense in depth on top of RLS — R1 audit M2).
  // Manager+ + Heidi (Director of Inside Operations) can list. Lower
  // roles get an empty array via RLS anyway, but we 403 here so the
  // catalog presence isn't disclosed to other authenticated users.
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', authUser.id)
    .single()
  const role = ((profile as { role?: string } | null)?.role ?? '') as string
  const isHeidi = authUser.email === 'hhildreth@gomicrogridenergy.com'
  if (!['admin', 'super_admin', 'manager', 'team_leader'].includes(role) && !isHeidi) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('atlas_canonical_reports')
    .select(`
      id, name, description, category, status, owner, version,
      example_questions, parameter_schema, result_columns, function_name,
      verified_at, verified_by, verification_method, ground_truth_source,
      expected_row_count, drift_tolerance_pct, last_drift_check_at,
      last_drift_check_passed, created_at, updated_at
    `)
    .order('status', { ascending: true })
    .order('category', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[atlas/canonical/list] db error:', error.message)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ reports: data ?? [] })
}
