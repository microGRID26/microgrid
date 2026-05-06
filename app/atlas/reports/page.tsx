'use client'

import { useEffect, useState } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { CheckCircle2, AlertCircle, Circle, Sparkles, Database } from 'lucide-react'

interface CanonicalReport {
  id: string
  name: string
  description: string
  category: 'sales' | 'pipeline' | 'install' | 'finance' | 'commission' | 'ops'
  status: 'draft' | 'verified' | 'deprecated'
  owner: string
  version: number
  example_questions: string[]
  parameter_schema: Record<string, unknown>
  result_columns: unknown[]
  function_name: string
  verified_at: string | null
  verified_by: string | null
  verification_method: string | null
  ground_truth_source: string | null
  expected_row_count: number | null
  drift_tolerance_pct: number
  last_drift_check_at: string | null
  last_drift_check_passed: boolean | null
  created_at: string
  updated_at: string
}

const CATEGORY_LABEL: Record<string, string> = {
  sales: 'Sales',
  pipeline: 'Pipeline',
  install: 'Install',
  finance: 'Finance',
  commission: 'Commission',
  ops: 'Operations',
}

function StatusBadge({ status }: { status: CanonicalReport['status'] }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-900/40 border border-green-700/60 text-green-300 px-2 py-0.5 rounded">
        <CheckCircle2 className="w-3 h-3" />
        Verified
      </span>
    )
  }
  if (status === 'draft') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-900/40 border border-amber-700/60 text-amber-300 px-2 py-0.5 rounded">
        <Circle className="w-3 h-3" />
        Draft
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-gray-800 border border-gray-700 text-gray-500 px-2 py-0.5 rounded">
      <AlertCircle className="w-3 h-3" />
      Deprecated
    </span>
  )
}

export default function AtlasReportsPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [reports, setReports] = useState<CanonicalReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CanonicalReport | null>(null)
  const [filter, setFilter] = useState<'all' | 'verified' | 'draft' | 'deprecated'>('all')

  const isAdmin = user?.isAdmin ?? false
  const isSuperAdmin = user?.isSuperAdmin ?? false
  const isHeidi = user?.email === 'hhildreth@gomicrogridenergy.com'
  const canView = isAdmin || isSuperAdmin || isHeidi

  useEffect(() => {
    if (!canView) return
    let cancelled = false
    fetch('/api/atlas/canonical/list', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) {
          setError(data.error)
        } else {
          setReports(data.reports ?? [])
        }
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [canView])

  if (userLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Checking permissions…</div>
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col">
        <Nav active="" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <h1 className="text-lg font-semibold text-white mb-2">Restricted</h1>
            <p className="text-sm text-gray-500">
              The Atlas canonical reports admin is restricted to admins and the Director of Inside Operations.
            </p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300">
              ← Back
            </a>
          </div>
        </div>
      </div>
    )
  }

  const filtered =
    filter === 'all' ? reports : reports.filter((r) => r.status === filter)

  const counts = {
    all: reports.length,
    verified: reports.filter((r) => r.status === 'verified').length,
    draft: reports.filter((r) => r.status === 'draft').length,
    deprecated: reports.filter((r) => r.status === 'deprecated').length,
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <Nav active="" />

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-green-400" />
            <h1 className="text-xl font-semibold">Atlas Canonical Reports</h1>
          </div>
          <p className="text-sm text-gray-400">
            Hand-written, NetSuite-verified reports that Atlas routes to. The LLM never writes SQL — it only matches user
            questions to verified entries here.{' '}
            <a
              href="https://github.com/microGRID26/MicroGRID/blob/main/docs/atlas/disposition-canonical.md"
              className="underline text-gray-300 hover:text-white"
            >
              Read the doctrine
            </a>
            .
          </p>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 mb-4 bg-gray-800/50 border border-gray-800 rounded-lg p-1 w-fit">
          {(['all', 'verified', 'draft', 'deprecated'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                'text-xs px-3 py-1.5 rounded transition-colors ' +
                (filter === f
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800')
              }
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}{' '}
              <span className="text-[10px] text-gray-500">({counts[f]})</span>
            </button>
          ))}
        </div>

        {/* Loading / error / empty */}
        {loading && <div className="text-sm text-gray-500">Loading catalog…</div>}
        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/60 rounded px-3 py-2">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-12 text-center">
            <Database className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <h2 className="text-base font-medium text-gray-300 mb-2">Catalog is empty</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              No reports match this filter. P2 of the rollout is to seed the first 5–10 verified reports against
              NetSuite saved searches. See{' '}
              <code className="text-xs bg-gray-800 px-1 py-0.5 rounded">docs/atlas/seed-catalog-candidates.md</code>{' '}
              for the priority list.
            </p>
          </div>
        )}

        {/* List + detail split */}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-4">
            {/* List */}
            <div className="space-y-2">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className={
                    'w-full text-left bg-gray-800/60 border rounded-lg px-4 py-3 transition-colors ' +
                    (selected?.id === r.id
                      ? 'border-green-600/60'
                      : 'border-gray-700 hover:border-gray-600')
                  }
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-white">{r.name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-gray-500 mb-1">
                    {CATEGORY_LABEL[r.category] ?? r.category} · v{r.version} · {r.owner}
                  </div>
                  <div className="text-xs text-gray-400 line-clamp-2">{r.description}</div>
                </button>
              ))}
            </div>

            {/* Detail */}
            <div className="lg:sticky lg:top-4 self-start">
              {selected ? (
                <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 space-y-4">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h2 className="text-base font-semibold text-white">{selected.name}</h2>
                        <code className="text-xs text-gray-500">{selected.id}</code>
                      </div>
                      <StatusBadge status={selected.status} />
                    </div>
                    <p className="text-sm text-gray-300">{selected.description}</p>
                  </div>

                  {selected.status === 'verified' && (
                    <div className="bg-green-950/30 border border-green-900/50 rounded-lg p-3 text-xs space-y-1.5">
                      <div className="flex items-center gap-1.5 text-green-300 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified — answers will match this source
                      </div>
                      <div className="text-gray-400 grid grid-cols-2 gap-x-4 gap-y-1">
                        <div>
                          <span className="text-gray-500">Method:</span>{' '}
                          <span className="text-gray-300">{selected.verification_method}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Verified by:</span>{' '}
                          <span className="text-gray-300">{selected.verified_by}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">When:</span>{' '}
                          <span className="text-gray-300">
                            {selected.verified_at ? new Date(selected.verified_at).toLocaleDateString() : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Expected rows:</span>{' '}
                          <span className="text-gray-300">{selected.expected_row_count ?? '—'}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-gray-500">Source:</span>{' '}
                          <span className="text-gray-300">{selected.ground_truth_source}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {selected.example_questions.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium mb-1.5">
                        Example questions Atlas will route here
                      </div>
                      <ul className="space-y-1">
                        {selected.example_questions.map((q, i) => (
                          <li key={i} className="text-xs text-gray-300 italic">
                            “{q}”
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium mb-1.5">
                      Parameters
                    </div>
                    <pre className="text-[11px] text-gray-300 bg-gray-900 border border-gray-800 rounded p-2 overflow-x-auto">
{JSON.stringify(selected.parameter_schema, null, 2)}
                    </pre>
                  </div>

                  <div className="pt-2 border-t border-gray-800 text-[11px] text-gray-500">
                    Function: <code className="text-gray-400">{selected.function_name}</code>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-800/30 border border-gray-800 rounded-xl p-8 text-center">
                  <p className="text-sm text-gray-500">Select a report to see details.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
