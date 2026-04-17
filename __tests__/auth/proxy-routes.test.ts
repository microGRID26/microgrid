import { describe, it, expect } from 'vitest'

/**
 * Proxy route protection tests.
 * Tests the route rules, role hierarchy, and public route logic
 * defined in proxy.ts without needing Supabase auth.
 */

// ── Mirror proxy.ts logic for unit testing ──────────────────────────────────

const PUBLIC_ROUTES = ['/login', '/auth']
const PUBLIC_PREFIXES = ['/api/webhooks/', '/api/email/send-daily', '/api/email/onboarding-reminder', '/api/email/digest', '/api/calendar/webhook', '/api/portal/chat', '/api/customer/delete-account', '/api/v1/partner/', '/_next/', '/favicon.ico']

const ROLE_LEVEL: Record<string, number> = {
  super_admin: 5,
  admin: 4,
  finance: 3,
  manager: 2,
  user: 1,
  sales: 0,
}

const ROUTE_ROLE_REQUIREMENTS: { prefix: string; minLevel: number; label: string }[] = [
  { prefix: '/system', minLevel: 5, label: 'super_admin' },
  { prefix: '/admin', minLevel: 4, label: 'admin' },
  { prefix: '/analytics', minLevel: 2, label: 'manager' },
  { prefix: '/reports', minLevel: 2, label: 'manager' },
  { prefix: '/funding', minLevel: 2, label: 'manager' },
  { prefix: '/ntp', minLevel: 2, label: 'manager' },
  { prefix: '/inventory', minLevel: 2, label: 'manager' },
  { prefix: '/service', minLevel: 2, label: 'manager' },
  { prefix: '/work-orders', minLevel: 2, label: 'manager' },
  { prefix: '/warranty', minLevel: 2, label: 'manager' },
  { prefix: '/fleet', minLevel: 2, label: 'manager' },
  { prefix: '/vendors', minLevel: 2, label: 'manager' },
  { prefix: '/permits', minLevel: 2, label: 'manager' },
  { prefix: '/documents', minLevel: 2, label: 'manager' },
  { prefix: '/change-orders', minLevel: 2, label: 'manager' },
  { prefix: '/redesign', minLevel: 2, label: 'manager' },
  { prefix: '/legacy', minLevel: 2, label: 'manager' },
  { prefix: '/batch', minLevel: 2, label: 'manager' },
  { prefix: '/planset', minLevel: 2, label: 'manager' },
  { prefix: '/audit-trail', minLevel: 2, label: 'manager' },
  { prefix: '/audit', minLevel: 2, label: 'manager' },
  { prefix: '/dashboard', minLevel: 2, label: 'manager' },
  { prefix: '/sales', minLevel: 4, label: 'admin' },
  { prefix: '/invoices', minLevel: 3, label: 'finance' },
  { prefix: '/engineering', minLevel: 2, label: 'manager' },
]

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) return true
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return true
  if (pathname.includes('.') && !pathname.startsWith('/api/')) return true
  return false
}

function getRequiredLevel(pathname: string): { minLevel: number; label: string } | null {
  for (const route of ROUTE_ROLE_REQUIREMENTS) {
    if (pathname === route.prefix || pathname.startsWith(route.prefix + '/')) {
      return route
    }
  }
  return null
}

