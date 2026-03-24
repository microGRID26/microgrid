'use client'

import type { Note } from '@/types/database'
import React from 'react'

// Detect file references in note text and make them clickable
const FILE_REGEX = /(\S+\.(?:pdf|png|jpg|jpeg|gif|dwg|xlsx|xls|csv|doc|docx|zip|heic|mp4|mov))/gi

function NoteText({ text, folderUrl }: { text: string; folderUrl: string | null }) {
  if (!folderUrl) return <>{text}</>

  const parts = text.split(FILE_REGEX)
  if (parts.length === 1) return <>{text}</>

  return (
    <>
      {parts.map((part, i) =>
        FILE_REGEX.test(part) ? (
          <a key={i} href={folderUrl} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline" title={`Open Google Drive to find ${part}`}>
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

interface NotesTabProps {
  notes: Note[]
  newNote: string
  setNewNote: (v: string) => void
  addNote: () => void
  saving: boolean
  folderUrl?: string | null
}

export function NotesTab({ notes, newNote, setNewNote, addNote, saving, folderUrl }: NotesTabProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <textarea value={newNote} onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
          placeholder="Add a note… (⌘+Enter to save)" rows={3}
          className="w-full bg-gray-800 text-white text-sm rounded-lg p-3 border border-gray-700 focus:border-green-500 focus:outline-none resize-none placeholder-gray-500"
        />
        <div className="flex justify-end mt-2">
          <button onClick={addNote} disabled={saving || !newNote.trim()}
            className="text-xs px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg transition-colors">
            {saving ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {notes.map(n => (
          <div key={n.id} className="bg-gray-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-green-400">{n.pm}</span>
              <span className="text-xs text-gray-500">
                {n.time ? new Date(n.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
              </span>
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
