'use client'

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { clearQueryCache } from './useSupabaseQuery'
import type { Organization, OrgMembership, OrgType, OrgRole } from '@/types/database'

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserOrg {
  orgId: string
  orgName: string
  orgSlug: string
  orgType: OrgType
  orgRole: OrgRole
  isDefault: boolean
}

export interface OrgContextValue {
  orgId: string | null
  orgName: string | null
  orgSlug: string | null
  orgType: OrgType | null
  userOrgs: UserOrg[]
  switchOrg: (orgId: string) => void
  loading: boolean
}

const OrgContext = createContext<OrgContextValue>({
  orgId: null,
  orgName: null,
  orgSlug: null,
  orgType: null,
  userOrgs: [],
  switchOrg: () => {},
  loading: true,
})

// ── Default org ID (MicroGRID Energy) ────────────────────────────────────────
const DEFAULT_ORG_ID = 'a0000000-0000-0000-0000-000000000001'
const STORAGE_KEY = 'mg_org_id'

// ── Provider ─────────────────────────────────────────────────────────────────

export function OrgProvider({ children }: { children: ReactNode }) {
  const [userOrgs, setUserOrgs] = useState<UserOrg[]>([])
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const supabase = createClient()

    supabase.auth.getUser().then(async ({ data }) => {
      if (!mountedRef.current || !data.user) {
        if (mountedRef.current) setLoading(false)
        return
      }

      // Load user's org memberships with org details
      const { data: memberships } = await supabase
        .from('org_memberships')
        .select('org_id, org_role, is_default')
        .eq('user_id', data.user.id) as { data: Pick<OrgMembership, 'org_id' | 'org_role' | 'is_default'>[] | null }

      if (!mountedRef.current) return

      if (!memberships || memberships.length === 0) {
        // No memberships — use default org (backward compat)
        setActiveOrgId(DEFAULT_ORG_ID)
        setUserOrgs([{
          orgId: DEFAULT_ORG_ID,
          orgName: 'MicroGRID Energy',
          orgSlug: 'microgrid',
          orgType: 'epc',
          orgRole: 'member',
          isDefault: true,
        }])
        setLoading(false)
        return
      }

      // Load org details for all memberships
      const orgIds = memberships.map(m => m.org_id)
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name, slug, org_type, active')
        .in('id', orgIds) as { data: Pick<Organization, 'id' | 'name' | 'slug' | 'org_type' | 'active'>[] | null }

      if (!mountedRef.current) return

      const orgMap = new Map((orgs ?? []).map(o => [o.id, o]))
      const resolved: UserOrg[] = memberships
        .filter(m => orgMap.has(m.org_id))
        .map(m => {
          const org = orgMap.get(m.org_id)!
          return {
            orgId: m.org_id,
            orgName: org.name,
            orgSlug: org.slug,
            orgType: org.org_type as OrgType,
            orgRole: m.org_role as OrgRole,
            isDefault: m.is_default,
          }
        })
        .filter(o => orgMap.get(o.orgId)?.active !== false)

      setUserOrgs(resolved)

      // Determine active org: localStorage > is_default > first
      const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
      const storedValid = stored && resolved.some(o => o.orgId === stored)
      const defaultOrg = resolved.find(o => o.isDefault)

      const selected = storedValid ? stored : defaultOrg?.orgId ?? resolved[0]?.orgId ?? DEFAULT_ORG_ID
      setActiveOrgId(selected)
      setLoading(false)
    }).catch(() => {
      if (mountedRef.current) {
        // Auth error — fall back to default org with populated userOrgs so orgName/orgType aren't null
        setActiveOrgId(DEFAULT_ORG_ID)
        setUserOrgs([{
          orgId: DEFAULT_ORG_ID,
          orgName: 'MicroGRID Energy',
          orgSlug: 'microgrid',
          orgType: 'epc',
          orgRole: 'member',
          isDefault: true,
        }])
        setLoading(false)
      }
    })

    return () => { mountedRef.current = false }
  }, [])

  const switchOrg = useCallback((orgId: string) => {
    // Only switch to orgs the user actually belongs to
    if (userOrgs.length > 0 && !userOrgs.some(o => o.orgId === orgId)) {
      console.warn(`[useOrg] switchOrg called with unknown org: ${orgId}`)
      return
    }
    setActiveOrgId(orgId)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, orgId)
    }
    // Clear all cached queries so they refetch with new org scope
    clearQueryCache()
  }, [userOrgs])

  // Derive active org details (memoized to avoid recomputation on every render)
  const activeOrg = useMemo(() => userOrgs.find(o => o.orgId === activeOrgId), [userOrgs, activeOrgId])

  return (
    <OrgContext.Provider value={{
      orgId: activeOrgId,
      orgName: activeOrg?.orgName ?? null,
      orgSlug: activeOrg?.orgSlug ?? null,
      orgType: activeOrg?.orgType ?? null,
      userOrgs,
      switchOrg,
      loading,
    }}>
      {children}
    </OrgContext.Provider>
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOrg() {
  return useContext(OrgContext)
}
