'use client'

// components/admin/DupReviewManager.tsx — Admin UI for reviewing projects
// flagged by the SubHub ingest as suspected duplicates. Action #807, Phase 1.
//
// Surface:
//   - Page through pairs of (loser flagged for review, canonical winner)
//   - Side-by-side field comparison
//   - Two actions per pair: "Merge into canonical" or "Mark as distinct"

import { useCallback, useEffect, useState } from 'react'

interface ProjectRow {
  id: string
  name: string | null
  address: string | null
  email: string | null
  phone: string | null
  stage: string | null
  disposition: string | null
  sale_date: string | null
  contract: string | null
  systemkw: string | null
  module: string | null
  module_qty: string | null
  inverter: string | null
  inverter_qty: string | null
  battery: string | null
  battery_qty: string | null
  financier: string | null
  consultant: string | null
  subhub_id: string | number | null
  created_at: string
  dup_canonical_id: string | null
}

interface Pair {
  loser:  ProjectRow
  winner: ProjectRow | null
}

interface ListResponse {
  data: { page: number; page_size: number; total: number; pairs: Pair[] }
}

export function DupReviewManager() {
  const [pairs, setPairs]   = useState<Pair[]>([])
  const [page, setPage]     = useState(1)
  const [total, setTotal]   = useState(0)
  const [pageSize, setPS]   = useState(25)
  const [loading, setLoad]  = useState(true)
  const [busy, setBusy]     = useState<string | null>(null)
  const [toast, setToast]   = useState('')

  const flash = useCallback((m: string) => {
    setToast(m)
    setTimeout(() => setToast(''), 3000)
  }, [])

  const load = useCallback(async () => {
    setLoad(true)
    const res = await fetch(`/api/admin/dup-review/list?page=${page}`)
    if (!res.ok) {
      flash(`Load failed: ${res.status}`)
      setLoad(false)
      return
    }
    const json = await res.json() as ListResponse
    setPairs(json.data.pairs ?? [])
    setTotal(json.data.total ?? 0)
    setPS(json.data.page_size ?? 25)
    setLoad(false)
  }, [page, flash])

  useEffect(() => { void load() }, [load])

  const merge = async (loserId: string, loserName: string | null, winnerId: string | null) => {
    if (!winnerId) {
      flash('No canonical id on loser — cannot merge')
      return
    }
    if (!confirm(
      `Merge ${loserId} (${loserName ?? '?'}) INTO ${winnerId}?\n\n` +
      `All invoices, files, folders, notes, tasks, etc. will be moved to the winner.\n` +
      `The loser row will be tagged "Merged-Duplicate" and dropped from active pipelines.\n\n` +
      `This is reversible within 30 days via dup_review_log.`
    )) return
    setBusy(loserId)
    const res = await fetch(`/api/admin/dup-review/${loserId}/merge`, { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      flash(`Merge failed: ${j.error ?? res.status}`)
      return
    }
    flash(`Merged ${loserId} → ${winnerId}`)
    void load()
  }

  const dismiss = async (loserId: string) => {
    // R1 ux-audit fix (#807): prompt() returns null on Cancel. Check null
    // BEFORE coalescing — earlier version would silently fire the dismiss
    // POST with empty note when the operator hit Cancel.
    const raw = prompt(`Mark ${loserId} as a legitimate distinct deal. Optional note:`)
    if (raw === null) return
    const note = raw
    setBusy(loserId)
    const res = await fetch(`/api/admin/dup-review/${loserId}/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    setBusy(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      flash(`Dismiss failed: ${j.error ?? res.status}`)
      return
    }
    flash(`Dismissed ${loserId} (kept as distinct)`)
    void load()
  }

  const lastPage = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Dup Review</h1>
          <p className="text-xs text-gray-500">
            {loading ? 'Loading…' : `${total} flagged · page ${page} of ${lastPage}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white text-xs rounded-md transition-colors">
            ← Prev
          </button>
          <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white text-xs rounded-md transition-colors">
            Next →
          </button>
        </div>
      </header>

      {toast && (
        <div className="px-4 py-2 bg-blue-900/40 border border-blue-800 rounded-md text-xs text-blue-300">{toast}</div>
      )}

      {!loading && pairs.length === 0 && (
        <div className="px-4 py-8 bg-gray-900/40 border border-gray-800 rounded-md text-center text-sm text-gray-500">
          No projects are currently flagged for review.
        </div>
      )}

      {pairs.map(({ loser, winner }) => {
        const diffCount = winner ? countDiffs(loser, winner) : 0
        return (
          <article key={loser.id} className="border border-gray-800 rounded-lg bg-gray-900/40 overflow-hidden">
            <header className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
              <div className="text-xs text-gray-400">
                <span className="text-white font-medium">{loser.name ?? '?'}</span>
                <span className="text-gray-600 mx-2">·</span>
                <span>{loser.address ?? '?'}</span>
                {winner && (
                  <span className="text-gray-600 mx-2">·</span>
                )}
                {winner && (
                  <span className="text-amber-400">{diffCount} of 14 fields differ</span>
                )}
              </div>
              {/* R1 ux-audit fix (#807): destructive action on the right
                  (Merge), non-destructive on left (Mark distinct). */}
              <div className="flex gap-2">
                <button
                  onClick={() => dismiss(loser.id)}
                  disabled={busy === loser.id}
                  className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white text-xs rounded-md transition-colors"
                >
                  Mark as distinct
                </button>
                <button
                  onClick={() => merge(loser.id, loser.name, winner?.id ?? null)}
                  disabled={busy === loser.id || !winner}
                  title={!winner ? 'Cannot merge: canonical row missing. Use "Mark as distinct".' : undefined}
                  className="px-3 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white text-xs rounded-md transition-colors"
                >
                  {busy === loser.id ? 'Working…' : 'Merge into canonical →'}
                </button>
              </div>
            </header>
            <div className="grid grid-cols-2 divide-x divide-gray-800">
              <Card title="Flagged" subtitle={loser.id} row={loser} other={winner} kind="loser" />
              <Card title="Canonical" subtitle={winner?.id ?? '— no canonical found —'} row={winner} other={loser} kind="winner" />
            </div>
          </article>
        )
      })}
    </div>
  )
}

// Field-pair definitions for the side-by-side cards. Drives both the
// render AND the differ — keep in sync.
const COMPARED_FIELDS: Array<{ key: keyof ProjectRow; label: string; suffix?: keyof ProjectRow }> = [
  { key: 'stage', label: 'stage' },
  { key: 'disposition', label: 'disposition' },
  { key: 'email', label: 'email' },
  { key: 'phone', label: 'phone' },
  { key: 'sale_date', label: 'sale_date' },
  { key: 'contract', label: 'contract' },
  { key: 'systemkw', label: 'systemkw' },
  { key: 'module', label: 'module', suffix: 'module_qty' },
  { key: 'inverter', label: 'inverter', suffix: 'inverter_qty' },
  { key: 'battery', label: 'battery', suffix: 'battery_qty' },
  { key: 'financier', label: 'financier' },
  { key: 'consultant', label: 'consultant' },
  { key: 'subhub_id', label: 'subhub_id' },
  { key: 'created_at', label: 'created_at' },
]

function countDiffs(a: ProjectRow, b: ProjectRow): number {
  let n = 0
  for (const f of COMPARED_FIELDS) {
    if (norm(a[f.key]) !== norm(b[f.key])) n++
  }
  return n
}

function norm(v: ProjectRow[keyof ProjectRow]): string {
  if (v == null) return ''
  return String(v).trim().toLowerCase()
}

function Card({ title, subtitle, row, other, kind }: {
  title: string; subtitle: string; row: ProjectRow | null; other: ProjectRow | null; kind: 'loser' | 'winner'
}) {
  const tone = kind === 'loser' ? 'text-amber-400' : 'text-emerald-400'
  return (
    <div className="p-4 text-xs">
      <div className="flex items-center justify-between mb-2">
        <div className={`font-medium ${tone}`}>{title}</div>
        <div className="text-gray-500">{subtitle}</div>
      </div>
      {!row ? (
        <div className="text-gray-600">No row.</div>
      ) : (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
          {COMPARED_FIELDS.map((f) => {
            const v = row[f.key]
            const sx = f.suffix ? row[f.suffix] : null
            const diffs = other ? norm(v) !== norm(other[f.key]) : false
            return (
              <Field
                key={String(f.key)}
                label={f.label}
                v={f.key === 'subhub_id'
                    ? (v == null ? '<native>' : String(v))
                    : f.key === 'created_at'
                      ? (typeof v === 'string' ? v.slice(0,10) : null)
                      : (v == null ? null : String(v))}
                suffix={sx ? `× ${String(sx)}` : null}
                diff={diffs}
              />
            )
          })}
        </dl>
      )}
    </div>
  )
}

function Field({ label, v, suffix, diff }: { label: string; v: string | null; suffix?: string | null; diff?: boolean }) {
  return (
    <>
      <dt className={diff ? 'text-amber-400 font-medium' : 'text-gray-500'}>{label}</dt>
      <dd className={`truncate ${diff ? 'text-amber-200 font-medium' : 'text-gray-200'}`}>
        {v ?? <span className="text-gray-600">—</span>}
        {suffix && <span className="text-gray-500 ml-2">{suffix}</span>}
      </dd>
    </>
  )
}
