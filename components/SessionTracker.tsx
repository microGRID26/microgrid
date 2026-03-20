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
    initialized.current = true

    const supabase = createClient()
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'

    // Check if we already have a session for this browser tab
    const existingSessionId = sessionStorage.getItem(SESSION_KEY)

    if (existingSessionId) {
      // Session exists — just start heartbeat
      startHeartbeat(supabase, existingSessionId)
      return
    }

    // Create new session (one per login/tab)
    ;(supabase as any)
      .from('user_sessions')
      .insert({
        user_id: user.id,
        user_name: user.name,
        user_email: user.email,
        logged_in_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        page: currentPath,
      })
      .select('id')
      .single()
      .then(({ data }: { data: { id: string } | null }) => {
        if (data?.id) {
          sessionStorage.setItem(SESSION_KEY, String(data.id))
          startHeartbeat(supabase, String(data.id))
        }
      })

    function startHeartbeat(sb: any, sid: string) {
      // Immediate update
      const path = typeof window !== 'undefined' ? window.location.pathname : '/'
      ;(sb as any).from('user_sessions').update({ last_active_at: new Date().toISOString(), page: path }).eq('id', sid).then(() => {})

      // Heartbeat every 60s
      intervalRef.current = setInterval(() => {
        const p = typeof window !== 'undefined' ? window.location.pathname : '/'
        ;(sb as any).from('user_sessions').update({ last_active_at: new Date().toISOString(), page: p }).eq('id', sid).then(() => {})
      }, 60_000)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [user?.id])

  return null
}