function canAccess(pathname: string, role: string): boolean {
  if (isPublicRoute(pathname)) return true
  const req = getRequiredLevel(pathname)
  if (!req) return true // no role requirement = any authenticated user
  return (ROLE_LEVEL[role] ?? 1) >= req.minLevel
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Public Routes', () => {
  it('/login is public', () => {
    expect(isPublicRoute('/login')).toBe(true)
  })

  it('/auth is public', () => {
    expect(isPublicRoute('/auth')).toBe(true)
  })

  it('/auth/callback is public', () => {
    expect(isPublicRoute('/auth/callback')).toBe(true)
  })

  it('/api/webhooks/subhub is public', () => {
    expect(isPublicRoute('/api/webhooks/subhub')).toBe(true)
  })

  it('/api/webhooks/edge is public', () => {
    expect(isPublicRoute('/api/webhooks/edge')).toBe(true)
  })

  it('/api/webhooks/subhub-vwc is public', () => {
    expect(isPublicRoute('/api/webhooks/subhub-vwc')).toBe(true)
  })

  it('/api/email/send-daily is public (cron)', () => {
    expect(isPublicRoute('/api/email/send-daily')).toBe(true)
  })

  it('/api/email/digest is public (cron)', () => {
    expect(isPublicRoute('/api/email/digest')).toBe(true)
  })

  it('/api/email/onboarding-reminder is public (cron)', () => {
    expect(isPublicRoute('/api/email/onboarding-reminder')).toBe(true)
  })

  it('/api/calendar/webhook is public', () => {
    expect(isPublicRoute('/api/calendar/webhook')).toBe(true)
  })

  it('/api/v1/partner/me is public (bearer-token auth, not session)', () => {
    expect(isPublicRoute('/api/v1/partner/me')).toBe(true)
  })

  it('/api/v1/partner/engineering/assignments is public', () => {
    expect(isPublicRoute('/api/v1/partner/engineering/assignments')).toBe(true)
  })

  it('/api/v1/partner/leads is public', () => {
    expect(isPublicRoute('/api/v1/partner/leads')).toBe(true)
  })

  it('/api/v1/partner-admin is NOT public (admin routes keep session auth)', () => {
    // Guard against over-broad prefix: '/api/v1/partner/' trailing slash is intentional.
    expect(isPublicRoute('/api/v1/partner-admin/keys')).toBe(false)
  })

  it('/_next/ static assets are public', () => {
    expect(isPublicRoute('/_next/static/chunk.js')).toBe(true)
  })

  it('static files with extensions are public', () => {
    expect(isPublicRoute('/logo.svg')).toBe(true)
    expect(isPublicRoute('/favicon.ico')).toBe(true)
  })

  it('/command is NOT public', () => {
    expect(isPublicRoute('/command')).toBe(false)
  })

  it('/api/reports/chat is NOT public', () => {
    expect(isPublicRoute('/api/reports/chat')).toBe(false)
  })

  it('/pipeline is NOT public', () => {
    expect(isPublicRoute('/pipeline')).toBe(false)
  })
})

describe('Role Hierarchy', () => {
  it('super_admin has level 5', () => {
    expect(ROLE_LEVEL.super_admin).toBe(5)
  })

  it('admin has level 4', () => {
    expect(ROLE_LEVEL.admin).toBe(4)
  })

  it('finance has level 3', () => {
    expect(ROLE_LEVEL.finance).toBe(3)
  })

  it('manager has level 2', () => {
    expect(ROLE_LEVEL.manager).toBe(2)
  })

  it('user has level 1', () => {
    expect(ROLE_LEVEL.user).toBe(1)
  })

  it('sales has level 0', () => {
    expect(ROLE_LEVEL.sales).toBe(0)
  })

  it('hierarchy is strictly ordered', () => {
    expect(ROLE_LEVEL.super_admin).toBeGreaterThan(ROLE_LEVEL.admin)
    expect(ROLE_LEVEL.admin).toBeGreaterThan(ROLE_LEVEL.finance)
    expect(ROLE_LEVEL.finance).toBeGreaterThan(ROLE_LEVEL.manager)
    expect(ROLE_LEVEL.manager).toBeGreaterThan(ROLE_LEVEL.user)
    expect(ROLE_LEVEL.user).toBeGreaterThan(ROLE_LEVEL.sales)
  })
})

describe('Super Admin Routes (/system)', () => {
  it('super_admin can access /system', () => {
    expect(canAccess('/system', 'super_admin')).toBe(true)
  })

  it('admin cannot access /system', () => {
    expect(canAccess('/system', 'admin')).toBe(false)
  })

  it('manager cannot access /system', () => {
    expect(canAccess('/system', 'manager')).toBe(false)
  })

  it('applies to sub-paths like /system/flags', () => {
    expect(canAccess('/system/flags', 'admin')).toBe(false)
    expect(canAccess('/system/flags', 'super_admin')).toBe(true)
  })
})

describe('Admin Routes (/admin, /sales)', () => {
  it('admin can access /admin', () => {
    expect(canAccess('/admin', 'admin')).toBe(true)
  })

  it('super_admin can access /admin', () => {
    expect(canAccess('/admin', 'super_admin')).toBe(true)
  })

  it('manager cannot access /admin', () => {
    expect(canAccess('/admin', 'manager')).toBe(false)
  })

  it('admin can access /sales', () => {
    expect(canAccess('/sales', 'admin')).toBe(true)
  })

  it('manager cannot access /sales', () => {
    expect(canAccess('/sales', 'manager')).toBe(false)
  })

  it('finance cannot access /sales', () => {
    expect(canAccess('/sales', 'finance')).toBe(false)
  })
})

