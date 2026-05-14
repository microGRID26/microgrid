import path from 'node:path'
import fs from 'node:fs'
import { beforeAll, afterAll } from 'vitest'

// .env.local loader (mirrors evals/setup.ts). Required because vitest
// doesn't read .env.* by default; the integration suite needs the
// NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY +
// SUPABASE_SERVICE_ROLE_KEY trio.
const envPath = path.resolve(__dirname, '..', '..', '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

import { serviceClient } from './clients'
import {
  E2E_INTEGRATION_ORG_NAME,
  E2E_INTEGRATION_ORG_SLUG,
  E2E_INTEGRATION_PASSWORD,
  E2E_INTEGRATION_PROJECT_ID,
  E2E_INTEGRATION_USER_EMAIL,
  E2E_INTEGRATION_USER_NAME,
  E2E_TEST_PREFIX,
} from './fixtures'

// Module-scope context — populated by beforeAll, consumed by test files
// via getIntegrationContext().
let _ctx: { userId: string; orgId: string; projectId: string } | null = null

export function getIntegrationContext() {
  if (!_ctx) {
    throw new Error(
      'integration context not initialized — make sure vitest.integration.config.ts is the active config and beforeAll has run',
    )
  }
  return _ctx
}

/**
 * Defense-in-depth scrubber for accidental JWT leaks in error messages or
 * stack traces. Mirrors evals/setup.ts. Run on every thrown error from
 * setup/teardown paths so a Supabase SDK panic doesn't echo an Authorization
 * header into CI logs.
 */
function scrubSecrets(err: unknown): Error {
  // Patterns covered (R1 M4 fold, 2026-05-14):
  //   eyJ…    — JWT shape (anon + user JWTs)
  //   sbp_…   — Supabase service-role / publishable keys in current format
  // Plus literal-replace of the env-var values themselves so a stringified
  // axios/fetch error that embeds an Authorization header verbatim gets
  // redacted regardless of key shape.
  const patterns: Array<[RegExp, string]> = [
    [/eyJ[A-Za-z0-9_-]{20,}/g, 'eyJ<redacted>'],
    [/sbp_[A-Za-z0-9_-]{20,}/g, 'sbp_<redacted>'],
  ]
  const literals = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ].filter((v): v is string => Boolean(v && v.length >= 20))
  const scrub = (s: string): string => {
    let out = s
    for (const [re, repl] of patterns) out = out.replace(re, repl)
    for (const lit of literals) {
      // Plain literal replace (no regex; the literal could contain regex
      // metachars). split/join is the simplest non-allocating pattern.
      out = out.split(lit).join('<env_redacted>')
    }
    return out
  }
  const msg = err instanceof Error ? err.message : String(err)
  const scrubbed = scrub(msg)
  if (err instanceof Error) {
    err.message = scrubbed
    if (err.stack) err.stack = scrub(err.stack)
    return err
  }
  return new Error(scrubbed)
}

/**
 * Provision (or re-use) the integration test organization. Uses
 * org_type='engineering' to avoid the `organizations_grant_staff_on_new_epc`
 * trigger that auto-bulk-adds every role='user' user to every new EPC org.
 */
async function ensureOrg(): Promise<string> {
  const svc = serviceClient()
  const { data: existing, error: selErr } = await svc
    .from('organizations')
    .select('id, slug')
    .eq('slug', E2E_INTEGRATION_ORG_SLUG)
    .maybeSingle()
  if (selErr) throw new Error(`ensureOrg select failed: ${selErr.message}`)
  if (existing?.id) {
    if (existing.slug !== E2E_INTEGRATION_ORG_SLUG) {
      throw new Error(`ensureOrg refuses: org ${existing.id} has slug "${existing.slug}"`)
    }
    return existing.id as string
  }

  const { data: inserted, error: insErr } = await svc
    .from('organizations')
    .insert({
      slug: E2E_INTEGRATION_ORG_SLUG,
      name: E2E_INTEGRATION_ORG_NAME,
      org_type: 'engineering',
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    throw new Error(`ensureOrg insert failed: ${insErr?.message ?? 'no row returned'}`)
  }
  return inserted.id as string
}

async function ensureAuthUser(): Promise<string> {
  const svc = serviceClient()
  // Per-run namespacing (fixtures.ts) means the email is unique per
  // process: createUser usually succeeds first try. If a prior run with
  // the SAME env-provided RUN_ID crashed before teardown, fall back to a
  // lookup via public.users (keyed on email, not paginated — collapses
  // R1 M3 page-1-only scan).
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: E2E_INTEGRATION_USER_EMAIL,
    password: E2E_INTEGRATION_PASSWORD,
    email_confirm: true,
  })
  if (!createErr && created?.user) {
    return created.user.id
  }

  // Already-exists path. Look up via public.users (FK to auth.users.id;
  // email is indexed). Avoids the auth.admin.listUsers pagination cap.
  const { data: existing, error: lookupErr } = await svc
    .from('users')
    .select('id')
    .eq('email', E2E_INTEGRATION_USER_EMAIL)
    .maybeSingle()
  if (lookupErr) {
    throw new Error(
      `ensureAuthUser createUser failed (${createErr?.message ?? 'unknown'}) and lookup also failed: ${lookupErr.message}`,
    )
  }
  if (!existing?.id) {
    throw new Error(
      `ensureAuthUser createUser failed: ${createErr?.message ?? 'unknown'}; user not present in public.users either`,
    )
  }
  // Reset password so the user's signInWithPassword still works with the
  // current fixture password (the failed createUser path is the only one
  // that hits this, and it means the prior run left state behind).
  const { error: updErr } = await svc.auth.admin.updateUserById(existing.id as string, {
    password: E2E_INTEGRATION_PASSWORD,
  })
  if (updErr) throw new Error(`ensureAuthUser updateUserById failed: ${updErr.message}`)
  return existing.id as string
}

