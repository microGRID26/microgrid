'use client'

import { useState, useRef, useEffect } from 'react'
import { Bell, AlertTriangle, OctagonX, CheckCheck, AtSign } from 'lucide-react'
import { useNotifications, type Notification } from '@/lib/useNotifications'

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function NotificationBell() {
  const { notifications, loading, unreadCount, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside or Escape key
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const displayed = notifications.slice(0, 10)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative text-gray-400 hover:text-white p-1.5 rounded-md transition-colors hover:bg-gray-800"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div role="menu" aria-label="Notifications" className="absolute right-0 top-full mt-1 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-[100] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
            <span className="text-sm font-medium text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-6 text-center text-gray-500 text-sm">Loading...</div>
            ) : displayed.length === 0 ? (
              <div className="px-3 py-6 text-center text-gray-500 text-sm">No notifications</div>
            ) : (
              displayed.map(n => (
                <NotificationRow key={n.id} notification={n} onRead={markRead} onClose={() => setOpen(false)} />
              ))
            )}
          </div>

          {notifications.length > 10 && (
            <div className="px-3 py-2 border-t border-gray-700 text-center text-xs text-gray-500">
              Showing 10 of {notifications.length}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NotificationRow({ notification: n, onRead, onClose }: { notification: Notification; onRead: (id: string) => void; onClose: () => void }) {
  return (
    <button
      onClick={() => {
        onRead(n.id)
        onClose()
        if (n.id.startsWith('mention-')) {
          window.location.href = `/pipeline?open=${encodeURIComponent(n.projectId)}&tab=notes`
        } else {
          window.location.href = `/queue?search=${encodeURIComponent(n.projectId)}`
        }
      }}
      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-gray-800 border-b border-gray-800 last:border-b-0 ${
        n.read ? 'opacity-60' : ''
      }`}
    >
      {/* Icon */}
      <div className="mt-0.5 flex-shrink-0">
        {n.type === 'blocked' ? (
          <OctagonX className="w-4 h-4 text-red-400" />
        ) : n.type === 'mention' ? (
          <AtSign className="w-4 h-4 text-green-400" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${n.type === 'blocked' ? 'text-red-400' : n.type === 'mention' ? 'text-green-400' : 'text-amber-400'}`}>
            {n.title}
          </span>
          {!n.read && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-gray-300 truncate mt-0.5">{n.message}</p>
        <span className="text-[10px] text-gray-500 mt-0.5 block">{timeAgo(n.timestamp)}</span>
      </div>
    </button>
  )
}
