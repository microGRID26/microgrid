'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
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

export function useNotifications() {
  const { user } = useCurrentUser()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    const supabase = createClient()

    // Get PM's projects (active only)
    const { data: projects } = await (supabase as any)
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
    const { data: recentHistory } = await (supabase as any)
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
      recentHistory.forEach((h: any) => {
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

    // @mention notifications
    const { data: mentions } = await (supabase as any)
      .from('mention_notifications')
      .select('id, project_id, mentioned_by, message, created_at, read')
      .eq('mentioned_user_id', user.id)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(20)

    if (mentions) {
      mentions.forEach((m: any) => {
        notifs.push({
          id: `mention-${m.id}`,
          type: 'milestone' as const,
          title: `@Mentioned by ${m.mentioned_by}`,
          message: `${m.project_id}: ${m.message?.slice(0, 80) ?? ''}`,
          projectId: m.project_id,
          projectName: m.project_id,
          timestamp: m.created_at,
          read: false,
        })
      })
    }

    // Sort newest first
    notifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Read state from localStorage
    const readIds = JSON.parse(localStorage.getItem('mg_notif_read') || '[]') as string[]
    notifs.forEach(n => { if (readIds.includes(n.id)) n.read = true })

    setNotifications(notifs)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => load(), 30000)
    return () => clearInterval(interval)
  }, [load])

  const markRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    const readIds = JSON.parse(localStorage.getItem('mg_notif_read') || '[]') as string[]
    if (!readIds.includes(id)) {
      readIds.push(id)
      localStorage.setItem('mg_notif_read', JSON.stringify(readIds))
    }
  }

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    const ids = notifications.map(n => n.id)
    localStorage.setItem('mg_notif_read', JSON.stringify(ids))
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, loading, unreadCount, markRead, markAllRead, refresh: load }
}
