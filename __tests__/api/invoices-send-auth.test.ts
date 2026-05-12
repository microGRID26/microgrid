// __tests__/api/invoices-send-auth.test.ts
//
// Auth + authz gates on POST /api/invoices/[id]/send.
//
// greg_actions #153 / migration 133: the red-team found this route had no
// from_org check and no role gate — only a session requirement. A receiver
// (to_org) could trigger PDF-render + Resend-email + status flip on someone
// else's draft invoice. This file covers the route-level defense added in
// commit <TBD>; the DB trigger in migration 133 covers defense in depth.
//
// R1 2026-04-21 added: sender-admin happy path, 429 rate-limit, role check
// runs before invoice load (M4 test-coverage gap).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

function mockChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: (v: unknown) => unknown) => Promise.resolve(result).then(cb)),
  }
  return chain
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => Promise.resolve({ success: true })),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn(() => Promise.resolve({ data: { id: 'em-1' }, error: null })) },
  })),
}))

vi.mock('@/lib/invoices/pdf', () => ({
  renderInvoicePDF: vi.fn(() => Promise.resolve(Buffer.from('PDF'))),
}))

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  delete process.env.RESEND_API_KEY // skip actual send in happy path
})

afterEach(() => {
  process.env = originalEnv
})

function makeRequest(): Request {
  return new Request('https://localhost/api/invoices/inv-1/send', {
    method: 'POST',
  })
}

interface FakeClientOpts {
  user: { id: string; email: string } | null
  fromQueue: Array<{ data: unknown; error: unknown }>
}

function installFakeClient(opts: FakeClientOpts) {
  const fromMock = vi.fn()
  for (const r of opts.fromQueue) fromMock.mockReturnValueOnce(mockChain(r))
  const client = {
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: opts.user }, error: null })),
    },
    from: fromMock,
  }
  return { client, fromMock }
}

// Fixture helpers so the happy-path tests don't repeat 40 lines of column lists.
const draftInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-1',
  from_org: 'org-A',
  to_org: 'org-B',
  status: 'draft',
  total: 1000,
  subtotal: 1000,
  tax: 0,
  project_id: 'P1',
  milestone: 'ntp',
  due_date: null,
  sent_at: null,
  viewed_at: null,
  paid_at: null,
  paid_amount: null,
  payment_method: null,
  payment_reference: null,
  notes: null,
  generated_by: 'manual',
  rule_id: null,
  created_by: 'u1',
  created_by_id: 'u1',
  created_at: '2026-04-21T00:00:00Z',
  updated_at: '2026-04-21T00:00:00Z',
}

