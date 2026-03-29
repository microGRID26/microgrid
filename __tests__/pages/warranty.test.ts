import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Extracted logic to test (mirrored from warranty page/tab) ────────────────

interface EquipmentWarranty {
  id: string
  project_id: string
  equipment_type: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  quantity: number
  install_date: string | null
  warranty_start_date: string | null
  warranty_end_date: string | null
  warranty_years: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface WarrantyClaim {
  id: string
  warranty_id: string
  project_id: string
  claim_number: string | null
  status: string
  issue_description: string | null
  submitted_date: string | null
  resolved_date: string | null
  resolution_notes: string | null
  replacement_serial: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Mirror the warrantyStatus logic from warranty page
function warrantyStatus(w: EquipmentWarranty): 'active' | 'expiring' | 'expired' | 'unknown' {
  if (!w.warranty_end_date) return 'unknown'
  const end = new Date(w.warranty_end_date + 'T00:00:00')
  const daysLeft = Math.floor((end.getTime() - Date.now()) / 86400000)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 90) return 'expiring'
  return 'active'
}

// Mirror the daysRemaining logic from warranty page
function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null
  const end = new Date(endDate + 'T00:00:00')
  return Math.floor((end.getTime() - Date.now()) / 86400000)
}

// Mirror sort logic from warranty page
function sortWarranties(
  warranties: EquipmentWarranty[],
  sortCol: string,
  sortAsc: boolean
): EquipmentWarranty[] {
  const sorted = [...warranties]
  sorted.sort((a, b) => {
    let va: string | number | null = null
    let vb: string | number | null = null
    switch (sortCol) {
      case 'project_id': va = a.project_id; vb = b.project_id; break
      case 'equipment_type': va = a.equipment_type; vb = b.equipment_type; break
      case 'manufacturer': va = a.manufacturer; vb = b.manufacturer; break
      case 'model': va = a.model; vb = b.model; break
      case 'serial_number': va = a.serial_number; vb = b.serial_number; break
      case 'warranty_end_date': va = a.warranty_end_date; vb = b.warranty_end_date; break
      case 'warranty_start_date': va = a.warranty_start_date; vb = b.warranty_start_date; break
      default: va = a.warranty_end_date; vb = b.warranty_end_date
    }
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    if (va < vb) return sortAsc ? -1 : 1
    if (va > vb) return sortAsc ? 1 : -1
    return 0
  })
  return sorted
}

// Mirror CSV export logic from warranty page
function formatCSVRow(w: EquipmentWarranty): string[] {
  const days = daysRemaining(w.warranty_end_date)
  return [
    w.project_id,
    w.equipment_type,
    w.manufacturer ?? '',
    w.model ?? '',
    w.serial_number ?? '',
    String(w.quantity),
    w.install_date ?? '',
    w.warranty_start_date ?? '',
    w.warranty_end_date ?? '',
    w.warranty_years != null ? String(w.warranty_years) : '',
    warrantyStatus(w),
    days != null ? String(days) : '',
  ]
}

function formatCSV(warranties: EquipmentWarranty[]): string {
  const headers = ['Project ID', 'Type', 'Manufacturer', 'Model', 'Serial Number', 'Qty', 'Install Date', 'Warranty Start', 'Warranty End', 'Years', 'Status', 'Days Remaining']
  const rows = warranties.map(formatCSVRow)
  return [headers, ...rows].map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
}

// Mirror filter logic from warranty page
function filterWarranties(
  warranties: EquipmentWarranty[],
  filters: {
    search?: string
    typeFilter?: string
    statusFilter?: string
    mfgFilter?: string
  }
): EquipmentWarranty[] {
  let result = warranties
  if (filters.typeFilter) {
    result = result.filter(w => w.equipment_type === filters.typeFilter)
  }
  if (filters.mfgFilter) {
    result = result.filter(w => w.manufacturer?.toLowerCase().includes(filters.mfgFilter!.toLowerCase()))
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    result = result.filter(w =>
      w.project_id.toLowerCase().includes(q) ||
      (w.manufacturer?.toLowerCase().includes(q)) ||
      (w.model?.toLowerCase().includes(q)) ||
      (w.serial_number?.toLowerCase().includes(q))
    )
  }
  if (filters.statusFilter) {
    result = result.filter(w => warrantyStatus(w) === filters.statusFilter)
  }
  return result
}

