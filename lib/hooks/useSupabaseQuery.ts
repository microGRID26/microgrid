'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeSubscription } from './useRealtimeSubscription'
import type { Database } from '@/types/database'

type TableName = keyof Database['public']['Tables']
type RowType<T extends TableName> = Database['public']['Tables'][T]['Row']

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

interface EqFilter { eq: string | number | boolean }
interface NeqFilter { neq: string | number | boolean }
interface InFilter { in: (string | number)[] }
interface NotInFilter { not_in: (string | number)[] }
interface LikeFilter { ilike: string }
interface IsNullFilter { is: null }
interface IsNotNullFilter { isNot: null }
interface GtFilter { gt: string | number }
interface LtFilter { lt: string | number }
interface GteFilter { gte: string | number }
interface LteFilter { lte: string | number }

type FilterValue =
  | EqFilter
  | NeqFilter
  | InFilter
  | NotInFilter
  | LikeFilter
  | IsNullFilter
  | IsNotNullFilter
  | GtFilter
  | LtFilter
  | GteFilter
  | LteFilter

type Filters = Record<string, FilterValue | string | number | boolean>

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface OrderConfig {
  column: string
  ascending?: boolean
}

interface UseSupabaseQueryOptions {
  /** Columns to select (default '*') */
  select?: string
  /** Filter conditions */
  filters?: Filters
  /** Raw .or() expression (e.g., 'name.ilike.%test%,id.ilike.%test%') */
  or?: string
  /** Max rows to return (default 2000) */
  limit?: number
  /** Page number (1-based) for pagination */
  page?: number
  /** Rows per page (default 100) */
  pageSize?: number
  /** Order by */
  order?: OrderConfig
  /** Subscribe to realtime changes and auto-refetch */
  subscribe?: boolean
  /** Realtime debounce in ms (default 300) */
  debounceMs?: number
  /** Whether the query is enabled (default true) */
  enabled?: boolean
}

interface UseSupabaseQueryResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  /** Total count when using pagination */
  totalCount: number | null
  /** Whether there are more pages */
  hasMore: boolean
  /** Go to next page (call with your state setter) */
  nextPage: () => void
  /** Go to previous page */
  prevPage: () => void
  /** Jump to a specific page (1-based) */
  setPage: (page: number) => void
  /** Current page number */
  currentPage: number
  /** Manually trigger a refetch */
  refresh: () => void
}

// ---------------------------------------------------------------------------
// Module-level cache (shared across hook instances, cleared on navigation)
// ---------------------------------------------------------------------------

interface CacheEntry<T = unknown> {
  data: T[]
  totalCount: number | null
  timestamp: number
}

const queryCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry>>()

/** Cache TTL in ms — data older than this is considered stale */
const CACHE_TTL = 30_000

