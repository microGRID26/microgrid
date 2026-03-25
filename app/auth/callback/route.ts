import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // #11 — Check for missing code first (was unreachable before)
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // #3 — Validate email domain before provisioning
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email ?? ''
  const allowedDomains = ['@gomicrogridenergy.com', '@energydevelopmentgroup.com', '@trismartsolar.com']
  if (!allowedDomains.some(d => email.endsWith(d))) {
    return NextResponse.redirect(`${origin}/login?error=unauthorized_domain`)
  }

  // Auto-provision user row on first login
  if (user?.email) {
    const { error: provisionError } = await (supabase as any).rpc('provision_user', {
      p_email: user.email,
      p_name: user.user_metadata?.full_name ?? user.email.split('@')[0],
    })
    if (provisionError) {
      console.error('Failed to provision user:', provisionError)
      return NextResponse.redirect(`${origin}/login?error=provision_failed`)
    }
  }

  return NextResponse.redirect(`${origin}/command`)
}
