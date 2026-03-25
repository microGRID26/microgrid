'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { ConstructionBanner } from '@/components/ConstructionBanner'
import { Menu, X, ChevronDown } from 'lucide-react'
import { NotificationBell } from '@/components/NotificationBell'

// ── Shared nav for all pages ──────────────────────────────────────────────────
// Primary links are always visible. Secondary links live in "More" dropdown.

const PRIMARY_LINKS = [
  { label: 'Command',  href: '/command'  },
  { label: 'Queue',    href: '/queue'    },
  { label: 'Pipeline', href: '/pipeline' },
  { label: 'Schedule', href: '/schedule' },
  { label: 'Funding',  href: '/funding'  },
  { label: 'Analytics', href: '/analytics' },
]

const SALES_LINKS = [
  { label: 'Command',  href: '/command'  },
  { label: 'Queue',    href: '/queue'    },
  { label: 'Pipeline', href: '/pipeline' },
  { label: 'Schedule', href: '/schedule' },
]

const MORE_LINKS = [
  { label: 'Service',       href: '/service'  },
  { label: 'Change Orders', href: '/change-orders' },
  { label: 'Atlas',          href: '/reports'  },
  { label: 'Documents',     href: '/documents' },
  { label: 'Inventory',     href: '/inventory' },
  { label: 'Redesign',      href: '/redesign' },
  { label: 'Legacy',        href: '/legacy'   },
]

const ALL_LINKS = [...PRIMARY_LINKS, ...MORE_LINKS]

const GEAR_ICON = (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const HELP_ICON = (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

/** "More" dropdown for secondary nav links */
function MoreDropdown({ active, isAdmin }: { active: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isMoreActive = MORE_LINKS.some(l => l.label === active) || active === 'Audit Trail'

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 ${
          isMoreActive
            ? 'bg-gray-800 text-white'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
        }`}
      >
        More <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[180px] py-1">
          {MORE_LINKS.map(v => (
            <a key={v.label} href={v.href} onClick={() => setOpen(false)}
              className={`block px-4 py-2 text-xs transition-colors ${
                v.label === active
                  ? 'text-green-400 bg-gray-700/50'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}>
              {v.label}
            </a>
          ))}
          {isAdmin && (
            <>
              <div className="border-t border-gray-700 my-1" />
              <a href="/audit-trail" onClick={() => setOpen(false)}
                className={`block px-4 py-2 text-xs transition-colors ${
                  active === 'Audit Trail'
                    ? 'text-green-400 bg-gray-700/50'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}>
                Audit Trail
              </a>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface NavProps {
  active: string
  right?: React.ReactNode
  onNewProject?: () => void
}

export function Nav({ active, right, onNewProject }: NavProps) {
  const { user: currentUser, loading } = useCurrentUser()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isSales = !loading && !!currentUser?.isSales
  const navLinks = isSales ? SALES_LINKS : PRIMARY_LINKS

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <>
      <nav className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 sticky top-0 z-50 flex-shrink-0">
        <span className="text-green-400 font-bold text-base mr-2">MicroGRID</span>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-2">
          {navLinks.map(v => (
            <a key={v.label} href={v.href}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                v.label === active
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}>
              {v.label}
            </a>
          ))}

          {/* More dropdown — hidden for sales users */}
          {!isSales && <MoreDropdown active={active} isAdmin={!loading && !!currentUser?.isAdmin} />}

          {/* Notification bell — hidden for sales users */}
          {!isSales && !loading && currentUser && <NotificationBell />}

          {(!loading && currentUser?.isAdmin) && (
            <a href="/admin"
              className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                active === 'Admin'
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}>
              {GEAR_ICON}
              Admin
            </a>
          )}

          <a href="/help"
            className={`text-xs px-2 py-1.5 rounded-md transition-colors flex items-center gap-1 ${
              active === 'Help'
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}>
            {HELP_ICON}
          </a>

          {/* New Project button — hidden for sales users */}
          {!isSales && onNewProject && currentUser && (
            <button onClick={onNewProject}
              className="text-xs px-3 py-1.5 rounded-md transition-colors bg-green-700 hover:bg-green-600 text-white font-medium">
              + New Project
            </button>
          )}

          <ConstructionBanner />
        </div>

        {/* Desktop right slot */}
        {right && (
          <div className="hidden md:flex ml-auto items-center gap-2">
            {right}
          </div>
        )}

        {/* Desktop sign out */}
        <button onClick={signOut}
          className="hidden md:block ml-auto text-xs px-3 py-1.5 rounded-md transition-colors text-gray-500 hover:text-white hover:bg-gray-800">
          Sign out
        </button>

        {/* Mobile hamburger button */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="md:hidden ml-auto text-gray-400 hover:text-white p-1.5"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </nav>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />

          {/* Drawer */}
          <div className="absolute inset-0 bg-gray-950 flex flex-col overflow-y-auto">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
              <span className="text-green-400 font-bold text-base">MicroGRID</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-gray-400 hover:text-white p-1.5"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main nav links */}
            <div className="flex-1 py-2">
              {!isSales && onNewProject && currentUser && (
                <button
                  onClick={() => { setDrawerOpen(false); onNewProject() }}
                  className="w-full text-left py-3 px-4 text-base font-medium bg-green-700 text-white active:bg-green-600 transition-colors"
                >
                  + New Project
                </button>
              )}

              {(isSales ? [...SALES_LINKS, { label: 'Help', href: '/help' }] : ALL_LINKS).map(v => (
                <a key={v.label} href={v.href}
                  onClick={() => setDrawerOpen(false)}
                  className={`block py-3 px-4 text-base font-medium transition-colors ${
                    v.label === active
                      ? 'text-green-400 bg-gray-900'
                      : 'text-gray-300 active:bg-gray-800'
                  }`}>
                  {v.label}
                </a>
              ))}

              {/* Divider */}
              <div className="border-t border-gray-800 my-2" />

              {!isSales && !loading && currentUser && (
                <div className="px-4 py-2">
                  <NotificationBell />
                </div>
              )}

              {(!loading && currentUser?.isAdmin) && (
                <a href="/admin"
                  onClick={() => setDrawerOpen(false)}
                  className={`flex items-center gap-2 py-3 px-4 text-base font-medium transition-colors ${
                    active === 'Admin'
                      ? 'text-green-400 bg-gray-900'
                      : 'text-gray-300 active:bg-gray-800'
                  }`}>
                  {GEAR_ICON}
                  Admin
                </a>
              )}

              {(!loading && currentUser?.isAdmin) && (
                <a href="/audit-trail"
                  onClick={() => setDrawerOpen(false)}
                  className={`block py-3 px-4 text-base font-medium transition-colors ${
                    active === 'Audit Trail'
                      ? 'text-green-400 bg-gray-900'
                      : 'text-gray-300 active:bg-gray-800'
                  }`}>
                  Audit Trail
                </a>
              )}

              {!isSales && (
                <a href="/help"
                  onClick={() => setDrawerOpen(false)}
                  className={`flex items-center gap-2 py-3 px-4 text-base font-medium transition-colors ${
                    active === 'Help'
                      ? 'text-green-400 bg-gray-900'
                      : 'text-gray-300 active:bg-gray-800'
                  }`}>
                  {HELP_ICON}
                  Help
                </a>
              )}

              <button onClick={() => { setDrawerOpen(false); signOut() }}
                className="w-full text-left py-3 px-4 text-base font-medium text-gray-500 active:bg-gray-800 transition-colors">
                Sign out
              </button>

              {/* Construction banner in drawer */}
              <div className="px-4 py-2">
                <ConstructionBanner />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
