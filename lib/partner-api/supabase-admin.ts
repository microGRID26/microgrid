// lib/partner-api/supabase-admin.ts — Service-role Supabase client for the partner API.
//
// Partners never carry a Supabase session — they authenticate with a bearer
// via our withPartnerAuth middleware. To read/write DB rows on their behalf,
// this module exposes a service-role client. All scope + org enforcement lives
// in app code, NOT in RLS (which is deliberately configured for platform-only
// access on partner_* tables).

import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()

let cached: SupabaseClient | null = null

/** Returns a singleton service-role client. Throws if env vars are missing. */
export function partnerApiAdmin(): SupabaseClient {
  if (cached) return cached
  if (!SUPABASE_URL) throw new Error('[partner-api] NEXT_PUBLIC_SUPABASE_URL not configured')
  if (!SUPABASE_SECRET) throw new Error('[partner-api] SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) not configured')
  cached = createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

// ── Typed RPC wrappers for partner_event_outbox ──────────────────────────────
//
// Generated Supabase Database types don't include partner_event_outbox_* RPCs
// (the codegen would lift them, but we haven't gen'd types into this repo yet).
// Wrapping the untyped `.rpc()` calls here keeps the `as any` cast contained
// to two functions and gives fanout.ts a typed surface (#575 L6).

export interface OutboxClaimedRow {
  id: string
  event_type: string
  event_id: string
  payload: Record<string, unknown>
  emitted_at: string
  claimed_at: string
}

/** Call partner_event_outbox_claim_batch — see migration 241. */
export async function claimOutboxBatch(
  sb: SupabaseClient,
  args: { limit: number; nowMs: number },
): Promise<{ data: OutboxClaimedRow[] | null; error: PostgrestError | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc('partner_event_outbox_claim_batch', {
    p_limit: args.limit,
    p_now: new Date(args.nowMs).toISOString(),
  })
  return { data: data as OutboxClaimedRow[] | null, error: error as PostgrestError | null }
}

/** Call partner_event_outbox_record_attempt — see migrations 241 + 302.
 *
 *  expectedClaimedAt MUST be a parseable ISO timestamp string — it's the
 *  #574 cap-race guard's pivot. An empty/garbage value would silently bypass
 *  the guard (the SQL function defaults to NULL on unparseable input via the
 *  postgres timestamp cast). Reject at the wrapper to keep that posture
 *  centralized (#575 audit M1). */
export async function recordOutboxAttempt(
  sb: SupabaseClient,
  args: {
    id: string
    allOk: boolean
    expectedClaimedAt: string
    maxAttempts: number
    nowMs: number
  },
): Promise<{ data: boolean | null; error: PostgrestError | null }> {
  if (!args.expectedClaimedAt || Number.isNaN(Date.parse(args.expectedClaimedAt))) {
    throw new Error(
      '[partner-api] recordOutboxAttempt expectedClaimedAt must be a parseable ISO timestamp; ' +
      'passing empty/garbage would bypass the cap-race guard (#574).',
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc('partner_event_outbox_record_attempt', {
    p_id: args.id,
    p_all_ok: args.allOk,
    p_expected_claimed_at: args.expectedClaimedAt,
    p_max_attempts: args.maxAttempts,
    p_now: new Date(args.nowMs).toISOString(),
  })
  return { data: data as boolean | null, error: error as PostgrestError | null }
}
