'use client'

import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { ConstructionBanner } from '@/components/ConstructionBanner'

// ── Shared nav for all pages ──────────────────────────────────────────────────
// Usage: <Nav active="Queue" right={<>search + filters</>} />
// active: label of the current page ('Command','Queue','Pipeline', etc.)
// right:  optional right-side content (search bars, filters, counts)

const NAV_LINKS = [
  { label: 'Command',  href: '/command'  },
  { label: 'Queue',    href: '/queue'    },
  { label: 'Pipeline', href: '/pipeline' },
  { label: 'Analytics',href: '/analytics'},
  { label: 'Audit',    href: '/audit'    },
  { label: 'Schedule', href: '/schedule' },
  { label: 'Service',  href: '/service'  },
  { label: 'Funding',  href: '/funding'  },
]

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

interface NavProps {
  active: string
  right?: React.ReactNode
  onNewProject?: () => void
}

export function Nav({ active, right, onNewProject }: NavProps) {
  const { user: currentUser, loading } = useCurrentUser()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <nav className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 sticky top-0 z-50 flex-shrink-0">
      <span className="text-green-400 font-bold text-base mr-2">MicroGRID</span>

      {NAV_LINKS.map(v => (
        <a key={v.label} href={v.href}
          className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
            v.label === active
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}>
          {v.label}
        </a>
      ))}

      {(loading || currentUser?.isAdmin) && (
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
        className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
          active === 'Help'
            ? 'bg-gray-800 text-white'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
        }`}>
        {HELP_ICON}
        Help
      </a>

      {onNewProject && currentUser?.isAdmin && (
        <button onClick={onNewProject}
          className="text-xs px-3 py-1.5 rounded-md transition-colors bg-green-700 hover:bg-green-600 text-white font-medium">
          + New Project
        </button>
      )}

      <button onClick={signOut}
        className="text-xs px-3 py-1.5 rounded-md transition-colors text-gray-500 hover:text-white hover:bg-gray-800">
        Sign out
      </button>

      <ConstructionBanner />

      {right && (
        <div className="ml-auto flex items-center gap-2">
          {right}
        </div>
      )}
    </nav>
  )
}
