/**
 * @-mention parser. Pure module, server- and client-safe. Used by:
 *  - components/funding/NotesCell.tsx (UI display only — pretty-print live text)
 *  - app/api/notifications/note-mention/route.ts (authoritative parse on save)
 *
 * Handle convention: full name, lowercased, with whitespace collapsed to a dot
 * and non-alphanumeric chars dropped. "Greg Kelsch" -> "greg.kelsch". This avoids
 * the multi-Greg collision that email-local-part handles produce. When two active
 * users still share a handle (rare — true name collision), resolution is
 * deliberately AMBIGUOUS so neither is notified.
 *
 * Falls back to email local-part if a user's name is empty.
 */

export interface MentionableUser {
  id: string
  name: string | null
  email: string
}

export type MentionResolution =
  | { handle: string; userId: string; user: MentionableUser }
  | { handle: string; userId: null; reason: 'unknown' | 'ambiguous'; candidates: MentionableUser[] }

const MENTION_REGEX = /(?:^|\s)@([a-zA-Z0-9._+\-]+)/g

/**
 * Compute the handle for a user. Prefers full name; falls back to email
 * local-part (Gmail +tag stripped) for users without a name.
 */
export function handleOf(user: MentionableUser): string {
  const name = (user.name ?? '').trim()
  if (name) {
    return name
      .toLowerCase()
      .replace(/\s+/g, '.')        // "Greg Kelsch" -> "greg.kelsch"
      .replace(/[^a-z0-9.\-]/g, '') // drop apostrophes, accents, other punctuation
      .replace(/\.+/g, '.')         // collapse runs of dots
      .replace(/^\.+|\.+$/g, '')    // trim leading/trailing dots
  }
  const local = (user.email.split('@')[0] ?? '').toLowerCase()
  const plus = local.indexOf('+')
  return (plus >= 0 ? local.slice(0, plus) : local).replace(/[^a-z0-9.\-]/g, '')
}

/** Build a handle index. Multiple users can share a handle — the entry then has > 1 match. */
export function buildHandleIndex(users: MentionableUser[]): Map<string, MentionableUser[]> {
  const map = new Map<string, MentionableUser[]>()
  for (const u of users) {
    if (!u.email) continue
    const h = handleOf(u)
    if (!h) continue
    const arr = map.get(h)
    if (arr) arr.push(u)
    else map.set(h, [u])
  }
  return map
}

/**
 * Extract resolved mentions from `text`. Each unique handle yields one entry.
 * Ambiguous handles (>1 active user share the local-part) are returned with
 * userId=null + reason='ambiguous' so callers can warn or decline to notify.
 */
export function parseMentions(text: string, users: MentionableUser[]): MentionResolution[] {
  if (!text) return []
  const idx = buildHandleIndex(users)
  const seen = new Set<string>()
  const out: MentionResolution[] = []
  for (const m of text.matchAll(MENTION_REGEX)) {
    const handle = m[1].toLowerCase()
    if (seen.has(handle)) continue
    seen.add(handle)
    const matches = idx.get(handle) ?? []
    if (matches.length === 1) {
      out.push({ handle, userId: matches[0].id, user: matches[0] })
    } else if (matches.length > 1) {
      out.push({ handle, userId: null, reason: 'ambiguous', candidates: matches })
    } else {
      out.push({ handle, userId: null, reason: 'unknown', candidates: [] })
    }
  }
  return out
}

/** Convenience: just the resolved user IDs (drops unknown + ambiguous). */
export function resolvedMentionUserIds(text: string, users: MentionableUser[]): string[] {
  return parseMentions(text, users)
    .filter((m): m is MentionResolution & { userId: string } => m.userId !== null)
    .map(m => m.userId)
}
