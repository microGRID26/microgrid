import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { INTERNAL_DOMAINS } from '@/lib/utils'

const OAUTH_NEXT_COOKIE = '__Host-mg_oauth_next'

function clearOAuthCookie(response: NextResponse, hadCookie: boolean) {
  if (hadCookie) {
    response.cookies.set(OAUTH_NEXT_COOKIE, '', { path: '/', maxAge: 0, secure: true, sameSite: 'lax' })
  }
  return response
}

function parseSafeNext(raw: string | null, origin: string): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw, origin)
    if (u.origin !== origin) return null
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
    if (raw.includes('\r') || raw.includes('\n')) return null
    return raw
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Read + always clear the one-shot OAuth-next cookie regardless of which
  // return path we take below (early errors, success, anything). Stale value
  // from a prior failed flow must not steer the next login attempt.
  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get(OAUTH_NEXT_COOKIE)?.value
  const hadCookie = cookieRaw !== undefined

  if (!code) {
    return clearOAuthCookie(NextResponse.redirect(`${origin}/login?error=no_code`), hadCookie)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return clearOAuthCookie(NextResponse.redirect(`${origin}/login?error=auth_failed`), hadCookie)
  }

  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email ?? ''
  if (!INTERNAL_DOMAINS.some(d => email.endsWith(`@${d}`))) {
    return clearOAuthCookie(NextResponse.redirect(`${origin}/login?error=unauthorized_domain`), hadCookie)
  }

  if (user?.email) {
    const { error: provisionError } = await (supabase as unknown as { rpc: (fn: string, params: Record<string, string>) => Promise<{ error: { message: string } | null }> }).rpc('provision_user', {
      p_email: user.email,
      p_name: user.user_metadata?.full_name ?? user.email.split('@')[0],
    })
    if (provisionError) {
      console.error('Failed to provision user:', provisionError)
      return clearOAuthCookie(NextResponse.redirect(`${origin}/login?error=provision_failed`), hadCookie)
    }
  }

  // Pick deep-link target from URL ?next= first, fall back to cookie.
  // Both go through parseSafeNext (open-redirect, CRLF, origin check).
  let cookieDecoded: string | null = null
  if (cookieRaw) {
    try { cookieDecoded = decodeURIComponent(cookieRaw) } catch { cookieDecoded = null }
  }
  const next = parseSafeNext(searchParams.get('next'), origin)
    ?? parseSafeNext(cookieDecoded, origin)

  return clearOAuthCookie(
    NextResponse.redirect(`${origin}${next ?? '/command'}`),
    hadCookie,
  )
}
