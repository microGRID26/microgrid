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
    like: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: any) => Promise.resolve(result).then(cb)),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// ── getCustomerAccount ──────────────────────────────────────────────────────

describe('getCustomerAccount', () => {
  it('returns account for authenticated user', async () => {
    const account = {
      id: 'acc-1',
      auth_user_id: 'user-123',
      email: 'customer@example.com',
      name: 'Jane Doe',
      phone: '555-1234',
      project_id: 'PROJ-001',
      status: 'active',
      last_login_at: null,
      notification_prefs: { email_updates: true, sms_updates: false },
      created_at: '2026-03-01',
    }

    // Mock auth.getUser to return a user
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'customer@example.com' } },
      error: null,
    })

    const chain = mockChain({ data: account, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { getCustomerAccount } = await import('@/lib/api/customer-portal')
    const result = await getCustomerAccount()

    expect(result).toEqual(account)
    expect(mockSupabase.from).toHaveBeenCalledWith('customer_accounts')
    expect(chain.eq).toHaveBeenCalledWith('auth_user_id', 'user-123')
    expect(chain.eq).toHaveBeenCalledWith('status', 'active')
    expect(chain.single).toHaveBeenCalled()
  })

  it('returns null when no authenticated user', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { getCustomerAccount } = await import('@/lib/api/customer-portal')
    const result = await getCustomerAccount()

    expect(result).toBeNull()
    // Should not query the DB at all
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('returns null when no account found', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-999' } },
      error: null,
    })

    const chain = mockChain({ data: null, error: { message: 'not found' } })
    mockSupabase.from.mockReturnValue(chain)

    const { getCustomerAccount } = await import('@/lib/api/customer-portal')
    const result = await getCustomerAccount()

    expect(result).toBeNull()
  })
})

// ── getCustomerAccountByEmail ───────────────────────────────────────────────

