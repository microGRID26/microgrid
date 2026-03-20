'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn } from '@/lib/utils'
import { MessageSquarePlus, X } from 'lucide-react'

const FEEDBACK_TYPES = ['Bug', 'Feature Request', 'Improvement', 'Question'] as const

export function FeedbackButton() {
  const { user } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>('Improvement')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')

  // Lock background scroll when feedback modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  // Hide on /login
  if (typeof window !== 'undefined' && window.location.pathname === '/login') return null

  const reset = () => {
    setType('Improvement')
    setMessage('')
  }

  const submit = async () => {
    if (!message.trim()) return
    setSubmitting(true)
    const supabase = createClient()
    const { error } = await (supabase as any).from('feedback').insert({
      user_name: user?.name ?? 'Unknown',
      user_email: user?.email ?? '',
      type,
      page: typeof window !== 'undefined' ? window.location.pathname : '',
      message: message.trim(),
    })
    setSubmitting(false)
    if (error) {
      setToast('Failed to submit feedback')
    } else {
      setToast('Feedback submitted — thank you!')
      reset()
      setOpen(false)
    }
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 md:bottom-5 md:right-5 z-[90] flex items-center gap-2 px-2 py-2 md:px-3 bg-gray-800 border border-gray-700 rounded-lg
                   text-gray-400 hover:text-white hover:border-gray-600 shadow-lg transition-colors text-xs"
      >
        <MessageSquarePlus className="w-4 h-4" />
        <span className="hidden md:inline">Feedback</span>
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Send Feedback</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Instruction banner */}
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 leading-relaxed">
                  Help us improve MicroGRID CRM. Report bugs, request features, or suggest improvements.
                  Your feedback is reviewed by the admin team.
                </p>
              </div>

              {/* Type dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Type</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                             focus:outline-none focus:border-green-500 transition-colors"
                >
                  {FEEDBACK_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Message</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={4}
                  className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white
                             placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors resize-none"
                />
              </div>

              {/* Auto-captured info */}
              <div className="text-[10px] text-gray-600">
                Submitting as {user?.name ?? 'Unknown'} from {typeof window !== 'undefined' ? window.location.pathname : ''}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-800">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!message.trim() || submitting}
                className={cn(
                  'px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
                  message.trim() && !submitting
                    ? 'bg-green-700 hover:bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                )}
              >
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed bottom-16 right-5 z-[200] text-white text-xs px-4 py-2 rounded-md shadow-lg',
          toast.includes('Failed') ? 'bg-red-700' : 'bg-green-700'
        )}>
          {toast}
        </div>
      )}
    </>
  )
}
