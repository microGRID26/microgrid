import { describe, it, expect, vi } from 'vitest'

// Test the extracted logic from MaterialsTab without rendering the full component.
// This follows the project convention of testing business logic rather than full page rendering.

// ── Status cycling logic ────────────────────────────────────────────────────

describe('MaterialsTab status cycling logic', () => {
  const MATERIAL_STATUSES = ['needed', 'ordered', 'shipped', 'delivered', 'installed'] as const

  function getNextStatus(current: string): string {
    const idx = MATERIAL_STATUSES.indexOf(current as any)
    return MATERIAL_STATUSES[(idx + 1) % MATERIAL_STATUSES.length]
  }

  it('cycles needed -> ordered', () => {
    expect(getNextStatus('needed')).toBe('ordered')
  })

  it('cycles ordered -> shipped', () => {
    expect(getNextStatus('ordered')).toBe('shipped')
  })

  it('cycles shipped -> delivered', () => {
    expect(getNextStatus('shipped')).toBe('delivered')
  })

  it('cycles delivered -> installed', () => {
    expect(getNextStatus('delivered')).toBe('installed')
  })

  it('cycles installed -> needed (wraps around)', () => {
    expect(getNextStatus('installed')).toBe('needed')
  })

  it('auto-sets delivered_date when cycling to delivered and no existing date', () => {
    const material = { status: 'shipped', delivered_date: null }
    const next = getNextStatus(material.status)
    const updates: Record<string, any> = { status: next }
    if (next === 'delivered' && !material.delivered_date) {
      updates.delivered_date = new Date().toISOString().split('T')[0]
    }
    expect(updates.status).toBe('delivered')
    expect(updates.delivered_date).toBeDefined()
    expect(updates.delivered_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('does not overwrite existing delivered_date when cycling to delivered', () => {
    const material = { status: 'shipped', delivered_date: '2026-01-15' }
    const next = getNextStatus(material.status)
    const updates: Record<string, any> = { status: next }
    if (next === 'delivered' && !material.delivered_date) {
      updates.delivered_date = new Date().toISOString().split('T')[0]
    }
    expect(updates.delivered_date).toBeUndefined()
  })
})

// ── Auto-generate count logic ───────────────────────────────────────────────

describe('MaterialsTab auto-generate count logic', () => {
  interface MaterialLike {
    category: string
    name: string
  }

  interface ProjectEquipment {
    module: string | null
    module_qty: number | null
    inverter: string | null
    inverter_qty: number | null
    battery: string | null
    battery_qty: number | null
    optimizer: string | null
    optimizer_qty: number | null
  }

  function countAutoItems(materials: MaterialLike[], project: ProjectEquipment): number {
    const existingKeys = new Set(materials.map(m => `${m.category}:${m.name}`))
    let count = 0
    if (project.module && (project.module_qty ?? 0) > 0 && !existingKeys.has(`module:${project.module}`)) count++
    if (project.inverter && (project.inverter_qty ?? 0) > 0 && !existingKeys.has(`inverter:${project.inverter}`)) count++
    if (project.battery && (project.battery_qty ?? 0) > 0 && !existingKeys.has(`battery:${project.battery}`)) count++
    if (project.optimizer && (project.optimizer_qty ?? 0) > 0 && !existingKeys.has(`optimizer:${project.optimizer}`)) count++
    return count
  }

  it('counts all equipment when materials list is empty', () => {
    const count = countAutoItems([], {
      module: 'REC Alpha 400W', module_qty: 20,
      inverter: 'Enphase IQ8+', inverter_qty: 20,
      battery: 'Tesla Powerwall', battery_qty: 2,
      optimizer: null, optimizer_qty: null,
    })
    expect(count).toBe(3)
  })

  it('returns 0 when all equipment already exists in materials', () => {
    const materials = [
      { category: 'module', name: 'REC Alpha 400W' },
      { category: 'inverter', name: 'Enphase IQ8+' },
    ]
    const count = countAutoItems(materials, {
      module: 'REC Alpha 400W', module_qty: 20,
      inverter: 'Enphase IQ8+', inverter_qty: 20,
      battery: null, battery_qty: null,
      optimizer: null, optimizer_qty: null,
    })
    expect(count).toBe(0)
  })

  it('skips equipment with null name', () => {
    const count = countAutoItems([], {
      module: null, module_qty: 20,
      inverter: null, inverter_qty: null,
      battery: null, battery_qty: null,
      optimizer: null, optimizer_qty: null,
    })
    expect(count).toBe(0)
  })

  it('skips equipment with zero quantity', () => {
    const count = countAutoItems([], {
      module: 'REC Alpha 400W', module_qty: 0,
      inverter: 'Enphase IQ8+', inverter_qty: 0,
      battery: null, battery_qty: null,
      optimizer: null, optimizer_qty: null,
    })
    expect(count).toBe(0)
  })

  it('skips equipment with null quantity', () => {
    const count = countAutoItems([], {
      module: 'REC Alpha 400W', module_qty: null,
      inverter: null, inverter_qty: null,
      battery: null, battery_qty: null,
      optimizer: null, optimizer_qty: null,
    })
    expect(count).toBe(0)
  })

  it('counts only new items when some already exist', () => {
    const materials = [{ category: 'module', name: 'REC Alpha 400W' }]
    const count = countAutoItems(materials, {
      module: 'REC Alpha 400W', module_qty: 20,
      inverter: 'Enphase IQ8+', inverter_qty: 20,
      battery: 'Tesla Powerwall', battery_qty: 1,
      optimizer: 'SolarEdge P505', optimizer_qty: 20,
    })
    // module already exists, so only inverter, battery, optimizer = 3
    expect(count).toBe(3)
  })

  it('counts all 4 equipment types when all present and new', () => {
    const count = countAutoItems([], {
      module: 'Panel X', module_qty: 10,
      inverter: 'Inverter Y', inverter_qty: 1,
      battery: 'Battery Z', battery_qty: 2,
      optimizer: 'Optimizer W', optimizer_qty: 10,
    })
    expect(count).toBe(4)
  })
})

// ── Material category and source defaults ───────────────────────────────────

describe('MaterialsTab category colors', () => {
  const CATEGORY_COLORS: Record<string, string> = {
    module: 'bg-blue-500/20 text-blue-400',
    inverter: 'bg-purple-500/20 text-purple-400',
    battery: 'bg-emerald-500/20 text-emerald-400',
    optimizer: 'bg-amber-500/20 text-amber-400',
    racking: 'bg-orange-500/20 text-orange-400',
    electrical: 'bg-red-500/20 text-red-400',
    other: 'bg-gray-500/20 text-gray-400',
  }

  it('has distinct colors for all 7 categories', () => {
    const categories = ['module', 'inverter', 'battery', 'optimizer', 'racking', 'electrical', 'other']
    for (const cat of categories) {
      expect(CATEGORY_COLORS[cat]).toBeDefined()
    }
    // Verify all colors are unique
    const colors = Object.values(CATEGORY_COLORS)
    expect(new Set(colors).size).toBe(colors.length)
  })
})

describe('MaterialsTab status colors', () => {
  const STATUS_COLORS: Record<string, string> = {
    needed: 'bg-gray-500/20 text-gray-400',
    ordered: 'bg-blue-500/20 text-blue-400',
    shipped: 'bg-amber-500/20 text-amber-400',
    delivered: 'bg-green-500/20 text-green-400',
    installed: 'bg-emerald-500/20 text-emerald-300',
  }

  it('has colors for all 5 statuses', () => {
    const statuses = ['needed', 'ordered', 'shipped', 'delivered', 'installed']
    for (const s of statuses) {
      expect(STATUS_COLORS[s]).toBeDefined()
    }
  })
})

// ── Source defaults for auto-generated materials ────────────────────────────

describe('MaterialsTab source defaults', () => {
  function getSourceForCategory(category: string): string {
    if (['module', 'inverter', 'battery'].includes(category)) return 'dropship'
    return 'tbd'
  }

  it('modules default to dropship', () => {
    expect(getSourceForCategory('module')).toBe('dropship')
  })

  it('inverters default to dropship', () => {
    expect(getSourceForCategory('inverter')).toBe('dropship')
  })

  it('batteries default to dropship', () => {
    expect(getSourceForCategory('battery')).toBe('dropship')
  })

  it('optimizers default to tbd', () => {
    expect(getSourceForCategory('optimizer')).toBe('tbd')
  })

  it('racking defaults to tbd', () => {
    expect(getSourceForCategory('racking')).toBe('tbd')
  })

  it('electrical defaults to tbd', () => {
    expect(getSourceForCategory('electrical')).toBe('tbd')
  })

  it('other defaults to tbd', () => {
    expect(getSourceForCategory('other')).toBe('tbd')
  })
})

// ── PO creation from selected materials ─────────────────────────────────────

describe('MaterialsTab PO creation logic', () => {
  interface MaterialForPO {
    id: string
    name: string
    quantity: number
    equipment_id: string | null
  }

  function buildLineItems(selectedIds: Set<string>, materials: MaterialForPO[]) {
    return materials
      .filter(m => selectedIds.has(m.id))
      .map(m => ({
        material_id: m.id,
        equipment_id: m.equipment_id ?? null,
        name: m.name,
        quantity: m.quantity,
        unit_price: null as number | null,
        total_price: null as number | null,
        notes: null as string | null,
      }))
  }

  it('builds line items from selected material IDs', () => {
    const materials: MaterialForPO[] = [
      { id: 'm1', name: 'Panel X', quantity: 20, equipment_id: 'eq-1' },
      { id: 'm2', name: 'Inverter Y', quantity: 1, equipment_id: 'eq-2' },
      { id: 'm3', name: 'MC4 Connectors', quantity: 50, equipment_id: null },
    ]
    const selected = new Set(['m1', 'm3'])

    const items = buildLineItems(selected, materials)

    expect(items).toHaveLength(2)
    expect(items[0].name).toBe('Panel X')
    expect(items[0].material_id).toBe('m1')
    expect(items[0].equipment_id).toBe('eq-1')
    expect(items[1].name).toBe('MC4 Connectors')
    expect(items[1].material_id).toBe('m3')
    expect(items[1].equipment_id).toBeNull()
  })

  it('returns empty array when no materials selected', () => {
    const materials: MaterialForPO[] = [
      { id: 'm1', name: 'Panel X', quantity: 20, equipment_id: null },
    ]
    const selected = new Set<string>()

    const items = buildLineItems(selected, materials)
    expect(items).toEqual([])
  })

  it('sets unit_price and total_price to null (filled later)', () => {
    const materials: MaterialForPO[] = [
      { id: 'm1', name: 'Panel X', quantity: 20, equipment_id: null },
    ]
    const items = buildLineItems(new Set(['m1']), materials)

    expect(items[0].unit_price).toBeNull()
    expect(items[0].total_price).toBeNull()
  })

  it('preserves quantity from material', () => {
    const materials: MaterialForPO[] = [
      { id: 'm1', name: 'Panel X', quantity: 42, equipment_id: null },
    ]
    const items = buildLineItems(new Set(['m1']), materials)

    expect(items[0].quantity).toBe(42)
  })
})

// ── Status counts reduction ─────────────────────────────────────────────────

describe('MaterialsTab status counts', () => {
  interface MaterialLike { status: string }

  function computeStatusCounts(materials: MaterialLike[]): Record<string, number> {
    return materials.reduce<Record<string, number>>((acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1
      return acc
    }, {})
  }

  it('counts each status correctly', () => {
    const materials: MaterialLike[] = [
      { status: 'needed' },
      { status: 'needed' },
      { status: 'ordered' },
      { status: 'delivered' },
      { status: 'delivered' },
      { status: 'delivered' },
      { status: 'installed' },
    ]
    const counts = computeStatusCounts(materials)

    expect(counts.needed).toBe(2)
    expect(counts.ordered).toBe(1)
    expect(counts.delivered).toBe(3)
    expect(counts.installed).toBe(1)
    expect(counts.shipped).toBeUndefined()
  })

  it('returns empty object for empty materials list', () => {
    const counts = computeStatusCounts([])
    expect(counts).toEqual({})
  })
})

// ── PO selection toggling ───────────────────────────────────────────────────

describe('MaterialsTab PO selection toggle', () => {
  function togglePOSelect(prev: Set<string>, id: string): Set<string> {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  it('adds item when not selected', () => {
    const result = togglePOSelect(new Set(), 'm1')
    expect(result.has('m1')).toBe(true)
  })

  it('removes item when already selected', () => {
    const result = togglePOSelect(new Set(['m1']), 'm1')
    expect(result.has('m1')).toBe(false)
  })

  it('preserves other selections when toggling', () => {
    const result = togglePOSelect(new Set(['m1', 'm2']), 'm3')
    expect(result.has('m1')).toBe(true)
    expect(result.has('m2')).toBe(true)
    expect(result.has('m3')).toBe(true)
    expect(result.size).toBe(3)
  })
})