describe('getCustomerAccountByEmail', () => {
  it('returns account by email (lowercased)', async () => {
    const account = {
      id: 'acc-2',
      email: 'john@example.com',
      name: 'John Smith',
      project_id: 'PROJ-002',
      status: 'active',
    }

    const chain = mockChain({ data: account, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { getCustomerAccountByEmail } = await import('@/lib/api/customer-portal')
    const result = await getCustomerAccountByEmail('John@Example.COM')

    expect(result).toEqual(account)
    expect(chain.eq).toHaveBeenCalledWith('email', 'john@example.com')
  })

  it('returns null on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const { getCustomerAccountByEmail } = await import('@/lib/api/customer-portal')
    const result = await getCustomerAccountByEmail('none@example.com')

    expect(result).toBeNull()
  })
})

// ── loadCustomerProject ────────────────────────────────────────────────────

describe('loadCustomerProject', () => {
  it('returns customer-safe fields only', async () => {
    const project = {
      id: 'PROJ-001',
      name: 'Smith Residence',
      address: '123 Main St',
      city: 'Houston',
      zip: '77001',
      stage: 'install',
      stage_date: '2026-03-15',
      sale_date: '2026-01-10',
      module: 'REC Alpha 400W',
      module_qty: 20,
      inverter: 'Enphase IQ8+',
      inverter_qty: 20,
      systemkw: 8.0,
      financier: 'GoodLeap',
      disposition: 'Sale',
    }

    const chain = mockChain({ data: project, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCustomerProject } = await import('@/lib/api/customer-portal')
    const result = await loadCustomerProject('PROJ-001')

    expect(result).toEqual(project)
    expect(mockSupabase.from).toHaveBeenCalledWith('projects')
    expect(chain.eq).toHaveBeenCalledWith('id', 'PROJ-001')
    expect(chain.single).toHaveBeenCalled()
    // Verify select was called with customer-safe fields (no contract, blocker, pm_id, org_id)
    const selectArg = chain.select.mock.calls[0][0] as string
    expect(selectArg).toContain('id')
    expect(selectArg).toContain('name')
    expect(selectArg).toContain('stage')
    expect(selectArg).toContain('module')
    expect(selectArg).not.toContain('contract')
    expect(selectArg).not.toContain('blocker')
    expect(selectArg).not.toContain('pm_id')
    expect(selectArg).not.toContain('org_id')
  })

  it('returns null on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'not found' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCustomerProject } = await import('@/lib/api/customer-portal')
    const result = await loadCustomerProject('PROJ-999')

    expect(result).toBeNull()
  })
})

// ── loadProjectTimeline ────────────────────────────────────────────────────

describe('loadProjectTimeline', () => {
  it('returns sorted stage history entries', async () => {
    const history = [
      { id: 'h1', project_id: 'PROJ-001', stage: 'evaluation', entered: '2026-01-10' },
      { id: 'h2', project_id: 'PROJ-001', stage: 'survey', entered: '2026-01-15' },
      { id: 'h3', project_id: 'PROJ-001', stage: 'design', entered: '2026-02-01' },
    ]

    const chain = mockChain({ data: history, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectTimeline } = await import('@/lib/api/customer-portal')
    const result = await loadProjectTimeline('PROJ-001')

    expect(result).toEqual(history)
    expect(result).toHaveLength(3)
    expect(mockSupabase.from).toHaveBeenCalledWith('stage_history')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-001')
    expect(chain.order).toHaveBeenCalledWith('entered', { ascending: true })
    expect(chain.limit).toHaveBeenCalledWith(100)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectTimeline } = await import('@/lib/api/customer-portal')
    const result = await loadProjectTimeline('PROJ-001')

    expect(result).toEqual([])
  })
})

// ── loadProjectSchedule ────────────────────────────────────────────────────

describe('loadProjectSchedule', () => {
  it('returns customer-safe schedule fields', async () => {
    const schedule = [
      {
        id: 's1',
        project_id: 'PROJ-001',
        job_type: 'install',
        date: '2026-03-20',
        end_date: '2026-03-21',
        time: '08:00',
        status: 'scheduled',
        arrival_window: '8:00 AM - 10:00 AM',
      },
    ]

    const chain = mockChain({ data: schedule, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectSchedule } = await import('@/lib/api/customer-portal')
    const result = await loadProjectSchedule('PROJ-001')

    expect(result).toEqual(schedule)
    expect(mockSupabase.from).toHaveBeenCalledWith('schedule')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-001')
    expect(chain.order).toHaveBeenCalledWith('date', { ascending: true })
    expect(chain.limit).toHaveBeenCalledWith(50)
    // Verify select only includes customer-safe fields (no crew_id, notes, etc.)
    const selectArg = chain.select.mock.calls[0][0] as string
    expect(selectArg).toContain('job_type')
    expect(selectArg).toContain('date')
    expect(selectArg).toContain('arrival_window')
    expect(selectArg).not.toContain('crew_id')
    expect(selectArg).not.toContain('notes')
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectSchedule } = await import('@/lib/api/customer-portal')
    const result = await loadProjectSchedule('PROJ-001')

    expect(result).toEqual([])
  })
})

// ── loadCustomerTickets ────────────────────────────────────────────────────

describe('loadCustomerTickets', () => {
  it('returns tickets for project', async () => {
    const tickets = [
      {
        id: 't1',
        ticket_number: 'TKT-20260401-001',
        title: 'Panel issue',
        description: 'One panel looks cracked',
        category: 'service',
        priority: 'normal',
        status: 'open',
        created_at: '2026-04-01',
        resolved_at: null,
      },
      {
        id: 't2',
        ticket_number: 'TKT-20260402-001',
        title: 'Billing question',
        description: null,
        category: 'billing',
        priority: 'low',
        status: 'resolved',
        created_at: '2026-04-02',
        resolved_at: '2026-04-02',
      },
    ]

    const chain = mockChain({ data: tickets, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCustomerTickets } = await import('@/lib/api/customer-portal')
    const result = await loadCustomerTickets('PROJ-001')

    expect(result).toEqual(tickets)
    expect(result).toHaveLength(2)
    expect(mockSupabase.from).toHaveBeenCalledWith('tickets')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-001')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(100)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCustomerTickets } = await import('@/lib/api/customer-portal')
    const result = await loadCustomerTickets('PROJ-001')

    expect(result).toEqual([])
  })
})

// ── createCustomerTicket ───────────────────────────────────────────────────

describe('createCustomerTicket', () => {
  it('generates ticket number and sets source to customer_portal', async () => {
    const createdTicket = {
      id: 't-new',
      ticket_number: 'TKT-20260402-001',
      title: 'My panel is broken',
      description: 'There is a crack on one panel',
      category: 'service',
      priority: 'normal',
      status: 'open',
      created_at: '2026-04-02T10:00:00Z',
      resolved_at: null,
    }

    // First call: query existing ticket numbers (for sequence)
    const lookupChain = mockChain({ data: [], error: null })
    // Second call: insert the new ticket
    const insertChain = mockChain({ data: createdTicket, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      return callCount === 1 ? lookupChain : insertChain
    })

    const { createCustomerTicket } = await import('@/lib/api/customer-portal')
    const result = await createCustomerTicket(
      'PROJ-001',
      'My panel is broken',
      'There is a crack on one panel',
      'service',
      'Jane Doe'
    )

    expect(result).toEqual(createdTicket)

    // Verify insert was called with correct fields
    const insertCall = insertChain.insert.mock.calls[0][0]
    expect(insertCall.project_id).toBe('PROJ-001')
    expect(insertCall.title).toBe('My panel is broken')
    expect(insertCall.description).toBe('There is a crack on one panel')
    expect(insertCall.category).toBe('service')
    expect(insertCall.priority).toBe('normal')
    expect(insertCall.source).toBe('customer_portal')
    expect(insertCall.status).toBe('open')
    expect(insertCall.reported_by).toBe('Jane Doe')
    // Ticket number should follow TKT-YYYYMMDD-NNN format
    expect(insertCall.ticket_number).toMatch(/^TKT-\d{8}-\d{3}$/)
  })

  it('increments sequence when existing tickets exist', async () => {
    // Simulate existing ticket TKT-20260402-005
    const lookupChain = mockChain({
      data: [{ ticket_number: 'TKT-20260402-005' }],
      error: null,
    })
    const insertChain = mockChain({
      data: { id: 't-6', ticket_number: 'TKT-20260402-006' },
      error: null,
    })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      return callCount === 1 ? lookupChain : insertChain
    })

    const { createCustomerTicket } = await import('@/lib/api/customer-portal')
    const result = await createCustomerTicket('PROJ-001', 'Test', 'Desc', 'billing', 'John')

    // Verify the sequence was incremented to 006
    const insertCall = insertChain.insert.mock.calls[0][0]
    expect(insertCall.ticket_number).toMatch(/-006$/)
  })

  it('returns null on insert error', async () => {
    const lookupChain = mockChain({ data: [], error: null })
    const insertChain = mockChain({ data: null, error: { message: 'insert failed' } })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      return callCount === 1 ? lookupChain : insertChain
    })

    const { createCustomerTicket } = await import('@/lib/api/customer-portal')
    const result = await createCustomerTicket('PROJ-001', 'Test', 'Desc', 'service', 'Jane')

    expect(result).toBeNull()
  })
})

