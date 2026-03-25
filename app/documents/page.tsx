'use client'

import { useState, useEffect, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { searchAllProjectFiles, loadAllProjectFiles } from '@/lib/api/documents'
import { loadProjectById } from '@/lib/api'
import { escapeIlike } from '@/lib/utils'
import type { ProjectFile } from '@/lib/api/documents'
import type { Project } from '@/types/database'
import { Search, FileText, Image, File } from 'lucide-react'

// ── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getMimeLabel(mimeType: string | null): string {
  if (!mimeType) return '--'
  if (mimeType.includes('pdf')) return 'PDF'
  if (mimeType.startsWith('image/')) return 'Image'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'Spreadsheet'
  if (mimeType.includes('document') || mimeType.includes('word')) return 'Document'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'Presentation'
  if (mimeType.includes('zip') || mimeType.includes('archive')) return 'Archive'
  return 'File'
}

function getFileIcon(mimeType: string | null) {
  if (!mimeType) return <File size={14} className="text-gray-400" />
  if (mimeType.startsWith('image/')) return <Image size={14} className="text-blue-400" />
  if (mimeType.includes('pdf')) return <FileText size={14} className="text-red-400" />
  return <File size={14} className="text-gray-400" />
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  // ProjectPanel state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Load files
  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const query = debouncedSearch.trim()
      const result = query
        ? await searchAllProjectFiles(escapeIlike(query), page, PAGE_SIZE)
        : await loadAllProjectFiles(page, PAGE_SIZE)
      setFiles(result.data)
      setTotalCount(result.count)
    } catch (err) {
      console.error('Failed to load files:', err)
      setFiles([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, page])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const hasMore = page < totalPages

  async function openProject(projectId: string) {
    const project = await loadProjectById(projectId)
    if (project) setSelectedProject(project)
  }

  if (userLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav
        active="Documents"
        right={
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search files by name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500 w-64"
              />
            </div>
            <span className="text-xs text-gray-500">
              {totalCount.toLocaleString()} file{totalCount !== 1 ? 's' : ''}
            </span>
            <Pagination
              currentPage={page}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              hasMore={hasMore}
              onPrevPage={() => setPage(p => Math.max(1, p - 1))}
              onNextPage={() => setPage(p => p + 1)}
            />
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-white">Document Management</h1>
          <p className="text-xs text-gray-500 mt-0.5">File inventory and document tracking</p>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-500 text-sm">
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-3xl mb-3">📁</div>
            <div className="text-gray-400 text-sm font-medium mb-1">
              {debouncedSearch.trim() ? `No files matching "${debouncedSearch}"` : 'No files synced yet'}
            </div>
            <div className="text-gray-500 text-xs">
              File inventory will populate once Google Drive sync is enabled.
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 w-10"></th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-400">Project</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-400">File Name</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-400">Folder</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-400">Type</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 text-right">Size</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => (
                  <tr
                    key={file.id}
                    className="border-b border-gray-700/50 hover:bg-gray-750 cursor-pointer transition-colors"
                    onClick={() => openProject(file.project_id)}
                  >
                    <td className="px-4 py-2">
                      {getFileIcon(file.mime_type)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs text-green-400 font-mono">{file.project_id}</span>
                    </td>
                    <td className="px-4 py-2">
                      {file.file_url ? (
                        <a
                          href={file.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-white hover:text-green-400 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          {file.file_name}
                        </a>
                      ) : (
                        <span className="text-xs text-white">{file.file_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs text-gray-400">{file.folder_name || '--'}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs text-gray-400">{getMimeLabel(file.mime_type)}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-xs text-gray-500">{formatFileSize(file.file_size)}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-xs text-gray-500">{formatDate(file.updated_at || file.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ProjectPanel */}
      {selectedProject && (
        <ProjectPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onProjectUpdated={() => {}}
          initialTab="files"
        />
      )}
    </div>
  )
}
