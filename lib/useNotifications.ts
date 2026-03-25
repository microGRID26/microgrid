'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { useCurrentUser } from './useCurrentUser'

export interface Notification {
  id: string
  type: 'blocked' | 'revision' | 'milestone'
  title: string
  message: string
  projectId: string
  projectName: string
  timestamp: string
  read: boolean
}

/** Shape of a task_history row returned from the notification query */
interface TaskHistoryRow {
  project_id: string
  task_id: string
  status: string
  reason: string | null
  changed_at: string
  changed_by: string
}

/** Shape of a mention_notification row with joined project name */
interface MentionRow {
  id: string
  project_id: string
  mentioned_by: string
  message: string | null
  created_at: string
  read: boolean
  project: { name: string } | null
}

export function useNotifications() {
  const { user } = useCurrentUser()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    const supabase = createClient()

    // Get PM's projects (active only)
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, blocker, stage')
      .eq('pm_id', user.id)
      .not('disposition', 'in', '("Cancelled","In Service")') as { data: { id: string; name: string; blocker: string | null; stage: string }[] | null }

    if (!projects) { setLoading(false); return }

    const pids = projects.map(p => p.id)
    if (pids.length === 0) { setLoading(false); return }

    // Get stuck tasks from last 7 days
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const { data: recentHistory } = await supabase
      .from('task_history')
      .select('project_id, task_id, status, reason, changed_at, changed_by')
      .in('project_id', pids)
      .in('status', ['Revision Required', 'Pending Resolution'])
      .gte('changed_at', weekAgo.toISOString())
      .order('changed_at', { ascending: false })
      .limit(20)

    const notifs: Notification[] = []

    // Blocked projects
    projects.filter(p => p.blocker).forEach(p => {
      notifs.push({
        id: `blocked-${p.id}`,
        type: 'blocked',
        title: 'Project Blocked',
        message: `${p.name}: ${p.blocker}`,
        projectId: p.id,
        projectName: p.name,
        timestamp: new Date().toISOString(),
        read: false,
      })
    })

    // Recent revision/pending tasks
    if (recentHistory) {
      recentHistory.forEach((h: TaskHistoryRow) => {
        const proj = projects.find(p => p.id === h.project_id)
        if (!proj) return
        notifs.push({
          id: `task-${h.project_id}-${h.task_id}-${h.changed_at}`,
          type: 'revision',
          title: h.status === 'Revision Required' ? 'Revision Required' : 'Task Stuck',
          message: `${proj.name}: ${h.task_id}${h.reason ? ' \u2014 ' + h.reason : ''}`,
          projectId: h.project_id,
          projectName: proj.name,
          timestamp: h.changed_at,
          read: false,
        })
      })
    }

    // @mention notifications — join with projects for name
    const { data: mentions } = await supabase
      .from('mention_notifications')
      .select('id, project_id, mentioned_by, message, created_at, read, project:projects(name)')
      .eq('mentioned_user_id', user.id)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(20)

    if (mentions) {
      mentions.forEach((m: MentionRow) => {
        const projName = m.project?.name ?? m.project_id
        notifs.push({
          id: `mention-${m.id}`,
          type: 'milestone' as const,
          title: `@Mentioned by ${m.mentioned_by}`,
          message: `${projName} (${m.project_id}): ${m.message?.slice(0, 80) ?? ''}`,
          projectId: m.project_id,
          projectName: projName,
          timestamp: m.created_at,
          read: false,
        })
      })
    }

    // Sort newest first
    notifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Read state from localStorage
    let readIds: string[] = []
    try {
      readIds = JSON.parse(localStorage.getItem('mg_notif_read') || '[]')
    } catch { readIds = [] }
    notifs.forEach(n => { if (readIds.includes(n.id)) n.read = true })

    setNotifications(notifs)
    setLoading(false)
  }, [user])

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => { load() }, [load])

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => loadRef.current(), 30000)
    return () => clearInterval(interval)
  }, [])

  const markRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    // Mark in localStorage — cap at 100 most recent IDs
    let readIds: string[] = []
    try {
      readIds = JSON.parse(localStorage.getItem('mg_notif_read') || '[]')
    } catch { readIds = [] }
    if (!readIds.includes(id)) {
      readIds.push(id)
      localStorage.setItem('mg_notif_read', JSON.stringify(readIds.slice(-100)))
    }
    // Fire-and-forget DB update for mention notifications
    if (id.startsWith('mention-')) {
      const dbId = id.replace('mention-', '')
      db().from('mention_notifications').update({ read: true }).eq('id', dbId).then(() => {}, (err: unknown) => console.error('Failed to mark notification read:', err))
    }
  }

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    // localStorage — keep only most recent 100 IDs
    const ids = notifications.map(n => n.id).slice(-100)
    localStorage.setItem('mg_notif_read', JSON.stringify(ids))
    // Fire-and-forget DB update for all unread mention notifications
    const mentionIds = notifications
      .filter(n => !n.read && n.id.startsWith('mention-'))
      .map(n => n.id.replace('mention-', ''))
    if (mentionIds.length > 0) {
      db().from('mention_notifications').update({ read: true }).in('id', mentionIds).then(() => {}, (err: unknown) => console.error('Failed to mark notifications read:', err))
    }
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, loading, unreadCount, markRead, markAllRead, refresh: load }
}
