import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Real-client helpers for the integration test suite. Imports
// @supabase/supabase-js DIRECTLY rather than @/lib/supabase/* so the
// vitest.setup.ts global mock (which catches only the alias paths)
// doesn't fire. This file is reached only when vitest is launched with
// vitest.integration.config.ts (which does not include vitest.setup.ts).
//
// Cloned in shape from evals/helpers/clients.ts. Separated so the eval
// harness and integration harness can evolve independently.

function readEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !anon || !service) {
    throw new Error(
      '__tests__/integration/clients.ts: missing Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). Read from .env.local in setup.ts.',
    )
  }
  return { url, anon, service }
}

let _service: SupabaseClient | null = null

export function serviceClient(): SupabaseClient {
  if (_service) return _service
  const { url, service } = readEnv()
  _service = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _service
}

// Sign in as a non-admin user. Returns a client whose every request
// carries the user's JWT — PostgREST sees an authenticated end-user role,
// the BEFORE triggers from mig 223/224 see session_user='authenticator'
// (NOT in the DB-admin allowlist), and the user has only whatever
// org_memberships were granted in setup.
export async function userClient(email: string, password: string): Promise<SupabaseClient> {
  const { url, anon } = readEnv()
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`userClient sign-in failed for ${email}: ${error.message}`)
  }
  return client
}

export function supabaseUrl(): string {
  return readEnv().url
}
