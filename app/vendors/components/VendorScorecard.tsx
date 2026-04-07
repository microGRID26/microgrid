'use client'

import { useState, useEffect, useMemo } from 'react'
import { loadVendorScores } from '@/lib/api/vendor-scorecard'
import type { VendorScore } from '@/lib/api/vendor-scorecard'
import { useOrg } from '@/lib/hooks'
import { Search, ArrowUpDown, TrendingUp, TrendingDown, Minus, Download } from 'lucide-react'

// ── Score color helpers ──────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score === null) return 'text-gray-500'
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBg(score: number | null): string {
  if (score === null) return 'bg-gray-800'
  if (score >= 80) return 'bg-green-900/30'
  if (score >= 60) return 'bg-amber-900/30'
  return 'bg-red-900/30'
}

function scoreBadge(score: number): string {
  if (score >= 80) return 'bg-green-900/50 text-green-400 border border-green-800'
  if (score >= 60) return 'bg-amber-900/50 text-amber-400 border border-amber-800'
  return 'bg-red-900/50 text-red-400 border border-red-800'
}

function trendIcon(trend: VendorScore['trend']) {
  if (trend === 'improving') return <TrendingUp className="w-3.5 h-3.5 text-green-400" />
  if (trend === 'declining') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />
  return <Minus className="w-3.5 h-3.5 text-gray-500" />
}

function trendLabel(trend: VendorScore['trend']) {
  if (trend === 'improving') return 'Improving'
  if (trend === 'declining') return 'Declining'
  return 'Stable'
}

// ── Category labels ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  manufacturer: 'Manufacturer',
  distributor: 'Distributor',
  install_partner: 'Install Partner',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  roofing: 'Roofing',
  interior: 'Interior',
  other: 'Other',
}

// ── Sort options ─────────────────────────────────────────────────────────────

type SortField = 'overall_score' | 'vendor_name' | 'avg_turnaround_days' | 'revision_rate' | 'completion_rate' | 'avg_fulfillment_days'