function buildCacheKey(table: string, options: UseSupabaseQueryOptions): string {
  return table + '|' + JSON.stringify({
    select: options.select ?? '*',
    filters: options.filters,
    or: options.or,
    limit: options.limit,
    page: options.page,
    pageSize: options.pageSize,
    order: options.order,
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSupabaseQuery<T extends TableName>(
  table: T,
  options: UseSupabaseQueryOptions = {}
): UseSupabaseQueryResult<RowType<T>> {
  type Row = RowType<T>

  const {
    select = '*',
    filters,
    or: orExpr,
    limit = 2000,
    page: initialPage,
    pageSize = 100,
    order,
    subscribe = false,
    debounceMs = 300,
    enabled = true,
  } = options

  const [data, setData] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1)

  const isPaginated = initialPage !== undefined
  const mountedRef = useRef(true)
  const fetchIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Serialize options for dependency tracking
  const optionsKey = buildCacheKey(table, {
    ...options,
    page: isPaginated ? currentPage : undefined,
  })

  const fetchData = useCallback(async (background = false): Promise<void> => {
    if (!enabled) return

    const cacheKey = optionsKey
    const thisFetchId = ++fetchIdRef.current

    // Check cache — return immediately if fresh
    const cached = queryCache.get(cacheKey) as CacheEntry<Row> | undefined
    if (cached && !background) {
      const isFresh = Date.now() - cached.timestamp < CACHE_TTL
      if (isFresh) {
        setData(cached.data)
        setTotalCount(cached.totalCount)
        setLoading(false)
        return
      }
      // Stale — return cached data immediately, trigger background refetch
      setData(cached.data)
      setTotalCount(cached.totalCount)
      setLoading(false)
      setTimeout(() => fetchData(true), 0)
      return
    }

    // Deduplicate: if same query is already in-flight, wait for it
    // Don't overwrite the existing promise — reuse it
    const existing = inflight.get(cacheKey)
    if (existing) {
      try {
        const result = (await existing) as CacheEntry<Row>
        if (mountedRef.current && fetchIdRef.current === thisFetchId) {
          setData(result.data)
          setTotalCount(result.totalCount)
          setLoading(false)
          setError(null)
        }
      } catch (e) {
        if (mountedRef.current && fetchIdRef.current === thisFetchId) {
          setError(e instanceof Error ? e.message : 'Query failed')
          setLoading(false)
        }
      }
      return
    }

    if (!background) setLoading(true)

    const fetchPromise = (async (): Promise<CacheEntry<Row>> => {
      const supabase = createClient()

      // Build query — cast to dynamic query builder since we apply filters
      // with runtime field names. Same pattern as lib/db.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = isPaginated
        ? supabase.from(table).select(select, { count: 'exact' })
        : supabase.from(table).select(select)

      // Apply filters
      if (filters) {
        for (const [field, value] of Object.entries(filters)) {
          if (value === null || value === undefined) continue

          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            // Shorthand: { pm_id: 'abc' } => eq
            query = query.eq(field, value)
          } else if ('eq' in value) {
            query = query.eq(field, value.eq)
          } else if ('neq' in value) {
            query = query.neq(field, value.neq)
          } else if ('in' in value) {
            query = query.in(field, value.in)
          } else if ('not_in' in value) {
            // Supabase PostgREST not_in: values are comma-separated in parens.
            // Strings are double-quoted; we escape backslashes, double-quotes, commas, and parens
            // to prevent injection via crafted filter values.
            const escapeNotInValue = (v: string): string =>
              v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/,/g, '\\,').replace(/[()]/g, '\\$&')
            const vals = value.not_in.map(v => typeof v === 'string' ? `"${escapeNotInValue(v)}"` : v).join(',')
            query = query.not(field, 'in', `(${vals})`)
          } else if ('ilike' in value) {
            query = query.ilike(field, value.ilike)
          } else if ('is' in value) {
            query = query.is(field, null)
          } else if ('isNot' in value) {
            query = query.not(field, 'is', null)
          } else if ('gt' in value) {
            query = query.gt(field, value.gt)
          } else if ('lt' in value) {
            query = query.lt(field, value.lt)
          } else if ('gte' in value) {
            query = query.gte(field, value.gte)
          } else if ('lte' in value) {
            query = query.lte(field, value.lte)
          }
        }
      }

      // Apply or expression
      if (orExpr) {
        query = query.or(orExpr)
      }

      // Apply order
      if (order) {
        query = query.order(order.column, { ascending: order.ascending ?? true })
      }

      // Apply pagination or limit
      if (isPaginated) {
        const from = (currentPage - 1) * pageSize
        const to = from + pageSize - 1
        query = query.range(from, to)
      } else {
        query = query.limit(limit)
      }

      const { data: rows, error: queryError, count } = await query

      if (queryError) throw new Error(queryError.message)

      const result: CacheEntry<Row> = {
        data: (rows ?? []) as Row[],
        totalCount: count,
        timestamp: Date.now(),
      }

      // Update cache
      queryCache.set(cacheKey, result as CacheEntry)

      return result
    })()

    inflight.set(cacheKey, fetchPromise as Promise<CacheEntry>)

    try {
      const result = await fetchPromise
      if (mountedRef.current && fetchIdRef.current === thisFetchId) {
        setData(result.data)
        setTotalCount(result.totalCount)
        setError(null)
        if (!background) setLoading(false)
      }
    } catch (e) {
      if (mountedRef.current && fetchIdRef.current === thisFetchId) {
        setError(e instanceof Error ? e.message : 'Query failed')
        if (!background) setLoading(false)
      }
    } finally {
      inflight.delete(cacheKey)
    }
  }, [optionsKey, enabled])

  // Initial fetch
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime: invalidate cache and refetch when changes arrive
  const handleRealtimeChange = useCallback(() => {
    // Invalidate all cache entries for this table
    for (const key of queryCache.keys()) {
      if (key.startsWith(table + '|')) {
        queryCache.delete(key)
      }
    }
    fetchData(true) // background refetch
  }, [table, fetchData])

  useRealtimeSubscription(table, {
    onChange: handleRealtimeChange,
    debounceMs,
    enabled: subscribe,
  })

  // Refresh function — clears cache and refetches
  const refresh = useCallback(() => {
    queryCache.delete(optionsKey)
    fetchData()
  }, [optionsKey, fetchData])

  // Pagination helpers
  const hasMore = isPaginated && totalCount !== null
    ? currentPage * pageSize < totalCount
    : false

  const nextPage = useCallback(() => {
    if (hasMore) setCurrentPage(p => p + 1)
  }, [hasMore])

  const prevPage = useCallback(() => {
    setCurrentPage(p => Math.max(1, p - 1))
  }, [])

  const setPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, page))
  }, [])

  return {
    data,
    loading,
    error,
    totalCount,
    hasMore,
    nextPage,
    prevPage,
    setPage,
    currentPage,
    refresh,
  }
}

/**
 * Clear the entire query cache. Useful when you know data has changed
 * via a mutation and want all queries to refetch fresh.
 */
export function clearQueryCache() {
  queryCache.clear()
}
