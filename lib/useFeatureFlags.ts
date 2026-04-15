'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeatureFlag {
  id: string
  flag_key: string
  label: string
  description: string | null
  enabled: boolean
  rollout_percentage: number
  allowed_roles: string[] | null
  allowed_org_ids: string[] | null
  created_at: string
  updated_at: string
}

// ── In-memory cache ──────────────────────────────────────────────────────────

let flagsCache: FeatureFlag[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let inflight: Promise<FeatureFlag[]> | null = null

function isCacheValid(): boolean {
  return flagsCache !== null && Date.now() - cacheTimestamp < CACHE_TTL
}

async function loadFlags(): Promise<FeatureFlag[]> {
  if (isCacheValid()) return flagsCache!

  // Dedup in-flight requests
  if (inflight) return inflight

  inflight = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('label') as { data: FeatureFlag[] | null; error: unknown }

    if (error) {
      console.error('Failed to load feature flags:', error)
      return flagsCache ?? []
    }

    flagsCache = data ?? []
    cacheTimestamp = Date.now()
    inflight = null
    return flagsCache
  })()

  return inflight
}

/** Invalidate the flags cache (call after admin mutations) */
export function clearFlagsCache(): void {
  flagsCache = null
  cacheTimestamp = 0
  inflight = null
}

// ── Rollout hash ─────────────────────────────────────────────────────────────

/** Deterministic hash of userId + flagKey to a 0-99 bucket for gradual rollout */
function rolloutBucket(userId: string, flagKey: string): number {
  const str = `${userId}:${flagKey}`
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 100
}

// ── Pure function (server-side compatible) ───────────────────────────────────

/** Check if a flag is enabled for a given user — pure function, no hooks */
export function isFeatureEnabled(
  flags: FeatureFlag[],
  flagKey: string,
  userId?: string,
  userRole?: string,
): boolean {
  const flag = flags.find(f => f.flag_key === flagKey)
  if (!flag) return false
  if (!flag.enabled) return false

  // Role check
  if (flag.allowed_roles && flag.allowed_roles.length > 0) {
    if (!userRole || !flag.allowed_roles.includes(userRole)) return false
  }

  // Rollout percentage check
  if (flag.rollout_percentage < 100) {
    if (!userId) return false
    if (rolloutBucket(userId, flagKey) >= flag.rollout_percentage) return false
  }

  return true
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Returns all feature flags with loading state */
export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>(flagsCache ?? [])
  const [loading, setLoading] = useState(!isCacheValid())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    loadFlags().then(data => {
      if (mountedRef.current) {
        setFlags(data)
        setLoading(false)
      }
    })

    // Refresh every 5 minutes
    const interval = setInterval(() => {
      clearFlagsCache()
      loadFlags().then(data => {
        if (mountedRef.current) setFlags(data)
      })
    }, CACHE_TTL)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return { flags, loading }
}

/** Check a single feature flag for the current user */
export function useFeatureFlag(flagKey: string): { enabled: boolean; loading: boolean } {
  const { flags, loading: flagsLoading } = useFeatureFlags()
  const { user, loading: userLoading } = useCurrentUser()

  const loading = flagsLoading || userLoading

  const enabled = isFeatureEnabled(
    flags,
    flagKey,
    user?.id,
    user?.role,
  )

  return { enabled, loading }
}
