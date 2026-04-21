'use client'

import posthog from 'posthog-js'

export interface IdentifyPayload {
  id: string
  email: string
  name?: string
  role?: string
  orgId?: string | null
  orgName?: string | null
}

function isReady(): boolean {
  return typeof window !== 'undefined' && posthog.__loaded
}

export function identifyUser(payload: IdentifyPayload) {
  if (!isReady()) return
  const { id, email, name, role, orgId, orgName } = payload
  posthog.identify(id, {
    email,
    name,
    role,
    org_id: orgId ?? undefined,
    org_name: orgName ?? undefined,
  })
  if (orgId) posthog.group('organization', orgId, { name: orgName ?? orgId })
}

export function resetAnalytics() {
  if (!isReady()) return
  posthog.reset()
}

export function capturePageview(url?: string) {
  if (!isReady()) return
  posthog.capture('$pageview', url ? { $current_url: url } : undefined)
}
