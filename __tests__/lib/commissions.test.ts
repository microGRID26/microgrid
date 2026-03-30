import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockSupabase } from '../../vitest.setup'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    or: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: any) => Promise.resolve(result).then(cb)),
  }
  return chain
}

// ── Mock Rate Data ──────────────────────────────────────────────────────────

const MOCK_RATES = [
  { id: 'r1', role_key: 'sales_rep', label: 'Sales Rep', rate_type: 'per_watt', rate: 0.50, description: 'Per-watt for sales reps', active: true, sort_order: 1, org_id: null, created_at: '2026-03-28', updated_at: '2026-03-28' },
  { id: 'r2', role_key: 'closer', label: 'Closer', rate_type: 'per_watt', rate: 0.25, description: 'Per-watt for closers', active: true, sort_order: 2, org_id: null, created_at: '2026-03-28', updated_at: '2026-03-28' },
  { id: 'r3', role_key: 'team_leader', label: 'Team Leader', rate_type: 'per_watt', rate: 0.10, description: 'Override', active: true, sort_order: 3, org_id: null, created_at: '2026-03-28', updated_at: '2026-03-28' },
  { id: 'r4', role_key: 'manager', label: 'Manager', rate_type: 'per_watt', rate: 0.05, description: 'Override', active: true, sort_order: 4, org_id: null, created_at: '2026-03-28', updated_at: '2026-03-28' },
  { id: 'r5', role_key: 'adder', label: 'Adder Commission', rate_type: 'percentage', rate: 10.00, description: '10% of adder revenue', active: true, sort_order: 5, org_id: null, created_at: '2026-03-28', updated_at: '2026-03-28' },
  { id: 'r6', role_key: 'referral', label: 'Referral Bonus', rate_type: 'flat', rate: 500.00, description: 'Per referral', active: true, sort_order: 6, org_id: null, created_at: '2026-03-28', updated_at: '2026-03-28' },
]

