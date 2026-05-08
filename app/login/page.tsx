'use client'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)

  async function signInWithGoogle() {
    setLoading(true)
    // createClient() reads NEXT_PUBLIC_SUPABASE_* at call time. Calling it
    // at module scope ran during static prerender (next build) where CI
    // doesn't carry those env vars and the build crashed. Defer to the
    // click handler so prerender stays clean.
    const supabase = createClient()
    // Preserve deep-link target: proxy.ts sets ?redirect=<pathname> when it bounces
    // an unauthed request to /login. Pass it through to the callback as ?next so
    // the user lands on the original page instead of /command.
    const redirect = new URLSearchParams(location.search).get('redirect')
    const callback = new URL(`${location.origin}/auth/callback`)
    if (redirect) callback.searchParams.set('next', redirect)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
      },
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 rounded-2xl p-10 w-full max-w-sm shadow-2xl text-center">
        <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center mx-auto mb-6">
          <span className="text-white font-bold text-xl">M</span>
        </div>
        <h1 className="text-white text-2xl font-bold mb-1">MicroGRID</h1>
        <p className="text-gray-400 text-sm">Operating System</p>
        <p className="text-gray-500 text-xs mb-8">Powered by EDGE</p>
        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 font-medium py-3 px-4 rounded-xl hover:bg-gray-50 transition disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  )
}
