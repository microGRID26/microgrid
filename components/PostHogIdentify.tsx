'use client'

import { useEffect, useRef } from 'react'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks/useOrg'
import { identifyUser, resetAnalytics } from '@/lib/analytics/posthog'

// Mounts inside OrgProvider. Binds the anonymous PostHog session to the
// signed-in user + active org once both are resolved. Idempotent —
// identify() on the same distinct_id is a no-op.
export function PostHogIdentify() {
  const { user, loading: userLoading } = useCurrentUser()
  const { orgId, orgName, loading: orgLoading } = useOrg()
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (userLoading || orgLoading) return
    if (!user?.id) {
      if (lastKeyRef.current) {
        resetAnalytics()
        lastKeyRef.current = null
      }
      return
    }
    const key = `${user.id}|${orgId ?? ''}`
    if (lastKeyRef.current === key) return
    identifyUser({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId,
      orgName,
    })
    lastKeyRef.current = key
  }, [user?.id, user?.email, user?.name, user?.role, orgId, orgName, userLoading, orgLoading])

  return null
}
