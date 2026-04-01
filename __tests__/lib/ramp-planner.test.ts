import { describe, it, expect } from 'vitest'
import {
  classifyTier, haversineDistance, estimateDriveMinutes,
  computeReadinessScore, computePriorityScore, optimizeRoute,
  getMonday, getWeekLabel, getNextWeeks, autoReadiness,
  TIER_INFO, RAMP_STATUSES, READINESS_WEIGHTS,
} from '@/lib/api/ramp-planner'

// ── Tier Classification ──────────────────────────────────────────────────────

describe('classifyTier', () => {
  it('county + non-ecoflow = tier 1', () => {
    expect(classifyTier('Harris County', 'Q.PEAK DUO', 'SolarEdge', null)).toBe(1)
  })

  it('county + ecoflow inverter = tier 2', () => {
    expect(classifyTier('Fort Bend County', 'Q.PEAK', 'EcoFlow Delta', null)).toBe(2)
  })

  it('county + ecoflow battery = tier 2', () => {
    expect(classifyTier('Montgomery County', 'Q.PEAK', 'SolarEdge', 'EcoFlow PowerStream')).toBe(2)
  })

  it('city + non-ecoflow = tier 3', () => {
    expect(classifyTier('Houston city', 'Q.PEAK DUO', 'SolarEdge', null)).toBe(3)
  })

  it('city + ecoflow = tier 4', () => {
    expect(classifyTier('Dallas city', 'Q.PEAK', 'EcoFlow Delta Pro', 'EcoFlow Delta')).toBe(4)
  })

  it('null AHJ = city (tier 3 or 4)', () => {
    expect(classifyTier(null, 'Q.PEAK', 'SolarEdge', null)).toBe(3)
  })

  it('case insensitive', () => {
    expect(classifyTier('HARRIS COUNTY', 'ECOFLOW Module', null, null)).toBe(2)
  })

  it('all 4 tiers have info defined', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(TIER_INFO[tier]).toBeDefined()
      expect(TIER_INFO[tier].label).toBeTruthy()
    }
  })
})

// ── Haversine Distance ───────────────────────────────────────────────────────

describe('haversineDistance', () => {
  it('same point = 0', () => {
    expect(haversineDistance(29.99, -95.41, 29.99, -95.41)).toBe(0)
  })

  it('warehouse to Katy ≈ 25 miles', () => {
    // Warehouse: 29.9902, -95.4152. Katy: ~29.7858, -95.8244
    const d = haversineDistance(29.9902, -95.4152, 29.7858, -95.8244)
    expect(d).toBeGreaterThan(20)
    expect(d).toBeLessThan(35)
  })

  it('Houston to Dallas ≈ 225 miles', () => {
    const d = haversineDistance(29.76, -95.37, 32.78, -96.80)
    expect(d).toBeGreaterThan(200)
    expect(d).toBeLessThan(260)
  })

  it('returns positive number', () => {
    expect(haversineDistance(30, -95, 31, -96)).toBeGreaterThan(0)
  })
})

describe('estimateDriveMinutes', () => {
  it('0 miles = 0 minutes', () => {
    expect(estimateDriveMinutes(0)).toBe(0)
  })

  it('30 miles ≈ 84 minutes (30mph, 1.4x road factor)', () => {
    const mins = estimateDriveMinutes(30)
    expect(mins).toBeGreaterThan(50)
    expect(mins).toBeLessThan(100)
  })
})

// ── Readiness Score ──────────────────────────────────────────────────────────

describe('computeReadinessScore', () => {
  it('all false = 0', () => {
    expect(computeReadinessScore({})).toBe(0)
  })

  it('all true = 100', () => {
    expect(computeReadinessScore({
      equipment_ready: true,
      homeowner_confirmed: true,
      permit_clear: true,
      utility_approved: true,
      hoa_approved: true,
      redesign_complete: true,
      crew_available: true,
    })).toBe(100)
  })

  it('equipment + homeowner = 40', () => {
    expect(computeReadinessScore({
      equipment_ready: true,
      homeowner_confirmed: true,
    })).toBe(40)
  })

  it('permit clear alone = 20', () => {
    expect(computeReadinessScore({ permit_clear: true })).toBe(20)
  })

  it('crew_available alone = 5 (lowest weight)', () => {
    expect(computeReadinessScore({ crew_available: true })).toBe(5)
  })
})

// ── Priority Score ───────────────────────────────────────────────────────────

describe('computePriorityScore', () => {
  const weights = { readiness: 0.4, proximity: 0.3, cluster: 0.15, value: 0.15 }

  it('perfect project scores high', () => {
    const score = computePriorityScore(100, 5, 5, 80000, 50, 100000, weights)
    expect(score).toBeGreaterThan(60)
  })

  it('unready project scores low even if close', () => {
    const score = computePriorityScore(0, 5, 5, 80000, 50, 100000, weights)
    expect(score).toBeLessThan(45)
  })

  it('far project with high readiness still scores decent', () => {
    const score = computePriorityScore(100, 45, 1, 50000, 50, 100000, weights)
    expect(score).toBeGreaterThan(30)
  })

  it('readiness has highest weight impact', () => {
    const highReady = computePriorityScore(100, 25, 2, 50000, 50, 100000, weights)
    const lowReady = computePriorityScore(20, 25, 2, 50000, 50, 100000, weights)
    expect(highReady - lowReady).toBeGreaterThan(20) // 80 * 0.4 = 32 point difference
  })
})

// ── Route Optimization ───────────────────────────────────────────────────────