const orgRows = [
  { id: 'org-A', name: 'From Co', slug: 'from', org_type: 'epc', allowed_domains: [], logo_url: null, settings: {}, active: true, billing_email: null, billing_address: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
  { id: 'org-B', name: 'To Co', slug: 'to', org_type: 'platform', allowed_domains: [], logo_url: null, settings: {}, active: true, billing_email: 'billing@to.example', billing_address: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
]

describe('POST /api/invoices/[id]/send — auth', () => {
  it('returns 401 when no session', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    const { client } = installFakeClient({ user: null, fromQueue: [] })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate-limit exceeded (fires before role check)', async () => {
    const { rateLimit } = await import('@/lib/rate-limit')
    ;(rateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false })
    const { createServerClient } = await import('@supabase/ssr')
    const { client, fromMock } = installFakeClient({
      user: { id: 'u1', email: 'anyone@gomicrogridenergy.com' },
      fromQueue: [],
    })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(429)
    // Role lookup must not have fired — rate-limit is cheaper than a DB read.
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns 403 when user has no role row', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    const { client } = installFakeClient({
      user: { id: 'u1', email: 'ghost@gomicrogridenergy.com' },
      fromQueue: [{ data: null, error: null }],
    })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 403 when user role is outside SEND_ALLOWED_ROLES — and does NOT load the invoice', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    const { client, fromMock } = installFakeClient({
      user: { id: 'u1', email: 'cust@customer.example' },
      fromQueue: [{ data: { id: 'u1', role: 'customer' }, error: null }],
    })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(403)
    // Role check rejected before the invoice was loaded — only `users` was touched.
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('users')
  })

  it('returns 403 when admin is NOT a member of from_org (receiver trying to send)', async () => {
    // H1 exploit from the 2026-04-21 red-team: admin on to_org calling
    // /send on a draft whose from_org they are NOT in. Must be rejected
    // before any PDF render or Resend API call.
    const { createServerClient } = await import('@supabase/ssr')
    const { client } = installFakeClient({
      user: { id: 'u1', email: 'paul@energydevelopmentgroup.com' },
      fromQueue: [
        { data: { id: 'u1', role: 'admin' }, error: null },
        { data: draftInvoice, error: null },
        {
          data: [
            { org_id: 'org-B', organizations: { id: 'org-B', org_type: 'epc' } },
          ],
          error: null,
        },
      ],
    })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(403)
    const { renderInvoicePDF } = await import('@/lib/invoices/pdf')
    expect(renderInvoicePDF).not.toHaveBeenCalled()
  })

  it('bypasses from_org check for platform org members', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    const { client } = installFakeClient({
      user: { id: 'u1', email: 'greg@gomicrogridenergy.com' },
      fromQueue: [
        { data: { id: 'u1', role: 'admin' }, error: null },
        { data: draftInvoice, error: null },
        {
          data: [
            { org_id: 'org-EDGE', organizations: { id: 'org-EDGE', org_type: 'platform' } },
          ],
          error: null,
        },
        { data: [{ id: 'inv-1' }], error: null }, // claim update
        { data: [], error: null },                // line items
        { data: orgRows, error: null },           // orgs
        { data: { id: 'P1', name: 'Project P1' }, error: null }, // projects (draftInvoice.project_id='P1')
      ],
    })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(200)
  })

  it('accepts sender-org admin (happy path: membership in from_org)', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    const { client } = installFakeClient({
      user: { id: 'u1', email: 'admin-a@gomicrogridenergy.com' },
      fromQueue: [
        { data: { id: 'u1', role: 'admin' }, error: null },
        { data: draftInvoice, error: null },
        {
          data: [
            { org_id: 'org-A', organizations: { id: 'org-A', org_type: 'epc' } },
          ],
          error: null,
        },
        { data: [{ id: 'inv-1' }], error: null }, // claim
        { data: [], error: null },                // line items
        { data: orgRows, error: null },           // orgs
        { data: { id: 'P1', name: 'Project P1' }, error: null }, // projects (draftInvoice.project_id='P1')
      ],
    })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.invoiceId).toBe('inv-1')
  })
})

describe('POST /api/invoices/[id]/send — TOCTOU', () => {
  it('returns 409 when the claim UPDATE affects zero rows (race loser) and does NOT send email', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    const { client } = installFakeClient({
      user: { id: 'u1', email: 'admin@gomicrogridenergy.com' },
      fromQueue: [
        { data: { id: 'u1', role: 'admin' }, error: null },
        { data: draftInvoice, error: null },
        {
          data: [
            { org_id: 'org-A', organizations: { id: 'org-A', org_type: 'epc' } },
          ],
          error: null,
        },
        // Claim update returns empty array — another concurrent request won.
        { data: [], error: null },
      ],
    })
    ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(client)
    const { POST } = await import('@/app/api/invoices/[id]/send/route')
    const res = await POST(makeRequest() as never, { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already sent/i)
    // Critical invariant: race loser did NOT render a PDF or call Resend.
    const { renderInvoicePDF } = await import('@/lib/invoices/pdf')
    expect(renderInvoicePDF).not.toHaveBeenCalled()
  })
})
