'use client'

import { cn } from '@/lib/utils'

// ── Summary Card ─────────────────────────────────────────────────────────────

export function SummaryCard({
  label,
  value,
  subValue,
  color,
  onClick,
  active,
}: {
  label: string
  value: number | string
  subValue?: string
  color: string
  onClick: () => void
  active: boolean
}) {
  const activeMap: Record<string, string> = {
    gray: 'border-gray-700 ring-1 ring-gray-500/50',
    amber: 'border-amber-700 ring-1 ring-amber-500/50',
    blue: 'border-blue-700 ring-1 ring-blue-500/50',
    green: 'border-green-700 ring-1 ring-green-500/50',
    red: 'border-red-700 ring-1 ring-red-500/50',
  }
  const textMap: Record<string, string> = {
    gray: 'text-white',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'bg-gray-900 border rounded-xl px-4 py-3 text-left transition-colors',
        active ? activeMap[color] : 'border-gray-800 hover:border-gray-700'
      )}
    >
      <div className="text-xs text-gray-400">{label}</div>
      <div className={cn('text-2xl font-bold', typeof value === 'number' && value > 0 ? textMap[color] : typeof value === 'string' ? textMap[color] : 'text-gray-500')}>{value}</div>
      {subValue && <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>}
    </button>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

