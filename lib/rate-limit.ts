// lib/rate-limit.ts — Shared rate limiting utility
// Uses Upstash Redis when configured (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN),
// falls back to in-memory Map for local dev or when env vars are missing.

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ── Upstash Redis client (singleton) ────────────────────────────────────────

let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

// ── In-memory fallback ──────────────────────────────────────────────────────

const memoryMap = new Map<string, { count: number; resetAt: number }>()

function checkMemoryLimit(key: string, windowMs: number, max: number): { success: boolean } {
  const now = Date.now()
  const entry = memoryMap.get(key)
  if (!entry || now > entry.resetAt) {
    memoryMap.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true }
  }
  if (entry.count >= max) return { success: false }
  entry.count++
  return { success: true }
}

// ── Rate limiter cache (one per config) ─────────────────────────────────────

const limiters = new Map<string, Ratelimit>()

function getUpstashLimiter(prefix: string, windowMs: number, max: number): Ratelimit | null {
  const r = getRedis()
  if (!r) return null

  const key = `${prefix}:${windowMs}:${max}`
  if (limiters.has(key)) return limiters.get(key)!

  // Convert windowMs to Upstash duration string
  const windowSec = Math.ceil(windowMs / 1000)
  const duration = windowSec >= 86400 ? `${Math.ceil(windowSec / 86400)} d`
    : windowSec >= 3600 ? `${Math.ceil(windowSec / 3600)} h`
    : `${windowSec} s`

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(max, duration as Parameters<typeof Ratelimit.slidingWindow>[1]),
    prefix: `rl:${prefix}`,
  })
  limiters.set(key, limiter)
  return limiter
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check rate limit for a given key.
 * Uses Upstash Redis if configured, otherwise falls back to in-memory.
 *
 * @param key - Unique identifier (e.g., 'enroll', `edge:${ip}`, `chat:${userId}`)
 * @param opts.windowMs - Time window in milliseconds (default: 60_000)
 * @param opts.max - Maximum requests per window (default: 10)
 * @returns { success: boolean }
 */
export async function rateLimit(
  key: string,
  opts: { windowMs?: number; max?: number; prefix?: string } = {}
): Promise<{ success: boolean }> {
  const windowMs = opts.windowMs ?? 60_000
  const max = opts.max ?? 10
  const prefix = opts.prefix ?? 'api'

  const upstash = getUpstashLimiter(prefix, windowMs, max)
  if (upstash) {
    const result = await upstash.limit(key)
    return { success: result.success }
  }

  // Fallback: in-memory
  return checkMemoryLimit(`${prefix}:${key}`, windowMs, max)
}
