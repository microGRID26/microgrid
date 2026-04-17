'use client'

import type { Note } from '@/types/database'
import React from 'react'
import { X } from 'lucide-react'
import { MentionNoteInput } from './MentionNoteInput'

// Detect file references in note text and make them clickable
// Links to Google Drive search scoped to the project folder
const FILE_PATTERN = /(\S+\.(?:pdf|png|jpg|jpeg|gif|dwg|xlsx|xls|csv|doc|docx|zip|heic|mp4|mov))/gi
const INLINE_IMAGE = /^image_\d{4}-\d{2}-\d{2}T/i

function isFileRef(part: string): boolean {
  return /\.\w{2,4}$/.test(part) && /\.(pdf|png|jpg|jpeg|gif|dwg|xlsx|xls|csv|doc|docx|zip|heic|mp4|mov)$/i.test(part)
}

function buildDriveSearchUrl(folderUrl: string, fileName: string): string {
  // Extract folder ID from Google Drive URL
  const match = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/)
  if (match) {
    const folderId = match[1]
    return `https://drive.google.com/drive/search?q=${encodeURIComponent(fileName)}+in:${folderId}`
  }
  // Fallback: general Drive search
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(fileName)}`
}

const MENTION_PATTERN = /(@[A-Z][a-z]+ [A-Z][a-z]+)/g

function NoteText({ text, folderUrl }: { text: string; folderUrl: string | null }) {
  // First split by file references
  const fileParts = text.split(FILE_PATTERN)

  return (
    <>
      {fileParts.map((part, i) => {
        if (isFileRef(part) && !INLINE_IMAGE.test(part) && folderUrl) {
          return (
            <a key={i} href={buildDriveSearchUrl(folderUrl, part)} target="_blank" rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline" title={`Search Google Drive for ${part}`}>
              {part}
            </a>
          )
        }
        // Check for @mentions in this text segment
        const mentionParts = part.split(MENTION_PATTERN)
        if (mentionParts.length === 1) return <React.Fragment key={i}>{part}</React.Fragment>
        return (
          <React.Fragment key={i}>
            {mentionParts.map((mp, j) =>
              mp.startsWith('@') ? (
                <span key={j} className="text-green-400 font-medium">{mp}</span>
              ) : (
                <React.Fragment key={j}>{mp}</React.Fragment>
              )
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}


interface NotesTabProps {
  notes: Note[]
  newNote: string
  setNewNote: (v: string) => void
  addNote: (noteText?: string) => void
  deleteNote?: (id: string) => void
  saving: boolean
  folderUrl?: string | null
  projectId?: string
  currentUserName?: string
}

export function NotesTab({ notes, newNote, setNewNote, addNote, deleteNote, saving, folderUrl, projectId, currentUserName }: NotesTabProps) {
  const handleSubmit = (text: string) => {
    addNote(text)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        {projectId && currentUserName ? (
          <MentionNoteInput
            onSubmit={handleSubmit}
            placeholder="Add a note… Type @ to mention someone (⌘+Enter to save)"
            projectId={projectId}
            currentUserName={currentUserName}
            saving={saving}
          />
        ) : (
          <>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
              placeholder="Add a note…"
              rows={3}
              className="w-full bg-gray-800 text-white text-sm rounded-lg p-3 border border-gray-700 focus:border-green-500 focus:outline-none resize-none placeholder-gray-500"
            />
            <div className="flex justify-end mt-2">
              <button onClick={addNote} disabled={saving || !newNote.trim()}
                className="text-xs px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg transition-colors">
                {saving ? 'Saving...' : 'Add Note'}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {notes.map(n => (
          <div key={n.id} className="bg-gray-800 rounded-xl p-3 group">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-green-400">{n.pm}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {n.time ? new Date(n.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </span>
                {deleteNote && (
                  <button onClick={() => { if (confirm('Delete this note?')) deleteNote(n.id) }}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all" title="Delete note">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-200 whitespace-pre-wrap"><NoteText text={n.text} folderUrl={folderUrl ?? null} /></p>
          </div>
        ))}
        {notes.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-xs">No notes yet.</div>
        )}
      </div>
    </div>
  )
}
