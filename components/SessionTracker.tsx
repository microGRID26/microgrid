'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'

const SESSION_KEY = 'microgrid_session_id'

export function SessionTracker() {
  const { user, loading } = useCurrentUser()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (loading || initialized.current) return

    // Use user from hook, or fall back to auth session directly
    const supabase = createClient()

    async function init() {
      let userId = user?.id
      let userName = user?.name
      let userEmail = user?.email

      // If useCurrentUser didn't find a users table row, get info from auth directly
      if (!userId) {
        const { data: authData } = await supabase.auth.getUser()
        if (!authData.user) return // Not logged in
        userId = authData.user.id
        userEmail = authData.user.email ?? ''
        userName = authData.user.user_metadata?.full_name ?? userEmail?.split('@')[0] ?? 'Unknown'
      }

      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'

      // Check if we already have a session for this browser tab
      const existingSessionId = sessionStorage.getItem(SESSION_KEY)
      if (existingSessionId) {
        initialized.current = true
        startHeartbeat(supabase, existingSessionId)
        return
      }

      // Create new session
      try {
        const { data, error } = await (supabase as any)
          .from('user_sessions')
          .insert({
            user_id: userId,
            user_name: userName,
            user_email: userEmail,
            logged_in_at: new Date().toISOString(),
            last_active_at: new Date().toISOString(),
            page: currentPath,
          })
          .select('id')
          .single()

        if (error) {
          console.error('session insert failed:', error)
          return
        }

        if (data?.id) {
          sessionStorage.setItem(SESSION_KEY, String(data.id))
          initialized.current = true
          startHeartbeat(supabase, String(data.id))
        }
      } catch (err) {
        console.error('session insert failed:', err)
      }
    }

    function startHeartbeat(sb: any, sid: string) {
      const path = typeof window !== 'undefined' ? window.location.pathname : '/'
      ;(sb as any).from('user_sessions').update({ last_active_at: new Date().toISOString(), page: path }).eq('id', sid)
        .then(() => {}).catch((err: any) => console.error('heartbeat failed:', err))

      intervalRef.current = setInterval(() => {
        const p = typeof window !== 'undefined' ? window.location.pathname : '/'
        ;(sb as any).from('user_sessions').update({ last_active_at: new Date().toISOString(), page: p }).eq('id', sid)
          .then(() => {}).catch((err: any) => console.error('heartbeat failed:', err))
      }, 60_000)
    }

    init()

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [loading, user?.id])

  return null
}
