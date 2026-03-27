'use client'

import { useState, useCallback } from 'react'
import { fmt$ } from '@/lib/utils'
import type { Project, ProjectFunding } from '@/types/database'
import { X } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

export type Period = 'wtd' | 'mtd' | 'qtd' | 'ytd' | 'last7' | 'last30' | 'last90'

export const PERIOD_LABELS: Record<Period, string> = {
  wtd: 'Week to Date', mtd: 'This Month', qtd: 'This Quarter',
  ytd: 'This Year', last7: 'Last 7 Days', last30: 'Last 30 Days', last90: 'Last 90 Days',
}

export const STAGE_DAYS_REMAINING: Record<string, number> = {
  evaluation: 56, survey: 50, design: 44, permit: 31, install: 10, inspection: 17, complete: 0,
}

// ── Period helpers ───────────────────────────────────────────────────────────

export function rangeStart(period: Period): Date {
  const d = new Date()
  switch (period) {
    case 'wtd':   d.setDate(d.getDate() - d.getDay()); break
    case 'mtd':   d.setDate(1); break
    case 'qtd':   { const qm = Math.floor(d.getMonth() / 3) * 3; d.setMonth(qm, 1); break }
    case 'ytd':   d.setMonth(0, 1); break
    case 'last7':  d.setDate(d.getDate() - 7); break
    case 'last30': d.setDate(d.getDate() - 30); break
    case 'last90': d.setDate(d.getDate() - 90); break
  }
  d.setHours(0, 0, 0, 0)
  return d
}

export function inRange(dateStr: string | null | undefined, period: Period): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  return d >= rangeStart(period) && d <= new Date()
}

// ── Shared data shape passed to each tab ────────────────────────────────────

export interface AnalyticsData {
  projects: Project[]
  active: Project[]
  complete: Project[]
  funding: Record<string, ProjectFunding>
  period: Period
}

// ── Shared components ───────────────────────────────────────────────────────

export function MetricCard({ label, value, sub, color, onClick }: {
  label: string; value: string; sub?: string; color?: string; onClick?: () => void
}) {
  return (
    <div
      className={`bg-gray-800 rounded-xl p-4 border border-gray-700 ${onClick ? 'cursor-pointer hover:border-gray-500 hover:bg-gray-750 transition-colors' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      aria-label={onClick ? `${label}: ${value}` : undefined}
    >
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
      {onClick && <div className="text-[10px] text-gray-600 mt-1">Click to view</div>}
    </div>
  )
}

export function MiniBar({ label, count, value, max }: { label: string; count: number; value: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="text-xs text-gray-400 w-24 flex-shrink-0">{label}</div>
      <div className="flex-1 bg-gray-800 rounded-full h-2">
        <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-gray-300 font-mono w-8 text-right">{count}</div>
      <div className="text-xs text-gray-500 font-mono w-20 text-right">{fmt$(value)}</div>
    </div>
  )
}

// ── Project drill-down modal ────────────────────────────────────────────────

export function ProjectListModal({ title, projects, onClose }: {
  title: string
  projects: Project[]
  onClose: () => void
}) {
  // Close on Escape key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}
      role="dialog" aria-modal="true" aria-label={title} onKeyDown={handleKeyDown}>
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div>
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="text-xs text-gray-500">{projects.length} project{projects.length !== 1 ? 's' : ''}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close dialog"><X size={16} /></button>
        </div>
        <div className="overflow-auto flex-1 p-4">
          {projects.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-8">No projects</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-400 font-medium px-2 py-2">Project</th>
                  <th className="text-left text-gray-400 font-medium px-2 py-2">Stage</th>
                  <th className="text-left text-gray-400 font-medium px-2 py-2">PM</th>
                  <th className="text-right text-gray-400 font-medium px-2 py-2">Contract</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800">
                    <td className="px-2 py-1.5 text-white">{p.name ?? p.id}</td>
                    <td className="px-2 py-1.5 text-gray-400">{p.stage}</td>
                    <td className="px-2 py-1.5 text-gray-400">{p.pm ?? '—'}</td>
                    <td className="px-2 py-1.5 text-gray-300 font-mono text-right">{fmt$(Number(p.contract) || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── CSV export helper ───────────────────────────────────────────────────────

export function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Sortable table hook ─────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc'

export function useSortable<T>(data: T[], defaultKey: keyof T, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey)
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir)

  const toggleSort = useCallback((key: keyof T) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return sortDir === 'asc' ? cmp : -cmp
  })

  return { sorted, sortKey, sortDir, toggleSort }
}

export function SortHeader<T>({ label, field, sortKey, sortDir, onSort }: {
  label: string; field: T; sortKey: T; sortDir: SortDir; onSort: (field: T) => void
}) {
  const active = sortKey === field
  return (
    <th
      className="text-left text-gray-400 font-medium px-3 py-2 cursor-pointer hover:text-white select-none"
      onClick={() => onSort(field)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      role="columnheader"
    >
      {label} {active ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
    </th>
  )
}

// ── Tab CSV export button ───────────────────────────────────────────────────

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Export data as CSV"
      className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md px-3 py-1.5 transition-colors"
    >
      Export CSV
    </button>
  )
}
