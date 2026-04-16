// __tests__/lib/partner-api-scopes.test.ts — Scope enforcement tests.

import { describe, it, expect } from 'vitest'
import {
  SCOPES,
  SCOPE_PRESETS,
  isValidScope,
  hasScope,
  requireScopes,
} from '@/lib/partner-api/scopes'
import { ApiError } from '@/lib/partner-api/errors'

describe('scope constants', () => {
  it('SCOPES contains expected core scopes', () => {
    expect(SCOPES).toContain('engineering:assignments:read')
    expect(SCOPES).toContain('engineering:assignments:write')
    expect(SCOPES).toContain('leads:create')
    expect(SCOPES).toContain('webhooks:manage')
  })

  it('no scope is declared twice', () => {
    const set = new Set(SCOPES)
    expect(set.size).toBe(SCOPES.length)
  })

  it('every preset scope is declared in SCOPES', () => {
    for (const [label, preset] of Object.entries(SCOPE_PRESETS)) {
      for (const s of preset) {
        expect(isValidScope(s), `preset "${label}" references unknown scope ${s}`).toBe(true)
      }
    }
  })
})

describe('isValidScope', () => {
  it('returns true for declared scopes', () => {
    expect(isValidScope('engineering:assignments:read')).toBe(true)
  })
  it('returns false for made-up scopes', () => {
    expect(isValidScope('admin:root:everything')).toBe(false)
  })
})

describe('hasScope', () => {
  it('returns true when the granted list contains the scope', () => {
    expect(hasScope(['projects:read', 'leads:read'], 'leads:read')).toBe(true)
  })
  it('returns false when scope is missing', () => {
    expect(hasScope(['projects:read'], 'leads:read')).toBe(false)
  })
})

describe('requireScopes', () => {
  it('does not throw when all required scopes are granted', () => {
    expect(() => requireScopes(
      ['engineering:assignments:read', 'engineering:assignments:write'],
      ['engineering:assignments:read'],
    )).not.toThrow()
  })

  it('throws forbidden when a required scope is missing', () => {
    expect(() => requireScopes(
      ['projects:read'],
      ['engineering:assignments:read'],
    )).toThrowError(ApiError)
    try {
      requireScopes(['projects:read'], ['engineering:assignments:read'])
    } catch (e) {
      expect((e as ApiError).code).toBe('forbidden')
      expect((e as ApiError).status).toBe(403)
      expect((e as ApiError).details?.missing).toEqual(['engineering:assignments:read'])
    }
  })

  it('accepts empty required list (auth-only endpoints)', () => {
    expect(() => requireScopes(['anything:read'], [])).not.toThrow()
  })

  it('reports all missing scopes, not just the first', () => {
    try {
      requireScopes([], ['projects:read', 'leads:read'])
    } catch (e) {
      expect((e as ApiError).details?.missing).toEqual(['projects:read', 'leads:read'])
    }
  })
})
