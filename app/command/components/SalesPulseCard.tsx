'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { handleApiError } from '@/lib/errors'

type SaleRow = { sale_date: string | null; consultant: string | null; advisor: string | null }

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoISO(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function repName(r: SaleRow): string {
  return (r.consultant || r.advisor || 'Unassigned').trim()
}

export function SalesPulseCard({ onRepClick }: { onRepClick?: (rep: string) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const since = daysAgoISO(30)
      // Cap at 5000: 30-day window × ~2 sales/day/rep × ~80 reps = headroom for 10K+ project scale.
      // If we hit the cap, the sparkline silently truncates older days — acceptable since today/week
      // counts will be correct (newest first ordering).
      // Exclusion list mirrors the activeProjects filter on /command (page.tsx) so the Sales Pulse
      // KPI matches the canonical pipeline view. (R2 red-team Medium.)
      const EXCLUDED_DISPOSITIONS = ['Cancelled', 'In Service', 'Loyalty', 'Legal', 'On Hold']
      const { data, error } = await supabase
        .from('projects')
        .select('sale_date, consultant, advisor')
        .gte('sale_date', since)
        .not('disposition', 'in', `(${EXCLUDED_DISPOSITIONS.map(d => `"${d}"`).join(',')})`)
        .order('sale_date', { ascending: false })
        .limit(5000)
      if (cancelled) return
      if (error) {
        handleApiError(error, '[SalesPulseCard] load')
        setLoading(false)
        return
      }
      setRows((data ?? []) as SaleRow[])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [supabase])

  const today = todayISO()
  const sevenDaysAgo = daysAgoISO(6)

  const todayCount = rows.filter(r => r.sale_date === today).length
  const weekCount = rows.filter(r => r.sale_date && r.sale_date >= sevenDaysAgo).length
  const monthCount = rows.length

  const repTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      if (!r.sale_date || r.sale_date < sevenDaysAgo) continue
      const k = repName(r)
      if (k === 'Unassigned') continue
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
  }, [rows, sevenDaysAgo])

  const sparkline = useMemo(() => {
    const counts: number[] = []
    for (let i = 29; i >= 0; i--) {
      const d = daysAgoISO(i)
      counts.push(rows.filter(r => r.sale_date === d).length)
    }
    const max = Math.max(1, ...counts)
    return { counts, max }
  }, [rows])

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Sales Pulse</h3>
        <span className="text-[10px] text-gray-500">last 30 days · excludes cancelled</span>
      </div>

      {loading ? (
        <div className="text-xs text-gray-500">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Today</div>
              <div className="text-2xl font-bold font-mono text-green-400">{todayCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Last 7d</div>
              <div className="text-2xl font-bold font-mono text-white">{weekCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Last 30d</div>
              <div className="text-2xl font-bold font-mono text-gray-300">{monthCount}</div>
            </div>
          </div>

          {/* 30-day sparkline */}
          <div className="flex items-end gap-px h-12 mb-4 border-b border-gray-800 pb-1">
            {sparkline.counts.map((c, i) => (
              <div
                key={i}
                title={`${daysAgoISO(29 - i)}: ${c} sale${c === 1 ? '' : 's'}`}
                className="flex-1 bg-green-600/70 hover:bg-green-500 rounded-sm min-w-[2px]"
                style={{ height: `${Math.max(2, (c / sparkline.max) * 100)}%` }}
              />
            ))}
          </div>

          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Top reps · last 7d</div>
            {repTotals.length === 0 ? (
              <div className="text-xs text-gray-500">No sales in last 7 days.</div>
            ) : (
              <ul className="space-y-1">
                {repTotals.map(([rep, n]) => (
                  <li key={rep}>
                    <button
                      onClick={() => onRepClick?.(rep)}
                      className="w-full flex items-center justify-between text-left text-xs px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                    >
                      <span className="text-gray-200 truncate">{rep}</span>
                      <span className="text-green-400 font-mono">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
