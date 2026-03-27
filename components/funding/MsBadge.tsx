'use client'

import type { MilestoneKey, MsData } from './types'

/** Standardized milestone status badge with consistent colors */
export function MsBadge({ ms, data }: { ms: MilestoneKey; data: MsData }) {
  const color = data.status === 'Funded' || data.status === 'Complete' ? 'bg-green-900 text-green-300'
    : data.status === 'Submitted' ? 'bg-blue-900 text-blue-300'
    : data.status === 'Pending Resolution' ? 'bg-red-900 text-red-300'
    : data.status === 'Revision Required' ? 'bg-orange-900 text-orange-300'
    : data.status === 'Rejected' ? 'bg-red-900 text-red-300'
    : data.isEligible ? 'bg-amber-900 text-amber-300'
    : 'bg-gray-800 text-gray-500'
  return <span className={`font-bold px-1 py-0.5 rounded text-[10px] ${color}`} aria-label={`${ms.toUpperCase()}: ${data.status ?? (data.isEligible ? 'Eligible' : 'Not eligible')}`}>{ms.toUpperCase()}</span>
}
