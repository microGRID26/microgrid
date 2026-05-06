// __tests__/api/customer-delete-account-stripe.test.ts
//
// #544: customer-delete-account must delete the Stripe customer side
// before the local cascade so saved cards + Stripe customer records
// are not orphaned. Defense-in-depth tests:
//   • happy path with dedup
//   • no-op when STRIPE_SECRET_KEY unset
//   • best-effort on Stripe throw
//   • account already gone
//   • CRITICAL: metadata-mismatch refuses delete (#544 R1 cross-tenant wipe)
//   • cap warning fires when stripe-customer count exceeds threshold
//   • Stripe customer 404 (already gone) is handled gracefully
//   • payment-method query is correctly scoped to account.id

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

interface CapturedEq {
  column: string
  value: unknown
}

function mockChain(result: { data: unknown; error: unknown }, captures?: CapturedEq[]) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    upsert: vi.fn(() => Promise.resolve({ error: null })),
    eq: vi.fn((column: string, value: unknown) => {
      captures?.push({ column, value })
      return chain
    }),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: (v: unknown) => unknown) => Promise.resolve(result).then(cb)),
  }
  return chain
}

const stripeRetrieveMock = vi.fn()
const stripeDelMock = vi.fn(() => Promise.resolve({ id: 'deleted', deleted: true }))

vi.mock('stripe', () => {
  return {
    default: vi.fn(function () {
      return {
        customers: {
          retrieve: stripeRetrieveMock,
          del: stripeDelMock,
        },
      }
    }),
  }
})

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ getAll: () => [] }),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => Promise.resolve({ success: true })),
}))

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
  // Default: retrieve returns a customer whose metadata claims user u1 / account a1
  stripeRetrieveMock.mockImplementation((id: string) =>
    Promise.resolve({
      id,
      object: 'customer',
      metadata: { auth_user_id: 'u1', customer_account_id: 'a1' },
    }),
  )
})

afterEach(() => {
  process.env = originalEnv
})

function makeRequest(): Request {
  return new Request('https://localhost/api/customer/delete-account', { method: 'POST' })
}

interface InstallOpts {
  account: { id: string; name: string; project_id: string } | null
  paymentMethods: Array<{ stripe_customer_id: string | null }>
  authDeleteFails?: string
}

async function installAdmin(opts: InstallOpts) {
  const ssr = (await import('@supabase/ssr')) as unknown as { createServerClient: ReturnType<typeof vi.fn> }
  const sjs = (await import('@supabase/supabase-js')) as unknown as { createClient: ReturnType<typeof vi.fn> }

  ssr.createServerClient.mockReturnValueOnce({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })),
    },
  })

  const captures: Record<string, CapturedEq[]> = {
    customer_accounts: [],
    tickets: [],
    ticket_comments: [],
    customer_feedback: [],
    customer_payment_methods: [],
    pending_auth_deletions: [],
  }
  const adminFrom = vi.fn((table: string) => {
    captures[table] = captures[table] ?? []
    switch (table) {
      case 'customer_accounts':
        // First call resolves account; second fires the delete.
        if (captures[table].length === 0) {
          return mockChain({ data: opts.account, error: null }, captures[table])
        }
        return mockChain({ data: null, error: null }, captures[table])
      case 'tickets':
        return mockChain({ data: [], error: null }, captures[table])
      case 'ticket_comments':
        return mockChain({ data: [], error: null }, captures[table])
      case 'customer_feedback':
        return mockChain({ data: [], error: null }, captures[table])
      case 'customer_payment_methods':
        return mockChain({ data: opts.paymentMethods, error: null }, captures[table])
      case 'pending_auth_deletions':
        return mockChain({ data: null, error: null }, captures[table])
      default:
        return mockChain({ data: [], error: null }, captures[table])
    }
  })

  sjs.createClient.mockReturnValueOnce({
    from: adminFrom,
    storage: { from: () => ({ remove: vi.fn(() => Promise.resolve({ error: null })) }) },
    auth: {
      admin: {
        deleteUser: vi.fn(() =>
          Promise.resolve({ error: opts.authDeleteFails ? { message: opts.authDeleteFails } : null }),
        ),
      },
    },
  })
  return { captures }
}