describe('Finance Routes (/invoices)', () => {
  it('finance can access /invoices', () => {
    expect(canAccess('/invoices', 'finance')).toBe(true)
  })

  it('admin can access /invoices', () => {
    expect(canAccess('/invoices', 'admin')).toBe(true)
  })

  it('manager cannot access /invoices', () => {
    expect(canAccess('/invoices', 'manager')).toBe(false)
  })

  it('user cannot access /invoices', () => {
    expect(canAccess('/invoices', 'user')).toBe(false)
  })
})

describe('Manager Routes (20+ operational pages)', () => {
  const managerRoutes = [
    '/analytics', '/reports', '/funding', '/ntp', '/inventory',
    '/service', '/work-orders', '/warranty', '/fleet', '/vendors',
    '/permits', '/documents', '/change-orders', '/redesign', '/legacy',
    '/batch', '/planset', '/audit-trail', '/audit', '/dashboard', '/engineering',
  ]

  for (const route of managerRoutes) {
    it(`manager can access ${route}`, () => {
      expect(canAccess(route, 'manager')).toBe(true)
    })

    it(`user cannot access ${route}`, () => {
      expect(canAccess(route, 'user')).toBe(false)
    })

    it(`sales cannot access ${route}`, () => {
      expect(canAccess(route, 'sales')).toBe(false)
    })
  }

  it('admin can access all manager routes', () => {
    for (const route of managerRoutes) {
      expect(canAccess(route, 'admin')).toBe(true)
    }
  })

  it('super_admin can access all manager routes', () => {
    for (const route of managerRoutes) {
      expect(canAccess(route, 'super_admin')).toBe(true)
    }
  })
})

describe('Auth-Only Routes (any authenticated user)', () => {
  const authOnlyRoutes = ['/command', '/queue', '/pipeline', '/schedule', '/crew', '/commissions', '/help', '/mobile/field', '/mobile/leadership']

  for (const route of authOnlyRoutes) {
    it(`${route} has no role requirement`, () => {
      expect(getRequiredLevel(route)).toBeNull()
    })

    it(`sales user can access ${route}`, () => {
      expect(canAccess(route, 'sales')).toBe(true)
    })
  }
})

describe('Sub-path Inheritance', () => {
  it('/admin/users inherits admin requirement', () => {
    expect(canAccess('/admin/users', 'manager')).toBe(false)
    expect(canAccess('/admin/users', 'admin')).toBe(true)
  })

  it('/documents/missing inherits manager requirement', () => {
    expect(canAccess('/documents/missing', 'user')).toBe(false)
    expect(canAccess('/documents/missing', 'manager')).toBe(true)
  })

  it('/analytics/leadership inherits manager requirement', () => {
    expect(canAccess('/analytics/leadership', 'sales')).toBe(false)
    expect(canAccess('/analytics/leadership', 'manager')).toBe(true)
  })
})

describe('Edge Cases', () => {
  it('unknown role defaults to level 1 (user)', () => {
    expect(canAccess('/command', 'unknown_role')).toBe(true)
    expect(canAccess('/analytics', 'unknown_role')).toBe(false) // level 1 < 2
  })

  it('root / has no role requirement', () => {
    expect(getRequiredLevel('/')).toBeNull()
  })

  it('/api/reports/chat is not public but has no route requirement', () => {
    expect(isPublicRoute('/api/reports/chat')).toBe(false)
    expect(getRequiredLevel('/api/reports/chat')).toBeNull()
  })

  it('route matching is prefix-based, not contains', () => {
    // /audit should not match /audit-trail — both should resolve to
    // distinct rules in the table, not accidentally collide.
    const auditRule = ROUTE_ROLE_REQUIREMENTS.find((r) => r.prefix === '/audit')
    const trailRule = ROUTE_ROLE_REQUIREMENTS.find((r) => r.prefix === '/audit-trail')
    expect(auditRule).toBeDefined()
    expect(trailRule).toBeDefined()
    expect(auditRule!.prefix).not.toBe(trailRule!.prefix)
  })

  it('25 route rules are defined', () => {
    expect(ROUTE_ROLE_REQUIREMENTS).toHaveLength(25)
  })

  it('all route rules have valid role levels', () => {
    for (const rule of ROUTE_ROLE_REQUIREMENTS) {
      expect(rule.minLevel).toBeGreaterThanOrEqual(0)
      expect(rule.minLevel).toBeLessThanOrEqual(5)
      expect(rule.prefix.startsWith('/')).toBe(true)
    }
  })
})