describe('optimizeRoute', () => {
  const warehouse = { lat: 29.9902, lng: -95.4152 }

  it('empty list returns 0 miles', () => {
    const result = optimizeRoute(warehouse, [])
    expect(result.totalMiles).toBe(0)
    expect(result.ordered).toHaveLength(0)
    expect(result.legs).toHaveLength(0)
  })

  it('single point returns round trip', () => {
    const result = optimizeRoute(warehouse, [{ id: '1', lat: 29.78, lng: -95.82, label: 'Katy' }])
    expect(result.ordered).toHaveLength(1)
    expect(result.totalMiles).toBeGreaterThan(0)
    expect(result.legs).toHaveLength(2) // warehouse → katy → warehouse
  })

  it('two close points grouped before far point', () => {
    const points = [
      { id: '1', lat: 32.78, lng: -96.80, label: 'Dallas (far)' },
      { id: '2', lat: 29.80, lng: -95.50, label: 'Near A' },
      { id: '3', lat: 29.82, lng: -95.48, label: 'Near B' },
    ]
    const result = optimizeRoute(warehouse, points)
    // Nearest-neighbor should pick the two nearby points first
    expect(result.ordered[0].label).not.toBe('Dallas (far)')
    expect(result.ordered[1].label).not.toBe('Dallas (far)')
  })

  it('returns legs with from/to labels', () => {
    const points = [
      { id: '1', lat: 29.80, lng: -95.50, label: 'Job A' },
      { id: '2', lat: 29.82, lng: -95.48, label: 'Job B' },
    ]
    const result = optimizeRoute(warehouse, points)
    expect(result.legs[0].from).toBe('Warehouse')
    expect(result.legs[result.legs.length - 1].to).toBe('Warehouse')
  })

  it('total minutes is sum of leg minutes', () => {
    const points = [
      { id: '1', lat: 29.80, lng: -95.50, label: 'Job A' },
      { id: '2', lat: 29.70, lng: -95.60, label: 'Job B' },
    ]
    const result = optimizeRoute(warehouse, points)
    const legSum = result.legs.reduce((s, l) => s + l.minutes, 0)
    expect(result.totalMinutes).toBe(legSum)
  })
})

// ── Week Helpers ─────────────────────────────────────────────────────────────

describe('getMonday', () => {
  it('returns Monday for a Wednesday', () => {
    const monday = getMonday(new Date('2026-04-01T12:00:00')) // Wednesday
    expect(monday).toBe('2026-03-30')
  })

  it('Monday returns itself', () => {
    const monday = getMonday(new Date('2026-03-30T12:00:00')) // Monday
    expect(monday).toBe('2026-03-30')
  })

  it('Sunday returns previous Monday', () => {
    const monday = getMonday(new Date('2026-04-05T12:00:00')) // Sunday
    expect(monday).toBe('2026-03-30')
  })
})

describe('getWeekLabel', () => {
  it('formats week range correctly', () => {
    const label = getWeekLabel('2026-03-30')
    expect(label).toContain('Mar')
    expect(label).toContain('30')
    expect(label).toContain('–')
  })
})

describe('getNextWeeks', () => {
  it('returns correct count', () => {
    expect(getNextWeeks(4)).toHaveLength(4)
    expect(getNextWeeks(12)).toHaveLength(12)
  })

  it('all entries are Mondays', () => {
    const weeks = getNextWeeks(4)
    for (const w of weeks) {
      const d = new Date(w + 'T12:00:00')
      expect(d.getDay()).toBe(1) // Monday
    }
  })

  it('weeks are 7 days apart', () => {
    const weeks = getNextWeeks(4)
    for (let i = 1; i < weeks.length; i++) {
      const diff = new Date(weeks[i]).getTime() - new Date(weeks[i - 1]).getTime()
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000)
    }
  })
})

// ── Auto Readiness ───────────────────────────────────────────────────────────

describe('autoReadiness', () => {
  it('county + non-ecoflow: permit + redesign + hoa + crew = 45', () => {
    const r = autoReadiness('Harris County', 'Q.PEAK', 'SolarEdge', null)
    expect(r.permit_clear).toBe(true)
    expect(r.redesign_complete).toBe(true)
    expect(r.hoa_approved).toBe(true)
    expect(r.crew_available).toBe(true)
    expect(r.equipment_ready).toBe(false)
    expect(r.homeowner_confirmed).toBe(false)
    expect(computeReadinessScore(r as any)).toBe(45) // permit=20, hoa=10, redesign=10, crew=5
  })

  it('city + ecoflow: only hoa + crew = 15', () => {
    const r = autoReadiness('Houston city', 'Q.PEAK', 'EcoFlow Delta', null)
    expect(r.permit_clear).toBe(false)
    expect(r.redesign_complete).toBe(false)
    expect(r.hoa_approved).toBe(true)
    expect(computeReadinessScore(r as any)).toBe(15) // hoa=10, crew=5
  })

  it('county + ecoflow: permit + hoa + crew = 35', () => {
    const r = autoReadiness('Fort Bend County', null, null, 'EcoFlow Battery')
    expect(r.permit_clear).toBe(true)
    expect(r.redesign_complete).toBe(false)
    expect(computeReadinessScore(r as any)).toBe(35) // permit=20, hoa=10, crew=5
  })
})

describe('READINESS_WEIGHTS', () => {
  it('weights sum to 100', () => {
    const total = READINESS_WEIGHTS.reduce((sum, w) => sum + w.weight, 0)
    expect(total).toBe(100)
  })
})

describe('constants', () => {
  it('has 6 ramp statuses', () => {
    expect(RAMP_STATUSES).toHaveLength(6)
    expect(RAMP_STATUSES).toContain('planned')
    expect(RAMP_STATUSES).toContain('completed')
  })
})
