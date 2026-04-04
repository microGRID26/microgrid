import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { INTERNAL_DOMAINS } from '@/lib/utils'

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
  if (!INTERNAL_DOMAINS.some(d => email.endsWith(`@${d}`))) {
    return NextResponse.redirect(`${origin}/login?error=unauthorized_domain`)
  }

  // Auto-provision user row on first login
  if (user?.email) {
    // RPC function not in generated Database types — cast to call untyped .rpc()
    const { error: provisionError } = await (supabase as unknown as { rpc: (fn: string, params: Record<string, string>) => Promise<{ error: { message: string } | null }> }).rpc('provision_user', {
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
