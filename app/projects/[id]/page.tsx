'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { loadProjectById } from '@/lib/api/projects'
import type { Project } from '@/types/database'

type PanelTab = NonNullable<React.ComponentProps<typeof ProjectPanel>['initialTab']>

const VALID_TABS: PanelTab[] = [
  'tasks', 'notes', 'info', 'bom', 'files', 'materials',
  'warranty', 'ntp', 'cost_basis', 'invoices',
]

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const router = useRouter()

  const rawIdParam = params?.id ?? ''
  let rawId = ''
  try { rawId = decodeURIComponent(rawIdParam) } catch { rawId = rawIdParam }
  const tabParam = search?.get('tab') ?? undefined
  const initialTab = VALID_TABS.includes(tabParam as PanelTab) ? (tabParam as PanelTab) : undefined

  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const UNAVAILABLE = `Project ${rawId || '(unknown)'} is not available. It may not exist, or you may not have access.`
    if (!rawId) {
      setError(UNAVAILABLE)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadProjectById(rawId)
      .then(p => {
        if (cancelled) return
        if (!p) setError(UNAVAILABLE)
        else setProject(p)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(UNAVAILABLE)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [rawId])

  function handleClose() {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/command')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading {rawId}…
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-white mb-2">Project unavailable</h1>
          <p className="text-sm text-gray-400 mb-4">{error}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push('/command')}
              className="text-xs bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Back to Command
            </button>
            <button
              onClick={() => router.push('/portfolio')}
              className="text-xs text-gray-400 hover:text-white px-4 py-2 transition-colors"
            >
              Open Portfolio
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <ProjectPanel
        project={project}
        onClose={handleClose}
        onProjectUpdated={() => loadProjectById(rawId).then(p => p && setProject(p))}
        initialTab={initialTab}
      />
    </div>
  )
}
