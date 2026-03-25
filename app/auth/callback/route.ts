import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth_failed`)
    }

    // Auto-provision user row on first login
    const { data: { user } } = await supabase.auth.getUser()
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
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  return NextResponse.redirect(`${origin}/command`)
}