async function ensurePublicUser(authId: string): Promise<void> {
  const svc = serviceClient()
  const { data: existing, error: selErr } = await svc
    .from('users')
    .select('id, role')
    .eq('id', authId)
    .maybeSingle()
  if (selErr) throw new Error(`ensurePublicUser select failed: ${selErr.message}`)
  if (existing?.id) {
    // Reset role to 'user' every run as a defense against a future migration
    // bumping the test user to admin/super_admin (which would invalidate
    // the trigger-guard test premise — admin/super_admin BYPASSES the
    // BEFORE triggers via `auth_is_admin()`).
    if (existing.role !== 'user') {
      const { error: updErr } = await svc
        .from('users')
        .update({ role: 'user' })
        .eq('id', authId)
      if (updErr) throw new Error(`ensurePublicUser role reset failed: ${updErr.message}`)
    }
    return
  }
  const { error: insErr } = await svc.from('users').insert({
    id: authId,
    email: E2E_INTEGRATION_USER_EMAIL,
    name: E2E_INTEGRATION_USER_NAME,
    active: true,
    is_active: true,
    role: 'user',
  })
  if (insErr) throw new Error(`ensurePublicUser insert failed: ${insErr.message}`)
}

async function ensureMembership(userId: string, orgId: string): Promise<void> {
  const svc = serviceClient()
  const { data: existing, error: selErr } = await svc
    .from('org_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (selErr) throw new Error(`ensureMembership select failed: ${selErr.message}`)
  if (existing?.id) return
  const { error: insErr } = await svc.from('org_memberships').insert({
    user_id: userId,
    org_id: orgId,
    org_role: 'member',
    is_default: true,
  })
  if (insErr) throw new Error(`ensureMembership insert failed: ${insErr.message}`)
}

/**
 * Drop any org_memberships row where the integration test user is attached
 * to an org OUTSIDE the integration test org. The
 * `organizations_grant_staff_on_new_epc` trigger silently bulk-adds
 * role='user' users to every new EPC org Greg creates. Auto-heal on every
 * setup. Slug-guarded — refuses to operate if the integration org slug
 * doesn't resolve to the expected fixture.
 */
async function purgeUserForeignMemberships(userId: string, orgId: string): Promise<void> {
  const svc = serviceClient()
  const { data: org, error: verifyErr } = await svc
    .from('organizations')
    .select('id, slug')
    .eq('id', orgId)
    .maybeSingle()
  if (verifyErr) throw new Error(`purgeUserForeignMemberships verify failed: ${verifyErr.message}`)
  if (!org || org.slug !== E2E_INTEGRATION_ORG_SLUG) {
    throw new Error(
      `purgeUserForeignMemberships refuses to operate: org ${orgId} slug "${org?.slug}" not "${E2E_INTEGRATION_ORG_SLUG}"`,
    )
  }
  const { error: delErr } = await svc
    .from('org_memberships')
    .delete()
    .eq('user_id', userId)
    .neq('org_id', orgId)
  if (delErr) throw new Error(`purgeUserForeignMemberships delete failed: ${delErr.message}`)
}

/**
 * Fail-loud assertion that the integration user has memberships ONLY in
 * the integration org. Catches the case where a future MicroGRID trigger
 * silently re-attaches the test user to a prod org between purge and
 * test-run.
 */
async function assertUserMembershipScoped(userId: string, orgId: string): Promise<void> {
  const svc = serviceClient()
  const { data, error } = await svc
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', userId)
  if (error) throw new Error(`assertUserMembershipScoped query failed: ${error.message}`)
  const orgs = (data ?? []).map(r => r.org_id as string)
  if (orgs.length !== 1 || orgs[0] !== orgId) {
    throw new Error(
      `integration user membership leak: expected exactly [${orgId}], got [${orgs.join(',')}]. Refusing to run.`,
    )
  }
}

async function ensureProject(orgId: string, userId: string): Promise<string> {
  const svc = serviceClient()
  // pm_id is the load-bearing field for the projects_update_v2 RLS
  // policy: the USING/WITH CHECK requires (pm_id = auth_user_id() OR
  // auth_is_manager()). Test user is role='user' (not manager), so we
  // must set pm_id = userId for the user's JWT to even reach the
  // BEFORE triggers from mig 223/224 — otherwise RLS pre-filters
  // the UPDATE to 0 rows and the test would silently pass with
  // error=null instead of testing the trigger.
  const { data: existing, error: selErr } = await svc
    .from('projects')
    .select('id, stage, use_sld_v2, pm_id, org_id')
    .eq('id', E2E_INTEGRATION_PROJECT_ID)
    .maybeSingle()
  if (selErr) throw new Error(`ensureProject select failed: ${selErr.message}`)
  if (existing?.id) {
    // Reset stage / use_sld_v2 / pm_id / org_id to known baseline on
    // every run. service_role bypasses both RLS and the mig 223/224
    // BEFORE triggers (session_user='service_role' is in the DB-admin
    // allowlist), so this is safe.
    const { error: updErr } = await svc
      .from('projects')
      .update({
        stage: 'evaluation',
        use_sld_v2: false,
        pm_id: userId,
        org_id: orgId,
      })
      .eq('id', E2E_INTEGRATION_PROJECT_ID)
    if (updErr) {
      throw new Error(`ensureProject baseline reset failed: ${updErr.message}`)
    }
    return existing.id as string
  }
  // INSERT the fixture project. Only id + org_id are NOT NULL; pm_id is
  // nullable but we set it so the user can pass projects_update_v2 RLS.
  const { error: insErr } = await svc
    .from('projects')
    .insert({
      id: E2E_INTEGRATION_PROJECT_ID,
      org_id: orgId,
      stage: 'evaluation',
      use_sld_v2: false,
      pm_id: userId,
    })
  if (insErr) throw new Error(`ensureProject insert failed: ${insErr.message}`)
  return E2E_INTEGRATION_PROJECT_ID
}

async function teardown(userId: string, orgId: string): Promise<void> {
  const svc = serviceClient()

  // Slug-guard: refuse teardown if the org id doesn't resolve to our
  // fixture slug.
  const { data: org, error: verifyErr } = await svc
    .from('organizations')
    .select('id, slug')
    .eq('id', orgId)
    .maybeSingle()
  if (verifyErr) throw new Error(`teardown verify failed: ${verifyErr.message}`)
  if (!org || org.slug !== E2E_INTEGRATION_ORG_SLUG) {
    throw new Error(
      `teardown refuses: org ${orgId} slug "${org?.slug}" not "${E2E_INTEGRATION_ORG_SLUG}"`,
    )
  }

  // Project — guard on id prefix.
  if (!E2E_INTEGRATION_PROJECT_ID.startsWith(E2E_TEST_PREFIX)) {
    throw new Error('teardown refuses: project id lost the e2e_test_ prefix')
  }
  const { error: delProjErr } = await svc
    .from('projects')
    .delete()
    .eq('id', E2E_INTEGRATION_PROJECT_ID)
  if (delProjErr) {
    throw new Error(`teardown delete project failed: ${delProjErr.message}`)
  }

  // org_memberships scoped to (user, org) — defensive double-filter.
  const { error: delMemErr } = await svc
    .from('org_memberships')
    .delete()
    .eq('user_id', userId)
    .eq('org_id', orgId)
  if (delMemErr) throw new Error(`teardown delete membership failed: ${delMemErr.message}`)

  // public.users — guard on email prefix.
  if (!E2E_INTEGRATION_USER_EMAIL.startsWith(E2E_TEST_PREFIX)) {
    throw new Error('teardown refuses: user email lost the e2e_test_ prefix')
  }
  const { error: delPubErr } = await svc
    .from('users')
    .delete()
    .eq('id', userId)
    .eq('email', E2E_INTEGRATION_USER_EMAIL)
  if (delPubErr) throw new Error(`teardown delete public user failed: ${delPubErr.message}`)

  // organization — final guard on slug match.
  const { error: delOrgErr } = await svc
    .from('organizations')
    .delete()
    .eq('id', orgId)
    .eq('slug', E2E_INTEGRATION_ORG_SLUG)
  if (delOrgErr) throw new Error(`teardown delete org failed: ${delOrgErr.message}`)

  // auth.users last — once removed, the FK-child cascade is gone.
  const { error: delAuthErr } = await svc.auth.admin.deleteUser(userId)
  if (delAuthErr) throw new Error(`teardown deleteUser failed: ${delAuthErr.message}`)
}

beforeAll(async () => {
  try {
    const orgId = await ensureOrg()
    const userId = await ensureAuthUser()
    await ensurePublicUser(userId)
    await purgeUserForeignMemberships(userId, orgId)
    await ensureMembership(userId, orgId)
    await assertUserMembershipScoped(userId, orgId)
    const projectId = await ensureProject(orgId, userId)
    _ctx = { userId, orgId, projectId }
  } catch (err) {
    throw scrubSecrets(err)
  }
}, 60_000)

afterAll(async () => {
  // Cleanup MUST throw on failure. Silent cleanup failures = orphan rows
  // strand in prod indefinitely. Better to fail loud and force a manual
  // sweep than leave junk behind.
  if (!_ctx) return
  try {
    await teardown(_ctx.userId, _ctx.orgId)
  } catch (err) {
    throw scrubSecrets(err)
  }
}, 60_000)
