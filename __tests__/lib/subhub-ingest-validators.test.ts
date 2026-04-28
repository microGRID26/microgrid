import { describe, it, expect } from 'vitest'
import { isSafeHttpUrl, safeContractDate } from '@/lib/subhub/ingest'

// R1 audit fix tests — Critical 1 (XSS via doc URLs) + High 4 (date validation).

describe('isSafeHttpUrl — XSS guard for SubHub document URLs', () => {
  it('accepts https URLs', () => {
    expect(isSafeHttpUrl('https://cdn.virtualsaleportal.com/contract.pdf')).toBe(true)
  })

  it('accepts http URLs (legacy CDNs)', () => {
    expect(isSafeHttpUrl('http://example.com/doc.pdf')).toBe(true)
  })

  it('rejects javascript: scheme', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: scheme', () => {
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects file: scheme', () => {
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects vbscript: scheme', () => {
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isSafeHttpUrl('')).toBe(false)
  })

  it('rejects null', () => {
    expect(isSafeHttpUrl(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isSafeHttpUrl(undefined)).toBe(false)
  })

  it('rejects non-string types', () => {
    expect(isSafeHttpUrl(42)).toBe(false)
    expect(isSafeHttpUrl({})).toBe(false)
    expect(isSafeHttpUrl([])).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isSafeHttpUrl('not a url')).toBe(false)
    expect(isSafeHttpUrl('://')).toBe(false)
  })

  it('rejects scheme-only (no host)', () => {
    expect(isSafeHttpUrl('https:')).toBe(false)
  })
})

describe('safeContractDate — sale_date guard', () => {
  it('accepts ISO date string YYYY-MM-DD', () => {
    expect(safeContractDate('2026-04-28')).toBe('2026-04-28')
  })

  it('accepts ISO datetime and trims to date', () => {
    expect(safeContractDate('2026-04-27T22:44:42+00:00')).toBe('2026-04-27')
  })

  it('rejects "tomorrow" and other words', () => {
    expect(safeContractDate('tomorrow')).toBeNull()
    expect(safeContractDate('today')).toBeNull()
  })

  it('rejects script-injection attempts', () => {
    expect(safeContractDate('<script>alert(1)</script>')).toBeNull()
  })

  it('rejects pre-2000 dates', () => {
    expect(safeContractDate('1999-12-31')).toBeNull()
    expect(safeContractDate('1970-01-01')).toBeNull()
  })

  it('rejects far-future dates', () => {
    expect(safeContractDate('9999-12-31')).toBeNull()
    expect(safeContractDate('2099-01-01')).toBeNull()
  })

  it('accepts today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(safeContractDate(today)).toBe(today)
  })

  it('rejects null and undefined', () => {
    expect(safeContractDate(null)).toBeNull()
    expect(safeContractDate(undefined)).toBeNull()
  })

  it('rejects non-string types', () => {
    expect(safeContractDate(20260428)).toBeNull()
    expect(safeContractDate({})).toBeNull()
  })

  it('rejects malformed date strings', () => {
    expect(safeContractDate('2026-13-01')).toBeNull() // bad month
    expect(safeContractDate('2026-04-99')).toBeNull() // bad day
    expect(safeContractDate('2026/04/28')).toBeNull() // wrong separator
  })
})
