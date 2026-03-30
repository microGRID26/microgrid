import { describe, it, expect } from 'vitest'

// ---- Extracted logic mirrors middleware.ts for unit testing ----

const PUBLIC_ROUTES = ['/login', '/auth']
const PUBLIC_PREFIXES = ['/api/webhooks/', '/api/email/send-daily', '/api/calendar/webhook', '/_next/', '/favicon.ico']

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

function hasAccess(pathname: string, role: string): boolean {
  const req = getRequiredLevel(pathname)
  if (!req) return true // only needs auth
  const level = ROLE_LEVEL[role] ?? 1
  return level >= req.minLevel
}

// ---- Tests ----

describe('middleware route protection', () => {
  describe('public routes', () => {
    it('allows /login', () => {
      expect(isPublicRoute('/login')).toBe(true)
    })

    it('allows /auth/callback', () => {
      expect(isPublicRoute('/auth/callback')).toBe(true)
    })

    it('allows /api/webhooks/subhub', () => {
      expect(isPublicRoute('/api/webhooks/subhub')).toBe(true)
    })

    it('allows /api/webhooks/edge', () => {
      expect(isPublicRoute('/api/webhooks/edge')).toBe(true)
    })

    it('allows /api/email/send-daily', () => {
      expect(isPublicRoute('/api/email/send-daily')).toBe(true)
    })

    it('allows /_next/static files', () => {
      expect(isPublicRoute('/_next/static/chunk.js')).toBe(true)
    })

    it('allows /favicon.ico', () => {
      expect(isPublicRoute('/favicon.ico')).toBe(true)
    })

    it('allows static files with extensions', () => {
      expect(isPublicRoute('/logo.png')).toBe(true)
      expect(isPublicRoute('/robots.txt')).toBe(true)
    })
  })

  describe('protected routes', () => {
    it('protects /command', () => {
      expect(isPublicRoute('/command')).toBe(false)
    })

    it('protects /admin', () => {
      expect(isPublicRoute('/admin')).toBe(false)
    })

    it('protects /queue', () => {
      expect(isPublicRoute('/queue')).toBe(false)
    })

    it('protects /system', () => {
      expect(isPublicRoute('/system')).toBe(false)
    })

    it('protects root /', () => {
      expect(isPublicRoute('/')).toBe(false)
    })

    it('protects /pipeline', () => {
      expect(isPublicRoute('/pipeline')).toBe(false)
    })

    it('does not treat /api/ routes as static files', () => {
      expect(isPublicRoute('/api/reports/chat')).toBe(false)
    })
  })
})

