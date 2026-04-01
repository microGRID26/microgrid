'use client'

import React, { useState, useEffect } from 'react'
import { loadProjectTickets, TICKET_STATUS_COLORS, TICKET_STATUS_LABELS, TICKET_PRIORITY_COLORS, TICKET_CATEGORY_COLORS, getSLAStatus } from '@/lib/api/tickets'
import type { Ticket } from '@/lib/api/tickets'
import { fmtDate, cn } from '@/lib/utils'
import { Plus } from 'lucide-react'

export function TicketsTab({ projectId }: { projectId: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    loadProjectTickets(projectId).then(t => { setTickets(t); setLoading(false) })
  }, [projectId])

  if (loading) return <div className="flex-1 overflow-y-auto p-5 text-gray-500 text-xs">Loading tickets...</div>

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tickets ({tickets.length})</h3>
        <a href={`/tickets`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300">
          <Plus className="w-3 h-3" /> Open Tickets Page
        </a>
      </div>

      {tickets.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-xs">
          No tickets for this project.
          <br />
          <a href="/tickets" className="text-blue-400 hover:text-blue-300 mt-1 inline-block">Create one on the Tickets page</a>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const sla = getSLAStatus(t)
            const ageHours = Math.round((Date.now() - new Date(t.created_at).getTime()) / 3600000)
            const ageDays = Math.floor(ageHours / 24)
            return (
              <div key={t.id} className="bg-gray-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-mono text-[11px] font-medium">{t.ticket_number}</span>
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', TICKET_CATEGORY_COLORS[t.category])}>{t.category}</span>
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', TICKET_PRIORITY_COLORS[t.priority])}>{t.priority}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', TICKET_STATUS_COLORS[t.status])}>{TICKET_STATUS_LABELS[t.status]}</span>
                    <div className="flex gap-0.5" title={`Response: ${sla.response}, Resolution: ${sla.resolution}`}>
                      <span className={cn('w-2 h-2 rounded-full', sla.response === 'ok' ? 'bg-green-500' : sla.response === 'warning' ? 'bg-amber-500' : 'bg-red-500')} />
                      <span className={cn('w-2 h-2 rounded-full', sla.resolution === 'ok' ? 'bg-green-500' : sla.resolution === 'warning' ? 'bg-amber-500' : 'bg-red-500')} />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-white font-medium">{t.title}</p>
                {t.description && <p className="text-[11px] text-gray-400 line-clamp-2">{t.description}</p>}
                <div className="flex items-center gap-4 text-[10px] text-gray-500">
                  <span>{fmtDate(t.created_at)}</span>
                  <span>{ageDays > 0 ? `${ageDays}d ago` : `${ageHours}h ago`}</span>
                  {t.assigned_to && <span>Assigned: <span className="text-gray-300">{t.assigned_to}</span></span>}
                </div>
                {t.resolution_category && (
                  <div className="bg-green-900/20 border border-green-700/30 rounded px-2 py-1">
                    <span className="text-[10px] text-green-400 capitalize">{t.resolution_category.replace(/_/g, ' ')}</span>
                    {t.resolution_notes && <span className="text-[10px] text-gray-400 ml-2">{t.resolution_notes}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
