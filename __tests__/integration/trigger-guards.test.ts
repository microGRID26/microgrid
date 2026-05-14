import { describe, it, expect, beforeAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceClient, userClient } from './clients'
import { getIntegrationContext } from './setup'
import { E2E_INTEGRATION_PASSWORD, E2E_INTEGRATION_USER_EMAIL } from './fixtures'

// PostgREST-path E2E test for the projects.stage + projects.use_sld_v2
// BEFORE UPDATE trigger guards (mig 223 + 224). Closes greg_actions
// #1054 (the trigger-guard PostgREST-path test that was blocked on
// integration-test scaffolding — that scaffolding ships in this same
// session as #1058).
//
// Real path: real anon URL + real signInWithPassword + real JWT + real
// PostgREST → real DB. The non-admin authenticated user attempts
// UPDATE on projects.stage and projects.use_sld_v2; both SHOULD return
// a PostgREST error matching SQLSTATE 42501 / 'permission denied' from
// the BEFORE triggers.

describe('projects BEFORE UPDATE trigger guards — PostgREST path', () => {
  let user: SupabaseClient
  let projectId: string

  beforeAll(async () => {
    user = await userClient(E2E_INTEGRATION_USER_EMAIL, E2E_INTEGRATION_PASSWORD)
    projectId = getIntegrationContext().projectId
  })

  it('user can SELECT the test project (RLS precondition for trigger-guard tests)', async () => {
    // If this fails, the trigger-guard tests below would silently pass
    // with error=null because RLS pre-filters the UPDATE to 0 rows
    // BEFORE the BEFORE trigger sees anything. Pin the precondition.
    const { data, error } = await user
      .from('projects')
      .select('id, stage, use_sld_v2, pm_id')
      .eq('id', projectId)
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBe(projectId)
    expect(data?.stage).toBe('evaluation')
    expect(data?.use_sld_v2).toBe(false)
  })

  // R1 H2 fold (2026-05-14). PostgREST has surfaced SQLSTATE 42501 on
  // error.code, error.details, AND error.message across supabase-js
  // version history. Assert breadth-first so a future SDK upgrade
  // doesn't silently flip pass-on-reject to pass-on-null. The server-
  // side re-read is the authoritative invariant; the client-side error
  // shape is decoration.
  function isPermissionDeniedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const e = error as { code?: unknown; details?: unknown; message?: unknown; hint?: unknown }
    const blob = [e.code, e.details, e.message, e.hint]
      .filter(v => typeof v === 'string')
      .join(' ')
    return blob.includes('42501') || /permission denied|insufficient_privilege/i.test(blob)
  }

  it('non-admin UPDATE on projects.stage is rejected by mig 223 trigger (42501)', async () => {
    // Baseline: stage was reset to 'evaluation' in beforeAll. Attempt
    // to flip it to 'survey' via the user JWT.
    const { error, data } = await user
      .from('projects')
      .update({ stage: 'survey' })
      .eq('id', projectId)
      .select()

    expect(error).not.toBeNull()
    expect(isPermissionDeniedError(error)).toBe(true)
    expect(data).toBeNull()

    // Server-side authority: re-read via service_role and confirm stage
    // is still 'evaluation' (not 'survey'). This is the load-bearing
    // assertion — if the trigger silently allowed the update, this
    // would fail regardless of error shape.
    const svc = serviceClient()
    const { data: row } = await svc
      .from('projects')
      .select('stage')
      .eq('id', projectId)
      .single()
    expect(row?.stage).toBe('evaluation')
  })

  it('non-admin UPDATE on projects.use_sld_v2 is rejected by mig 224 trigger (42501)', async () => {
    const { error, data } = await user
      .from('projects')
      .update({ use_sld_v2: true })
      .eq('id', projectId)
      .select()

    expect(error).not.toBeNull()
    expect(isPermissionDeniedError(error)).toBe(true)
    expect(data).toBeNull()

    const svc = serviceClient()
    const { data: row } = await svc
      .from('projects')
      .select('use_sld_v2')
      .eq('id', projectId)
      .single()
    expect(row?.use_sld_v2).toBe(false)
  })
})