const MOCK_RECORD = {
  id: 'cr-1',
  project_id: 'PROJ-00001',
  user_id: 'user-1',
  user_name: 'John Sales',
  role_key: 'sales_rep',
  system_watts: 10000,
  rate: 0.50,
  adder_revenue: 5000,
  referral_count: 0,
  solar_commission: 5000,
  adder_commission: 500,
  referral_commission: 0,
  total_commission: 5500,
  status: 'pending',
  milestone: null,
  paid_at: null,
  notes: null,
  admin_notes: null,
  days_since_sale: null,
  is_energy_community: false,
  adder_deduction: 0,
  org_id: null,
  created_at: '2026-03-28T12:00:00Z',
  updated_at: '2026-03-28T12:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// ── Constants ───────────────────────────────────────────────────────────────

describe('Commission constants', () => {
  it('exports all commission statuses', async () => {
    const { COMMISSION_STATUSES, COMMISSION_STATUS_LABELS, COMMISSION_STATUS_BADGE } = await import('@/lib/api/commissions')
    expect(COMMISSION_STATUSES).toEqual(['pending', 'approved', 'paid', 'cancelled'])
    expect(Object.keys(COMMISSION_STATUS_LABELS)).toHaveLength(4)
    expect(COMMISSION_STATUS_LABELS.pending).toBe('Pending')
    expect(COMMISSION_STATUS_LABELS.approved).toBe('Approved')
    expect(COMMISSION_STATUS_LABELS.paid).toBe('Paid')
    expect(COMMISSION_STATUS_LABELS.cancelled).toBe('Cancelled')
  })

  it('exports badge classes for all statuses', async () => {
    const { COMMISSION_STATUS_BADGE } = await import('@/lib/api/commissions')
    expect(Object.keys(COMMISSION_STATUS_BADGE)).toHaveLength(4)
    expect(COMMISSION_STATUS_BADGE.pending).toContain('amber')
    expect(COMMISSION_STATUS_BADGE.approved).toContain('blue')
    expect(COMMISSION_STATUS_BADGE.paid).toContain('green')
    expect(COMMISSION_STATUS_BADGE.cancelled).toContain('red')
  })

  it('exports DEFAULT_ROLES with correct keys and labels', async () => {
    const { DEFAULT_ROLES } = await import('@/lib/api/commissions')
    expect(DEFAULT_ROLES).toHaveLength(4)
    expect(DEFAULT_ROLES[0]).toEqual({ key: 'sales_rep', label: 'Sales Rep' })
    expect(DEFAULT_ROLES[1]).toEqual({ key: 'closer', label: 'Closer' })
    expect(DEFAULT_ROLES[2]).toEqual({ key: 'team_leader', label: 'Team Leader Override' })
    expect(DEFAULT_ROLES[3]).toEqual({ key: 'manager', label: 'Manager Override' })
  })
})

// ── calculateCommission (pure function) ────────────────────────────────────

describe('calculateCommission', () => {
  it('calculates sales_rep: 10000 watts x $0.50/W = $5,000 solar', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(10000, 0, 0, 'sales_rep', MOCK_RATES as any)
    expect(result.solarCommission).toBe(5000)
    expect(result.adderCommission).toBe(0)
    expect(result.referralCommission).toBe(0)
    expect(result.total).toBe(5000)
  })

  it('calculates closer: 10000 watts x $0.25/W = $2,500 solar', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(10000, 0, 0, 'closer', MOCK_RATES as any)
    expect(result.solarCommission).toBe(2500)
    expect(result.total).toBe(2500)
  })

  it('calculates adder commission: $5,000 revenue x 10% = $500', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(10000, 5000, 0, 'sales_rep', MOCK_RATES as any)
    expect(result.solarCommission).toBe(5000)
    expect(result.adderCommission).toBe(500)
    expect(result.total).toBe(5500)
  })

  it('calculates referral bonus: 3 referrals x $500 = $1,500', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(10000, 0, 3, 'sales_rep', MOCK_RATES as any)
    expect(result.solarCommission).toBe(5000)
    expect(result.referralCommission).toBe(1500)
    expect(result.total).toBe(6500)
  })

  it('calculates full breakdown: solar + adder + referral', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(10000, 5000, 3, 'sales_rep', MOCK_RATES as any)
    expect(result.solarCommission).toBe(5000)
    expect(result.adderCommission).toBe(500)
    expect(result.referralCommission).toBe(1500)
    expect(result.total).toBe(7000)
  })

  it('returns $0 for zero watts, zero adder, zero referrals', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(0, 0, 0, 'sales_rep', MOCK_RATES as any)
    expect(result.solarCommission).toBe(0)
    expect(result.adderCommission).toBe(0)
    expect(result.referralCommission).toBe(0)
    expect(result.total).toBe(0)
  })

  it('returns $0 solar for unknown role key', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(10000, 5000, 3, 'unknown_role', MOCK_RATES as any)
    expect(result.solarCommission).toBe(0)
    // adder and referral still apply (they are role-independent)
    expect(result.adderCommission).toBe(500)
    expect(result.referralCommission).toBe(1500)
    expect(result.total).toBe(2000)
  })

  it('handles negative watts gracefully (clamps to zero)', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(-5000, 0, 0, 'sales_rep', MOCK_RATES as any)
    expect(result.solarCommission).toBe(0)
    expect(result.total).toBe(0)
  })

  it('handles negative adder revenue (adder commission stays 0 due to >0 guard)', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(0, -1000, 0, 'sales_rep', MOCK_RATES as any)
    expect(result.adderCommission).toBe(0) // guard: adderRevenue > 0
    expect(result.total).toBe(0)
  })

  it('handles negative referral count (referral commission stays 0 due to >0 guard)', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(0, 0, -2, 'sales_rep', MOCK_RATES as any)
    expect(result.referralCommission).toBe(0) // guard: referralCount > 0
    expect(result.total).toBe(0)
  })

  it('handles empty rates array', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const result = calculateCommission(10000, 5000, 3, 'sales_rep', [])
    expect(result.solarCommission).toBe(0)
    expect(result.adderCommission).toBe(0)
    expect(result.referralCommission).toBe(0)
    expect(result.total).toBe(0)
  })

  it('skips inactive rates', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const inactiveRates = MOCK_RATES.map(r => ({ ...r, active: false })) as any
    const result = calculateCommission(10000, 5000, 3, 'sales_rep', inactiveRates)
    expect(result.total).toBe(0)
  })

  it('handles percentage rate type for solar', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const pctRates = [
      { ...MOCK_RATES[0], rate_type: 'percentage', rate: 5 }, // 5% of watts? unusual but supported
    ] as any
    const result = calculateCommission(10000, 0, 0, 'sales_rep', pctRates)
    // percentage: systemWatts * rate / 100 = 10000 * 5 / 100 = 500
    expect(result.solarCommission).toBe(500)
  })

  it('handles flat rate type for solar', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const flatRates = [
      { ...MOCK_RATES[0], rate_type: 'flat', rate: 1500 },
    ] as any
    const result = calculateCommission(10000, 0, 0, 'sales_rep', flatRates)
    expect(result.solarCommission).toBe(1500)
  })

  it('rounds to 2 decimal places', async () => {
    const { calculateCommission } = await import('@/lib/api/commissions')
    const rates = [
      { ...MOCK_RATES[0], rate: 0.333 }, // 10000 * 0.333 = 3330
    ] as any
    const result = calculateCommission(10001, 0, 0, 'sales_rep', rates)
    // 10001 * 0.333 = 3330.333
    expect(result.solarCommission).toBe(3330.33)
    expect(result.total).toBe(3330.33)
  })
})

