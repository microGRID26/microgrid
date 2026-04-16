// __tests__/lib/partner-api-pii.test.ts — Customer PII redaction.

import { describe, it, expect } from 'vitest'
import { redactCustomerFields } from '@/lib/partner-api/pii'

describe('redactCustomerFields', () => {
  const row = {
    id: 'PROJ-1',
    name: 'Jane Doe',
    address: '123 Main St',
    city: 'Austin',
    email: 'jane@example.com',
    phone: '512-555-0199',
    systemkw: 10,
  }

  it('preserves all fields when hasPiiScope=true', () => {
    const out = redactCustomerFields(row, true)
    expect(out).toEqual(row)
  })

  it('redacts email + phone when hasPiiScope=false', () => {
    const out = redactCustomerFields(row, false)
    expect(out.email).toBeNull()
    expect(out.phone).toBeNull()
    expect(out.name).toBe('Jane Doe')
    expect(out.address).toBe('123 Main St')
    expect(out.systemkw).toBe(10)
  })

  it('redacts case-insensitively', () => {
    const r = { Email: 'x@y.com', Phone_Mobile: '555', Address: 'ok' }
    const out = redactCustomerFields(r, false)
    expect(out.Email).toBeNull()
    expect(out.Phone_Mobile).toBeNull()
    expect(out.Address).toBe('ok')
  })

  it('redacts all PII key variants', () => {
    const r = {
      email_primary: 'a', email_secondary: 'b',
      phone_home: 'c', phone_mobile: 'd', phone_work: 'e',
      mobile: 'f', cell: 'g',
      name: 'keep',
    }
    const out = redactCustomerFields(r, false)
    expect(out.email_primary).toBeNull()
    expect(out.email_secondary).toBeNull()
    expect(out.phone_home).toBeNull()
    expect(out.phone_mobile).toBeNull()
    expect(out.phone_work).toBeNull()
    expect(out.mobile).toBeNull()
    expect(out.cell).toBeNull()
    expect(out.name).toBe('keep')
  })

  it('returns a new object; does not mutate input', () => {
    const original = { email: 'x' }
    const out = redactCustomerFields(original, false)
    expect(original.email).toBe('x')
    expect(out.email).toBeNull()
  })
})
