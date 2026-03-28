'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useOrg } from '@/lib/hooks'
import type { OrgType } from '@/types/database'
import { Building2, Check, ChevronDown } from 'lucide-react'

// ── Org type display config ──────────────────────────────────────────────────

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  platform: 'Platform',
  epc: 'EPC',
  sales: 'Sales',
  engineering: 'Engineering',
  supply: 'Supply',
  customer: 'Customer',
}

const ORG_TYPE_COLORS: Record<OrgType, string> = {
  platform: 'bg-purple-900/40 text-purple-400 border-purple-800',
  epc: 'bg-green-900/40 text-green-400 border-green-800',
  sales: 'bg-blue-900/40 text-blue-400 border-blue-800',
  engineering: 'bg-amber-900/40 text-amber-400 border-amber-800',
  supply: 'bg-cyan-900/40 text-cyan-400 border-cyan-800',
  customer: 'bg-gray-800 text-gray-400 border-gray-700',
}

// ── OrgSwitcher Component ────────────────────────────────────────────────────

export function OrgSwitcher() {
  const { orgId, orgName, userOrgs, switchOrg, loading } = useOrg()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Don't render for single-org users or while loading
  if (loading || userOrgs.length <= 1) return null

  return (
    <OrgSwitcherDropdown
      orgId={orgId}
      orgName={orgName}
      userOrgs={userOrgs}
      switchOrg={switchOrg}
      open={open}
      setOpen={setOpen}
      dropdownRef={ref}
    />
  )
}

// Separated to avoid conditional hook calls
function OrgSwitcherDropdown({
  orgId,
  orgName,
  userOrgs,
  switchOrg,
  open,
  setOpen,
  dropdownRef,
}: {
  orgId: string | null
  orgName: string | null
  userOrgs: ReturnType<typeof useOrg>['userOrgs']
  switchOrg: (id: string) => void
  open: boolean
  setOpen: (v: boolean) => void
  dropdownRef: React.RefObject<HTMLDivElement | null>
}) {
  const [focusIndex, setFocusIndex] = useState(-1)

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open, dropdownRef, setOpen])

  // Escape to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, setOpen])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
        setFocusIndex(0)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusIndex(i => Math.min(i + 1, userOrgs.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusIndex >= 0 && focusIndex < userOrgs.length) {
          const target = userOrgs[focusIndex]
          switchOrg(target.orgId)
          setOpen(false)
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }, [open, focusIndex, userOrgs, switchOrg, setOpen])

  return (
    <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        onClick={() => { setOpen(!open); setFocusIndex(-1) }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
        aria-label={`Switch organization. Current: ${orgName ?? 'Unknown'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 className="w-3 h-3 text-gray-500" />
        <span className="max-w-[120px] truncate">{orgName ?? 'Organization'}</span>
        <ChevronDown className="w-3 h-3 text-gray-500" />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[220px] py-1"
          role="listbox"
          aria-label="Organizations"
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            Organizations
          </div>
          {userOrgs.map((org, idx) => {
            const isActive = org.orgId === orgId
            const isFocused = idx === focusIndex
            return (
              <button
                key={org.orgId}
                onClick={() => { switchOrg(org.orgId); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  isFocused ? 'bg-gray-700' : ''
                } ${isActive ? 'text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'}`}
                role="option"
                aria-selected={isActive}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{org.orgName}</span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                      ORG_TYPE_COLORS[org.orgType] ?? 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}>
                      {ORG_TYPE_LABELS[org.orgType] ?? org.orgType}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 capitalize">{org.orgRole}</div>
                </div>
                {isActive && <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
