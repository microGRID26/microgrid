'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Dashboard merged into Command Center — redirect for bookmarks/links
export default function DashboardPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/command') }, [router])
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-gray-500 text-sm animate-pulse">Redirecting to Command Center…</div>
    </div>
  )
}
