'use client'

import { useMemo } from 'react'
import { fmt$ } from '@/lib/utils'
import { ExportButton, downloadCSV, SortHeader, useSortable, type AnalyticsData } from './shared'

interface DealerRow {
  dealer: string
  count: number
  value: number
  avgKw: number
}

export function Dealers({ data }: { data: AnalyticsData }) {
  const { projects } = data

  const dealerAnalytics = useMemo(() => {
    // Projects by dealer
    const dealerMap = new Map<string, { count: number; value: number; kwTotal: number }>()
    projects.forEach(p => {
      const d = p.dealer || 'Unknown'
      const cur = dealerMap.get(d) || { count: 0, value: 0, kwTotal: 0 }
      cur.count++
      cur.value += Number(p.contract) || 0
      cur.kwTotal += Number(p.systemkw) || 0
      dealerMap.set(d, cur)
    })
    const dealers = [...dealerMap.entries()].map(([dealer, stats]) => ({
      dealer,
      count: stats.count,
      value: stats.value,
      avgKw: stats.count > 0 ? Math.round((stats.kwTotal / stats.count) * 100) / 100 : 0,
    }))
    const maxDealerCount = Math.max(...dealers.map(d => d.count), 1)

    // Projects by consultant
    const consultantMap = new Map<string, number>()
    projects.forEach(p => {
      const c = p.consultant
      if (c) consultantMap.set(c, (consultantMap.get(c) || 0) + 1)
    })
    const consultants = [...consultantMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    const maxConsultant = Math.max(...consultants.map(c => c.count), 1)

    // Projects by advisor
    const advisorMap = new Map<string, number>()
    projects.forEach(p => {
      const a = p.advisor
      if (a) advisorMap.set(a, (advisorMap.get(a) || 0) + 1)
    })
    const advisors = [...advisorMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    const maxAdvisor = Math.max(...advisors.map(a => a.count), 1)

    return { dealers, maxDealerCount, consultants, maxConsultant, advisors, maxAdvisor }
  }, [projects])

  const { sorted: sortedDealers, sortKey, sortDir, toggleSort } = useSortable<DealerRow>(dealerAnalytics.dealers, 'count')

  const handleExport = () => {
    const headers = ['Dealer', 'Projects', 'Contract Value', 'Avg System (kW)']
    const rows = sortedDealers.map(d => [d.dealer, d.count, d.value, d.avgKw])
    const consultantRows = dealerAnalytics.consultants.map(c => [c.name, c.count, '', ''])
    const advisorRows = dealerAnalytics.advisors.map(a => [a.name, a.count, '', ''])
    downloadCSV('dealers.csv', headers, [
      ...rows,
      ['', '', '', ''],
      ['Consultant', 'Count', '', ''],
      ...consultantRows,
      ['', '', '', ''],
      ['Advisor', 'Count', '', ''],
      ...advisorRows,
    ])
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex justify-end"><ExportButton onClick={handleExport} /></div>

      {/* Projects by dealer - bar chart */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Projects by Dealer</div>
        {sortedDealers.slice(0, 20).map(d => (
          <div key={d.dealer} className="flex items-center gap-3 py-1.5">
            <div className="text-xs text-gray-400 w-36 flex-shrink-0 truncate">{d.dealer}</div>
            <div className="flex-1 bg-gray-700 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(d.count / dealerAnalytics.maxDealerCount * 100)}%` }} />
            </div>
            <div className="text-xs text-gray-300 font-mono w-8 text-right">{d.count}</div>
            <div className="text-xs text-gray-500 font-mono w-24 text-right">{fmt$(d.value)}</div>
          </div>
        ))}
      </div>

      {/* Dealer table - sortable */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Dealer Details</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[500px]">
            <thead>
              <tr className="border-b border-gray-700">
                <SortHeader label="Dealer" field={'dealer' as keyof DealerRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Projects" field={'count' as keyof DealerRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Contract Value" field={'value' as keyof DealerRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Avg System (kW)" field={'avgKw' as keyof DealerRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedDealers.slice(0, 20).map(d => (
                <tr key={d.dealer} className="border-b border-gray-800 hover:bg-gray-700/30">
                  <td className="px-3 py-2 text-white font-medium truncate max-w-[200px]">{d.dealer}</td>
                  <td className="px-3 py-2 text-gray-300 font-mono">{d.count}</td>
                  <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(d.value)}</td>
                  <td className="px-3 py-2 text-blue-400 font-mono">{d.avgKw > 0 ? `${d.avgKw} kW` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Consultants and Advisors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Projects by Consultant</div>
          {dealerAnalytics.consultants.length === 0 && <div className="text-xs text-gray-500">No consultant data</div>}
          {dealerAnalytics.consultants.slice(0, 15).map(c => (
            <div key={c.name} className="flex items-center gap-3 py-1.5">
              <div className="text-xs text-gray-400 w-32 flex-shrink-0 truncate">{c.name}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(c.count / dealerAnalytics.maxConsultant * 100)}%` }} />
              </div>
              <div className="text-xs text-gray-300 font-mono w-8 text-right">{c.count}</div>
            </div>
          ))}
        </div>

        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Projects by Advisor</div>
          {dealerAnalytics.advisors.length === 0 && <div className="text-xs text-gray-500">No advisor data</div>}
          {dealerAnalytics.advisors.slice(0, 15).map(a => (
            <div key={a.name} className="flex items-center gap-3 py-1.5">
              <div className="text-xs text-gray-400 w-32 flex-shrink-0 truncate">{a.name}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(a.count / dealerAnalytics.maxAdvisor * 100)}%` }} />
              </div>
              <div className="text-xs text-gray-300 font-mono w-8 text-right">{a.count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