function metricValue(v: VendorScore, field: SortField): number {
  if (field === 'overall_score') return v.overall_score
  if (field === 'vendor_name') return 0 // handled separately
  const val = v.metrics[field as keyof typeof v.metrics]
  return typeof val === 'number' ? val : -1
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VendorScorecard() {
  const { orgId } = useOrg()
  const [scores, setScores] = useState<VendorScore[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [sortField, setSortField] = useState<SortField>('overall_score')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    loadVendorScores(orgId ?? undefined).then(data => {
      setScores(data)
      setLoading(false)
    }).catch(err => {
      console.error('[VendorScorecard] Failed to load vendor scores:', err)
      setLoading(false)
    })
  }, [orgId])

  const filtered = useMemo(() => {
    let list = scores
    if (filterCategory) list = list.filter(v => v.category === filterCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(v => v.vendor_name.toLowerCase().includes(q))
    }
    // Sort
    list = [...list].sort((a, b) => {
      if (sortField === 'vendor_name') {
        return sortAsc
          ? a.vendor_name.localeCompare(b.vendor_name)
          : b.vendor_name.localeCompare(a.vendor_name)
      }
      const av = metricValue(a, sortField)
      const bv = metricValue(b, sortField)
      return sortAsc ? av - bv : bv - av
    })
    return list
  }, [scores, filterCategory, search, sortField, sortAsc])

  // Summary stats
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((s, v) => s + v.overall_score, 0) / scores.length)
    : 0
  const highPerformers = scores.filter(v => v.overall_score >= 80).length
  const atRisk = scores.filter(v => v.overall_score < 60 && v.overall_score > 0).length
  const withData = scores.filter(v => v.overall_score > 0).length

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  function exportCSV() {
    const header = 'Vendor,Category,Overall Score,Turnaround (days),Revision Rate,Completion %,Fulfillment (days),Assignments,Work Orders,POs,Trend'
    const rows = filtered.map(v =>
      [
        `"${v.vendor_name}"`,
        CATEGORY_LABELS[v.category] || v.category,
        v.overall_score,
        v.metrics.avg_turnaround_days ?? '',
        v.metrics.revision_rate ?? '',
        v.metrics.completion_rate ?? '',
        v.metrics.avg_fulfillment_days ?? '',
        v.metrics.total_assignments,
        v.metrics.total_work_orders,
        v.metrics.total_material_requests,
        v.trend,
      ].join(',')
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vendor-scorecard-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500 text-sm">Loading vendor scores...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-400">Avg Score</div>
          <div className={`text-2xl font-bold mt-1 ${scoreColor(avgScore)}`}>{avgScore}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-400">High Performers</div>
          <div className="text-2xl font-bold text-green-400 mt-1">{highPerformers}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-400">At Risk</div>
          <div className="text-2xl font-bold text-red-400 mt-1">{atRisk}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-400">Vendors w/ Data</div>
          <div className="text-2xl font-bold text-white mt-1">{withData} / {scores.length}</div>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Search vendors..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-2 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <button
          onClick={exportCSV}
          className="px-3 py-1.5 text-xs bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 transition-colors flex items-center gap-1"
        >
          <Download className="w-3 h-3" /> Export CSV
        </button>
      </div>

      {/* Scorecard table */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-xs">
              <th className="text-left px-3 py-2 font-medium">
                <button onClick={() => handleSort('vendor_name')} className="flex items-center gap-1 hover:text-white transition-colors">
                  Vendor <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left px-3 py-2 font-medium">Category</th>
              <th className="text-center px-3 py-2 font-medium">
                <button onClick={() => handleSort('overall_score')} className="flex items-center gap-1 hover:text-white transition-colors mx-auto">
                  Score <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-center px-3 py-2 font-medium">
                <button onClick={() => handleSort('avg_turnaround_days')} className="flex items-center gap-1 hover:text-white transition-colors mx-auto">
                  Turnaround <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-center px-3 py-2 font-medium">
                <button onClick={() => handleSort('revision_rate')} className="flex items-center gap-1 hover:text-white transition-colors mx-auto">
                  Revisions <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-center px-3 py-2 font-medium">
                <button onClick={() => handleSort('completion_rate')} className="flex items-center gap-1 hover:text-white transition-colors mx-auto">
                  Completion <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-center px-3 py-2 font-medium">
                <button onClick={() => handleSort('avg_fulfillment_days')} className="flex items-center gap-1 hover:text-white transition-colors mx-auto">
                  Fulfillment <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-center px-3 py-2 font-medium">Volume</th>
              <th className="text-center px-3 py-2 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-gray-500">
                  {scores.length === 0 ? 'No active vendors found' : 'No vendors match filters'}
                </td>
              </tr>
            ) : (
              filtered.map(v => (
                <tr key={v.vendor_id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                  <td className="px-3 py-2.5 font-medium text-white">{v.vendor_name}</td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">
                    {CATEGORY_LABELS[v.category] || v.category}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {v.overall_score > 0 ? (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${scoreBadge(v.overall_score)}`}>
                        {v.overall_score}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-xs">--</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-center ${scoreBg(v.metrics.avg_turnaround_days)}`}>
                    {v.metrics.avg_turnaround_days !== null ? (
                      <span className={scoreColor(100 - (v.metrics.avg_turnaround_days / 21) * 100)}>
                        {v.metrics.avg_turnaround_days}d
                      </span>
                    ) : (
                      <span className="text-gray-600">--</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-center ${scoreBg(v.metrics.revision_rate !== null ? (v.metrics.revision_rate <= 0.5 ? 80 : v.metrics.revision_rate <= 1 ? 60 : 40) : null)}`}>
                    {v.metrics.revision_rate !== null ? (
                      <span className={scoreColor(v.metrics.revision_rate === 0 ? 100 : v.metrics.revision_rate <= 0.5 ? 80 : v.metrics.revision_rate <= 1 ? 60 : 40)}>
                        {v.metrics.revision_rate.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-gray-600">--</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-center ${scoreBg(v.metrics.completion_rate)}`}>
                    {v.metrics.completion_rate !== null ? (
                      <span className={scoreColor(v.metrics.completion_rate)}>
                        {v.metrics.completion_rate}%
                      </span>
                    ) : (
                      <span className="text-gray-600">--</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-center ${scoreBg(v.metrics.avg_fulfillment_days !== null ? (v.metrics.avg_fulfillment_days <= 7 ? 80 : 40) : null)}`}>
                    {v.metrics.avg_fulfillment_days !== null ? (
                      <span className={scoreColor(100 - (v.metrics.avg_fulfillment_days / 21) * 100)}>
                        {v.metrics.avg_fulfillment_days}d
                      </span>
                    ) : (
                      <span className="text-gray-600">--</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      {v.metrics.total_assignments > 0 && <span title="Engineering assignments">{v.metrics.total_assignments} eng</span>}
                      {v.metrics.total_work_orders > 0 && <span title="Work orders">{v.metrics.total_work_orders} wo</span>}
                      {v.metrics.total_material_requests > 0 && <span title="Purchase orders">{v.metrics.total_material_requests} po</span>}
                      {v.metrics.total_assignments === 0 && v.metrics.total_work_orders === 0 && v.metrics.total_material_requests === 0 && (
                        <span className="text-gray-600">none</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1" title={trendLabel(v.trend)}>
                      {trendIcon(v.trend)}
                      <span className="text-xs text-gray-500 hidden md:inline">{trendLabel(v.trend)}</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> 80+</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 60-79</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> &lt;60</span>
        <span className="ml-auto">Turnaround/Fulfillment scored: 3d=100, 7d=80, 14d=60, 21d=40, &gt;21d=20</span>
      </div>
    </div>
  )
}
