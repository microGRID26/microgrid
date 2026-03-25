'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/database'

interface CurrentUser {
  id: string
  email: string
  name: string
  role: UserRole
  isAdmin: boolean      // role is admin or super_admin
  isSuperAdmin: boolean // role is super_admin
  isFinance: boolean    // role is finance+
  isManager: boolean    // role is manager+
}

const ROLE_LEVEL: Record<UserRole, number> = {
  super_admin: 5,
  admin: 4,
  finance: 3,
  manager: 2,
  user: 1,
}

function buildUser(id: string, email: string, name: string, role: UserRole): CurrentUser {
  const level = ROLE_LEVEL[role] ?? 1
  return {
    id, email, name, role,
    isAdmin: level >= 4,
    isSuperAdmin: role === 'super_admin',
    isFinance: level >= 3,
    isManager: level >= 2,
  }
}

let cached: CurrentUser | null = null

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(cached)
  const [loading, setLoading] = useState(!cached)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const supabase = createClient()

    // Always set up auth listener so signout is detected even when cached
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        cached = null
        if (mountedRef.current) setUser(null)
      }
    })

    if (cached) {
      return () => {
        mountedRef.current = false
        subscription.unsubscribe()
      }
    }

    supabase.auth.getUser().then(async ({ data }) => {
      if (!mountedRef.current) return
      const email = data.user?.email
      if (!email) { if (mountedRef.current) setLoading(false); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: u } = await (supabase as any)
        .from('users').select('id, name, email, role')
        .eq('email', email).single()
      if (!u) {
        console.warn(`useCurrentUser: no user row found for ${email}, falling back to default role`)
      }
      const resolved: CurrentUser = u
        ? buildUser(u.id, u.email, u.name, u.role ?? 'user')
        : buildUser('', email, email.split('@')[0], 'user')
      cached = resolved
      if (mountedRef.current) {
        setUser(resolved)
        setLoading(false)
      }
    }).catch((err) => {
      console.error('useCurrentUser: failed to load user', err)
      if (mountedRef.current) setLoading(false)
    })

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [])

  return { user, loading }
}
