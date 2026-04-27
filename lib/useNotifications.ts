'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { INACTIVE_DISPOSITION_FILTER } from '@/lib/utils'
import { useCurrentUser } from './useCurrentUser'

export interface Notification {
  id: string
  type: 'blocked' | 'revision' | 'milestone' | 'mention'
  title: string
  message: string
  projectId: string
  projectName: string
  timestamp: string
  read: boolean
  /** Discriminator for click routing — currently only 'funding' is set explicitly. */
  source?: 'funding' | 'project' | 'ticket'
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
  note_id: string | null
  mentioned_by: string
  message: string | null
  created_at: string
  read: boolean
}

export interface NotificationFilterPrefs {
  blocked?: boolean
  stuck_tasks?: boolean
  mentions?: boolean
}

export function useNotifications(filterPrefs?: NotificationFilterPrefs) {
  const { user } = useCurrentUser()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  // Track IDs of ephemeral notifications (blocked/revision) dismissed across sessions
  const DISMISSED_KEY = 'mg_dismissed_notifs'
  const [dismissedInit] = useState(() => {
    if (typeof window === 'undefined') return new Set<string>()
    const stored: string[] = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return new Set(stored.slice(-200))
  })
  const dismissedEphemeralRef = useRef<Set<string>>(dismissedInit)

  const load = useCallback(async () => {
    if (!user) return
    const supabase = createClient()

    // Get PM's projects (active only)
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, blocker, stage')
      .eq('pm_id', user.id)
      .not('disposition', 'in', INACTIVE_DISPOSITION_FILTER) as { data: { id: string; name: string; blocker: string | null; stage: string }[] | null }

    const pids = (projects ?? []).map(p => p.id)

    const notifs: Notification[] = []

    // Get stuck tasks from last 7 days (only if user has projects)
    let recentHistory: TaskHistoryRow[] | null = null
    if (pids.length > 0) {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      const { data } = await supabase
        .from('task_history')
        .select('project_id, task_id, status, reason, changed_at, changed_by')
        .in('project_id', pids)
        .in('status', ['Revision Required', 'Pending Resolution'])
        .gte('changed_at', weekAgo.toISOString())
        .order('changed_at', { ascending: false })
        .limit(20)
      recentHistory = data as TaskHistoryRow[] | null
    }

    // Blocked projects — ephemeral, reflect current state
    (projects ?? []).filter(p => p.blocker).forEach(p => {
      const id = `blocked-${p.id}`
      notifs.push({
        id,
        type: 'blocked',
        title: 'Project Blocked',
        message: `${p.name}: ${p.blocker}`,
        projectId: p.id,
        projectName: p.name,
        timestamp: new Date().toISOString(),
        read: dismissedEphemeralRef.current.has(id),
      })
    })

    // Overdue follow-ups — ephemeral, reflect current state
    const todayStr = new Date().toISOString().slice(0, 10)
    if (pids.length > 0) {
      const { data: overdueFollowUps } = await supabase
        .from('projects')
        .select('id, name, follow_up_date')
        .in('id', pids)
        .lt('follow_up_date', todayStr)
        .not('follow_up_date', 'is', null)
        .limit(10)
      if (overdueFollowUps) {
        for (const p of overdueFollowUps as { id: string; name: string; follow_up_date: string }[]) {
          const id = `followup-${p.id}`
          notifs.push({
            id,
            type: 'revision' as const,
            title: 'Follow-up Overdue',
            message: `${p.name}: follow-up was due ${p.follow_up_date}`,
            projectId: p.id,
            projectName: p.name,
            timestamp: p.follow_up_date,
            read: dismissedEphemeralRef.current.has(id),
          })
        }
      }
    }

    // Recent revision/pending tasks — ephemeral, reflect current state
    if (recentHistory) {
      recentHistory.forEach((h: TaskHistoryRow) => {
        const proj = (projects ?? []).find(p => p.id === h.project_id)
        if (!proj) return
        const id = `task-${h.project_id}-${h.task_id}-${h.changed_at}`
        notifs.push({
          id,
          type: 'revision',
          title: h.status === 'Revision Required' ? 'Revision Required' : 'Task Stuck',
          message: `${proj.name}: ${h.task_id}${h.reason ? ' \u2014 ' + h.reason : ''}`,
          projectId: h.project_id,
          projectName: proj.name,
          timestamp: h.changed_at,
          read: dismissedEphemeralRef.current.has(id),
        })
      })
    }

    // @mention notifications — DB is the source of truth for read state
    // Fetch both read and unread from last 30 days so we have recent history
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { data: mentions } = await supabase
      .from('mention_notifications')
      .select('id, project_id, note_id, mentioned_by, message, created_at, read')
      .eq('mentioned_user_id', user.id)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(20)

    if (mentions) {
      mentions.forEach((m: MentionRow) => {
        const isTicketMention = m.project_id === 'TICKET'
        const isFundingMention = (m.note_id ?? '').startsWith('funding:')
        const source: 'funding' | 'ticket' | 'project' = isFundingMention
          ? 'funding'
          : isTicketMention ? 'ticket' : 'project'
        notifs.push({
          id: `mention-${m.id}`,
          type: 'mention' as const,
          title: `@Mentioned by ${m.mentioned_by}`,
          message: isTicketMention ? (m.message?.slice(0, 100) ?? '') : `${m.project_id}: ${m.message?.slice(0, 80) ?? ''}`,
          projectId: isTicketMention ? '' : m.project_id,
          projectName: isTicketMention ? 'Ticket' : m.project_id,
          timestamp: m.created_at,
          read: m.read, // DB is source of truth
          source,
        })
      })
    }

    // Sort newest first
    notifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Apply user preferences filter (default to showing if pref is undefined)
    const filtered = filterPrefs ? notifs.filter(n => {
      if (n.type === 'blocked' && filterPrefs.blocked !== undefined && !filterPrefs.blocked) return false
      if (n.type === 'revision' && filterPrefs.stuck_tasks !== undefined && !filterPrefs.stuck_tasks) return false
      if (n.type === 'mention' && filterPrefs.mentions !== undefined && !filterPrefs.mentions) return false
      return true
    }) : notifs

    setNotifications(filtered)
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

  const markRead = useCallback((id: string) => {
    // Optimistically update local state
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))

    if (id.startsWith('mention-')) {
      // Mention notification — update DB (source of truth)
      const dbId = id.replace('mention-', '')
      db().from('mention_notifications')
        .update({ read: true })
        .eq('id', dbId)
        .then(({ error }: { error: unknown }) => {
          if (error) {
            console.error('Failed to mark notification read in DB:', error)
            // Revert optimistic update on failure so it stays unread
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: false } : n))
          }
        })
    } else {
      // Ephemeral notification (blocked/revision) — persist dismissal across sessions
      dismissedEphemeralRef.current.add(id)
      if (typeof window !== 'undefined') {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedEphemeralRef.current]))
      }
    }
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications(prev => {
      // Collect mention IDs from the current state for DB update
      const unreadMentionDbIds = prev
        .filter(n => !n.read && n.id.startsWith('mention-'))
        .map(n => n.id.replace('mention-', ''))

      // Track all ephemeral IDs as dismissed (persisted across sessions)
      prev.forEach(n => {
        if (!n.read && !n.id.startsWith('mention-')) {
          dismissedEphemeralRef.current.add(n.id)
        }
      })
      if (typeof window !== 'undefined') {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedEphemeralRef.current]))
      }

      // Fire DB update for mention notifications
      if (unreadMentionDbIds.length > 0) {
        db().from('mention_notifications')
          .update({ read: true })
          .in('id', unreadMentionDbIds)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.error('Failed to mark all notifications read in DB:', error)
              // On failure, reload from DB to get accurate state
              loadRef.current()
            }
          })
      }

      return prev.map(n => ({ ...n, read: true }))
    })
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, loading, unreadCount, markRead, markAllRead, refresh: load }
}
