// db.ts — typed Supabase helper that bypasses strict update type errors
// Use this instead of createClient() when you need to write to the DB
// Import: import { db } from '@/lib/db'
// Usage:  await db.from('projects').update({ blocker: 'text' }).eq('id', pid)

import { createClient } from '@/lib/supabase/client'

// Untyped Supabase client for writes to tables not in the generated Database type.
// Returns untyped client so .from()/.rpc() accept any table/column without cast errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function db(): any {
  return createClient()
}

// For reads where you want full type safety, use createClient() directly
export { createClient }
