'use client'

import { useState, useEffect, useMemo } from 'react'
import { loadProjectFiles } from '@/lib/api/documents'
import type { ProjectFile } from '@/lib/api/documents'
import { FileText, Image, File, Search, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { DocumentChecklist } from './DocumentChecklist'

interface FilesTabProps {
  folderUrl: string | null
  projectId: string
  currentStage?: string
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(mimeType: string | null) {
  if (!mimeType) return <File size={16} className="text-gray-400" />
  if (mimeType.startsWith('image/')) return <Image size={16} className="text-blue-400" />
  if (mimeType.includes('pdf')) return <FileText size={16} className="text-red-400" />
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return <FileText size={16} className="text-green-400" />
  if (mimeType.includes('document') || mimeType.includes('word'))
    return <FileText size={16} className="text-blue-300" />
  return <File size={16} className="text-gray-400" />
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function FilesTab({ folderUrl, projectId, currentStage }: FilesTabProps) {
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [syncToast, setSyncToast] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadProjectFiles(projectId).then(data => {
      if (!cancelled) {
        setFiles(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [projectId])

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files
    const q = search.toLowerCase()
    return files.filter(f => f.file_name.toLowerCase().includes(q))
  }, [files, search])

  const groupedByFolder = useMemo(() => {
    const groups: Record<string, ProjectFile[]> = {}
    for (const f of filteredFiles) {
      const folder = f.folder_name || 'Uncategorized'
      if (!groups[folder]) groups[folder] = []
      groups[folder].push(f)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredFiles])

  const toggleFolder = (folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  const handleSync = () => {
    setSyncToast(true)
    setTimeout(() => setSyncToast(false), 3000)
  }

  const hasFiles = files.length > 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Drive link + controls */}
      <div className="flex items-center gap-3 px-1 pb-3 border-b border-gray-700 flex-shrink-0">
        {folderUrl && (
          <a href={folderUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 transition-colors">
            <img src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" alt="Open in Google Drive" className="w-5 h-5" />
            <span className="text-xs font-semibold text-white">Open in Drive</span>
            <ExternalLink size={12} className="text-gray-400" />
          </a>
        )}

        {hasFiles && (
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search files..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-md pl-7 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500 w-48"
              />
            </div>
            <button
              onClick={handleSync}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-500 transition-colors cursor-help"
              title="Google Drive sync will be available in Phase 2"
            >
              <RefreshCw size={12} />
              Sync (Coming Soon)
            </button>
          </div>
        )}

        {!hasFiles && !loading && (
          <button
            onClick={handleSync}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-300 transition-colors ml-auto"
          >
            <RefreshCw size={12} />
            Sync from Drive
          </button>
        )}
      </div>

      {/* Toast */}
      {syncToast && (
        <div className="mx-1 mt-2 bg-gray-800 border border-green-700 rounded-md px-3 py-2 text-xs text-green-400 flex-shrink-0">
          Sync coming soon -- Google Drive sync will be available in Phase 2.
        </div>
      )}

      {/* Document Checklist */}
      {currentStage && (
        <div className="mt-2 flex-shrink-0">
          <DocumentChecklist projectId={projectId} currentStage={currentStage} />
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto mt-2">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
            Loading files...
          </div>
        ) : !hasFiles ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-3xl mb-3">📁</div>
            <div className="text-gray-400 text-sm font-medium mb-1">File inventory not yet synced</div>
            <div className="text-gray-500 text-xs">
              {folderUrl ? 'Use the Drive link above to browse files, or sync to load the file inventory.' : 'No Drive folder linked to this project.'}
            </div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
            No files matching &ldquo;{search}&rdquo;
          </div>
        ) : (
          <div className="space-y-1">
            {groupedByFolder.map(([folder, folderFiles]) => {
              const collapsed = collapsedFolders.has(folder)
              return (
                <div key={folder}>
                  <button
                    onClick={() => toggleFolder(folder)}
                    className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-gray-800 rounded-md transition-colors"
                  >
                    {collapsed
                      ? <ChevronRight size={14} className="text-gray-500" />
                      : <ChevronDown size={14} className="text-gray-500" />
                    }
                    <span className="text-xs font-semibold text-green-400">{folder}</span>
                    <span className="text-xs text-gray-500">({folderFiles.length})</span>
                  </button>

                  {!collapsed && (
                    <div className="ml-5 space-y-0.5">
                      {folderFiles.map(file => (
                        <div key={file.id} className="flex items-center gap-3 px-3 py-2 bg-gray-800 rounded-md hover:bg-gray-750 group">
                          {getFileIcon(file.mime_type)}
                          {file.file_url ? (
                            <a
                              href={file.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-white hover:text-green-400 transition-colors truncate flex-1 min-w-0"
                              title={file.file_name}
                            >
                              {file.file_name}
                            </a>
                          ) : (
                            <span className="text-xs text-white truncate flex-1 min-w-0" title={file.file_name}>
                              {file.file_name}
                            </span>
                          )}
                          <span className="text-xs text-gray-500 flex-shrink-0">{formatFileSize(file.file_size)}</span>
                          <span className="text-xs text-gray-500 flex-shrink-0">{formatDate(file.updated_at || file.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* File count */}
      {hasFiles && (
        <div className="px-1 pt-2 border-t border-gray-700 flex-shrink-0">
          <span className="text-xs text-gray-500">
            {filteredFiles.length} file{filteredFiles.length !== 1 ? 's' : ''}{search.trim() ? ` matching "${search}"` : ''} across {groupedByFolder.length} folder{groupedByFolder.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