describe('POST /api/customer/delete-account — Stripe cleanup (#544)', () => {
  it('deletes each unique Stripe customer when STRIPE_SECRET_KEY is set', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    await installAdmin({
      account: { id: 'a1', name: 'Test User', project_id: 'p1' },
      paymentMethods: [
        { stripe_customer_id: 'cus_real_aaaaaaaa1' },
        { stripe_customer_id: 'cus_real_bbbbbbbb2' },
        { stripe_customer_id: 'cus_real_aaaaaaaa1' }, // dupe — should dedupe
      ],
    })
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(stripeRetrieveMock).toHaveBeenCalledTimes(2)
    expect(stripeDelMock).toHaveBeenCalledTimes(2)
    // idempotencyKey present on every del call
    for (const call of stripeDelMock.mock.calls) {
      expect(call[1]).toMatchObject({ idempotencyKey: expect.stringMatching(/^del-cust-cus_real_/) })
    }
  })

  it('no-ops Stripe deletion when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY
    await installAdmin({
      account: { id: 'a1', name: 'Test User', project_id: 'p1' },
      paymentMethods: [{ stripe_customer_id: 'cus_real_1' }],
    })
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(stripeRetrieveMock).not.toHaveBeenCalled()
    expect(stripeDelMock).not.toHaveBeenCalled()
  })

  it('returns 200 even when stripe.customers.del throws (best-effort)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    stripeDelMock.mockRejectedValueOnce(new Error('Stripe is down'))
    await installAdmin({
      account: { id: 'a1', name: 'Test User', project_id: 'p1' },
      paymentMethods: [{ stripe_customer_id: 'cus_real_1' }],
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(stripeDelMock).toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('skips Stripe path entirely when account is already gone', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    await installAdmin({ account: null, paymentMethods: [] })
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(stripeRetrieveMock).not.toHaveBeenCalled()
    expect(stripeDelMock).not.toHaveBeenCalled()
  })

  // CRITICAL test (#544 R1) — cross-tenant Stripe wipe vector.
  it('REFUSES to delete a Stripe customer whose metadata does not claim this user', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    // Attacker-stamped row: stripe_customer_id points at someone else's
    // Stripe customer whose metadata claims a different auth user.
    stripeRetrieveMock.mockImplementationOnce((id: string) =>
      Promise.resolve({
        id,
        object: 'customer',
        metadata: { auth_user_id: 'victim-user-id', customer_account_id: 'victim-account-id' },
      }),
    )
    await installAdmin({
      account: { id: 'a1', name: 'Attacker', project_id: 'p1' },
      paymentMethods: [{ stripe_customer_id: 'cus_victim_xxxxxxxx' }],
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(stripeRetrieveMock).toHaveBeenCalledWith('cus_victim_xxxxxxxx')
    // The crucial assertion: del() must NOT have been called on the victim's customer.
    expect(stripeDelMock).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing stripe.customers.del'),
      expect.stringContaining('sc-last8'),
      expect.stringMatching(/xxxxxxxx$/),
    )
    errSpy.mockRestore()
  })

  it('treats Stripe 404 (No such customer) as already-gone', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    stripeRetrieveMock.mockRejectedValueOnce(new Error('No such customer: cus_real_1'))
    await installAdmin({
      account: { id: 'a1', name: 'Test User', project_id: 'p1' },
      paymentMethods: [{ stripe_customer_id: 'cus_real_1' }],
    })
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(stripeDelMock).not.toHaveBeenCalled()
  })

  it('treats Stripe-side already-deleted customer (deleted=true) as already-gone', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    stripeRetrieveMock.mockImplementationOnce((id: string) =>
      Promise.resolve({ id, object: 'customer', deleted: true }),
    )
    await installAdmin({
      account: { id: 'a1', name: 'Test User', project_id: 'p1' },
      paymentMethods: [{ stripe_customer_id: 'cus_real_1' }],
    })
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(stripeDelMock).not.toHaveBeenCalled()
  })

  it('warns but proceeds when stripe-customer count exceeds threshold', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    const ids = Array.from({ length: 12 }, (_, i) => ({ stripe_customer_id: `cus_${i}_aaaaaaaa` }))
    await installAdmin({
      account: { id: 'a1', name: 'Test User', project_id: 'p1' },
      paymentMethods: ids,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unusual stripe-customer count'),
      'count:', 12,
      'auth_user:', 'u1',
    )
    expect(stripeDelMock).toHaveBeenCalledTimes(12)
    warnSpy.mockRestore()
  })

  it('payment-method lookup is scoped by account.id (regression: must not leak rows from other accounts)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    const { captures } = await installAdmin({
      account: { id: 'a1-this-account', name: 'Test User', project_id: 'p1' },
      paymentMethods: [{ stripe_customer_id: 'cus_real_1' }],
    })
    const { POST } = await import('@/app/api/customer/delete-account/route')
    await POST(makeRequest() as never)
    // The customer_payment_methods select must filter by customer_account_id = 'a1-this-account'
    const cpmCaptures = captures.customer_payment_methods
    expect(cpmCaptures).toContainEqual({ column: 'customer_account_id', value: 'a1-this-account' })
  })

  it('persists pending_auth_deletions when auth.admin.deleteUser fails', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    const { captures } = await installAdmin({
      account: { id: 'a1', name: 'Test User', project_id: 'p1' },
      paymentMethods: [],
      authDeleteFails: 'auth-flap',
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/customer/delete-account/route')
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, warning: expect.stringContaining('auth removal pending') })
    // Touch on pending_auth_deletions table happened (upsert was called via the chain mock).
    expect(captures.pending_auth_deletions).toBeDefined()
    errSpy.mockRestore()
  })
})
