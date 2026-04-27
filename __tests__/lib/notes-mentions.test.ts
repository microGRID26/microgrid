import { describe, it, expect } from 'vitest'
import {
  handleOf, buildHandleIndex, parseMentions, resolvedMentionUserIds,
  type MentionableUser,
} from '@/lib/notes/mentions'

const users: MentionableUser[] = [
  { id: 'u_taylor',  name: 'Taylor Pratt',  email: 'tpratt@gomicrogridenergy.com' },
  { id: 'u_greg',    name: 'Greg Kelsch',   email: 'greg@gomicrogridenergy.com' },
  // Two users with the literal same full name — should collide on handle 'greg.kelsch'.
  { id: 'u_greg2',   name: 'Greg Kelsch',   email: 'greg@trismartsolar.com' },
  { id: 'u_paul',    name: 'Paul C',        email: 'paul@energydevelopmentgroup.com' },
  { id: 'u_anne',    name: 'Anne K',        email: 'anne+work@bloom.com' },
]

describe('handleOf', () => {
  it('uses slugified full name when present', () => {
    expect(handleOf({ id: '1', name: 'Greg Kelsch', email: 'g@x.com' })).toBe('greg.kelsch')
    expect(handleOf({ id: '2', name: 'Taylor Pratt', email: 't@x.com' })).toBe('taylor.pratt')
  })
  it('handles whitespace and punctuation in names', () => {
    expect(handleOf({ id: '1', name: "  Greg   Kelsch  ", email: 'g@x.com' })).toBe('greg.kelsch')
    expect(handleOf({ id: '2', name: "Anne O'Reilly", email: 'a@x.com' })).toBe('anne.oreilly')
  })
  it('falls back to email local-part when name is empty', () => {
    expect(handleOf({ id: '1', name: null, email: 'taylor.pratt@x.com' })).toBe('taylor.pratt')
    expect(handleOf({ id: '2', name: '', email: 'anne+work@bloom.com' })).toBe('anne')
  })
  it('disambiguates two users with the same first name when names differ', () => {
    const a = handleOf({ id: '1', name: 'Greg Kelsch', email: 'greg@a.com' })
    const b = handleOf({ id: '2', name: 'Greg Other',  email: 'greg@b.com' })
    expect(a).not.toBe(b) // both Gregs but different last names → no collision
  })
})

describe('buildHandleIndex', () => {
  it('groups users by shared full-name handle', () => {
    const idx = buildHandleIndex(users)
    expect(idx.get('greg.kelsch')?.length).toBe(2) // two literal Greg Kelschs
    expect(idx.get('taylor.pratt')?.length).toBe(1)
  })
})

describe('parseMentions', () => {
  it('resolves unique handles to their user', () => {
    const r = parseMentions('hey @taylor.pratt and @paul.c', users)
    expect(r).toEqual([
      expect.objectContaining({ handle: 'taylor.pratt', userId: 'u_taylor' }),
      expect.objectContaining({ handle: 'paul.c',       userId: 'u_paul' }),
    ])
  })

  it('marks ambiguous handles as null when two users share a full name', () => {
    const r = parseMentions('ping @greg.kelsch', users)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ handle: 'greg.kelsch', userId: null, reason: 'ambiguous' })
    expect((r[0] as { candidates: MentionableUser[] }).candidates).toHaveLength(2)
  })

  it('marks unknown handles with reason=unknown', () => {
    const r = parseMentions('ping @ghost.user', users)
    expect(r[0]).toMatchObject({ handle: 'ghost.user', userId: null, reason: 'unknown' })
  })

  it('dedupes a handle mentioned multiple times', () => {
    const r = parseMentions('@taylor.pratt please cc @taylor.pratt', users)
    expect(r).toHaveLength(1)
  })

  it('does not match an @ embedded inside an email address', () => {
    const r = parseMentions('forward to tpratt@gomicrogridenergy.com', users)
    expect(r).toHaveLength(0)
  })

  it('case-insensitive handle resolution', () => {
    const r = parseMentions('@TAYLOR.PRATT please review', users)
    expect(r[0]).toMatchObject({ handle: 'taylor.pratt', userId: 'u_taylor' })
  })
})

describe('resolvedMentionUserIds', () => {
  it('returns only resolved IDs, dropping ambiguous + unknown', () => {
    const ids = resolvedMentionUserIds('@taylor.pratt @greg.kelsch @ghost.x @paul.c', users)
    expect(new Set(ids)).toEqual(new Set(['u_taylor', 'u_paul']))
  })
})