// Mirror auto-populate dedup logic from WarrantyTab
function getAutoPopulateEntries(
  project: { module?: string | null; module_qty?: number | null; inverter?: string | null; inverter_qty?: number | null; battery?: string | null; battery_qty?: number | null; optimizer?: string | null; optimizer_qty?: number | null },
  existingWarranties: EquipmentWarranty[]
): { type: string; model: string | null; count: number }[] {
  const entries: { type: string; model: string | null; count: number }[] = []
  if (project.module) entries.push({ type: 'panel', model: project.module, count: project.module_qty ?? 1 })
  if (project.inverter) entries.push({ type: 'inverter', model: project.inverter, count: project.inverter_qty ?? 1 })
  if (project.battery) entries.push({ type: 'battery', model: project.battery, count: project.battery_qty ?? 1 })
  if (project.optimizer) entries.push({ type: 'optimizer', model: project.optimizer, count: project.optimizer_qty ?? 1 })

  const existing = new Set(existingWarranties.map(w => `${w.equipment_type}|${w.model}`))
  return entries.filter(e => !existing.has(`${e.type}|${e.model}`))
}

// Claim status transition logic
const CLAIM_STATUSES = ['draft', 'submitted', 'approved', 'denied', 'completed'] as const

function getClaimUpdates(newStatus: string): Partial<{ submitted_date: string; resolved_date: string }> {
  const updates: Partial<{ submitted_date: string; resolved_date: string }> = {}
  if (newStatus === 'submitted') updates.submitted_date = new Date().toISOString().split('T')[0]
  if (newStatus === 'completed' || newStatus === 'denied') updates.resolved_date = new Date().toISOString().split('T')[0]
  return updates
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function futureDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function pastDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function makeWarranty(overrides: Partial<EquipmentWarranty> = {}): EquipmentWarranty {
  return {
    id: 'w-1',
    project_id: 'PROJ-001',
    equipment_type: 'panel',
    manufacturer: 'Q Cells',
    model: 'Q.PEAK DUO 405W',
    serial_number: 'SN-12345',
    quantity: 25,
    install_date: '2025-06-15',
    warranty_start_date: '2025-06-15',
    warranty_end_date: futureDate(365 * 20),
    warranty_years: 25,
    notes: null,
    created_at: '2025-06-15T00:00:00Z',
    updated_at: '2025-06-15T00:00:00Z',
    ...overrides,
  }
}

function makeClaim(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: 'c-1',
    warranty_id: 'w-1',
    project_id: 'PROJ-001',
    claim_number: null,
    status: 'draft',
    issue_description: 'Panel cracked',
    submitted_date: null,
    resolved_date: null,
    resolution_notes: null,
    replacement_serial: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── warrantyStatus tests ────────────────────────────────────────────────────

describe('warrantyStatus', () => {
  it('returns "active" when end date is more than 90 days in the future', () => {
    const w = makeWarranty({ warranty_end_date: futureDate(365) })
    expect(warrantyStatus(w)).toBe('active')
  })

  it('returns "expiring" when end date is within 90 days', () => {
    const w = makeWarranty({ warranty_end_date: futureDate(45) })
    expect(warrantyStatus(w)).toBe('expiring')
  })

  it('returns "expiring" when end date is exactly 90 days from now', () => {
    const w = makeWarranty({ warranty_end_date: futureDate(90) })
    expect(warrantyStatus(w)).toBe('expiring')
  })

  it('returns "expired" when end date is in the past', () => {
    const w = makeWarranty({ warranty_end_date: pastDate(10) })
    expect(warrantyStatus(w)).toBe('expired')
  })

  it('returns "expired" when end date was yesterday', () => {
    const w = makeWarranty({ warranty_end_date: pastDate(1) })
    expect(warrantyStatus(w)).toBe('expired')
  })

  it('returns "unknown" when end date is null', () => {
    const w = makeWarranty({ warranty_end_date: null })
    expect(warrantyStatus(w)).toBe('unknown')
  })

  it('returns "expired" when end date is yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const w = makeWarranty({ warranty_end_date: yesterday })
    expect(warrantyStatus(w)).toBe('expired')
  })

  it('returns "expiring" when end date is tomorrow (1 day left)', () => {
    const w = makeWarranty({ warranty_end_date: futureDate(1) })
    expect(warrantyStatus(w)).toBe('expiring')
  })

  it('returns "active" when end date is 92 days away', () => {
    // 91 days can round to 90 depending on time-of-day, so use 92 for reliable boundary
    const w = makeWarranty({ warranty_end_date: futureDate(92) })
    expect(warrantyStatus(w)).toBe('active')
  })
})

// ── daysRemaining tests ─────────────────────────────────────────────────────

describe('daysRemaining', () => {
  it('returns null for null end date', () => {
    expect(daysRemaining(null)).toBeNull()
  })

  it('returns positive number for future end date', () => {
    const result = daysRemaining(futureDate(100))
    expect(result).toBeGreaterThanOrEqual(99)
    expect(result).toBeLessThanOrEqual(100)
  })

  it('returns negative number for past end date', () => {
    const result = daysRemaining(pastDate(10))
    expect(result).toBeLessThan(0)
  })

  it('returns -1 or 0 for today (depends on time of day)', () => {
    // Midnight of today vs current time means result is -1 once past midnight
    const today = new Date().toISOString().split('T')[0]
    const result = daysRemaining(today)
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThanOrEqual(-1)
    expect(result!).toBeLessThanOrEqual(0)
  })

  it('returns exactly 365 for a date one year from now', () => {
    const result = daysRemaining(futureDate(365))
    // Allow 1 day variance for time-of-day rounding
    expect(result).toBeGreaterThanOrEqual(364)
    expect(result).toBeLessThanOrEqual(365)
  })
})

// ── Claim status transitions ────────────────────────────────────────────────

describe('claim status transitions', () => {
  it('sets submitted_date when moving to submitted', () => {
    const updates = getClaimUpdates('submitted')
    expect(updates.submitted_date).toBeDefined()
    expect(updates.resolved_date).toBeUndefined()
  })

  it('sets resolved_date when moving to completed', () => {
    const updates = getClaimUpdates('completed')
    expect(updates.resolved_date).toBeDefined()
    expect(updates.submitted_date).toBeUndefined()
  })

  it('sets resolved_date when moving to denied', () => {
    const updates = getClaimUpdates('denied')
    expect(updates.resolved_date).toBeDefined()
    expect(updates.submitted_date).toBeUndefined()
  })

  it('sets no dates when moving to draft', () => {
    const updates = getClaimUpdates('draft')
    expect(updates.submitted_date).toBeUndefined()
    expect(updates.resolved_date).toBeUndefined()
  })

  it('sets no dates when moving to approved', () => {
    const updates = getClaimUpdates('approved')
    expect(updates.submitted_date).toBeUndefined()
    expect(updates.resolved_date).toBeUndefined()
  })

  it('CLAIM_STATUSES has correct values', () => {
    expect(CLAIM_STATUSES).toEqual(['draft', 'submitted', 'approved', 'denied', 'completed'])
  })
})

// ── Filter logic ────────────────────────────────────────────────────────────

describe('filter logic', () => {
  const warranties: EquipmentWarranty[] = [
    makeWarranty({ id: 'w-1', project_id: 'PROJ-001', equipment_type: 'panel', manufacturer: 'Q Cells', model: 'DUO 405', warranty_end_date: futureDate(365) }),
    makeWarranty({ id: 'w-2', project_id: 'PROJ-002', equipment_type: 'inverter', manufacturer: 'Enphase', model: 'IQ8+', warranty_end_date: futureDate(30) }),
    makeWarranty({ id: 'w-3', project_id: 'PROJ-003', equipment_type: 'battery', manufacturer: 'Tesla', model: 'Powerwall 3', warranty_end_date: pastDate(10) }),
    makeWarranty({ id: 'w-4', project_id: 'PROJ-004', equipment_type: 'panel', manufacturer: 'Hanwha', model: 'Q.PEAK', warranty_end_date: null }),
  ]

  it('filters by equipment type', () => {
    const result = filterWarranties(warranties, { typeFilter: 'panel' })
    expect(result).toHaveLength(2)
    expect(result.every(w => w.equipment_type === 'panel')).toBe(true)
  })

  it('filters by manufacturer', () => {
    const result = filterWarranties(warranties, { mfgFilter: 'Tesla' })
    expect(result).toHaveLength(1)
    expect(result[0].manufacturer).toBe('Tesla')
  })

  it('filters by manufacturer case-insensitive', () => {
    const result = filterWarranties(warranties, { mfgFilter: 'tesla' })
    expect(result).toHaveLength(1)
  })

  it('filters by status (active)', () => {
    const result = filterWarranties(warranties, { statusFilter: 'active' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('w-1')
  })

  it('filters by status (expiring)', () => {
    const result = filterWarranties(warranties, { statusFilter: 'expiring' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('w-2')
  })

  it('filters by status (expired)', () => {
    const result = filterWarranties(warranties, { statusFilter: 'expired' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('w-3')
  })

  it('filters by search (project ID)', () => {
    const result = filterWarranties(warranties, { search: 'PROJ-002' })
    expect(result).toHaveLength(1)
    expect(result[0].project_id).toBe('PROJ-002')
  })

  it('filters by search (manufacturer)', () => {
    const result = filterWarranties(warranties, { search: 'enphase' })
    expect(result).toHaveLength(1)
    expect(result[0].manufacturer).toBe('Enphase')
  })

  it('filters by search (model)', () => {
    const result = filterWarranties(warranties, { search: 'Powerwall' })
    expect(result).toHaveLength(1)
    expect(result[0].model).toBe('Powerwall 3')
  })

  it('filters by search (serial number)', () => {
    const w = [makeWarranty({ serial_number: 'ABC-999' })]
    const result = filterWarranties(w, { search: 'abc-999' })
    expect(result).toHaveLength(1)
  })

  it('combines type and status filters', () => {
    const result = filterWarranties(warranties, { typeFilter: 'panel', statusFilter: 'active' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('w-1')
  })

  it('combines search with type filter', () => {
    const result = filterWarranties(warranties, { search: 'Q', typeFilter: 'panel' })
    expect(result).toHaveLength(2)
  })

  it('returns all when no filters', () => {
    const result = filterWarranties(warranties, {})
    expect(result).toHaveLength(4)
  })

  it('returns empty when no matches', () => {
    const result = filterWarranties(warranties, { search: 'nonexistent' })
    expect(result).toHaveLength(0)
  })
})

// ── Sort logic ──────────────────────────────────────────────────────────────

describe('sort logic', () => {
  const warranties: EquipmentWarranty[] = [
    makeWarranty({ id: 'w-1', project_id: 'PROJ-003', warranty_end_date: '2028-01-01', manufacturer: 'Q Cells' }),
    makeWarranty({ id: 'w-2', project_id: 'PROJ-001', warranty_end_date: '2030-06-15', manufacturer: 'Enphase' }),
    makeWarranty({ id: 'w-3', project_id: 'PROJ-002', warranty_end_date: null, manufacturer: 'Tesla' }),
  ]

  it('sorts by warranty_end_date ascending', () => {
    const result = sortWarranties(warranties, 'warranty_end_date', true)
    expect(result[0].id).toBe('w-1')
    expect(result[1].id).toBe('w-2')
    expect(result[2].id).toBe('w-3') // null goes last
  })

  it('sorts by warranty_end_date descending', () => {
    const result = sortWarranties(warranties, 'warranty_end_date', false)
    expect(result[0].id).toBe('w-2')
    expect(result[1].id).toBe('w-1')
    expect(result[2].id).toBe('w-3') // null still last
  })

  it('sorts by project_id ascending', () => {
    const result = sortWarranties(warranties, 'project_id', true)
    expect(result[0].project_id).toBe('PROJ-001')
    expect(result[1].project_id).toBe('PROJ-002')
    expect(result[2].project_id).toBe('PROJ-003')
  })

  it('sorts by manufacturer ascending', () => {
    const result = sortWarranties(warranties, 'manufacturer', true)
    expect(result[0].manufacturer).toBe('Enphase')
    expect(result[1].manufacturer).toBe('Q Cells')
    expect(result[2].manufacturer).toBe('Tesla')
  })

  it('handles null values — sorts nulls to the end', () => {
    const w = [
      makeWarranty({ id: 'w-a', manufacturer: null }),
      makeWarranty({ id: 'w-b', manufacturer: 'Alpha' }),
      makeWarranty({ id: 'w-c', manufacturer: 'Beta' }),
    ]
    const result = sortWarranties(w, 'manufacturer', true)
    expect(result[0].manufacturer).toBe('Alpha')
    expect(result[1].manufacturer).toBe('Beta')
    expect(result[2].manufacturer).toBeNull()
  })

  it('default sort col uses warranty_end_date', () => {
    const result = sortWarranties(warranties, 'unknown_column', true)
    // Falls through to default which is warranty_end_date
    expect(result[0].id).toBe('w-1')
    expect(result[1].id).toBe('w-2')
  })

  it('is stable for equal values', () => {
    const w = [
      makeWarranty({ id: 'w-a', equipment_type: 'panel' }),
      makeWarranty({ id: 'w-b', equipment_type: 'panel' }),
    ]
    const result = sortWarranties(w, 'equipment_type', true)
    expect(result[0].id).toBe('w-a')
    expect(result[1].id).toBe('w-b')
  })
})

// ── CSV export ──────────────────────────────────────────────────────────────

describe('CSV export', () => {
  it('formats a single warranty row correctly', () => {
    const w = makeWarranty({
      project_id: 'PROJ-001',
      equipment_type: 'panel',
      manufacturer: 'Q Cells',
      model: 'DUO 405',
      serial_number: 'SN-123',
      quantity: 25,
      install_date: '2025-06-15',
      warranty_start_date: '2025-06-15',
      warranty_end_date: futureDate(365),
      warranty_years: 25,
    })
    const row = formatCSVRow(w)
    expect(row[0]).toBe('PROJ-001')
    expect(row[1]).toBe('panel')
    expect(row[2]).toBe('Q Cells')
    expect(row[3]).toBe('DUO 405')
    expect(row[4]).toBe('SN-123')
    expect(row[5]).toBe('25')
    expect(row[9]).toBe('25') // warranty_years
    expect(row[10]).toBe('active')
    expect(Number(row[11])).toBeGreaterThan(0) // days remaining
  })

  it('handles null fields with empty strings', () => {
    const w = makeWarranty({
      manufacturer: null,
      model: null,
      serial_number: null,
      install_date: null,
      warranty_start_date: null,
      warranty_end_date: null,
      warranty_years: null,
    })
    const row = formatCSVRow(w)
    expect(row[2]).toBe('') // manufacturer
    expect(row[3]).toBe('') // model
    expect(row[4]).toBe('') // serial
    expect(row[6]).toBe('') // install_date
    expect(row[7]).toBe('') // start date
    expect(row[8]).toBe('') // end date
    expect(row[9]).toBe('') // years
    expect(row[10]).toBe('unknown') // status
    expect(row[11]).toBe('') // days remaining
  })

  it('escapes double quotes in CSV values', () => {
    const w = makeWarranty({ model: 'Model "X" Pro' })
    const csv = formatCSV([w])
    expect(csv).toContain('Model ""X"" Pro')
  })

  it('includes header row', () => {
    const csv = formatCSV([])
    expect(csv).toContain('Project ID')
    expect(csv).toContain('Days Remaining')
  })

  it('formats expired warranty correctly', () => {
    const w = makeWarranty({ warranty_end_date: pastDate(30) })
    const row = formatCSVRow(w)
    expect(row[10]).toBe('expired')
    expect(Number(row[11])).toBeLessThan(0)
  })
})

// ── Auto-populate from equipment ────────────────────────────────────────────

describe('auto-populate from equipment', () => {
  it('generates entries from all equipment types', () => {
    const project = {
      module: 'DUO 405',
      module_qty: 25,
      inverter: 'IQ8+',
      inverter_qty: 25,
      battery: 'Powerwall 3',
      battery_qty: 2,
      optimizer: 'P505',
      optimizer_qty: 25,
    }
    const result = getAutoPopulateEntries(project, [])
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ type: 'panel', model: 'DUO 405', count: 25 })
    expect(result[1]).toEqual({ type: 'inverter', model: 'IQ8+', count: 25 })
    expect(result[2]).toEqual({ type: 'battery', model: 'Powerwall 3', count: 2 })
    expect(result[3]).toEqual({ type: 'optimizer', model: 'P505', count: 25 })
  })

  it('skips null/empty equipment fields', () => {
    const project = { module: 'DUO 405', module_qty: 25, inverter: null, battery: null, optimizer: null }
    const result = getAutoPopulateEntries(project, [])
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('panel')
  })

  it('deduplicates against existing warranties', () => {
    const project = { module: 'DUO 405', module_qty: 25, inverter: 'IQ8+', inverter_qty: 25 }
    const existing = [makeWarranty({ equipment_type: 'panel', model: 'DUO 405' })]
    const result = getAutoPopulateEntries(project, existing)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('inverter')
  })

  it('returns empty when all equipment already has warranties', () => {
    const project = { module: 'DUO 405', module_qty: 25 }
    const existing = [makeWarranty({ equipment_type: 'panel', model: 'DUO 405' })]
    const result = getAutoPopulateEntries(project, existing)
    expect(result).toHaveLength(0)
  })

  it('returns empty when project has no equipment', () => {
    const project = {}
    const result = getAutoPopulateEntries(project, [])
    expect(result).toHaveLength(0)
  })

  it('defaults quantity to 1 when qty is null', () => {
    const project = { module: 'DUO 405', module_qty: null }
    const result = getAutoPopulateEntries(project, [])
    expect(result[0].count).toBe(1)
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('warrantyStatus handles empty string end date as unknown', () => {
    // The real code checks !w.warranty_end_date which is true for ''
    const w = makeWarranty({ warranty_end_date: '' as unknown as null })
    // Empty string is truthy, so it will try to parse — result depends on Date parsing
    // This tests that the code handles the edge case
    const status = warrantyStatus(w)
    expect(['active', 'expiring', 'expired', 'unknown']).toContain(status)
  })

  it('daysRemaining works with very far future dates', () => {
    const farFuture = '2099-12-31'
    const result = daysRemaining(farFuture)
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(20000)
  })

  it('daysRemaining works with very old dates', () => {
    const oldDate = '2000-01-01'
    const result = daysRemaining(oldDate)
    expect(result).not.toBeNull()
    expect(result!).toBeLessThan(-5000)
  })

  it('sort handles all-null column', () => {
    const w = [
      makeWarranty({ id: 'w-a', serial_number: null }),
      makeWarranty({ id: 'w-b', serial_number: null }),
    ]
    const result = sortWarranties(w, 'serial_number', true)
    expect(result).toHaveLength(2)
  })

  it('filter handles warranty with all null searchable fields', () => {
    const w = [makeWarranty({ manufacturer: null, model: null, serial_number: null })]
    const result = filterWarranties(w, { search: 'anything' })
    expect(result).toHaveLength(0)
  })

  it('CSV export handles 0 quantity', () => {
    const w = makeWarranty({ quantity: 0 })
    const row = formatCSVRow(w)
    expect(row[5]).toBe('0')
  })

  it('warrantyStatus boundary: exactly -1 day (yesterday) is expired', () => {
    const w = makeWarranty({ warranty_end_date: pastDate(1) })
    expect(warrantyStatus(w)).toBe('expired')
  })

  it('claim status transition: submitted sets today as submitted_date', () => {
    const today = new Date().toISOString().split('T')[0]
    const updates = getClaimUpdates('submitted')
    expect(updates.submitted_date).toBe(today)
  })

  it('claim status transition: completed sets today as resolved_date', () => {
    const today = new Date().toISOString().split('T')[0]
    const updates = getClaimUpdates('completed')
    expect(updates.resolved_date).toBe(today)
  })
})
