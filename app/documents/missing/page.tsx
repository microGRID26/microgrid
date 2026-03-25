'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { db } from '@/lib/db'
import { loadDocumentRequirements, loadProjectFiles } from '@/lib/api/documents'
import { loadProjectById } from '@/lib/api'
import { escapeIlike, STAGE_ORDER, STAGE_LABELS } from '@/lib/utils'
import type { DocumentRequirement, ProjectFile } from '@/lib/api/documents'
import type { Project } from '@/types/database'
import { Search, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react'

const PAGE_SIZE = 50

// Convert ILIKE-style patterns to regex
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function matchesPattern(fileName: string, pattern: string | null): boolean {
  if (!pattern) return false
  return patternToRegex(pattern).test(fileName)
}

interface ProjectMissingDocs {
  project: Project
  missingCount: number
  totalRequired: number
  missingDocs: string[]
}

type SortField = 'missing' | 'id' | 'name' | 'stage'
type SortDir = 'asc' | 'desc'

export default function MissingDocumentsPage() {
  const { user: authUser, loading: authLoading } = useCurrentUser()
  const [projects, setProjects] = useState<Project[]>([])
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([])
  const [projectFilesMap, setProjectFilesMap] = useState<Record<string, ProjectFile[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [pmFilter, setPmFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('missing')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const [openProject, setOpenProject] = useState<Project | null>(null)

  // Load active projects and requirements
  const loadData = useCallback(async () => {
    setLoading(true)
    const supabase = db()

    // Load active projects (exclude Cancelled, In Service)
    const { data: projData } = await supabase
      .from('projects')
      .select('*')
      .not('disposition', 'in', '("Cancelled","In Service")')
      .order('id')
      .limit(2000)

    const projs = (projData ?? []) as Project[]
    setProjects(projs)

    // Load all active document requirements
    const reqs = await loadDocumentRequirements()
    setRequirements(reqs)

    // Load project_files for all projects (batch)
    const { data: allFiles } = await supabase
      .from('project_files')
      .select('*')
      .order('project_id')
      .limit(50000)

    const filesMap: Record<string, ProjectFile[]> = {}
    for (const f of (allFiles ?? []) as ProjectFile[]) {
      if (!filesMap[f.project_id]) filesMap[f.project_id] = []
      filesMap[f.project_id].push(f)
    }
    setProjectFilesMap(filesMap)

    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Compute missing documents per project
  const projectMissing = useMemo((): ProjectMissingDocs[] => {
    return projects.map(project => {
      const currentIdx = STAGE_ORDER.indexOf(project.stage)
      const relevantStages = new Set(STAGE_ORDER.slice(0, currentIdx + 1))
      const projectReqs = requirements.filter(r => r.required && relevantStages.has(r.stage))
      const projectFiles = projectFilesMap[project.id] ?? []

      const missingDocs: string[] = []
      for (const req of projectReqs) {
        let found = false
        for (const f of projectFiles) {
          if (req.folder_name && f.folder_name) {
            if (!f.folder_name.toLowerCase().includes(req.folder_name.toLowerCase())) continue
          }
          if (req.filename_pattern && matchesPattern(f.file_name, req.filename_pattern)) {
            found = true
            break
          }
        }
        if (!found) missingDocs.push(req.document_type)
      }

      return {
        project,
        missingCount: missingDocs.length,
        totalRequired: projectReqs.length,
        missingDocs,
      }
    })
  }, [projects, requirements, projectFilesMap])

  // Get unique PMs for filter dropdown
  const pmOptions = useMemo(() => {
    const pms = new Map<string, string>()
    for (const p of projects) {
      if (p.pm && p.pm_id) pms.set(p.pm_id, p.pm)
    }
    return Array.from(pms.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [projects])

  // Filter and sort
  const filtered = useMemo(() => {
    let result = projectMissing

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        r.project.name?.toLowerCase().includes(q) ||
        r.project.id.toLowerCase().includes(q) ||
        r.project.city?.toLowerCase().includes(q) ||
        r.project.address?.toLowerCase().includes(q)
      )
    }

    // Stage filter
    if (stageFilter) {
      result = result.filter(r => r.project.stage === stageFilter)
    }

    // PM filter
    if (pmFilter) {
      result = result.filter(r => r.project.pm_id === pmFilter)
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'missing': cmp = a.missingCount - b.missingCount; break
        case 'id': cmp = a.project.id.localeCompare(b.project.id); break
        case 'name': cmp = (a.project.name ?? '').localeCompare(b.project.name ?? ''); break
        case 'stage': cmp = STAGE_ORDER.indexOf(a.project.stage) - STAGE_ORDER.indexOf(b.project.stage); break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return result
  }, [projectMissing, search, stageFilter, pmFilter, sortField, sortDir])

  // Pagination
  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasMore = page < totalPages

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'missing' ? 'desc' : 'asc')
    }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="inline ml-0.5" />
      : <ChevronDown size={12} className="inline ml-0.5" />
  }

  const handleOpenProject = async (projectId: string) => {
    const proj = await loadProjectById(projectId)
    if (proj) setOpenProject(proj)
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Nav active="Documents" right={
        <div className="flex items-center gap-3">
          <Pagination
            currentPage={page}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            hasMore={hasMore}
            onPrevPage={() => setPage(p => Math.max(1, p - 1))}
            onNextPage={() => setPage(p => p + 1)}
          />
        </div>
      } />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-white">Missing Documents Report</h1>
          <p className="text-xs text-gray-500 mt-1">
            Projects with missing required documents based on their current pipeline stage.
          </p>
        </div>

        {/* Info banner */}
        <div className="mb-4 bg-amber-900/20 border border-amber-800/50 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300/80">
            Document inventory sync in progress. Results will improve as more projects are synced.
            Document requirements can be configured in the Admin portal.
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, ID, city, address..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-md pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>

          <select
            value={stageFilter}
            onChange={e => { setStageFilter(e.target.value); setPage(1) }}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="">All Stages</option>
            {STAGE_ORDER.map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>

          <select
            value={pmFilter}
            onChange={e => { setPmFilter(e.target.value); setPage(1) }}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="">All PMs</option>
            {pmOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>

          <span className="text-xs text-gray-500 ml-auto">
            {totalCount} project{totalCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
            Analyzing documents across projects...
          </div>
        ) : (
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 border-b border-gray-800">
                <tr>
                  <th
                    className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white select-none"
                    onClick={() => toggleSort('id')}
                  >
                    Project ID <SortIcon field="id" />
                  </th>
                  <th
                    className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white select-none"
                    onClick={() => toggleSort('name')}
                  >
                    Name <SortIcon field="name" />
                  </th>
                  <th
                    className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white select-none"
                    onClick={() => toggleSort('stage')}
                  >
                    Stage <SortIcon field="stage" />
                  </th>
                  <th className="text-left px-3 py-2.5 text-gray-400 font-medium">PM</th>
                  <th
                    className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white select-none"
                    onClick={() => toggleSort('missing')}
                  >
                    Missing <SortIcon field="missing" />
                  </th>
                  <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Missing Documents</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row, i) => (
                  <tr
                    key={row.project.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                  >
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleOpenProject(row.project.id)}
                        className="text-blue-400 hover:text-blue-300 font-mono"
                      >
                        {row.project.id}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-white max-w-[200px] truncate">{row.project.name ?? '--'}</td>
                    <td className="px-3 py-2 text-gray-400">{STAGE_LABELS[row.project.stage] ?? row.project.stage}</td>
                    <td className="px-3 py-2 text-gray-400">{row.project.pm ?? '--'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        row.missingCount === 0
                          ? 'bg-green-900/40 text-green-400'
                          : row.missingCount <= 2
                          ? 'bg-amber-900/40 text-amber-400'
                          : 'bg-red-900/40 text-red-400'
                      }`}>
                        {row.missingCount}/{row.totalRequired}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 max-w-[300px] truncate" title={row.missingDocs.join(', ')}>
                      {row.missingDocs.length > 0 ? row.missingDocs.join(', ') : (
                        <span className="text-green-400/60">All present</span>
                      )}
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-12 text-center text-gray-600">
                      {requirements.length === 0
                        ? 'No document requirements configured. Add them in the Admin portal.'
                        : 'No projects match the current filters.'
                      }
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ProjectPanel modal */}
      {openProject && (
        <ProjectPanel
          project={openProject}
          onClose={() => setOpenProject(null)}
          onProjectUpdated={() => {}}
          initialTab="files"
        />
      )}
    </div>
  )
}
