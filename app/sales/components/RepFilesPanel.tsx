import React, { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  loadRepFiles, addRepFile, deleteRepFile,
  REP_FILE_TYPES, REP_FILE_TYPE_LABELS,
} from '@/lib/api'
import type { RepFile } from '@/lib/api'
import { Upload, Trash2, FileText, Image, Download, X } from 'lucide-react'
import { resolveSignedUrl, parsePathFromLegacyUrl } from '@/lib/storage/signed-url'
import SignedLink from '@/components/storage/SignedLink'

const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return <Image className="w-3.5 h-3.5 text-blue-400" />
  return <FileText className="w-3.5 h-3.5 text-gray-400" />
}

export function RepFilesPanel({ repId, isAdmin, userName }: {
  repId: string
  isAdmin: boolean
  userName: string
}) {
  const [files, setFiles] = useState<RepFile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [fileType, setFileType] = useState<string>('other')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    const f = await loadRepFiles(repId)
    setFiles(f)
    setLoaded(true)
  }, [repId])

  // Load on first render
  if (!loaded) load()

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)

    const ext = file.name.split('.').pop() ?? 'file'
    const storagePath = `${repId}/${Date.now()}.${ext}`
    const supabase = createClient()

    const { error: uploadErr } = await supabase.storage
      .from('rep-files')
      .upload(storagePath, file, { contentType: file.type })

    if (uploadErr) {
      console.error('[rep-file upload]', uploadErr)
      setUploading(false)
      e.target.value = ''
      return
    }

    // Bucket flipped private in migration 154 — getPublicUrl doesn't resolve.
    // Reader path uses file_path via server-side signed URL; file_url is dead.
    await addRepFile({
      rep_id: repId,
      file_type: fileType,
      file_name: file.name,
      file_url: null,
      file_path: storagePath,
      uploaded_by: userName,
      notes: null,
    })

    await load()
    setUploading(false)
    setFileType('other')
    e.target.value = ''
  }

  async function handleDelete(fileId: string, f: RepFile) {
    if (!confirm('Delete this file?')) return
    await deleteRepFile(fileId)
    // Best-effort remove from storage — prefer the stored path column,
    // fall back to parsing it out of the legacy URL for rows that predate
    // migration 150. `file_path` is stored as raw object name, so no decode.
    // The legacy URL's path segment may be percent-encoded (Supabase
    // getPublicUrl encodes spaces etc), so only decode in that branch and
    // catch malformed encodings (e.g. a stray `%` in a filename) instead of
    // letting them crash the handler.
    let path: string | null = null
    if (f.file_path) {
      path = f.file_path
    } else if (f.file_url) {
      const parsed = parsePathFromLegacyUrl(f.file_url, 'rep-files')
      if (parsed) {
        try {
          path = decodeURIComponent(parsed)
        } catch {
          path = parsed
        }
      }
    }
    if (path) {
      const supabase = createClient()
      await supabase.storage.from('rep-files').remove([path])
    }
    await load()
  }

  async function openPreview(f: RepFile) {
    const signed = await resolveSignedUrl('rep-files', { path: f.file_path, legacyUrl: f.file_url })
    if (signed) setPreviewUrl(signed)
  }

  const isImage = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)
  }

  return (
    <div className="space-y-2">
      <h4 className="text-[10px] uppercase text-gray-500 font-medium tracking-wider">Files</h4>

      {files.length > 0 ? (
        <div className="space-y-1">
          {files.map(f => (
            <div key={f.id} className="flex items-center justify-between py-1 px-2 bg-gray-800/50 rounded group">
              <div className="flex items-center gap-2 min-w-0">
                {fileIcon(f.file_name)}
                <div className="min-w-0">
                  {isImage(f.file_name) ? (
                    <button
                      onClick={() => openPreview(f)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 truncate block max-w-[140px]"
                      title={f.file_name}
                    >
                      {f.file_name}
                    </button>
                  ) : (
                    <SignedLink
                      bucket="rep-files"
                      path={f.file_path}
                      legacyUrl={f.file_url}
                      className="text-[10px] text-blue-400 hover:text-blue-300 truncate block max-w-[140px]"
                      title={f.file_name}
                    >
                      {f.file_name}
                    </SignedLink>
                  )}
                  <span className="text-[9px] text-gray-500">
                    {REP_FILE_TYPE_LABELS[f.file_type] ?? f.file_type}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <SignedLink bucket="rep-files" path={f.file_path} legacyUrl={f.file_url}
                  className="text-gray-500 hover:text-white p-0.5" title="Download">
                  <Download className="w-3 h-3" />
                </SignedLink>
                {isAdmin && (
                  <button onClick={() => handleDelete(f.id, f)}
                    className="text-gray-500 hover:text-red-400 p-0.5" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-gray-600">No files uploaded</p>
      )}

      {isAdmin && (
        <div className="flex items-center gap-2 pt-1" onClick={e => e.stopPropagation()}>
          <select
            value={fileType}
            onChange={e => setFileType(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-green-500"
          >
            {REP_FILE_TYPES.map(t => (
              <option key={t} value={t}>{REP_FILE_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <label className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors ${
            uploading ? 'bg-gray-700 text-gray-500' : 'bg-green-700/50 hover:bg-green-700 text-green-300'
          }`}>
            <Upload className="w-3 h-3" />
            {uploading ? 'Uploading...' : 'Upload'}
            <input
              type="file"
              accept={ACCEPT}
              className="hidden"
              disabled={uploading}
              onChange={handleUpload}
            />
          </label>
        </div>
      )}

      {/* Image preview modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setPreviewUrl(null)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative max-w-3xl max-h-[85vh]">
            <button onClick={() => setPreviewUrl(null)}
              className="absolute -top-3 -right-3 bg-gray-800 border border-gray-600 rounded-full p-1 text-gray-400 hover:text-white z-10">
              <X className="w-4 h-4" />
            </button>
            <img src={previewUrl} alt="Preview" className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  )
}
