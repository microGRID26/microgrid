import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Enforce ROLE_COOKIE_SECRET in production. Without it, role cookie caching
// is DISABLED and every request hits the DB for the role. The public anon
// key is not safe as an HMAC secret — it's shipped to the client, so anyone
// who knows their own user.id could forge a cookie claiming any role.
if (process.env.NODE_ENV === 'production' && !process.env.ROLE_COOKIE_SECRET) {
  console.warn('[SECURITY] ROLE_COOKIE_SECRET not set — role cookie caching disabled, every request will re-query the DB. Set this env var in Vercel.')
}

/** HMAC secret for signing/verifying the role cookie. In production we
 *  refuse to fall back to the anon key; if unset, we return null and the
 *  proxy skips the cookie path entirely. In dev/test we fall back to the
 *  anon key (or a literal) so local testing still exercises the cookie path. */
function getRoleCookieSecret(): string | null {
  if (process.env.ROLE_COOKIE_SECRET) return process.env.ROLE_COOKIE_SECRET
  if (process.env.NODE_ENV !== 'production') {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'dev-fallback'
  }
  return null
}

// Routes that require no authentication
const PUBLIC_ROUTES = ['/login', '/auth', '/portal/login', '/portal/auth', '/privacy']
// /api/cron/* — Vercel cron routes. Each route runs its own CRON_SECRET
// bearer-token check (timingSafeEqual). Listing the prefix here keeps
// proxy.ts from 307-redirecting unauthenticated cron requests to /login.
// Audit 2026-05 #560: 4 crons silently dead since c1653c3 (proxy.ts intro)
// only enumerated /api/email/* — partner_event_outbox accumulated 598 stuck
// events.
const PUBLIC_PREFIXES = ['/api/webhooks/', '/api/cron/', '/api/email/send-daily', '/api/email/onboarding-reminder', '/api/email/digest', '/api/calendar/webhook', '/api/portal/chat', '/api/customer/delete-account', '/api/v1/partner/', '/_next/', '/favicon.ico']

// Role hierarchy levels (must match lib/useCurrentUser.ts ROLE_LEVEL)
const ROLE_LEVEL: Record<string, number> = {
  super_admin: 5,
  admin: 4,
  finance: 3,
  manager: 2,
  user: 1,
  sales: 0,
}

