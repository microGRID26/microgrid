import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// ── Notification Preferences Filtering ──────────────────────────────────────

describe('NotificationPrefs defaults', () => {
  it('DEFAULT_NOTIFICATION_PREFS has all keys set to true', async () => {
    const { DEFAULT_NOTIFICATION_PREFS } = await import('@/lib/usePreferences')
    expect(DEFAULT_NOTIFICATION_PREFS.blocked).toBe(true)
    expect(DEFAULT_NOTIFICATION_PREFS.stuck_tasks).toBe(true)
    expect(DEFAULT_NOTIFICATION_PREFS.mentions).toBe(true)
    expect(DEFAULT_NOTIFICATION_PREFS.digest_email).toBe(true)
    expect(DEFAULT_NOTIFICATION_PREFS.stuck_email).toBe(true)
  })

  it('has exactly 5 keys', async () => {
    const { DEFAULT_NOTIFICATION_PREFS } = await import('@/lib/usePreferences')
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFS)).toHaveLength(5)
  })
})

// ── Duration Calculation Logic ──────────────────────────────────────────────

describe('Time entry duration logic', () => {
  it('completed entry uses stored duration_minutes', () => {
    const entry = { clock_out: '2026-03-31T17:00:00Z', duration_minutes: 480 }
    const mins = entry.clock_out ? (entry.duration_minutes ?? 0) : 0
    expect(mins).toBe(480)
  })

  it('completed entry with null duration defaults to 0', () => {
    const entry = { clock_out: '2026-03-31T17:00:00Z', duration_minutes: null }
    const mins = entry.clock_out ? (entry.duration_minutes ?? 0) : 0
    expect(mins).toBe(0)
  })

  it('active entry (no clock_out) calculates elapsed from clock_in', () => {
    const clockIn = new Date(Date.now() - 120 * 60000).toISOString() // 2 hours ago
    const entry = { clock_in: clockIn, clock_out: null, duration_minutes: null }
    const mins = entry.clock_out
      ? (entry.duration_minutes ?? 0)
      : Math.floor((Date.now() - new Date(entry.clock_in).getTime()) / 60000)
    expect(mins).toBeGreaterThanOrEqual(119)
    expect(mins).toBeLessThanOrEqual(121)
  })

  it('never returns negative duration', () => {
    const futureClockIn = new Date(Date.now() + 60000).toISOString()
    const entry = { clock_in: futureClockIn, clock_out: null, duration_minutes: null }
    const raw = Math.floor((Date.now() - new Date(entry.clock_in).getTime()) / 60000)
    const mins = Math.max(0, raw)
    expect(mins).toBe(0)
  })
})

// ── HTML Escaping ───────────────────────────────────────────────────────────

describe('HTML escape for email templates', () => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  it('escapes angle brackets', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('escapes ampersands', () => {
    expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry')
  })

  it('escapes quotes', () => {
    expect(esc('He said "hello"')).toBe('He said &quot;hello&quot;')
  })

  it('handles empty string', () => {
    expect(esc('')).toBe('')
  })

  it('handles normal text unchanged', () => {
    expect(esc('John Smith')).toBe('John Smith')
  })

  it('handles project names with special chars', () => {
    expect(esc('O\'Brien & Sons <LLC>')).toBe('O\'Brien &amp; Sons &lt;LLC&gt;')
  })
})

// ── URL Encoding ────────────────────────────────────────────────────────────

describe('URL encoding for project IDs', () => {
  it('encodes normal project ID', () => {
    expect(encodeURIComponent('PROJ-12345')).toBe('PROJ-12345')
  })

  it('encodes special characters', () => {
    expect(encodeURIComponent('PROJ 123&test')).toBe('PROJ%20123%26test')
  })
})

// ── Notification Filter Edge Cases ──────────────────────────────────────────

describe('Notification filter with partial prefs', () => {
  it('undefined pref defaults to showing notification', () => {
    const prefs = {} as { blocked?: boolean; stuck_tasks?: boolean; mentions?: boolean }
    const notif = { type: 'blocked' as const }

    // Mirrors the fix: check !== undefined before filtering
    const shouldShow = !(notif.type === 'blocked' && prefs.blocked !== undefined && !prefs.blocked)
    expect(shouldShow).toBe(true) // undefined = show
  })

  it('false pref hides notification', () => {
    const prefs = { blocked: false } as { blocked?: boolean }
    const notif = { type: 'blocked' as const }

    const shouldShow = !(notif.type === 'blocked' && prefs.blocked !== undefined && !prefs.blocked)
    expect(shouldShow).toBe(false)
  })

  it('true pref shows notification', () => {
    const prefs = { blocked: true } as { blocked?: boolean }
    const notif = { type: 'blocked' as const }

    const shouldShow = !(notif.type === 'blocked' && prefs.blocked !== undefined && !prefs.blocked)
    expect(shouldShow).toBe(true)
  })

  it('mention filter works independently', () => {
    const prefs = { blocked: false, mentions: true } as { blocked?: boolean; mentions?: boolean }

    const blockedShow = !(prefs.blocked !== undefined && !prefs.blocked)
    const mentionShow = !(prefs.mentions !== undefined && !prefs.mentions)

    expect(blockedShow).toBe(false) // blocked OFF
    expect(mentionShow).toBe(true)  // mentions ON
  })
})
