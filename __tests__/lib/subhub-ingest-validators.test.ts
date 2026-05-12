import { describe, it, expect } from 'vitest'
import { isSafeHttpUrl, safeContractDate, normAddr, mapSubhubStage, escapeLikePattern } from '@/lib/subhub/ingest'

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

// Action #901 — intra-batch dedup misses on suffix/case variants in 5/6 backfill.
describe('normAddr — address normalization for dedup', () => {
  it('collapses common suffix variants', () => {
    expect(normAddr('123 Main Drive')).toBe(normAddr('123 Main Dr'))
    expect(normAddr('456 Oak Avenue')).toBe(normAddr('456 Oak Ave'))
    expect(normAddr('789 Elm Street')).toBe(normAddr('789 Elm St'))
    expect(normAddr('10 Pine Lane')).toBe(normAddr('10 Pine Ln'))
    expect(normAddr('22 Cedar Road')).toBe(normAddr('22 Cedar Rd'))
    expect(normAddr('300 Maple Boulevard')).toBe(normAddr('300 Maple Blvd'))
    expect(normAddr('15 Court')).toBe(normAddr('15 Ct'))
  })

  it('is case-insensitive', () => {
    expect(normAddr('432 Scuttle Drive')).toBe(normAddr('432 SCUTTLE DRIVE'))
    expect(normAddr('627 Laurel St')).toBe(normAddr('627 laurel st'))
  })

  it('strips internal whitespace and punctuation', () => {
    expect(normAddr('5713  Lenore   Street')).toBe(normAddr('5713 Lenore St'))
    expect(normAddr('945 DUBINA AVE')).toBe(normAddr('945 Dubina Avenue'))
  })

  it('returns empty string for null/undefined/empty', () => {
    expect(normAddr(null)).toBe('')
    expect(normAddr(undefined)).toBe('')
    expect(normAddr('')).toBe('')
  })

  it('produces different outputs for substantively different addresses', () => {
    expect(normAddr('432 Scuttle Drive')).not.toBe(normAddr('432 Skuttle Drive'))
    expect(normAddr('100 Main St')).not.toBe(normAddr('101 Main St'))
  })

  // R1 M-1 — expanded suffix coverage.
  it('handles Trail/Parkway/Highway/Place/Circle/Terrace/Square/Way', () => {
    expect(normAddr('100 Pine Trail')).toBe(normAddr('100 Pine Trl'))
    expect(normAddr('100 Loop Parkway')).toBe(normAddr('100 Loop Pkwy'))
    expect(normAddr('100 Highway 6')).toBe(normAddr('100 Hwy 6'))
    expect(normAddr('100 Oak Place')).toBe(normAddr('100 Oak Pl'))
    expect(normAddr('100 Cedar Circle')).toBe(normAddr('100 Cedar Cir'))
    expect(normAddr('100 Maple Terrace')).toBe(normAddr('100 Maple Ter'))
    expect(normAddr('100 Park Square')).toBe(normAddr('100 Park Sq'))
  })

  // R1 M-1 — token-boundary preservation prevents false-positive collapse.
  it('does NOT collapse "12 3rd St" into "123 Rd St"', () => {
    expect(normAddr('12 3rd St')).not.toBe(normAddr('123 Rd St'))
  })
})

// R1 H-1 fix.
describe('escapeLikePattern — LIKE wildcard injection guard', () => {
  it('escapes %', () => {
    expect(escapeLikePattern('100%off')).toBe('100\\%off')
  })
  it('escapes _', () => {
    expect(escapeLikePattern('user_name')).toBe('user\\_name')
  })
  it('escapes backslash before % and _ (so order doesn\'t double-escape)', () => {
    expect(escapeLikePattern('\\')).toBe('\\\\')
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%')
  })
  it('leaves benign strings untouched', () => {
    expect(escapeLikePattern('John Smith')).toBe('John Smith')
  })
  it('handles an attacker payload of just "%"', () => {
    expect(escapeLikePattern('%')).toBe('\\%')
  })
})

// Action #902 — hardcoded stage='evaluation' caused the 1,754-row eval pile.
describe('mapSubhubStage — payload stage → MG stage', () => {
  it('maps Completed → complete', () => {
    expect(mapSubhubStage('Completed').stage).toBe('complete')
    expect(mapSubhubStage('COMPLETED').stage).toBe('complete')
  })

  it('maps Cancelled → evaluation with disposition Cancelled', () => {
    expect(mapSubhubStage('Cancelled')).toEqual({ stage: 'evaluation', disposition: 'Cancelled' })
    expect(mapSubhubStage('canceled')).toEqual({ stage: 'evaluation', disposition: 'Cancelled' })
  })

  it('maps Permitting → permit', () => {
    expect(mapSubhubStage('Permitting').stage).toBe('permit')
  })

  it('maps Design → design', () => {
    expect(mapSubhubStage('Design').stage).toBe('design')
    expect(mapSubhubStage('CAD').stage).toBe('design')
    expect(mapSubhubStage('Engineering').stage).toBe('design')
  })

  it('maps Install → install', () => {
    expect(mapSubhubStage('Install').stage).toBe('install')
    expect(mapSubhubStage('Installing').stage).toBe('install')
  })

  it('maps Inspection → inspection (and PTO)', () => {
    expect(mapSubhubStage('Inspection').stage).toBe('inspection')
    expect(mapSubhubStage('PTO').stage).toBe('inspection')
  })

  it('maps Site/Survey → survey', () => {
    expect(mapSubhubStage('Site Visit').stage).toBe('survey')
    expect(mapSubhubStage('Survey').stage).toBe('survey')
  })

  it('falls back to evaluation when stage is missing/unrecognized', () => {
    expect(mapSubhubStage(undefined).stage).toBe('evaluation')
    expect(mapSubhubStage(null).stage).toBe('evaluation')
    expect(mapSubhubStage('').stage).toBe('evaluation')
    expect(mapSubhubStage('   ').stage).toBe('evaluation')
    expect(mapSubhubStage('Lead').stage).toBe('evaluation')
    expect(mapSubhubStage(42 as unknown as string).stage).toBe('evaluation')
  })

  it('does not set disposition for non-cancelled stages', () => {
    expect(mapSubhubStage('Completed').disposition).toBeUndefined()
    expect(mapSubhubStage('Install').disposition).toBeUndefined()
    expect(mapSubhubStage('Lead').disposition).toBeUndefined()
  })

  // R1 H-2 — strict equality, not substring matching.
  it('does NOT substring-match payload values (R1 H-2)', () => {
    // Old behavior: .includes('complete') → matched ALL of these → 'complete'.
    // New strict map: only literal 'complete'/'completed'/'closed' are accepted.
    expect(mapSubhubStage('install_complete_review').stage).toBe('evaluation')
    expect(mapSubhubStage('PROCESS_INCOMPLETE_WORKFLOW').stage).toBe('evaluation')
    expect(mapSubhubStage('the_install_pending').stage).toBe('evaluation')
    expect(mapSubhubStage('captopril').stage).toBe('evaluation') // contained 'pto'
  })

  // R1 M-2 — terminal vocabulary expanded.
  it('maps additional terminal states to Cancelled', () => {
    expect(mapSubhubStage('Withdrawn').disposition).toBe('Cancelled')
    expect(mapSubhubStage('Lost').disposition).toBe('Cancelled')
    expect(mapSubhubStage('Refunded').disposition).toBe('Cancelled')
    expect(mapSubhubStage('Returned').disposition).toBe('Cancelled')
    expect(mapSubhubStage('Chargeback').disposition).toBe('Cancelled')
  })
})