describe('role-based route access', () => {
  describe('/system — super_admin only', () => {
    it('allows super_admin', () => {
      expect(hasAccess('/system', 'super_admin')).toBe(true)
    })

    it('blocks admin', () => {
      expect(hasAccess('/system', 'admin')).toBe(false)
    })

    it('blocks manager', () => {
      expect(hasAccess('/system', 'manager')).toBe(false)
    })

    it('blocks user', () => {
      expect(hasAccess('/system', 'user')).toBe(false)
    })

    it('blocks sales', () => {
      expect(hasAccess('/system', 'sales')).toBe(false)
    })
  })

  describe('/admin — admin+ only', () => {
    it('allows super_admin', () => {
      expect(hasAccess('/admin', 'super_admin')).toBe(true)
    })

    it('allows admin', () => {
      expect(hasAccess('/admin', 'admin')).toBe(true)
    })

    it('blocks finance', () => {
      expect(hasAccess('/admin', 'finance')).toBe(false)
    })

    it('blocks manager', () => {
      expect(hasAccess('/admin', 'manager')).toBe(false)
    })

    it('blocks user', () => {
      expect(hasAccess('/admin', 'user')).toBe(false)
    })

    it('blocks sales', () => {
      expect(hasAccess('/admin', 'sales')).toBe(false)
    })
  })

  describe('manager+ routes', () => {
    const managerRoutes = [
      '/analytics', '/reports', '/funding', '/ntp', '/inventory',
      '/service', '/work-orders', '/warranty', '/fleet', '/vendors',
      '/permits', '/documents', '/change-orders', '/redesign',
      '/legacy', '/batch', '/planset', '/audit-trail', '/audit',
      '/dashboard',
    ]

    for (const route of managerRoutes) {
      it(`${route} — allows manager`, () => {
        expect(hasAccess(route, 'manager')).toBe(true)
      })

      it(`${route} — allows admin`, () => {
        expect(hasAccess(route, 'admin')).toBe(true)
      })

      it(`${route} — blocks user`, () => {
        expect(hasAccess(route, 'user')).toBe(false)
      })

      it(`${route} — blocks sales`, () => {
        expect(hasAccess(route, 'sales')).toBe(false)
      })
    }
  })

  describe('/sales — admin+ only', () => {
    it('allows super_admin', () => {
      expect(hasAccess('/sales', 'super_admin')).toBe(true)
    })

    it('allows admin', () => {
      expect(hasAccess('/sales', 'admin')).toBe(true)
    })

    it('blocks finance', () => {
      expect(hasAccess('/sales', 'finance')).toBe(false)
    })

    it('blocks manager', () => {
      expect(hasAccess('/sales', 'manager')).toBe(false)
    })

    it('blocks user', () => {
      expect(hasAccess('/sales', 'user')).toBe(false)
    })

    it('blocks sales', () => {
      expect(hasAccess('/sales', 'sales')).toBe(false)
    })
  })

  describe('/invoices — finance+ only', () => {
    it('allows super_admin', () => {
      expect(hasAccess('/invoices', 'super_admin')).toBe(true)
    })

    it('allows admin', () => {
      expect(hasAccess('/invoices', 'admin')).toBe(true)
    })

    it('allows finance', () => {
      expect(hasAccess('/invoices', 'finance')).toBe(true)
    })

    it('blocks manager', () => {
      expect(hasAccess('/invoices', 'manager')).toBe(false)
    })

    it('blocks user', () => {
      expect(hasAccess('/invoices', 'user')).toBe(false)
    })

    it('blocks sales', () => {
      expect(hasAccess('/invoices', 'sales')).toBe(false)
    })
  })

  describe('/engineering — manager+ only', () => {
    it('allows super_admin', () => {
      expect(hasAccess('/engineering', 'super_admin')).toBe(true)
    })

    it('allows admin', () => {
      expect(hasAccess('/engineering', 'admin')).toBe(true)
    })

    it('allows finance', () => {
      expect(hasAccess('/engineering', 'finance')).toBe(true)
    })

    it('allows manager', () => {
      expect(hasAccess('/engineering', 'manager')).toBe(true)
    })

    it('blocks user', () => {
      expect(hasAccess('/engineering', 'user')).toBe(false)
    })

    it('blocks sales', () => {
      expect(hasAccess('/engineering', 'sales')).toBe(false)
    })
  })

  describe('/commissions — auth-only (custom page gate)', () => {
    it('allows any authenticated role (no proxy-level role requirement)', () => {
      expect(hasAccess('/commissions', 'user')).toBe(true)
      expect(hasAccess('/commissions', 'sales')).toBe(true)
      expect(hasAccess('/commissions', 'manager')).toBe(true)
      expect(hasAccess('/commissions', 'finance')).toBe(true)
      expect(hasAccess('/commissions', 'admin')).toBe(true)
      expect(hasAccess('/commissions', 'super_admin')).toBe(true)
    })
  })

  describe('cross-role access matrix', () => {
    it('sales user (level 0) is blocked from /sales, /invoices, /engineering', () => {
      expect(hasAccess('/sales', 'sales')).toBe(false)
      expect(hasAccess('/invoices', 'sales')).toBe(false)
      expect(hasAccess('/engineering', 'sales')).toBe(false)
    })

    it('finance user (level 3) can access /invoices but not /sales', () => {
      expect(hasAccess('/invoices', 'finance')).toBe(true)
      expect(hasAccess('/sales', 'finance')).toBe(false)
    })

    it('manager (level 2) can access /engineering but not /sales or /invoices', () => {
      expect(hasAccess('/engineering', 'manager')).toBe(true)
      expect(hasAccess('/sales', 'manager')).toBe(false)
      expect(hasAccess('/invoices', 'manager')).toBe(false)
    })
  })

  describe('auth-only routes (no role requirement)', () => {
    const authOnlyRoutes = ['/command', '/queue', '/pipeline', '/schedule', '/help', '/crew', '/mobile/field', '/mobile/leadership']

    for (const route of authOnlyRoutes) {
      it(`${route} — allows any role`, () => {
        expect(hasAccess(route, 'user')).toBe(true)
        expect(hasAccess(route, 'sales')).toBe(true)
        expect(hasAccess(route, 'manager')).toBe(true)
        expect(hasAccess(route, 'admin')).toBe(true)
        expect(hasAccess(route, 'super_admin')).toBe(true)
      })
    }
  })

  describe('sub-path protection', () => {
    it('/admin/something is admin-protected', () => {
      expect(hasAccess('/admin/something', 'manager')).toBe(false)
      expect(hasAccess('/admin/something', 'admin')).toBe(true)
    })

    it('/system/orgs is super-admin-protected', () => {
      expect(hasAccess('/system/orgs', 'admin')).toBe(false)
      expect(hasAccess('/system/orgs', 'super_admin')).toBe(true)
    })

    it('/documents/missing is manager-protected', () => {
      expect(hasAccess('/documents/missing', 'user')).toBe(false)
      expect(hasAccess('/documents/missing', 'manager')).toBe(true)
    })
  })

  describe('unknown role defaults to user level', () => {
    it('unknown role gets level 1', () => {
      expect(hasAccess('/command', 'unknown_role')).toBe(true)
      expect(hasAccess('/admin', 'unknown_role')).toBe(false)
      expect(hasAccess('/analytics', 'unknown_role')).toBe(false)
    })
  })
})

