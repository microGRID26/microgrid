'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { useCurrentUser } from '@/lib/useCurrentUser'

const SESSION_KEY = 'microgrid_session_id'
const SESSION_TS_KEY = 'microgrid_session_ts'
const SESSION_TTL = 30 * 60 * 1000 // 30 minutes — don't create new session if recent one exists

export function SessionTracker() {
  const { user, loading } = useCurrentUser()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (loading) return
    if (initialized.current) return

    const supabase = db()

    async function init() {
      // Try user from hook first
      let userId = user?.id
      let userName = user?.name
      let userEmail = user?.email

      // If useCurrentUser didn't find a users table row, get info from auth directly
      if (!userId) {
        try {
          const { data: authData } = await supabase.auth.getUser()
          if (!authData?.user) return // Not logged in
          userId = authData.user.id
          userEmail = authData.user.email ?? ''
          userName = authData.user.user_metadata?.full_name ?? userEmail?.split('@')[0] ?? 'Unknown'
        } catch {
          return // Auth not ready
        }
      }

      if (!userId) return // Still no user — bail

      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'

      // Check if we already have a session (sessionStorage for this tab, localStorage as fallback)
      const existingSessionId = sessionStorage.getItem(SESSION_KEY)
      if (existingSessionId) {
        // Verify session still exists in DB before reusing
        const { data: existing } = await supabase
          .from('user_sessions')
          .select('id')
          .eq('id', existingSessionId)
          .single()
        if (existing) {
          initialized.current = true
          startHeartbeat(supabase, existingSessionId)
          return
        }
        // Session was deleted or expired — clear stale references
        sessionStorage.removeItem(SESSION_KEY)
        localStorage.removeItem(SESSION_KEY)
      }

      // Check localStorage — prevent duplicate sessions from mobile Safari re-loading
      const lastSessionId = localStorage.getItem(SESSION_KEY)
      const lastSessionTs = localStorage.getItem(SESSION_TS_KEY)
      if (lastSessionId && lastSessionTs && Date.now() - Number(lastSessionTs) < SESSION_TTL) {
        sessionStorage.setItem(SESSION_KEY, lastSessionId)
        initialized.current = true
        startHeartbeat(supabase, lastSessionId)
        return
      }

      // Create new session
      try {
        const { data, error } = await supabase
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
          const sid = String(data.id)
          sessionStorage.setItem(SESSION_KEY, sid)
          localStorage.setItem(SESSION_KEY, sid)
          localStorage.setItem(SESSION_TS_KEY, String(Date.now()))
          initialized.current = true
          startHeartbeat(supabase, sid)
        }
      } catch (err) {
        console.error('session insert failed:', err)
      }
    }

    function startHeartbeat(sb: ReturnType<typeof db>, sid: string) {
      const path = typeof window !== 'undefined' ? window.location.pathname : '/'
      localStorage.setItem(SESSION_TS_KEY, String(Date.now()))
      sb.from('user_sessions').update({ last_active_at: new Date().toISOString(), page: path }).eq('id', sid)
        .then(() => {}).catch((err: any) => console.error('heartbeat failed:', err))

      intervalRef.current = setInterval(() => {
        const p = typeof window !== 'undefined' ? window.location.pathname : '/'
        sb.from('user_sessions').update({ last_active_at: new Date().toISOString(), page: p }).eq('id', sid)
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
