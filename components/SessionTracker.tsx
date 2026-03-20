'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'

const SESSION_KEY = 'microgrid_session_id'

export function SessionTracker() {
  const { user } = useCurrentUser()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (!user?.id || initialized.current) return

    const supabase = createClient()
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'

    // Check if we already have a session for this browser tab
    const existingSessionId = sessionStorage.getItem(SESSION_KEY)

    if (existingSessionId) {
      // Session exists — just start heartbeat
      initialized.current = true
      startHeartbeat(supabase, existingSessionId)
      return
    }

    // Create new session (one per login/tab)
    async function createSession() {
      try {
        const { data, error } = await (supabase as any)
          .from('user_sessions')
          .insert({
            user_id: user!.id,
            user_name: user!.name,
            user_email: user!.email,
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

    createSession()

    function startHeartbeat(sb: any, sid: string) {
      // Immediate update
      const path = typeof window !== 'undefined' ? window.location.pathname : '/'
      ;(sb as any).from('user_sessions').update({ last_active_at: new Date().toISOString(), page: path }).eq('id', sid)
        .then(() => {}).catch((err: any) => console.error('heartbeat failed:', err))

      // Heartbeat every 60s
      intervalRef.current = setInterval(() => {
        const p = typeof window !== 'undefined' ? window.location.pathname : '/'
        ;(sb as any).from('user_sessions').update({ last_active_at: new Date().toISOString(), page: p }).eq('id', sid)
          .then(() => {}).catch((err: any) => console.error('heartbeat failed:', err))
      }, 60_000)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [user?.id])

  return null
}