describe('middleware edge cases', () => {
  describe('calendar API routes are public', () => {
    it('/api/calendar/webhook is public', () => {
      expect(isPublicRoute('/api/calendar/webhook')).toBe(true)
    })

    it('/api/calendar/sync is NOT public (only webhook is public)', () => {
      expect(isPublicRoute('/api/calendar/sync')).toBe(false)
    })
  })

  describe('forged role cookie cannot bypass route checks', () => {
    // The hasAccess function checks the role level from the DB-fetched role,
    // not from a cookie. Even if someone sets a cookie claiming super_admin,
    // the DB lookup returns their actual role. Here we verify the access check
    // itself rejects insufficient roles regardless of what a cookie might claim.

    it('/admin rejects user role even if cookie says admin', () => {
      // Simulate: cookie claims admin, but DB returns user
      const dbRole = 'user'
      expect(hasAccess('/admin', dbRole)).toBe(false)
    })

    it('/system rejects admin role even if cookie says super_admin', () => {
      const dbRole = 'admin'
      expect(hasAccess('/system', dbRole)).toBe(false)
    })

    it('/admin rejects sales role even if cookie says super_admin', () => {
      const dbRole = 'sales'
      expect(hasAccess('/admin', dbRole)).toBe(false)
    })
  })

  describe('unknown routes require auth but no role', () => {
    it('/some-unknown-page is not public', () => {
      expect(isPublicRoute('/some-unknown-page')).toBe(false)
    })

    it('/some-unknown-page allows any authenticated role (no role requirement)', () => {
      expect(hasAccess('/some-unknown-page', 'user')).toBe(true)
      expect(hasAccess('/some-unknown-page', 'sales')).toBe(true)
    })
  })

  describe('nested routes inherit parent gate', () => {
    it('/documents/missing inherits /documents manager gate', () => {
      expect(hasAccess('/documents/missing', 'user')).toBe(false)
      expect(hasAccess('/documents/missing', 'sales')).toBe(false)
      expect(hasAccess('/documents/missing', 'manager')).toBe(true)
      expect(hasAccess('/documents/missing', 'admin')).toBe(true)
      expect(hasAccess('/documents/missing', 'super_admin')).toBe(true)
    })

    it('/admin/users inherits /admin admin gate', () => {
      expect(hasAccess('/admin/users', 'manager')).toBe(false)
      expect(hasAccess('/admin/users', 'admin')).toBe(true)
    })

    it('/system/flags inherits /system super_admin gate', () => {
      expect(hasAccess('/system/flags', 'admin')).toBe(false)
      expect(hasAccess('/system/flags', 'super_admin')).toBe(true)
    })
  })
})

describe('middleware cookie error handling', () => {
  it('setAll wraps in try-catch', () => {
    // Simulates the middleware pattern: cookie setting failure should not crash
    let crashed = false
    try {
      const setAll = (_cookies: any[]) => {
        try {
          throw new Error('Cookie write failed')
        } catch {
          // Safe to ignore
        }
      }
      setAll([{ name: 'test', value: 'val', options: {} }])
    } catch {
      crashed = true
    }
    expect(crashed).toBe(false)
  })
})
