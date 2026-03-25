'use client'

import { useState, useEffect, useMemo } from 'react'
import { loadDocumentRequirements, loadProjectDocuments, loadProjectFiles } from '@/lib/api/documents'
import type { DocumentRequirement, ProjectDocument, ProjectFile } from '@/lib/api/documents'
import { STAGE_ORDER, STAGE_LABELS } from '@/lib/utils'
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react'

interface DocumentChecklistProps {
  projectId: string
  currentStage: string
}

// Convert ILIKE-style patterns to regex: %word% means "contains word" (case-insensitive)
function patternToRegex(pattern: string): RegExp {
  // Escape regex special chars except %, then convert % to .*
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // escape all regex specials
    .replace(/%/g, '.*')                        // convert SQL % wildcards
    .replace(/_/g, '.')                          // convert SQL _ wildcards
  return new RegExp(`^${escaped}$`, 'i')
}

function matchesPattern(fileName: string, pattern: string | null): boolean {
  if (!pattern) return false
  const regex = patternToRegex(pattern)
  return regex.test(fileName)
}

interface ChecklistItem {
  requirement: DocumentRequirement
  status: 'present' | 'missing' | 'pending' | 'verified'
  matchedFile: ProjectFile | null
}

export function DocumentChecklist({ projectId, currentStage }: DocumentChecklistProps) {
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([])
  const [projectDocs, setProjectDocs] = useState<ProjectDocument[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([
      loadDocumentRequirements(),
      loadProjectDocuments(projectId),
      loadProjectFiles(projectId),
    ]).then(([reqs, docs, projFiles]) => {
      if (cancelled) return
      setRequirements(reqs)
      setProjectDocs(docs)
      setFiles(projFiles)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [projectId, currentStage])

  // Filter requirements to current stage and all prior stages
  const relevantRequirements = useMemo(() => {
    const currentIdx = STAGE_ORDER.indexOf(currentStage)
    if (currentIdx < 0) return requirements.filter(r => r.active)
    const relevantStages = new Set(STAGE_ORDER.slice(0, currentIdx + 1))
    return requirements.filter(r => r.active && relevantStages.has(r.stage))
  }, [requirements, currentStage])

  // Build checklist items: match files against requirements
  const checklistItems = useMemo(() => {
    const docMap = new Map(projectDocs.map(d => [d.requirement_id, d]))

    return relevantRequirements.map((req): ChecklistItem => {
      // Check if there's a manual status override in project_documents
      const manualDoc = docMap.get(req.id)
      if (manualDoc) {
        // Find the matched file if any
        const matchedFile = manualDoc.file_id
          ? files.find(f => f.file_id === manualDoc.file_id) ?? null
          : null
        return { requirement: req, status: manualDoc.doc_status, matchedFile }
      }

      // Auto-match by filename pattern and folder name
      let matchedFile: ProjectFile | null = null
      for (const f of files) {
        // Check folder match first
        if (req.folder_name && f.folder_name) {
          if (!f.folder_name.toLowerCase().includes(req.folder_name.toLowerCase())) continue
        }
        // Check filename pattern
        if (req.filename_pattern && matchesPattern(f.file_name, req.filename_pattern)) {
          matchedFile = f
          break
        }
      }

      return {
        requirement: req,
        status: matchedFile ? 'present' : 'missing',
        matchedFile,
      }
    })
  }, [relevantRequirements, projectDocs, files])

  // Group by stage
  const groupedByStage = useMemo(() => {
    const groups: Record<string, ChecklistItem[]> = {}
    for (const item of checklistItems) {
      const stage = item.requirement.stage
      if (!groups[stage]) groups[stage] = []
      groups[stage].push(item)
    }
    // Sort by stage order
    return STAGE_ORDER
      .filter(s => groups[s])
      .map(s => ({ stage: s, items: groups[s] }))
  }, [checklistItems])

  // Summary counts
  const presentCount = checklistItems.filter(i => i.status === 'present' || i.status === 'verified').length
  const totalCount = checklistItems.length
  const pendingCount = checklistItems.filter(i => i.status === 'pending').length
  const missingCount = checklistItems.filter(i => i.status === 'missing').length
  const progressPct = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0

  const toggleStage = (stage: string) => {
    setCollapsedStages(prev => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div className="text-gray-500 text-xs">Loading document checklist...</div>
      </div>
    )
  }

  if (!loading && totalCount === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 w-full text-left"
        >
          {collapsed ? <ChevronRight size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
          <span className="text-xs font-semibold text-green-400">Document Checklist</span>
        </button>
        {!collapsed && (
          <div className="mt-3 text-gray-500 text-xs">
            No document requirements configured for this stage. Admin can add requirements in the Admin portal.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Header with collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left px-4 py-3"
      >
        {collapsed ? <ChevronRight size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        <span className="text-xs font-semibold text-green-400">Document Checklist</span>
        <span className="ml-auto text-xs text-gray-400">{presentCount}/{totalCount} present</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Progress</span>
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                {missingCount > 0 && <span className="text-red-400">{missingCount} missing</span>}
                {pendingCount > 0 && <span className="text-amber-400">{pendingCount} pending</span>}
              </div>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-right text-[10px] text-gray-500">{progressPct}%</div>
          </div>

          {/* Grouped checklist */}
          <div className="space-y-2">
            {groupedByStage.map(({ stage, items }) => {
              const stageCollapsed = collapsedStages.has(stage)
              const stagePresent = items.filter(i => i.status === 'present' || i.status === 'verified').length
              return (
                <div key={stage}>
                  <button
                    onClick={() => toggleStage(stage)}
                    className="flex items-center gap-1.5 w-full text-left py-1"
                  >
                    {stageCollapsed
                      ? <ChevronRight size={12} className="text-gray-600" />
                      : <ChevronDown size={12} className="text-gray-600" />
                    }
                    <span className="text-[11px] font-medium text-green-400/80">{STAGE_LABELS[stage] || stage}</span>
                    <span className="text-[10px] text-gray-600 ml-1">({stagePresent}/{items.length})</span>
                  </button>

                  {!stageCollapsed && (
                    <div className="ml-4 space-y-0.5">
                      {items.map(item => (
                        <div
                          key={item.requirement.id}
                          className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-700/50 transition-colors"
                        >
                          {/* Status icon */}
                          {(item.status === 'present' || item.status === 'verified') && (
                            <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                          )}
                          {item.status === 'missing' && (
                            <XCircle size={14} className="text-red-400 flex-shrink-0" />
                          )}
                          {item.status === 'pending' && (
                            <Clock size={14} className="text-amber-400 flex-shrink-0" />
                          )}

                          {/* Document type */}
                          <span className="text-xs text-gray-300 flex-1 min-w-0 truncate">
                            {item.requirement.document_type}
                            {!item.requirement.required && (
                              <span className="text-gray-600 ml-1">(optional)</span>
                            )}
                          </span>

                          {/* Status label */}
                          {(item.status === 'present' || item.status === 'verified') && item.matchedFile && (
                            <span className="text-[10px] text-gray-500 truncate max-w-[150px] flex-shrink-0" title={item.matchedFile.file_name}>
                              {item.matchedFile.file_name}
                            </span>
                          )}
                          {item.status === 'missing' && (
                            <span className="text-[10px] text-red-400/70 flex-shrink-0">Missing</span>
                          )}
                          {item.status === 'pending' && (
                            <span className="text-[10px] text-amber-400/70 flex-shrink-0">Pending</span>
                          )}
                          {item.status === 'verified' && (
                            <span className="text-[10px] text-green-400/70 flex-shrink-0 ml-1">Verified</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
