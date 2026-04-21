import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import React from 'react'

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_ORG_ID = 'a0000000-0000-0000-0000-000000000001'

function buildMembershipsChain(memberships: { org_id: string; org_role: string; is_default: boolean }[]) {
  const chain: Record<string, any> = {}
  const methods = ['select', 'eq', 'neq', 'in', 'ilike', 'or', 'order', 'range', 'limit', 'not']
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  chain.then = vi.fn((resolve: any) => Promise.resolve({ data: memberships, error: null }).then(resolve))
  return chain
}

function buildOrgsChain(orgs: { id: string; name: string; slug: string; org_type: string; active: boolean }[]) {
  const chain: Record<string, any> = {}
  const methods = ['select', 'eq', 'neq', 'in', 'ilike', 'or', 'order', 'range', 'limit', 'not']
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  chain.then = vi.fn((resolve: any) => Promise.resolve({ data: orgs, error: null }).then(resolve))
  return chain
}

// Per #155 fix, useOrg now looks up public.users by email before querying
// org_memberships, because org_memberships.user_id stores public.users.id
// (not auth.uid). The chain here resolves to { id: <userId> } for .single(),
// matching the legacy userId param so existing test expectations still hold.
function buildUserRowChain(userRow: { id: string } | null) {
  const chain: Record<string, any> = {}
  const methods = ['select', 'eq', 'neq', 'in', 'ilike', 'or', 'order', 'range', 'limit', 'not']
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  chain.single = vi.fn(() => Promise.resolve({ data: userRow, error: userRow ? null : { code: 'PGRST116' } }))
  chain.maybeSingle = chain.single
  chain.then = vi.fn((resolve: any) => Promise.resolve({ data: userRow, error: null }).then(resolve))
  return chain
}

function mockSupabaseWith(
  memberships: { org_id: string; org_role: string; is_default: boolean }[],
  orgs: { id: string; name: string; slug: string; org_type: string; active: boolean }[],
  userId = 'user-123',
  publicUserRow: { id: string } | null = { id: userId },
) {
  const membershipsChain = buildMembershipsChain(memberships)
  const orgsChain = buildOrgsChain(orgs)
  const userRowChain = buildUserRowChain(publicUserRow)

  return {
    from: vi.fn((table: string) => {
      if (table === 'users') return userRowChain
      if (table === 'org_memberships') return membershipsChain
      if (table === 'organizations') return orgsChain
      return membershipsChain
    }),
    auth: {
      getUser: vi.fn(() => Promise.resolve({
        data: { user: { id: userId, email: 'test@gomicrogridenergy.com' } },
        error: null,
      })),
    },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  }
}

function mockSupabaseNoUser() {
  return {
    from: vi.fn(() => buildMembershipsChain([])),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  }
}

