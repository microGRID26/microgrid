'use client'

import { useState, useEffect, useCallback } from 'react'
import { db } from '@/lib/db'
import { SearchBar } from './shared'
import type { EmailOnboarding } from '@/types/database'

/** Escape HTML special characters to prevent XSS in email templates */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

type Enrollment = EmailOnboarding

export function EmailManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const [showAnnounce, setShowAnnounce] = useState(false)
  const [announceSubject, setAnnounceSubject] = useState('')
  const [announceMessage, setAnnounceMessage] = useState('')
  const [announceRole, setAnnounceRole] = useState('')
  const [toast, setToast] = useState('')

  const loadEnrollments = useCallback(async () => {
    setLoading(true)
    const { data, error } = await (db() as any)
      .from('email_onboarding')
      .select('*')
      .order('started_at', { ascending: false })
    if (error) {
      console.error('[EmailManager] load error:', error)
    } else {
      setEnrollments(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadEnrollments() }, [loadEnrollments])

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const togglePause = async (enrollment: Enrollment) => {
    const { error } = await (db() as any)
      .from('email_onboarding')
      .update({ paused: !enrollment.paused })
      .eq('id', enrollment.id)
    if (error) {
      flash('Error updating enrollment')
    } else {
      setEnrollments(prev =>
        prev.map(e => e.id === enrollment.id ? { ...e, paused: !e.paused } : e)
      )
      flash(enrollment.paused ? 'Resumed' : 'Paused')
    }
  }

  const sendTestEmail = async () => {
    setSending(true)
    try {
      const res = await fetch('/api/email/send-daily')
      const data = await res.json()
      flash(`Sent: ${data.sent}, Skipped: ${data.skipped || 0}`)
    } catch {
      flash('Error sending test emails')
    }
    setSending(false)
  }

  const enrollAllUsers = async () => {
    setEnrolling(true)
    try {
      const { data: users } = await (db() as any)
        .from('users')
        .select('id, email, name')
        .eq('active', true)

      if (!users) {
        flash('No users found')
        setEnrolling(false)
        return
      }

      let enrolled = 0
      for (const user of users) {
        const res = await fetch('/api/email/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            user_email: user.email,
            user_name: user.name,
          }),
        })
        const data = await res.json()
        if (data.enrolled) enrolled++
      }
      flash(`Enrolled ${enrolled} new user${enrolled !== 1 ? 's' : ''}`)
      loadEnrollments()
    } catch {
      flash('Error enrolling users')
    }
    setEnrolling(false)
  }

  const sendAnnouncement = async () => {
    if (!announceSubject.trim() || !announceMessage.trim()) {
      flash('Subject and message are required')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/email/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: announceSubject,
          html: `<h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">${escapeHtml(announceSubject)}</h2><p>${escapeHtml(announceMessage).replace(/\n/g, '</p><p>')}</p>`,
          targetRole: announceRole || undefined,
        }),
      })
      const data = await res.json()
      flash(`Sent to ${data.sent} user${data.sent !== 1 ? 's' : ''}`)
      setShowAnnounce(false)
      setAnnounceSubject('')
      setAnnounceMessage('')
      setAnnounceRole('')
    } catch {
      flash('Error sending announcement')
    }
    setSending(false)
  }

  const filtered = enrollments.filter(e => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (e.user_email?.toLowerCase().includes(q)) ||
      (e.user_name?.toLowerCase().includes(q))
    )
  })

  const stats = {
    total: enrollments.length,
    active: enrollments.filter(e => !e.paused && !e.completed).length,
    paused: enrollments.filter(e => e.paused).length,
    completed: enrollments.filter(e => e.completed).length,
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-900/90 text-green-300 text-xs px-4 py-2 rounded-lg border border-green-800 shadow-lg">
          {toast}
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-3">
          <span className="text-xs text-gray-400">
            Total: <span className="text-white font-medium">{stats.total}</span>
          </span>
          <span className="text-xs text-gray-400">
            Active: <span className="text-green-400 font-medium">{stats.active}</span>
          </span>
          <span className="text-xs text-gray-400">
            Paused: <span className="text-amber-400 font-medium">{stats.paused}</span>
          </span>
          <span className="text-xs text-gray-400">
            Completed: <span className="text-blue-400 font-medium">{stats.completed}</span>
          </span>
        </div>
        <div className="flex-1" />
        {isSuperAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowAnnounce(true)}
              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs font-medium rounded-md transition-colors"
            >
              Send Announcement
            </button>
            <button
              onClick={sendTestEmail}
              disabled={sending}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors"
            >
              {sending ? 'Sending...' : 'Trigger Daily Send'}
            </button>
            <button
              onClick={enrollAllUsers}
              disabled={enrolling}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors"
            >
              {enrolling ? 'Enrolling...' : 'Enroll All Users'}
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="mb-4">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or email..." />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-500 text-sm">Loading enrollments...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            {enrollments.length === 0 ? 'No users enrolled yet. Click "Enroll All Users" to start.' : 'No matching enrollments.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="border-b border-gray-800">
                <th className="text-left py-2 px-3 text-gray-400 font-medium">User</th>
                <th className="text-left py-2 px-3 text-gray-400 font-medium">Email</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Day</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Status</th>
                <th className="text-left py-2 px-3 text-gray-400 font-medium">Last Sent</th>
                <th className="text-left py-2 px-3 text-gray-400 font-medium">Started</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="py-2.5 px-3 text-white">{e.user_name || '—'}</td>
                  <td className="py-2.5 px-3 text-gray-300">{e.user_email}</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-800 text-white font-semibold text-xs">
                      {e.current_day}
                    </span>
                    <span className="text-gray-500 ml-1">/30</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {e.completed ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-900/40 text-blue-400 border border-blue-800">
                        Completed
                      </span>
                    ) : e.paused ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-400 border border-amber-800">
                        Paused
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/40 text-green-400 border border-green-800">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-gray-400">
                    {e.last_sent_at ? new Date(e.last_sent_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-gray-400">
                    {new Date(e.started_at).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {!e.completed && isSuperAdmin && (
                      <button
                        onClick={() => togglePause(e)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          e.paused
                            ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                            : 'bg-amber-900/30 text-amber-400 hover:bg-amber-900/50'
                        }`}
                      >
                        {e.paused ? 'Resume' : 'Pause'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Progress bar visual */}
      {filtered.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-800">
          <div className="text-xs text-gray-400 mb-2">Overall Progress</div>
          <div className="flex gap-1">
            {Array.from({ length: 30 }, (_, i) => {
              const usersAtDay = enrollments.filter(e => e.current_day > i).length
              const pct = enrollments.length > 0 ? usersAtDay / enrollments.length : 0
              return (
                <div
                  key={i}
                  className="flex-1 h-4 rounded-sm"
                  style={{
                    background: pct > 0.7 ? '#1D9E75' : pct > 0.3 ? '#f59e0b' : pct > 0 ? '#ef4444' : '#1f2937',
                    opacity: pct > 0 ? 0.4 + pct * 0.6 : 0.3,
                  }}
                  title={`Day ${i + 1}: ${usersAtDay} users completed`}
                />
              )
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-500">Day 1</span>
            <span className="text-[10px] text-gray-500">Day 30</span>
          </div>
        </div>
      )}

      {/* Announcement Modal */}
      {showAnnounce && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowAnnounce(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Send Announcement</h2>
              <button onClick={() => setShowAnnounce(false)} className="text-gray-400 hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Subject</label>
                <input
                  value={announceSubject}
                  onChange={e => setAnnounceSubject(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                           focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="What's New in NOVA..."
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Message</label>
                <textarea
                  value={announceMessage}
                  onChange={e => setAnnounceMessage(e.target.value)}
                  rows={5}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                           focus:outline-none focus:border-blue-500 transition-colors resize-none"
                  placeholder="Write your announcement..."
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Target Role (optional)</label>
                <select
                  value={announceRole}
                  onChange={e => setAnnounceRole(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                           focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="">All Users</option>
                  <option value="super_admin">Super Admin</option>
                  <option value="admin">Admin</option>
                  <option value="finance">Finance</option>
                  <option value="manager">Manager</option>
                  <option value="user">User</option>
                  <option value="sales">Sales</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowAnnounce(false)}
                  className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={sendAnnouncement}
                  disabled={sending}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors"
                >
                  {sending ? 'Sending...' : 'Send to All'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