// Routes that require specific minimum role levels
const ROUTE_ROLE_REQUIREMENTS: { prefix: string; minLevel: number; label: string }[] = [
  { prefix: '/system', minLevel: 5, label: 'super_admin' },
  { prefix: '/admin', minLevel: 4, label: 'admin' },
  { prefix: '/analytics', minLevel: 2, label: 'manager' },
  { prefix: '/reports', minLevel: 2, label: 'manager' },
  { prefix: '/funding', minLevel: 2, label: 'manager' },
  { prefix: '/ntp', minLevel: 2, label: 'manager' },
  { prefix: '/inventory', minLevel: 2, label: 'manager' },
  { prefix: '/tickets', minLevel: 2, label: 'manager' },
  { prefix: '/ramp-up', minLevel: 2, label: 'manager' },
  { prefix: '/ops', minLevel: 2, label: 'manager' },
  { prefix: '/map', minLevel: 2, label: 'manager' },
  { prefix: '/service', minLevel: 2, label: 'manager' },
  { prefix: '/work-orders', minLevel: 2, label: 'manager' },
  { prefix: '/warranty', minLevel: 2, label: 'manager' },
  { prefix: '/fleet', minLevel: 2, label: 'manager' },
  { prefix: '/vendors', minLevel: 2, label: 'manager' },
  { prefix: '/permits', minLevel: 2, label: 'manager' },
  { prefix: '/documents', minLevel: 2, label: 'manager' },
  { prefix: '/change-orders', minLevel: 2, label: 'manager' },
  { prefix: '/redesign', minLevel: 2, label: 'manager' },
  { prefix: '/legacy', minLevel: 1, label: 'user' },
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

const ROLE_COOKIE = 'mg_user_role'
const ROLE_COOKIE_MAX_AGE = 300

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip public routes entirely
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  // Create Supabase client for proxy (uses request/response cookies)
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          } catch {
            // Cookie setting can fail during SSR; safe to ignore
          }
        },
      },
    }
  )

  // Refresh session — validates JWT server-side
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    // TEMP DIAGNOSTIC (revert after we identify the cookie-loss root cause):
    // log when a request looks like it SHOULD have a session but proxy sees none.
    // Filter to only requests carrying any sb- cookie so we don't spam unauth probes.
    const sbCookies = request.cookies.getAll().filter(c => c.name.startsWith('sb-'))
    if (sbCookies.length > 0) {
      console.error('[proxy] auth failed despite sb-cookies present', {
        path: pathname,
        sbCookieNames: sbCookies.map(c => c.name),
        sbCookieSizes: sbCookies.map(c => c.value.length),
        authErrorMessage: authError?.message ?? 'no user, no error',
        userPresent: !!user,
      })
    }
    // Portal users get redirected to portal login, CRM users to CRM login
    const isPortalRoute = pathname.startsWith('/portal')
    const loginUrl = new URL(isPortalRoute ? '/portal/login' : '/login', request.url)
    if (pathname !== '/' && !isPortalRoute) {
      loginUrl.searchParams.set('redirect', pathname)
    }
    return NextResponse.redirect(loginUrl)
  }

  // Portal routes: authenticated but bypass CRM role check
  // Portal auth callback already verified customer_accounts row
  if (pathname.startsWith('/portal')) {
    return response
  }

  // CRM routes: prevent portal-only users from accessing CRM
  // (portal users won't have a users table row)

  // Check if this route requires a specific role
  const requirement = getRequiredLevel(pathname)
  if (!requirement) {
    return response
  }

  // Role check — always query DB when cookie is missing or expired; validate cookie with HMAC
  const hmacSecret = getRoleCookieSecret()
  const isSensitiveRoute = pathname.startsWith('/admin') || pathname.startsWith('/system')
  const roleCookieRaw = !hmacSecret || isSensitiveRoute ? undefined : request.cookies.get(ROLE_COOKIE)?.value
  // Cookie format: "role:hmac" — verify integrity to prevent forgery
  let userRole: string | undefined
  if (hmacSecret && roleCookieRaw && roleCookieRaw.includes(':')) {
    const [cookieRole, cookieHmac] = roleCookieRaw.split(':')
    const { createHmac, timingSafeEqual } = await import('crypto')
    const expectedHmac = createHmac('sha256', hmacSecret).update(cookieRole + ':' + user.id).digest('hex').slice(0, 32)
    const a = Buffer.from(cookieHmac)
    const b = Buffer.from(expectedHmac)
    if (a.length === b.length && timingSafeEqual(a, b)) {
      userRole = cookieRole
    }
  }

  if (!userRole) {
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('role')
        .eq('email', user.email ?? '')
        .single()

      userRole = userRow?.role ?? 'user'
    } catch {
      userRole = 'user'
    }

    // Sign the cookie with HMAC to prevent forgery. Skip caching entirely
    // when no secret is configured (prod without ROLE_COOKIE_SECRET) — the
    // proxy will re-query the DB on every request, which is less efficient
    // but avoids signing with the public anon key.
    if (hmacSecret) {
      const { createHmac } = await import('crypto')
      const hmac = createHmac('sha256', hmacSecret).update(userRole + ':' + user.id).digest('hex').slice(0, 32)
      response.cookies.set(ROLE_COOKIE, `${userRole}:${hmac}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: ROLE_COOKIE_MAX_AGE,
        path: '/',
      })
    }
  }

  const resolvedRole = userRole ?? 'user'
  const userLevel = ROLE_LEVEL[resolvedRole] ?? 1

  if (userLevel < requirement.minLevel) {
    const redirectUrl = new URL('/command', request.url)
    redirectUrl.searchParams.set('error', 'insufficient_role')
    redirectUrl.searchParams.set('required', requirement.label)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