function mockSupabaseAuthError() {
  return {
    from: vi.fn(() => buildMembershipsChain([])),
    auth: {
      getUser: vi.fn(() => Promise.reject(new Error('Auth failed'))),
    },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useOrg', () => {
  it('provides default context values when used outside provider', async () => {
    vi.doMock('@/lib/supabase/client', () => ({
      createClient: () => mockSupabaseNoUser(),
    }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { useOrg } = await import('@/lib/hooks/useOrg')
    const { result } = renderHook(() => useOrg())

    // Outside provider, should get default context (no provider = no loading, static defaults)
    expect(result.current.orgId).toBeNull()
    expect(result.current.orgName).toBeNull()
    expect(result.current.orgSlug).toBeNull()
    expect(result.current.orgType).toBeNull()
    expect(result.current.userOrgs).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(typeof result.current.switchOrg).toBe('function')
  })

  it('returns orgId, orgName, orgType, userOrgs, switchOrg, loading from provider', async () => {
    const memberships = [
      { org_id: DEFAULT_ORG_ID, org_role: 'admin', is_default: true },
    ]
    const orgs = [
      { id: DEFAULT_ORG_ID, name: 'MicroGRID Energy', slug: 'microgrid', org_type: 'epc', active: true },
    ]
    const supabase = mockSupabaseWith(memberships, orgs)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.orgId).toBe(DEFAULT_ORG_ID)
    expect(result.current.orgName).toBe('MicroGRID Energy')
    expect(result.current.orgType).toBe('epc')
    expect(result.current.orgSlug).toBe('microgrid')
    expect(result.current.userOrgs).toHaveLength(1)
    expect(result.current.userOrgs[0].orgRole).toBe('admin')
    expect(typeof result.current.switchOrg).toBe('function')
  })

  it('switchOrg updates localStorage and calls clearQueryCache', async () => {
    const orgA = 'a0000000-0000-0000-0000-000000000001'
    const orgB = 'b0000000-0000-0000-0000-000000000002'

    const memberships = [
      { org_id: orgA, org_role: 'admin', is_default: true },
      { org_id: orgB, org_role: 'member', is_default: false },
    ]
    const orgs = [
      { id: orgA, name: 'MicroGRID Energy', slug: 'microgrid', org_type: 'epc', active: true },
      { id: orgB, name: 'EDGE Portal', slug: 'edge', org_type: 'platform', active: true },
    ]

    const supabase = mockSupabaseWith(memberships, orgs)
    const mockClearCache = vi.fn()

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: mockClearCache,
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Initially on orgA (is_default)
    expect(result.current.orgId).toBe(orgA)

    // Switch to orgB
    act(() => {
      result.current.switchOrg(orgB)
    })

    expect(result.current.orgId).toBe(orgB)
    expect(result.current.orgName).toBe('EDGE Portal')
    expect(localStorage.getItem('mg_org_id')).toBe(orgB)
    expect(mockClearCache).toHaveBeenCalled()
  })

  it('falls back to default org when no memberships exist', async () => {
    const supabase = mockSupabaseWith([], [])

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should fall back to hardcoded default
    expect(result.current.orgId).toBe(DEFAULT_ORG_ID)
    expect(result.current.orgName).toBe('MicroGRID Energy')
    expect(result.current.orgType).toBe('epc')
    expect(result.current.userOrgs).toHaveLength(1)
    expect(result.current.userOrgs[0].orgRole).toBe('member')
  })

  it('selects correct org from localStorage when multiple orgs exist', async () => {
    const orgA = 'a0000000-0000-0000-0000-000000000001'
    const orgB = 'b0000000-0000-0000-0000-000000000002'

    // Set localStorage before render
    localStorage.setItem('mg_org_id', orgB)

    const memberships = [
      { org_id: orgA, org_role: 'admin', is_default: true },
      { org_id: orgB, org_role: 'member', is_default: false },
    ]
    const orgs = [
      { id: orgA, name: 'MicroGRID Energy', slug: 'microgrid', org_type: 'epc', active: true },
      { id: orgB, name: 'EDGE Portal', slug: 'edge', org_type: 'platform', active: true },
    ]

    const supabase = mockSupabaseWith(memberships, orgs)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should prefer localStorage value over is_default
    expect(result.current.orgId).toBe(orgB)
    expect(result.current.orgName).toBe('EDGE Portal')
  })

  it('falls back to is_default when no localStorage is set', async () => {
    const orgA = 'a0000000-0000-0000-0000-000000000001'
    const orgB = 'b0000000-0000-0000-0000-000000000002'

    const memberships = [
      { org_id: orgA, org_role: 'member', is_default: false },
      { org_id: orgB, org_role: 'admin', is_default: true },
    ]
    const orgs = [
      { id: orgA, name: 'MicroGRID Energy', slug: 'microgrid', org_type: 'epc', active: true },
      { id: orgB, name: 'EDGE Portal', slug: 'edge', org_type: 'platform', active: true },
    ]

    const supabase = mockSupabaseWith(memberships, orgs)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should select orgB because it has is_default: true
    expect(result.current.orgId).toBe(orgB)
    expect(result.current.orgName).toBe('EDGE Portal')
  })

  it('handles auth error gracefully — falls back to default org', async () => {
    const supabase = mockSupabaseAuthError()

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should fall back to DEFAULT_ORG_ID on auth error with populated org details
    expect(result.current.orgId).toBe(DEFAULT_ORG_ID)
    expect(result.current.orgName).toBe('MicroGRID Energy')
    expect(result.current.orgType).toBe('epc')
    expect(result.current.userOrgs).toHaveLength(1)
  })

  it('handles no authenticated user — sets loading false', async () => {
    const supabase = mockSupabaseNoUser()

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // No user means no org loaded, but loading should be false
    expect(result.current.orgId).toBeNull()
    expect(result.current.userOrgs).toEqual([])
  })

  it('filters out inactive orgs from userOrgs', async () => {
    const orgA = 'a0000000-0000-0000-0000-000000000001'
    const orgB = 'b0000000-0000-0000-0000-000000000002'

    const memberships = [
      { org_id: orgA, org_role: 'admin', is_default: true },
      { org_id: orgB, org_role: 'member', is_default: false },
    ]
    const orgs = [
      { id: orgA, name: 'MicroGRID Energy', slug: 'microgrid', org_type: 'epc', active: true },
      { id: orgB, name: 'Inactive Org', slug: 'inactive', org_type: 'sales', active: false },
    ]

    const supabase = mockSupabaseWith(memberships, orgs)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Only active orgs should be in userOrgs
    expect(result.current.userOrgs).toHaveLength(1)
    expect(result.current.userOrgs[0].orgId).toBe(orgA)
  })

  it('falls back to DEFAULT_ORG_ID when auth user has no public.users row (#155 fix)', async () => {
    // Regression test: pre-#155-fix, useOrg filtered org_memberships by
    // auth.uid(), which never matched any real row because memberships key
    // on public.users.id. That silently returned zero rows and fired the
    // DEFAULT_ORG_ID fallback for every user. Post-fix, useOrg resolves
    // public.users.id via email; if the row doesn't exist (first-login
    // race / offboarded user), fall back to DEFAULT_ORG_ID so the UI still
    // renders — this test pins that path.
    const supabase = mockSupabaseWith(
      [{ org_id: 'irrelevant', org_role: 'admin', is_default: true }],
      [],
      'user-123',
      null, // no public.users row for this email
    )

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.orgId).toBe(DEFAULT_ORG_ID)
    expect(result.current.orgName).toBe('MicroGRID Energy')
    expect(result.current.orgType).toBe('epc')
    expect(result.current.userOrgs).toHaveLength(1)
  })

  it('ignores invalid localStorage org ID and uses is_default', async () => {
    const orgA = 'a0000000-0000-0000-0000-000000000001'

    // Set invalid org in localStorage
    localStorage.setItem('mg_org_id', 'nonexistent-org-id')

    const memberships = [
      { org_id: orgA, org_role: 'admin', is_default: true },
    ]
    const orgs = [
      { id: orgA, name: 'MicroGRID Energy', slug: 'microgrid', org_type: 'epc', active: true },
    ]

    const supabase = mockSupabaseWith(memberships, orgs)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))
    vi.doMock('@/lib/hooks/useSupabaseQuery', () => ({
      clearQueryCache: vi.fn(),
    }))

    const { OrgProvider, useOrg } = await import('@/lib/hooks/useOrg')

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(OrgProvider, null, children)

    const { result } = renderHook(() => useOrg(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should ignore invalid localStorage and use is_default
    expect(result.current.orgId).toBe(orgA)
  })
})
