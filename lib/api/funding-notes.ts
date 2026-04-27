import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'

export interface FundingNote {
  id: string
  project_id: string
  milestone: 'm1' | 'm2' | 'm3'
  author_id: string
  /** Resolved on read via join — never client-supplied (R1#H1 on migration 187). */
  author: string
  body: string
  created_at: string
  deleted_at: string | null
}

type AuthorRef = { name: string | null; email: string | null } | null

interface RawNoteRow {
  id: string
  project_id: string
  milestone: 'm1' | 'm2' | 'm3'
  author_id: string
  body: string
  created_at: string
  deleted_at: string | null
  // PostgREST sometimes returns embedded resources as arrays depending on FK
  // inference. Normalize at the call site via `coerceAuthor`.
  users: AuthorRef | AuthorRef[]
}

function coerceAuthor(u: AuthorRef | AuthorRef[]): AuthorRef {
  if (Array.isArray(u)) return u[0] ?? null
  return u
}

function pickAuthor(u: AuthorRef | AuthorRef[]): string {
  const a = coerceAuthor(u)
  if (!a) return 'Unknown'
  return a.name ?? a.email ?? 'Unknown'
}

const PG_ERROR_FRIENDLY: Record<string, string> = {
  '23514': 'Comment failed validation (length must be 1–4000 chars)',
  '23502': 'Missing required field',
  '23503': 'Project no longer exists',
  '42501': 'You don’t have permission to do that',
}

function friendlyDbError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return 'Couldn’t save comment'
  const mapped = err.code ? PG_ERROR_FRIENDLY[err.code] : null
  return mapped ?? 'Couldn’t save comment — try again'
}

export async function loadFundingNotes(projectId: string): Promise<FundingNote[]> {
  const { data, error } = await db().from('funding_notes')
    .select('id, project_id, milestone, author_id, body, created_at, deleted_at, users:author_id (name, email)')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) {
    console.error('[loadFundingNotes]', error.message)
    return []
  }
  const rows = (data ?? []) as unknown as RawNoteRow[]
  return rows.map(r => ({
    id: r.id,
    project_id: r.project_id,
    milestone: r.milestone,
    author_id: r.author_id,
    author: pickAuthor(r.users),
    body: r.body,
    created_at: r.created_at,
    deleted_at: r.deleted_at,
  }))
}

export interface FundingNoteSummary {
  project_id: string
  total: number
  last_author: string | null
  last_at: string | null
}

/**
 * Cheap row-count + last-author summary for the funding table column. Pulls all
 * non-deleted rows and groups client-side. RLS limits visibility to finance+.
 *
 * Future scaling note: at >5K notes total this hits the limit. Move to a Postgres
 * RPC (`group by project_id`) when the count crosses that threshold.
 */
export async function loadFundingNoteSummaries(): Promise<Map<string, FundingNoteSummary>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('funding_notes')
    .select('project_id, created_at, users:author_id (name, email)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) {
    console.error('[loadFundingNoteSummaries]', error.message)
    return new Map()
  }
  const rows = (data ?? []) as unknown as { project_id: string; created_at: string; users: AuthorRef | AuthorRef[] }[]
  const out = new Map<string, FundingNoteSummary>()
  for (const row of rows) {
    const ex = out.get(row.project_id)
    if (!ex) {
      out.set(row.project_id, {
        project_id: row.project_id,
        total: 1,
        last_author: pickAuthor(row.users),
        last_at: row.created_at,
      })
    } else {
      ex.total += 1
    }
  }
  return out
}

export type AddNoteResult =
  | { ok: true; note: FundingNote }
  | { ok: false; error: string }

export async function addFundingNote(
  projectId: string,
  milestone: 'm1' | 'm2' | 'm3',
  authorId: string,
  body: string,
): Promise<AddNoteResult> {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'Comment is empty' }
  if (trimmed.length > 4000) return { ok: false, error: 'Comment too long (max 4000 chars)' }
  if (!authorId) return { ok: false, error: 'Cannot attribute comment — please refresh and sign in again' }
  const { data, error } = await db().from('funding_notes')
    .insert({ project_id: projectId, milestone, author_id: authorId, body: trimmed })
    .select('id, project_id, milestone, author_id, body, created_at, deleted_at, users:author_id (name, email)')
    .single()
  if (error || !data) {
    console.error('[addFundingNote]', error?.code, error?.message)
    return { ok: false, error: friendlyDbError(error) }
  }
  const r = data as unknown as RawNoteRow
  return {
    ok: true,
    note: {
      id: r.id,
      project_id: r.project_id,
      milestone: r.milestone,
      author_id: r.author_id,
      author: pickAuthor(r.users),
      body: r.body,
      created_at: r.created_at,
      deleted_at: r.deleted_at,
    },
  }
}

export type SoftDeleteResult = { ok: true } | { ok: false; error: string }

export async function softDeleteFundingNote(noteId: string): Promise<SoftDeleteResult> {
  const { error } = await db().from('funding_notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', noteId)
  if (error) {
    console.error('[softDeleteFundingNote]', error.code, error.message)
    return { ok: false, error: friendlyDbError(error) }
  }
  return { ok: true }
}