// ── loadTicketComments ─────────────────────────────────────────────────────

describe('loadTicketComments', () => {
  it('loads comments for a ticket', async () => {
    const comments = [
      { id: 'c1', ticket_id: 'tkt-1', author: 'Jane', message: 'Hello', created_at: '2026-04-01T08:00:00Z' },
      { id: 'c2', ticket_id: 'tkt-1', author: 'Support', message: 'Hi Jane', created_at: '2026-04-01T09:00:00Z' },
    ]

    const chain = mockChain({ data: comments, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadTicketComments } = await import('@/lib/api/customer-portal')
    const result = await loadTicketComments('tkt-1')

    expect(result).toEqual(comments)
    expect(result).toHaveLength(2)
    expect(mockSupabase.from).toHaveBeenCalledWith('ticket_comments')
    expect(chain.eq).toHaveBeenCalledWith('ticket_id', 'tkt-1')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(chain.limit).toHaveBeenCalledWith(200)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadTicketComments } = await import('@/lib/api/customer-portal')
    const result = await loadTicketComments('tkt-bad')

    expect(result).toEqual([])
  })
})

// ── addTicketComment ───────────────────────────────────────────────────────

describe('addTicketComment', () => {
  it('inserts a comment with is_internal=false', async () => {
    const chain = mockChain({ data: null, error: null })
    // addTicketComment does not call .single(), it just awaits the insert
    chain.then = vi.fn((cb: any) => Promise.resolve({ data: null, error: null }).then(cb))
    mockSupabase.from.mockReturnValue(chain)

    const { addTicketComment } = await import('@/lib/api/customer-portal')
    const result = await addTicketComment('tkt-1', 'Thanks for the update!', 'Jane Doe')

    expect(result).toBe(true)
    expect(mockSupabase.from).toHaveBeenCalledWith('ticket_comments')
    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.ticket_id).toBe('tkt-1')
    expect(insertArg.message).toBe('Thanks for the update!')
    expect(insertArg.author).toBe('Jane Doe')
    expect(insertArg.is_internal).toBe(false)
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: null })
    chain.then = vi.fn((cb: any) => Promise.resolve({ data: null, error: { message: 'fail' } }).then(cb))
    mockSupabase.from.mockReturnValue(chain)

    const { addTicketComment } = await import('@/lib/api/customer-portal')
    const result = await addTicketComment('tkt-1', 'msg', 'user')

    expect(result).toBe(false)
  })
})