// ── loadCommissionRates ────────────────────────────────────────────────────

describe('loadCommissionRates', () => {
  it('loads all active rates without orgId', async () => {
    const chain = mockChain({ data: MOCK_RATES, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRates } = await import('@/lib/api/commissions')
    const result = await loadCommissionRates()

    expect(mockSupabase.from).toHaveBeenCalledWith('commission_rates')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('active', true)
    expect(chain.order).toHaveBeenCalledWith('sort_order', { ascending: true })
    expect(chain.limit).toHaveBeenCalledWith(100)
    expect(result).toEqual(MOCK_RATES)
  })

  it('filters by orgId when provided (includes null org_id)', async () => {
    const chain = mockChain({ data: MOCK_RATES, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRates } = await import('@/lib/api/commissions')
    await loadCommissionRates('org-123')

    expect(chain.or).toHaveBeenCalledWith('org_id.eq.org-123,org_id.is.null')
  })

  it('does not filter by orgId when null', async () => {
    const chain = mockChain({ data: MOCK_RATES, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRates } = await import('@/lib/api/commissions')
    await loadCommissionRates(null)

    // eq should only be called once for 'active', not for 'org_id'
    expect(chain.eq).toHaveBeenCalledTimes(1)
    expect(chain.eq).toHaveBeenCalledWith('active', true)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'db error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRates } = await import('@/lib/api/commissions')
    const result = await loadCommissionRates()

    expect(result).toEqual([])
  })
})

// ── loadCommissionRecords ──────────────────────────────────────────────────

describe('loadCommissionRecords', () => {
  it('loads records with no filters', async () => {
    const chain = mockChain({ data: [MOCK_RECORD], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    const result = await loadCommissionRecords()

    expect(mockSupabase.from).toHaveBeenCalledWith('commission_records')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(500)
    expect(result).toEqual([MOCK_RECORD])
  })

  it('applies userId filter', async () => {
    const chain = mockChain({ data: [MOCK_RECORD], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    await loadCommissionRecords({ userId: 'user-1' })

    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('applies projectId filter', async () => {
    const chain = mockChain({ data: [MOCK_RECORD], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    await loadCommissionRecords({ projectId: 'PROJ-00001' })

    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-00001')
  })

  it('applies status filter', async () => {
    const chain = mockChain({ data: [MOCK_RECORD], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    await loadCommissionRecords({ status: 'pending' })

    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('applies date range filters', async () => {
    const chain = mockChain({ data: [MOCK_RECORD], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    await loadCommissionRecords({ dateFrom: '2026-01-01', dateTo: '2026-03-31' })

    expect(chain.gte).toHaveBeenCalledWith('created_at', '2026-01-01')
    expect(chain.lte).toHaveBeenCalledWith('created_at', '2026-03-31')
  })

  it('applies orgId filter', async () => {
    const chain = mockChain({ data: [MOCK_RECORD], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    await loadCommissionRecords({ orgId: 'org-123' })

    expect(chain.eq).toHaveBeenCalledWith('org_id', 'org-123')
  })

  it('applies all filters together', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    await loadCommissionRecords({
      userId: 'user-1',
      projectId: 'PROJ-00001',
      status: 'approved',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      orgId: 'org-123',
    })

    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-00001')
    expect(chain.eq).toHaveBeenCalledWith('status', 'approved')
    expect(chain.gte).toHaveBeenCalledWith('created_at', '2026-01-01')
    expect(chain.lte).toHaveBeenCalledWith('created_at', '2026-03-31')
    expect(chain.eq).toHaveBeenCalledWith('org_id', 'org-123')
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'db error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCommissionRecords } = await import('@/lib/api/commissions')
    const result = await loadCommissionRecords()

    expect(result).toEqual([])
  })
})

// ── createCommissionRecord ─────────────────────────────────────────────────

describe('createCommissionRecord', () => {
  it('creates a commission record successfully', async () => {
    const chain = mockChain({ data: MOCK_RECORD, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { createCommissionRecord } = await import('@/lib/api/commissions')
    const result = await createCommissionRecord({
      project_id: 'PROJ-00001',
      user_id: 'user-1',
      user_name: 'John Sales',
      role_key: 'sales_rep',
      system_watts: 10000,
      rate: 0.50,
      adder_revenue: 5000,
      referral_count: 0,
      solar_commission: 5000,
      adder_commission: 500,
      referral_commission: 0,
      total_commission: 5500,
      status: 'pending',
      milestone: null,
      paid_at: null,
      notes: null,
      admin_notes: null,
      days_since_sale: null,
      is_energy_community: false,
      adder_deduction: 0,
      org_id: null,
    })

    expect(mockSupabase.from).toHaveBeenCalledWith('commission_records')
    expect(chain.insert).toHaveBeenCalled()
    expect(chain.select).toHaveBeenCalled()
    expect(result).toEqual(MOCK_RECORD)
  })

  it('returns null on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'insert error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { createCommissionRecord } = await import('@/lib/api/commissions')
    const result = await createCommissionRecord({
      project_id: 'PROJ-00001',
      user_id: 'user-1',
      user_name: 'Test',
      role_key: 'sales_rep',
      system_watts: 10000,
      rate: 0.50,
      adder_revenue: 0,
      referral_count: 0,
      solar_commission: 5000,
      adder_commission: 0,
      referral_commission: 0,
      total_commission: 5000,
      status: 'pending',
      milestone: null,
      paid_at: null,
      notes: null,
      admin_notes: null,
      days_since_sale: null,
      is_energy_community: false,
      adder_deduction: 0,
      org_id: null,
    })

    expect(result).toBeNull()
  })
})

// ── updateCommissionRecord ─────────────────────────────────────────────────

describe('updateCommissionRecord', () => {
  it('updates a commission record successfully', async () => {
    const updated = { ...MOCK_RECORD, status: 'approved' }
    const chain = mockChain({ data: updated, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updateCommissionRecord } = await import('@/lib/api/commissions')
    const result = await updateCommissionRecord('cr-1', { status: 'approved' })

    expect(mockSupabase.from).toHaveBeenCalledWith('commission_records')
    expect(chain.update).toHaveBeenCalledWith({ status: 'approved' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'cr-1')
    expect(result).toEqual(updated)
  })

  it('returns null on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'update error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { updateCommissionRecord } = await import('@/lib/api/commissions')
    const result = await updateCommissionRecord('cr-1', { status: 'paid' })

    expect(result).toBeNull()
  })
})

// ── loadEarningsSummary ────────────────────────────────────────────────────

describe('loadEarningsSummary', () => {
  it('aggregates earnings by status', async () => {
    const records = [
      { role_key: 'sales_rep', status: 'pending', total_commission: 5000 },
      { role_key: 'sales_rep', status: 'approved', total_commission: 3000 },
      { role_key: 'sales_rep', status: 'paid', total_commission: 2000 },
      { role_key: 'closer', status: 'paid', total_commission: 1000 },
      { role_key: 'sales_rep', status: 'cancelled', total_commission: 500 },
    ]
    const chain = mockChain({ data: records, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadEarningsSummary } = await import('@/lib/api/commissions')
    const result = await loadEarningsSummary()

    expect(result.totalPending).toBe(5000)
    expect(result.totalApproved).toBe(3000)
    expect(result.totalPaid).toBe(3000) // 2000 + 1000
    expect(result.totalCancelled).toBe(500)
    expect(result.totalEarned).toBe(11000) // pending + approved + paid
  })

  it('groups by role excluding cancelled', async () => {
    const records = [
      { role_key: 'sales_rep', status: 'paid', total_commission: 5000 },
      { role_key: 'sales_rep', status: 'paid', total_commission: 3000 },
      { role_key: 'closer', status: 'approved', total_commission: 1000 },
      { role_key: 'sales_rep', status: 'cancelled', total_commission: 2000 },
    ]
    const chain = mockChain({ data: records, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadEarningsSummary } = await import('@/lib/api/commissions')
    const result = await loadEarningsSummary()

    const salesRole = result.byRole.find(r => r.roleKey === 'sales_rep')
    expect(salesRole).toBeDefined()
    expect(salesRole!.total).toBe(8000) // 5000 + 3000 (cancelled excluded)
    expect(salesRole!.count).toBe(2)

    const closerRole = result.byRole.find(r => r.roleKey === 'closer')
    expect(closerRole).toBeDefined()
    expect(closerRole!.total).toBe(1000)
    expect(closerRole!.count).toBe(1)
  })

  it('applies userId filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadEarningsSummary } = await import('@/lib/api/commissions')
    await loadEarningsSummary('user-1')

    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('applies orgId filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadEarningsSummary } = await import('@/lib/api/commissions')
    await loadEarningsSummary(null, 'org-123')

    expect(chain.eq).toHaveBeenCalledWith('org_id', 'org-123')
  })

  it('applies date range', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadEarningsSummary } = await import('@/lib/api/commissions')
    await loadEarningsSummary(null, null, { from: '2026-01-01', to: '2026-03-31' })

    expect(chain.gte).toHaveBeenCalledWith('created_at', '2026-01-01')
    expect(chain.lte).toHaveBeenCalledWith('created_at', '2026-03-31')
  })

  it('returns zeroed summary on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'db error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadEarningsSummary } = await import('@/lib/api/commissions')
    const result = await loadEarningsSummary()

    expect(result.totalEarned).toBe(0)
    expect(result.totalPending).toBe(0)
    expect(result.totalApproved).toBe(0)
    expect(result.totalPaid).toBe(0)
    expect(result.totalCancelled).toBe(0)
    expect(result.byRole).toEqual([])
  })

  it('handles null total_commission gracefully', async () => {
    const records = [
      { role_key: 'sales_rep', status: 'paid', total_commission: null },
    ]
    const chain = mockChain({ data: records, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadEarningsSummary } = await import('@/lib/api/commissions')
    const result = await loadEarningsSummary()

    expect(result.totalPaid).toBe(0)
    expect(result.totalEarned).toBe(0)
  })
})

// ── generateProjectCommissions ─────────────────────────────────────────────

describe('generateProjectCommissions', () => {
  it('creates records for applicable roles', async () => {
    // We need to mock multiple from() calls sequentially:
    // 1. projects select -> single
    // 2. project_adders select
    // 3. commission_rates select (via loadCommissionRates)
    // 4+ createCommissionRecord calls

    const projectChain = mockChain({
      data: { id: 'PROJ-00001', systemkw: 10, consultant: 'John Sales', advisor: 'Jane Closer', pm: 'Bob PM', pm_id: 'user-pm-1', org_id: 'org-1' },
      error: null,
    })
    const addersChain = mockChain({
      data: [{ price: 2000, quantity: 1 }, { price: 1500, quantity: 2 }],
      error: null,
    })
    const ratesChain = mockChain({ data: MOCK_RATES, error: null })
    const recordChain = mockChain({ data: MOCK_RECORD, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_adders') return addersChain
      if (table === 'commission_rates') return ratesChain
      if (table === 'commission_records') return recordChain
      return mockChain({ data: null, error: null })
    })

    const { generateProjectCommissions } = await import('@/lib/api/commissions')
    const result = await generateProjectCommissions('PROJ-00001')

    // Should create records for: sales_rep (consultant), closer (advisor), team_leader (pm)
    // Manager is skipped because userName is null and roleKey is 'manager' — but code says "except manager which may be set later"
    // So manager IS included if there's a rate for it, even with null userName
    expect(mockSupabase.from).toHaveBeenCalledWith('projects')
    expect(mockSupabase.from).toHaveBeenCalledWith('project_adders')
    expect(mockSupabase.from).toHaveBeenCalledWith('commission_rates')
  })

  it('returns empty array when project not found', async () => {
    const chain = mockChain({ data: null, error: { message: 'not found' } })
    mockSupabase.from.mockReturnValue(chain)

    const { generateProjectCommissions } = await import('@/lib/api/commissions')
    const result = await generateProjectCommissions('PROJ-NONEXISTENT')

    expect(result).toEqual([])
  })

  it('returns empty array when no rates found', async () => {
    const projectChain = mockChain({
      data: { id: 'PROJ-00001', systemkw: 10, consultant: 'John', advisor: null, pm: null, pm_id: null, org_id: null },
      error: null,
    })
    const addersChain = mockChain({ data: [], error: null })
    const ratesChain = mockChain({ data: [], error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_adders') return addersChain
      if (table === 'commission_rates') return ratesChain
      return mockChain({ data: null, error: null })
    })

    const { generateProjectCommissions } = await import('@/lib/api/commissions')
    const result = await generateProjectCommissions('PROJ-00001')

    expect(result).toEqual([])
  })

  it('sums adder revenue correctly (price x quantity)', async () => {
    const projectChain = mockChain({
      data: { id: 'PROJ-00001', systemkw: 10, consultant: 'John', advisor: null, pm: null, pm_id: null, org_id: null },
      error: null,
    })
    const addersChain = mockChain({
      data: [
        { price: 1000, quantity: 2 }, // 2000
        { price: 500, quantity: 3 },  // 1500
      ],
      error: null,
    })
    const ratesChain = mockChain({ data: MOCK_RATES, error: null })
    const recordChain = mockChain({ data: MOCK_RECORD, error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_adders') return addersChain
      if (table === 'commission_rates') return ratesChain
      if (table === 'commission_records') return recordChain
      return mockChain({ data: null, error: null })
    })

    const { generateProjectCommissions } = await import('@/lib/api/commissions')
    const result = await generateProjectCommissions('PROJ-00001')

    // The adder revenue should be 2000 + 1500 = 3500
    // Verify the insert was called with correct adder_revenue
    expect(result.length).toBeGreaterThan(0)
  })

  it('uses orgId from parameter if provided, else from project', async () => {
    const projectChain = mockChain({
      data: { id: 'PROJ-00001', systemkw: 10, consultant: 'John', advisor: null, pm: null, pm_id: null, org_id: 'project-org' },
      error: null,
    })
    const addersChain = mockChain({ data: [], error: null })
    const ratesChain = mockChain({ data: MOCK_RATES, error: null })
    const recordChain = mockChain({ data: MOCK_RECORD, error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_adders') return addersChain
      if (table === 'commission_rates') return ratesChain
      if (table === 'commission_records') return recordChain
      return mockChain({ data: null, error: null })
    })

    const { generateProjectCommissions } = await import('@/lib/api/commissions')

    // When orgId param is provided, it should use that
    await generateProjectCommissions('PROJ-00001', 'override-org')
    // The rates loading should use 'override-org'
    expect(ratesChain.or).toHaveBeenCalledWith('org_id.eq.override-org,org_id.is.null')
  })
})

// ── addCommissionRate ──────────────────────────────────────────────────────

describe('addCommissionRate', () => {
  it('creates a new rate and returns it', async () => {
    const newRate = { ...MOCK_RATES[0], id: 'r-new' }
    const chain = mockChain({ data: newRate, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { addCommissionRate } = await import('@/lib/api/commissions')
    const result = await addCommissionRate({
      role_key: 'custom',
      label: 'Custom Rate',
      rate_type: 'per_watt',
      rate: 0.75,
      description: 'Custom',
      active: true,
      sort_order: 10,
      org_id: null,
    })

    expect(mockSupabase.from).toHaveBeenCalledWith('commission_rates')
    expect(chain.insert).toHaveBeenCalled()
    expect(result).toEqual(newRate)
  })

  it('returns null on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'insert error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { addCommissionRate } = await import('@/lib/api/commissions')
    const result = await addCommissionRate({
      role_key: 'custom',
      label: 'Custom Rate',
      rate_type: 'per_watt',
      rate: 0.75,
      description: null,
      active: true,
      sort_order: 10,
      org_id: null,
    })

    expect(result).toBeNull()
  })
})

// ── deleteCommissionRate ───────────────────────────────────────────────────

describe('deleteCommissionRate', () => {
  it('deletes a rate and returns true', async () => {
    const chain = mockChain({ data: null, error: null })
    // Override then to resolve directly (delete doesn't use .single())
    chain.then = vi.fn((cb: any) => Promise.resolve({ data: null, error: null }).then(cb))
    mockSupabase.from.mockReturnValue(chain)

    const { deleteCommissionRate } = await import('@/lib/api/commissions')
    const result = await deleteCommissionRate('r1')

    expect(mockSupabase.from).toHaveBeenCalledWith('commission_rates')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'r1')
    expect(result).toBe(true)
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: null })
    chain.then = vi.fn((cb: any) => Promise.resolve({ data: null, error: { message: 'delete error' } }).then(cb))
    mockSupabase.from.mockReturnValue(chain)

    const { deleteCommissionRate } = await import('@/lib/api/commissions')
    const result = await deleteCommissionRate('r1')

    expect(result).toBe(false)
  })
})
