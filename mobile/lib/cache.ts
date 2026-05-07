// Offline cache using SecureStore — instant app launch with stale-while-revalidate
// Data is cached locally and served immediately, then refreshed in background.
// Uses SecureStore (works in Expo Go) instead of MMKV (requires dev build).

import * as SecureStore from 'expo-secure-store'

const CACHE_PREFIX = 'cache_'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface CacheEntry<T> {
  data: T
  timestamp: number
}

// Single source of truth for all cache keys. setCache/getCache are typed
// against this list so adding a new key without registering it is a compile
// error — preventing the sign-out leak class of bug.
const KNOWN_CACHE_KEYS = [
  'account', 'project', 'timeline', 'schedule', 'documents', 'taskStates',
  'billingStatements', 'paymentMethods', 'paymentHistory',
  'activity',
] as const

type CacheKey = typeof KNOWN_CACHE_KEYS[number]

/**
 * Get cached data. Returns null if no cache or expired beyond TTL (6h).
 */
export function getCache<T>(key: CacheKey): T | null {
  const entry = memCache[CACHE_PREFIX + key]
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    delete memCache[CACHE_PREFIX + key]
    return null
  }
  return entry.data
}

/**
 * Save data to cache (in-memory + persistent).
 */
export function setCache<T>(key: CacheKey, data: T): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() }
  memCache[CACHE_PREFIX + key] = entry
  // Persist async (fire-and-forget)
  SecureStore.setItemAsync(CACHE_PREFIX + key, JSON.stringify(entry)).catch(() => {})
}

/**
 * Load persistent cache into memory on app start.
 */
export async function loadPersistentCache(): Promise<void> {
  for (const key of KNOWN_CACHE_KEYS) {
    try {
      const raw = await SecureStore.getItemAsync(CACHE_PREFIX + key)
      if (raw) {
        const entry = JSON.parse(raw)
        if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
          memCache[CACHE_PREFIX + key] = entry
        }
      }
    } catch {}
  }
}

// In-memory cache for synchronous access
const memCache: Record<string, CacheEntry<any>> = {}

/**
 * Clear all cached data (in-memory + persistent).
 * Call on sign-out and account deletion to prevent data leaking to next user.
 */
export function clearCache(): void {
  const keys = Object.keys(memCache)
  keys.forEach(k => delete memCache[k])
  // Also clear persistent SecureStore entries — every key ever written.
  for (const key of KNOWN_CACHE_KEYS) {
    SecureStore.deleteItemAsync(CACHE_PREFIX + key).catch(() => {})
  }
}

