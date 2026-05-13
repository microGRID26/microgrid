// Check whether an agent's `enabled` flag is on before the cron actually runs.
// Mirrors atlas-hq/lib/fleet/enabled.ts. The MG project IS the source of truth
// for atlas_agents — this just calls the existing atlas_is_agent_enabled RPC
// using MG's own service-role key.
//
// Design:
// - 60s in-memory cache so repeated calls within a warm Vercel instance
//   don't hit Supabase every time.
// - Fail-open: if env is missing or the RPC errors, return `true`. A
//   Supabase hiccup shouldn't silently take a cron offline.
// - Called at the top of email cron handlers (#1029, 2026-05-13). If false,
//   the handler short-circuits with a "skipped" response and does NOT
//   self-report a run (avoids spamming atlas_agent_runs with skip rows).

interface CacheEntry {
  enabled: boolean
  fetchedAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()

export function _clearEnabledCache() {
  cache.clear()
}

async function fetchEnabled(slug: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('[fleet/enabled] MG Supabase env not set — fail-open for', slug)
    return true
  }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/atlas_is_agent_enabled`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_slug: slug }),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn('[fleet/enabled] RPC', res.status, 'for', slug, '— fail-open')
      return true
    }
    const data = await res.json()
    if (typeof data === 'boolean') return data
    console.warn('[fleet/enabled] unexpected response shape for', slug, '— fail-open')
    return true
  } catch (err) {
    console.warn('[fleet/enabled] fetch threw for', slug, err, '— fail-open')
    return true
  }
}

export async function isAgentEnabled(slug: string): Promise<boolean> {
  const now = Date.now()
  const cached = cache.get(slug)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.enabled
  }
  const fresh = await fetchEnabled(slug)
  cache.set(slug, { enabled: fresh, fetchedAt: now })
  return fresh
}
