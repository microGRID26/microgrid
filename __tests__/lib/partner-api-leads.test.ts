// __tests__/lib/partner-api-leads.test.ts — Lead validators + id generator.

import { describe, it, expect } from 'vitest'
import {
  validateLeadCreate,
  validateLeadPatch,
  generateLeadId,
  LEAD_PATCHABLE_FIELDS,
  VALID_LEAD_DOC_TYPES,
} from '@/lib/partner-api/leads'
import { ApiError } from '@/lib/partner-api/errors'

describe('validateLeadCreate', () => {
  const base = {
    name: 'Jane Doe',
    address: '123 Main St',
    phone: '512-555-0199',
  }

  it('accepts minimal valid input', () => {
    const out = validateLeadCreate(base)
    expect(out.name).toBe('Jane Doe')
    expect(out.address).toBe('123 Main St')
    expect(out.phone).toBe('512-555-0199')
    expect(out.email).toBeNull()
    expect(out.systemkw).toBeNull()
  })

  it('trims name and address', () => {
    const out = validateLeadCreate({ ...base, name: '  Jane  ', address: '  1 Oak ' })
    expect(out.name).toBe('Jane')
    expect(out.address).toBe('1 Oak')
  })

  it('requires name', () => {
    expect(() => validateLeadCreate({ ...base, name: '' })).toThrowError(ApiError)
    expect(() => validateLeadCreate({ ...base, name: '   ' })).toThrowError(ApiError)
    const { name: _name, ...rest } = base
    expect(() => validateLeadCreate(rest)).toThrowError(ApiError)
  })

  it('requires address', () => {
    expect(() => validateLeadCreate({ ...base, address: '' })).toThrowError(ApiError)
  })

  it('requires at least one of phone or email', () => {
    expect(() => validateLeadCreate({ name: 'A', address: 'B' })).toThrowError(ApiError)
    // email-only is fine
    expect(() => validateLeadCreate({ name: 'A', address: 'B', email: 'a@b.com' })).not.toThrow()
  })

  it('validates sale_date format', () => {
    expect(() => validateLeadCreate({ ...base, sale_date: 'next tuesday' })).toThrowError(ApiError)
    expect(() => validateLeadCreate({ ...base, sale_date: '2026-04-16' })).not.toThrow()
    const out = validateLeadCreate({ ...base, sale_date: null })
    expect(out.sale_date).toBeNull()
  })

  it('validates systemkw is positive finite', () => {
    expect(() => validateLeadCreate({ ...base, systemkw: -1 })).toThrowError(ApiError)
    expect(() => validateLeadCreate({ ...base, systemkw: 0 })).toThrowError(ApiError)
    expect(() => validateLeadCreate({ ...base, systemkw: Infinity })).toThrowError(ApiError)
    expect(() => validateLeadCreate({ ...base, systemkw: 'ten' })).toThrowError(ApiError)
    const out = validateLeadCreate({ ...base, systemkw: 9.5 })
    expect(out.systemkw).toBe(9.5)
  })

  it('normalizes optional strings: empty → null', () => {
    const out = validateLeadCreate({ ...base, city: '', zip: '   ', dealer: null })
    expect(out.city).toBeNull()
    expect(out.zip).toBeNull()
    expect(out.dealer).toBeNull()
  })

  it('rejects non-object body', () => {
    expect(() => validateLeadCreate(null)).toThrowError(ApiError)
    expect(() => validateLeadCreate('string')).toThrowError(ApiError)
    expect(() => validateLeadCreate(42)).toThrowError(ApiError)
  })
})

describe('validateLeadPatch', () => {
  it('allows a single whitelisted field', () => {
    const { updates, ignored } = validateLeadPatch({ phone: '555-1234' })
    expect(updates).toEqual({ phone: '555-1234' })
    expect(ignored).toEqual([])
  })

  it('collects ignored non-whitelisted fields', () => {
    const { updates, ignored } = validateLeadPatch({
      name: 'Jane', stage: 'complete', disposition: 'Cancelled',
    })
    expect(updates).toEqual({ name: 'Jane' })
    expect(ignored.sort()).toEqual(['disposition', 'stage'])
  })

  it('rejects when no patchable fields provided', () => {
    expect(() => validateLeadPatch({ stage: 'install' })).toThrowError(ApiError)
    expect(() => validateLeadPatch({})).toThrowError(ApiError)
  })

  it('allows nulling a field', () => {
    const { updates } = validateLeadPatch({ phone: null })
    expect(updates).toEqual({ phone: null })
  })

  it('validates systemkw type', () => {
    expect(() => validateLeadPatch({ systemkw: -1 })).toThrowError(ApiError)
    expect(() => validateLeadPatch({ systemkw: 'ten' })).toThrowError(ApiError)
    const { updates } = validateLeadPatch({ systemkw: 12.5 })
    expect(updates).toEqual({ systemkw: 12.5 })
  })

  it('rejects non-string on string fields', () => {
    expect(() => validateLeadPatch({ name: 42 })).toThrowError(ApiError)
  })

  it('rejects non-object body', () => {
    expect(() => validateLeadPatch('nope')).toThrowError(ApiError)
  })
})

describe('generateLeadId', () => {
  it('returns LEAD- prefix + 12 hex chars (48 bits entropy)', () => {
    const id = generateLeadId()
    expect(id).toMatch(/^LEAD-[0-9a-f]{12}$/)
  })

  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateLeadId()))
    expect(ids.size).toBe(100)
  })
})

describe('validateLeadPatch (R1 + R2 cases)', () => {
  it('R1: coerces empty string to null (PATCH semantics match POST)', () => {
    const { updates } = validateLeadPatch({ email: '', phone: '   ' })
    expect(updates).toEqual({ email: null, phone: null })
  })

  it('R1: preserves explicit null', () => {
    const { updates } = validateLeadPatch({ email: null })
    expect(updates).toEqual({ email: null })
  })

  it('R1: trims non-empty strings', () => {
    const { updates } = validateLeadPatch({ city: '  Austin  ' })
    expect(updates).toEqual({ city: 'Austin' })
  })
})

describe('constants', () => {
  it('LEAD_PATCHABLE_FIELDS matches documented list', () => {
    expect([...LEAD_PATCHABLE_FIELDS].sort()).toEqual([
      'address', 'city', 'dealer', 'email', 'name', 'phone', 'systemkw', 'zip',
    ])
  })
  it('VALID_LEAD_DOC_TYPES matches documented list', () => {
    expect([...VALID_LEAD_DOC_TYPES].sort()).toEqual([
      'id', 'other', 'signed_contract', 'site_photo', 'utility_bill',
    ])
  })
})
