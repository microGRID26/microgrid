// lib/partner-api/supabase-admin.ts — Service-role Supabase client for the partner API.
//
// Partners never carry a Supabase session — they authenticate with a bearer
// via our withPartnerAuth middleware. To read/write DB rows on their behalf,
// this module exposes a service-role client. All scope + org enforcement lives
// in app code, NOT in RLS (which is deliberately configured for platform-only
// access on partner_* tables).

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY?.trim()

let cached: SupabaseClient | null = null

/** Returns a singleton service-role client. Throws if env vars are missing. */
export function partnerApiAdmin(): SupabaseClient {
  if (cached) return cached
  if (!SUPABASE_URL) throw new Error('[partner-api] NEXT_PUBLIC_SUPABASE_URL not configured')
  if (!SUPABASE_SECRET) throw new Error('[partner-api] SUPABASE_SECRET_KEY not configured')
  cached = createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