// ── Chat Sessions ──────────────────────────────────────────────────────────

describe('loadChatSession', () => {
  it('returns chat session with messages', async () => {
    const session = {
      id: 'chat-1',
      messages: [
        { role: 'user', content: 'How is my project?', timestamp: '2026-04-01T08:00:00Z' },
        { role: 'assistant', content: 'Your project is in the install stage.', timestamp: '2026-04-01T08:00:05Z' },
      ],
    }

    const chain = mockChain({ data: session, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadChatSession } = await import('@/lib/api/customer-portal')
    const result = await loadChatSession('acc-1', 'PROJ-001')

    expect(result).toEqual({ id: 'chat-1', messages: session.messages })
    expect(mockSupabase.from).toHaveBeenCalledWith('customer_chat_sessions')
    expect(chain.eq).toHaveBeenCalledWith('account_id', 'acc-1')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-001')
  })

  it('returns null when no session found', async () => {
    const chain = mockChain({ data: null, error: { message: 'not found' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadChatSession } = await import('@/lib/api/customer-portal')
    const result = await loadChatSession('acc-1', 'PROJ-999')

    expect(result).toBeNull()
  })
})

describe('saveChatMessages', () => {
  it('updates messages on existing session', async () => {
    const chain = mockChain({ data: null, error: null })
    chain.then = vi.fn((cb: any) => Promise.resolve({ data: null, error: null }).then(cb))
    mockSupabase.from.mockReturnValue(chain)

    const messages = [
      { role: 'user' as const, content: 'Hello', timestamp: '2026-04-01T08:00:00Z' },
    ]

    const { saveChatMessages } = await import('@/lib/api/customer-portal')
    const result = await saveChatMessages('chat-1', messages)

    expect(result).toBe(true)
    expect(mockSupabase.from).toHaveBeenCalledWith('customer_chat_sessions')
    expect(chain.update).toHaveBeenCalledWith({ messages })
    expect(chain.eq).toHaveBeenCalledWith('id', 'chat-1')
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: null })
    chain.then = vi.fn((cb: any) => Promise.resolve({ data: null, error: { message: 'fail' } }).then(cb))
    mockSupabase.from.mockReturnValue(chain)

    const { saveChatMessages } = await import('@/lib/api/customer-portal')
    const result = await saveChatMessages('chat-1', [])

    expect(result).toBe(false)
  })
})

describe('createChatSession', () => {
  it('creates a new session and returns its id', async () => {
    const chain = mockChain({ data: { id: 'chat-new' }, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { createChatSession } = await import('@/lib/api/customer-portal')
    const result = await createChatSession('acc-1', 'PROJ-001')

    expect(result).toBe('chat-new')
    expect(mockSupabase.from).toHaveBeenCalledWith('customer_chat_sessions')
    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.account_id).toBe('acc-1')
    expect(insertArg.project_id).toBe('PROJ-001')
    expect(insertArg.messages).toEqual([])
  })

  it('returns null on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const { createChatSession } = await import('@/lib/api/customer-portal')
    const result = await createChatSession('acc-1', 'PROJ-001')

    expect(result).toBeNull()
  })
})

// ── inviteCustomer ─────────────────────────────────────────────────────────

describe('inviteCustomer', () => {
  it('creates account with invited status', async () => {
    const invited = {
      id: 'acc-new',
      auth_user_id: null,
      email: 'newcustomer@example.com',
      name: 'New Customer',
      phone: '555-9999',
      project_id: 'PROJ-003',
      status: 'invited',
      last_login_at: null,
      notification_prefs: { email_updates: true, sms_updates: false },
      created_at: '2026-04-02',
    }

    const chain = mockChain({ data: invited, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { inviteCustomer } = await import('@/lib/api/customer-portal')
    const result = await inviteCustomer(
      'NewCustomer@Example.COM',
      'New Customer',
      'PROJ-003',
      '555-9999',
      'Admin User'
    )

    expect(result).toEqual(invited)
    expect(mockSupabase.from).toHaveBeenCalledWith('customer_accounts')
    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.email).toBe('newcustomer@example.com') // lowercased
    expect(insertArg.name).toBe('New Customer')
    expect(insertArg.phone).toBe('555-9999')
    expect(insertArg.project_id).toBe('PROJ-003')
    expect(insertArg.status).toBe('invited')
    expect(insertArg.invited_by).toBe('Admin User')
  })

  it('sets phone and invited_by to null when omitted', async () => {
    const invited = {
      id: 'acc-new2',
      email: 'bare@example.com',
      name: 'Bare Customer',
      status: 'invited',
    }

    const chain = mockChain({ data: invited, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { inviteCustomer } = await import('@/lib/api/customer-portal')
    await inviteCustomer('bare@example.com', 'Bare Customer', 'PROJ-004')

    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.phone).toBeNull()
    expect(insertArg.invited_by).toBeNull()
  })

  it('returns null on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'duplicate email' } })
    mockSupabase.from.mockReturnValue(chain)

    const { inviteCustomer } = await import('@/lib/api/customer-portal')
    const result = await inviteCustomer('dup@example.com', 'Dup', 'PROJ-001')

    expect(result).toBeNull()
  })
})

// ── Constants: CUSTOMER_STAGE_LABELS & CUSTOMER_STAGE_DESCRIPTIONS ─────────

describe('CUSTOMER_STAGE_LABELS', () => {
  it('has labels for all 7 pipeline stages', async () => {
    const { CUSTOMER_STAGE_LABELS } = await import('@/lib/api/customer-portal')
    const stages = ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete']

    for (const stage of stages) {
      expect(CUSTOMER_STAGE_LABELS[stage]).toBeDefined()
      expect(CUSTOMER_STAGE_LABELS[stage].length).toBeGreaterThan(0)
    }

    expect(Object.keys(CUSTOMER_STAGE_LABELS)).toHaveLength(7)
  })

  it('uses customer-friendly names (not internal names)', async () => {
    const { CUSTOMER_STAGE_LABELS } = await import('@/lib/api/customer-portal')

    expect(CUSTOMER_STAGE_LABELS.evaluation).toBe('Getting Started')
    expect(CUSTOMER_STAGE_LABELS.complete).toBe('System Active')
    expect(CUSTOMER_STAGE_LABELS.permit).toBe('Permitting')
    expect(CUSTOMER_STAGE_LABELS.install).toBe('Installation')
  })
})

describe('CUSTOMER_STAGE_DESCRIPTIONS', () => {
  it('has descriptions for all 7 pipeline stages', async () => {
    const { CUSTOMER_STAGE_DESCRIPTIONS } = await import('@/lib/api/customer-portal')
    const stages = ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete']

    for (const stage of stages) {
      expect(CUSTOMER_STAGE_DESCRIPTIONS[stage]).toBeDefined()
      expect(CUSTOMER_STAGE_DESCRIPTIONS[stage].length).toBeGreaterThan(10)
    }

    expect(Object.keys(CUSTOMER_STAGE_DESCRIPTIONS)).toHaveLength(7)
  })
})

// ── JOB_TYPE_LABELS ────────────────────────────────────────────────────────

describe('JOB_TYPE_LABELS', () => {
  it('has labels for all job types', async () => {
    const { JOB_TYPE_LABELS } = await import('@/lib/api/customer-portal')

    expect(JOB_TYPE_LABELS.survey).toBe('Site Survey')
    expect(JOB_TYPE_LABELS.install).toBe('Installation')
    expect(JOB_TYPE_LABELS.inspection).toBe('Inspection')
    expect(JOB_TYPE_LABELS.service).toBe('Service Visit')
    expect(Object.keys(JOB_TYPE_LABELS)).toHaveLength(4)
  })
})
