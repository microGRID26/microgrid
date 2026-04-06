import { useState } from 'react'
import { cn } from '@/lib/utils'
import { JOB_COMPLETE_TASK } from '@/lib/tasks'
import { JOB_BADGE, JOB_LABELS, STATUS_DOT, STATUS_LABEL, fmtTime, mapsLink, telLink } from './constants'
import type { FieldJob } from './constants'

export function FieldJobCard({
  job,
  onTap,
  onStatusChange,
  onMarkTaskComplete,
  onAddNote,
}: {
  job: FieldJob
  onTap: () => void
  onStatusChange: (id: string, status: string) => void
  onMarkTaskComplete: (job: FieldJob) => void
  onAddNote?: (projectId: string, text: string) => Promise<boolean>
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSending, setNoteSending] = useState(false)
  const address = [job.customer_address, job.customer_city, job.customer_zip].filter(Boolean).join(', ')
  const status = job.status ?? 'scheduled'
  const jobType = job.job_type ?? 'survey'
  const taskId = JOB_COMPLETE_TASK[jobType]

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
      {/* Card body — tappable for detail */}
      <button onClick={onTap} className="w-full text-left p-4 active:bg-gray-800 transition-colors">
        {/* Top row: badges */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={cn('text-sm px-3 py-1 rounded-full font-medium border', JOB_BADGE[jobType] ?? 'bg-gray-800 text-gray-300 border-gray-700')}>
            {JOB_LABELS[jobType] ?? jobType}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('w-2.5 h-2.5 rounded-full', STATUS_DOT[status] ?? 'bg-gray-500')} />
            <span className="text-sm text-gray-400">{STATUS_LABEL[status] ?? status}</span>
          </span>
          {job.time && (
            <span className="text-sm text-gray-400 ml-auto">{fmtTime(job.time)}</span>
          )}
        </div>

        {/* Project name — large */}
        <div className="text-xl font-bold text-white mb-1 leading-tight">
          {job.project_name ?? job.project_id}
        </div>

        {/* Address */}
        {address && (
          <div className="text-sm text-gray-400 mb-2">{address}</div>
        )}

        {/* Crew */}
        {job.crew_name && (
          <div className="text-xs text-gray-500">Crew: {job.crew_name}</div>
        )}
      </button>

      {/* Quick actions row */}
      <div className="flex items-center border-t border-gray-800 divide-x divide-gray-800">
        {/* Call */}
        {job.customer_phone ? (
          <a
            href={telLink(job.customer_phone)}
            className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-green-400 active:bg-gray-800 transition-colors"
            aria-label="Call customer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span className="text-sm">Call</span>
          </a>
        ) : (
          <div className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span className="text-sm">Call</span>
          </div>
        )}

        {/* Navigate */}
        {address ? (
          <a
            href={mapsLink(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-blue-400 active:bg-gray-800 transition-colors"
            aria-label="Navigate to address"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span className="text-sm">Navigate</span>
          </a>
        ) : (
          <div className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span className="text-sm">Navigate</span>
          </div>
        )}

        {/* Quick note toggle */}
        <button
          onClick={() => setNoteOpen(!noteOpen)}
          className={cn('flex-1 flex items-center justify-center gap-2 min-h-[48px] active:bg-gray-800 transition-colors', noteOpen ? 'text-green-400' : 'text-amber-400')}
          aria-label="Add quick note"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
          <span className="text-sm">Note</span>
        </button>

        {/* Full detail */}
        <button
          onClick={onTap}
          className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-gray-400 active:bg-gray-800 transition-colors"
          aria-label="View full details"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <span className="text-sm">Detail</span>
        </button>
      </div>

      {/* Quick Note — expandable */}
      {noteOpen && onAddNote && (
        <div className="px-4 py-3 border-t border-gray-800">
          <div className="flex gap-2">
            <input
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Quick note..."
              autoFocus
              onKeyDown={async e => {
                if (e.key === 'Enter' && noteText.trim()) {
                  setNoteSending(true)
                  const ok = await onAddNote(job.project_id, noteText.trim())
                  setNoteSending(false)
                  if (ok) { setNoteText(''); setNoteOpen(false) }
                }
              }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500"
            />
            <button
              onClick={async () => {
                if (!noteText.trim()) return
                setNoteSending(true)
                const ok = await onAddNote(job.project_id, noteText.trim())
                setNoteSending(false)
                if (ok) { setNoteText(''); setNoteOpen(false) }
              }}
              disabled={!noteText.trim() || noteSending}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-green-700 active:bg-green-600 disabled:bg-gray-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* Status action + Mark Task Complete */}
      {status !== 'complete' && status !== 'cancelled' && (
        <div className="px-4 pb-4 pt-2 space-y-2">
          {/* Job status toggle */}
          {status === 'scheduled' && (
            <button
              onClick={() => onStatusChange(job.id, 'in_progress')}
              className="w-full py-3 rounded-xl font-semibold text-base bg-amber-700 active:bg-amber-500 text-white transition-colors"
            >
              Start Job
            </button>
          )}
          {status === 'in_progress' && (
            <button
              onClick={() => onStatusChange(job.id, 'complete')}
              className="w-full py-3 rounded-xl font-semibold text-base bg-green-700 active:bg-green-500 text-white transition-colors"
            >
              Mark Job Complete
            </button>
          )}
          {/* Mark task complete (if mappable) */}
          {taskId && status === 'in_progress' && (
            <button
              onClick={() => onMarkTaskComplete(job)}
              className="w-full py-3 rounded-xl font-semibold text-base bg-green-900 border border-green-700 active:bg-green-800 text-green-300 transition-colors"
            >
              Mark Task Complete ({JOB_LABELS[jobType]})
            </button>
          )}
        </div>
      )}
    </div>
  )
}
