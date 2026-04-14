'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Clock, Plus, RefreshCw, Shield, XCircle } from 'lucide-react'

import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn, fmt$ } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

type ClaimStatus = 'pending' | 'deployed' | 'invoiced' | 'recovered' | 'voided'

interface WarrantyClaim {
  id: string
  project_id: string
  claim_date: string
  description: string
  work_required: string
  claim_amount: number | null
  status: ClaimStatus
  notes: string | null
  created_at: string
  updated_at: string
  deployed_at: string | null
  original_epc: { id: string; name: string; slug: string } | null
  deployed_epc: { id: string; name: string; slug: string } | null
  project: { id: string; job_number: string; customer_name: string; city: string; state: string } | null
}

interface NewClaimForm {
  project_id: string
  original_epc_id: string
  description: string
  work_required: string
  notes: string
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ClaimStatus, {
  label: string
  color: string
  icon: React.FC<{ className?: string }>
}> = {
  pending:   { label: 'Pending',   color: 'text-amber-400 bg-amber-400/10 border-amber-400/20',  icon: Clock },
  deployed:  { label: 'Deployed',  color: 'text-blue-400 bg-blue-400/10 border-blue-400/20',     icon: RefreshCw },
  invoiced:  { label: 'Invoiced',  color: 'text-purple-400 bg-purple-400/10 border-purple-400/20', icon: AlertTriangle },
  recovered: { label: 'Recovered', color: 'text-green-400 bg-green-400/10 border-green-400/20',  icon: CheckCircle },
  voided:    { label: 'Voided',    color: 'text-gray-500 bg-gray-500/10 border-gray-500/20',     icon: XCircle },
}

const EMPTY_FORM: NewClaimForm = {
  project_id: '',
  original_epc_id: '',
  description: '',
  work_required: '',
  notes: '',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WarrantyClaimsPage() {
  const { user: currentUser, loading: authLoading } = useCurrentUser()

  const [claims, setClaims] = useState<WarrantyClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | 'all'>('all')
  const [showNewForm, setShowNewForm] = useState(false)
  const [form, setForm] = useState<NewClaimForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const loadClaims = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/warranty?${params}`)
      if (!res.ok) throw new Error(await res.text())
      const json = (await res.json()) as { claims: WarrantyClaim[] }
      setClaims(json.claims ?? [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { void loadClaims() }, [loadClaims])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/warranty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error: string }
        throw new Error(err.error ?? 'Failed to create claim')
      }
      setForm(EMPTY_FORM)
      setShowNewForm(false)
      await loadClaims()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating claim')
    } finally {
      setSubmitting(false)
    }
  }

  async function updateClaim(id: string, updates: Record<string, unknown>) {
    setUpdatingId(id)
    try {
      const res = await fetch(`/api/warranty/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error: string }
        throw new Error(err.error ?? 'Failed to update claim')
      }
      await loadClaims()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error updating claim')
    } finally {
      setUpdatingId(null)
    }
  }

  const statusCounts = claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1
    return acc
  }, {})

  const totalOpenDeductions = claims
    .filter((c) => c.status === 'invoiced' && c.claim_amount)
    .reduce((sum, c) => sum + (c.claim_amount ?? 0), 0)

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Sign in to view warranty claims.</div>
      </div>
    )
  }

  if (!currentUser.isManager) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Manager or above required.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Warranty" />

      <main className="flex-1 p-4 md:p-6 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-green-400 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-white">Workmanship Claims</h1>
              <p className="text-gray-400 text-xs mt-0.5">
                EPC warranty chargebacks — netted automatically from the EPC&apos;s next invoice payment.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Claim
          </button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {(['pending', 'deployed', 'invoiced', 'recovered'] as ClaimStatus[]).map((s) => {
            const cfg = STATUS_CONFIG[s]
            const Icon = cfg.icon
            const active = statusFilter === s
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(active ? 'all' : s)}
                className={cn(
                  'bg-gray-800 rounded-lg p-4 text-left border transition-colors',
                  active ? 'border-green-500' : 'border-gray-700 hover:border-gray-600',
                )}
              >
                <div className={cn('flex items-center gap-1.5 text-xs font-medium mb-1', cfg.color.split(' ')[0])}>
                  <Icon className="w-3.5 h-3.5" />
                  {cfg.label}
                </div>
                <div className="text-2xl font-bold text-white">{statusCounts[s] ?? 0}</div>
              </button>
            )
          })}
        </div>

        {/* Open deductions banner */}
        {totalOpenDeductions > 0 && (
          <div className="bg-amber-900/30 border border-amber-700 rounded-lg px-4 py-3 mb-5 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <span className="text-amber-300 font-semibold">{fmt$(totalOpenDeductions)}</span>
              <span className="text-amber-400/80 ml-1">in queued funding deductions — will auto-net on next EPC payment.</span>
            </span>
          </div>
        )}

        {/* New claim form */}
        {showNewForm && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 mb-5">
            <h2 className="text-base font-semibold mb-4 text-white">New Warranty Claim</h2>
            <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Project ID</label>
                  <input
                    required
                    value={form.project_id}
                    onChange={(e) => setForm((f) => ({ ...f, project_id: e.target.value }))}
                    placeholder="PROJ-XXXXX"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Original EPC Org ID (UUID)</label>
                  <input
                    required
                    value={form.original_epc_id}
                    onChange={(e) => setForm((f) => ({ ...f, original_epc_id: e.target.value }))}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description of Failure</label>
                <textarea
                  required
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What went wrong and how it was discovered."
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Work Required</label>
                <textarea
                  required
                  rows={2}
                  value={form.work_required}
                  onChange={(e) => setForm((f) => ({ ...f, work_required: e.target.value }))}
                  placeholder="Specific remediation work that needs to be done."
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                >
                  {submitting ? 'Creating…' : 'Create Claim'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewForm(false); setForm(EMPTY_FORM) }}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-4 py-2 rounded text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Claims list */}
        {loading ? (
          <div className="text-gray-500 text-sm py-10 text-center">Loading claims…</div>
        ) : loadError ? (
          <div className="text-red-400 text-sm py-10 text-center">{loadError}</div>
        ) : claims.length === 0 ? (
          <div className="text-gray-600 text-sm py-14 text-center">
            {statusFilter === 'all' ? 'No warranty claims yet.' : `No ${statusFilter} claims.`}
          </div>
        ) : (
          <div className="space-y-2">
            {claims.map((claim) => {
              const cfg = STATUS_CONFIG[claim.status]
              const Icon = cfg.icon
              const isExpanded = expandedId === claim.id
              const isUpdating = updatingId === claim.id

              return (
                <div key={claim.id} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : claim.id)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-750 transition-colors"
                  >
                    <span className={cn('flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border shrink-0', cfg.color)}>
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-white text-sm font-medium">
                          {claim.project?.job_number ?? claim.project_id}
                        </span>
                        {claim.project && (
                          <span className="text-gray-400 text-xs">
                            {claim.project.customer_name} · {claim.project.city}, {claim.project.state}
                          </span>
                        )}
                        <span className="text-gray-500 text-xs">
                          {claim.original_epc?.name ?? 'Unknown EPC'}
                        </span>
                      </div>
                      <p className="text-gray-500 text-xs truncate mt-0.5">{claim.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {claim.claim_amount !== null && (
                        <div className="text-amber-300 text-sm font-semibold">{fmt$(claim.claim_amount)}</div>
                      )}
                      <div className="text-gray-500 text-xs">
                        {new Date(claim.claim_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail + actions */}
                  {isExpanded && (
                    <div className="border-t border-gray-700 px-4 py-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Work Required</div>
                          <div className="text-gray-300">{claim.work_required}</div>
                        </div>
                        {claim.deployed_epc && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Replacement EPC</div>
                            <div className="text-gray-300">{claim.deployed_epc.name}</div>
                            {claim.deployed_at && (
                              <div className="text-gray-500 text-xs mt-0.5">
                                Deployed {new Date(claim.deployed_at).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        )}
                        {claim.notes && (
                          <div className="sm:col-span-2">
                            <div className="text-xs text-gray-500 mb-1">Notes</div>
                            <div className="text-gray-300 text-sm">{claim.notes}</div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-700/50">
                        {claim.status === 'pending' && (
                          <button
                            disabled={isUpdating}
                            onClick={() => void updateClaim(claim.id, { status: 'deployed' })}
                            className="text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-600/30 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                          >
                            Mark Deployed
                          </button>
                        )}
                        {claim.status === 'deployed' && (
                          <button
                            disabled={isUpdating}
                            onClick={() => {
                              const raw = prompt('Invoiced amount (numbers only, e.g. 4500):')
                              if (!raw) return
                              const n = parseFloat(raw.replace(/[^0-9.]/g, ''))
                              if (isNaN(n) || n <= 0) { alert('Enter a valid positive amount'); return }
                              void updateClaim(claim.id, { status: 'invoiced', claim_amount: n })
                            }}
                            className="text-xs bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-600/30 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                          >
                            Set Invoiced Amount
                          </button>
                        )}
                        {claim.status === 'invoiced' && (
                          <button
                            disabled={isUpdating}
                            onClick={() => void updateClaim(claim.id, { status: 'recovered' })}
                            className="text-xs bg-green-600/20 hover:bg-green-600/40 text-green-300 border border-green-600/30 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                          >
                            Mark Recovered
                          </button>
                        )}
                        {(claim.status === 'pending' || claim.status === 'deployed') && (
                          <button
                            disabled={isUpdating}
                            onClick={() => {
                              if (!confirm('Void this claim? This removes the funding deduction queue.')) return
                              void updateClaim(claim.id, { status: 'voided' })
                            }}
                            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                          >
                            Void
                          </button>
                        )}
                        {isUpdating && (
                          <span className="text-xs text-gray-500 self-center">Saving…</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
