// lib/api/saved-queries.ts — Saved queries for Atlas reports
import { db } from '@/lib/db'

export interface SavedQuery {
  id: string
  name: string
  description: string | null
  query_text: string
  created_by: string
  created_by_name: string | null
  shared: boolean
  run_count: number
  last_run_at: string | null
  created_at: string
}

/** Load saved queries visible to the current user */
export async function loadSavedQueries(userId: string): Promise<SavedQuery[]> {
  const { data, error } = await db()
    .from('saved_queries')
    .select('*')
    .or(`created_by.eq.${userId},shared.eq.true`)
    .order('last_run_at', { ascending: false })
    .limit(100)

  if (error) { console.error('[loadSavedQueries]', error.message); return [] }
  return (data ?? []) as SavedQuery[]
}

/** Save a new query */
export async function saveQuery(query: {
  name: string
  description?: string | null
  query_text: string
  created_by: string
  created_by_name?: string | null
  shared?: boolean
}): Promise<SavedQuery | null> {
  const { data, error } = await db()
    .from('saved_queries')
    .insert(query)
    .select()
    .single()

  if (error) { console.error('[saveQuery]', error.message); return null }
  return data as SavedQuery
}

/** Update a saved query (name, description, shared) */
export async function updateSavedQuery(
  id: string,
  updates: Partial<Pick<SavedQuery, 'name' | 'description' | 'shared'>>,
): Promise<boolean> {
  const { error } = await db()
    .from('saved_queries')
    .update(updates)
    .eq('id', id)

  if (error) { console.error('[updateSavedQuery]', error.message); return false }
  return true
}

/** Delete a saved query */
export async function deleteSavedQuery(id: string): Promise<boolean> {
  const { error } = await db()
    .from('saved_queries')
    .delete()
    .eq('id', id)

  if (error) { console.error('[deleteSavedQuery]', error.message); return false }
  return true
}

/** Increment run count and update last_run_at */
export async function recordQueryRun(id: string): Promise<boolean> {
  // Load current count first
  const { data: current } = await db()
    .from('saved_queries')
    .select('run_count')
    .eq('id', id)
    .single()

  const count = ((current as { run_count: number } | null)?.run_count ?? 0) + 1

  const { error } = await db()
    .from('saved_queries')
    .update({
      run_count: count,
      last_run_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) { console.error('[recordQueryRun]', error.message); return false }
  return true
}
