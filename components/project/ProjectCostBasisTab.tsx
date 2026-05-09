'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Download, AlertCircle, FileText, RefreshCw } from 'lucide-react'

import type { Project } from '@/types/database'
import type { CostBasisSummary, ProjectCostLineItem } from '@/lib/cost/calculator'

interface ProjectCostBasisTabProps {
  project: Project
}

interface CostBasisResponse {
  project_id: string
  project_name: string
  lineItems: ProjectCostLineItem[]
  summary: CostBasisSummary
  isEphemeral: boolean
  drift: {
    is_stale: boolean
    drifted_count: number
    max_dollar_delta: number
  }
}

// Postgres NUMERIC columns come back as strings via PostgREST. Coerce
// defensively before any number-only methods to avoid runtime crashes.
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmtMoney(v: number | string | null | undefined): string {
  return `$${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(v: number | string | null | undefined): string {
  return `${(num(v) * 100).toFixed(2)}%`
}

function fmtMarkupX(v: number | string | null | undefined): string {
  return `${num(v).toFixed(2)}x`
}

export function ProjectCostBasisTab({ project }: ProjectCostBasisTabProps) {
  const [data, setData] = useState<CostBasisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [regenLoading, setRegenLoading] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/cost-basis`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as CostBasisResponse
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  const downloadPdf = async () => {
    setPdfLoading(true)
    try {
      const url = `/api/projects/${project.id}/cost-basis/pdf?download=1`
      window.open(url, '_blank')
    } finally {
      setTimeout(() => setPdfLoading(false), 800)
    }
  }

  const regenSnapshot = async () => {
    setRegenLoading(true)
    setRegenError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/cost-basis/regen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Generated via drift banner' }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // Reload the cost basis with the new active snapshot.
      await load()
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setRegenLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-400">
        Loading cost reconciliation…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">Failed to load cost basis</div>
            <div className="text-red-300 text-xs mt-1">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!data || data.lineItems.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-400">
        No cost basis line items found for this project.
      </div>
    )
  }

  const { lineItems, summary, isEphemeral } = data
  const sections = Array.from(new Set(lineItems.map((li) => li.section)))

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Project Cost Reconciliation & Basis</h3>
          <p className="text-xs text-gray-500 mt-1">
            Per-project tax substantiation. Internal-only — do not share with EPC or customer tenants.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="px-2 py-1 text-xs text-gray-400 border border-gray-700 rounded hover:bg-gray-800 transition-colors"
          >
            {showAdvanced ? 'Hide' : 'Show'} raw / markup
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={pdfLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-700 hover:bg-green-600 rounded transition-colors disabled:opacity-50"
          >
            {pdfLoading ? (
              <span>Generating…</span>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Generate PDF
              </>
            )}
          </button>
        </div>
      </div>

      {/* Ephemeral banner */}
      {isEphemeral ? (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded p-3">
          <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">Showing catalog defaults — not yet persisted</div>
            <div className="text-amber-200/70 mt-1">
              This project doesn't have its cost basis line items in the database yet.
              The values shown below are computed from the proforma catalog scaled to this
              project's system size. Run the backfill script to persist:
              <code className="ml-1 px-1 py-0.5 text-xs bg-black/30 rounded">
                npx tsx scripts/backfill-project-cost-line-items.ts --project-id={project.id}
              </code>
            </div>
          </div>
        </div>
      ) : null}

      {/* Drift banner — Phase F. Mark/Greg call 2026-05-08. Shows when the
          live overlay'd template values diverge from this snapshot's
          persisted raw_cost (any line > $0.50 delta). User can regen to
          create a new snapshot; the old one is preserved as history. */}
      {!isEphemeral && data.drift.is_stale ? (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">
              Pricing in the model has changed since this snapshot was generated
            </div>
            <div className="text-amber-200/70 mt-1">
              {data.drift.drifted_count} line item{data.drift.drifted_count === 1 ? '' : 's'} differ
              {data.drift.drifted_count === 1 ? 's' : ''} from today's catalog (max delta: ${data.drift.max_dollar_delta.toFixed(2)} per unit).
              Generating a new report creates a fresh reconciliation snapshot — the existing one is preserved as history.
            </div>
            {regenError ? (
              <div className="text-red-300 text-[11px] mt-2">Failed to regenerate: {regenError}</div>
            ) : null}
            <button
              type="button"
              onClick={regenSnapshot}
              disabled={regenLoading}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-amber-700 hover:bg-amber-600 rounded transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regenLoading ? 'animate-spin' : ''}`} />
              {regenLoading ? 'Generating…' : 'Generate new report'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Summary block — proforma I34:M39 */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="PV Basis" value={fmtMoney(summary.pv_basis)} sub={`${fmtPct(summary.pv_basis_pct)} of total`} accent="text-green-400" />
        <SummaryCard label="Battery Basis" value={fmtMoney(summary.battery_basis)} sub={`${fmtPct(summary.battery_basis_pct)} of total`} accent="text-blue-400" />
        <SummaryCard label="GPU Basis" value={fmtMoney(summary.gpu_basis)} sub={`${fmtPct(summary.gpu_basis_pct)} of total · ITC excluded`} accent="text-red-400" />
        <SummaryCard label="Total Basis" value={fmtMoney(summary.total_basis)} sub={`${summary.line_item_count} line items`} accent="text-white" />
      </div>

      {/* ITC eligible row */}
      <div className="flex items-center justify-between p-4 border border-green-800 bg-green-900/20 rounded">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide">ITC-Eligible Basis</div>
          <div className="text-xs text-gray-500 mt-0.5">Excludes GPU and other non-eligible items</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-400">{fmtMoney(summary.itc_eligible_basis)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{fmtPct(summary.itc_eligible_pct)} of total</div>
        </div>
      </div>

      {/* Line item tables, sectioned */}
      <div className="space-y-4">
        {sections.map((section) => {
          const sectionItems = lineItems.filter((li) => li.section === section)
          return (
            <div key={section} className="border border-gray-700 rounded overflow-hidden">
              <div className="bg-green-900/50 px-3 py-1.5 text-xs font-semibold text-green-300 uppercase tracking-wide">
                {section}
              </div>
              <table className="w-full text-xs">
                <thead className="bg-gray-800 text-gray-500 uppercase text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-left px-2 py-2">Bucket</th>
                    {showAdvanced ? (
                      <>
                        <th className="text-right px-2 py-2">Raw</th>
                        <th className="text-right px-2 py-2">K</th>
                        <th className="text-right px-2 py-2">Distro</th>
                      </>
                    ) : null}
                    <th className="text-right px-2 py-2">EPC Price</th>
                    <th className="text-right px-2 py-2 text-blue-400">Battery</th>
                    <th className="text-right px-2 py-2 text-green-400">PV</th>
                    <th className="text-center px-2 py-2">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionItems.map((li) => {
                    const rowClass = li.is_itc_excluded
                      ? 'bg-red-900/10 text-red-200'
                      : li.is_epc_internal
                        ? 'bg-amber-900/10 text-amber-100'
                        : 'text-gray-200'
                    return (
                      <tr key={li.id ?? li.item_name} className={`border-t border-gray-800 ${rowClass}`}>
                        <td className="px-3 py-1.5">{li.item_name}</td>
                        <td className="px-2 py-1.5 text-gray-500">{li.system_bucket}</td>
                        {showAdvanced ? (
                          <>
                            <td className="px-2 py-1.5 text-right">{fmtMoney(li.raw_cost)}</td>
                            <td className="px-2 py-1.5 text-right text-gray-500">{fmtMarkupX(li.markup_to_distro)}</td>
                            <td className="px-2 py-1.5 text-right">{fmtMoney(li.distro_price)}</td>
                          </>
                        ) : null}
                        <td className="px-2 py-1.5 text-right font-semibold">{fmtMoney(li.epc_price)}</td>
                        <td className="px-2 py-1.5 text-right text-blue-400">{fmtMoney(li.battery_cost)}</td>
                        <td className="px-2 py-1.5 text-right text-green-400">{fmtMoney(li.pv_cost)}</td>
                        <td className="px-2 py-1.5 text-center text-gray-500">{li.basis_eligibility}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1">
        <div>▣ <span className="text-amber-300">Yellow rows</span>: EPC internal cost (covered by attestation, no proof of payment)</div>
        <div>▣ <span className="text-red-300">Red rows</span>: ITC excluded (e.g. GPU)</div>
        <div>Markup column "K" is the additional factor: distro = raw × (1 + K)</div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="p-3 bg-gray-800 border border-gray-700 rounded">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-1 ${accent}`}>{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  )
}
