'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  loadDealerRelationships,
  addDealerRelationship,
  updateDealerRelationship,
  deleteDealerRelationship,
  loadUnderwritingFees,
  addUnderwritingFee,
  updateUnderwritingFee,
  deleteUnderwritingFee,
  DEALER_STATUSES,
  DEALER_STATUS_LABELS,
  DEALER_STATUS_BADGE,
  UNDERWRITING_FEE_TYPES,
  UNDERWRITING_FEE_TYPE_LABELS,
  UNDERWRITING_FEE_STATUSES,
  UNDERWRITING_FEE_STATUS_BADGE,
} from '@/lib/api'
import type {
  SalesDealerRelationship,
  SalesDealerStatus,
  EpcUnderwritingFee,
  UnderwritingFeeType,
  UnderwritingFeeStatus,
} from '@/lib/api'
import { db } from '@/lib/db'
import { fmt$, fmtDate } from '@/lib/utils'
import { handleApiError } from '@/lib/errors'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { Input, Modal, SaveBtn, Textarea } from './shared'

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'contracts' | 'fees'

interface OrgOption {
  id: string
  name: string
  slug: string
  org_type: string
  settings: { is_sales_originator?: boolean; is_underwriter?: boolean } | null
}

// ── Manager ──────────────────────────────────────────────────────────────────

export function DealerRelationshipsManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { user } = useCurrentUser()
  const [tab, setTab] = useState<Tab>('contracts')
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [toast, setToast] = useState('')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }, [])

  // Load orgs once — both tabs need them for the dropdowns
  useEffect(() => {
    async function loadOrgs() {
      const supabase = db()
      const { data } = await supabase
        .from('organizations')
        .select('id, name, slug, org_type, settings')
        .eq('active', true)
        .order('name')
      if (data) setOrgs(data as OrgOption[])
      setOrgsLoading(false)
    }
    void loadOrgs()
  }, [])

  // Installers onboardable as dealers — every EPC except MG Energy itself.
  const epcs = orgs.filter((o) => o.org_type === 'epc' && o.slug !== 'microgrid')
  // Sales originators — only orgs flagged is_sales_originator (MG Energy today).
  const originators = orgs.filter((o) => o.settings?.is_sales_originator === true)
  const orgName = (id: string): string => orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8)
  const currentUserId = user?.id ?? null

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Dealer Relationships</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            EPC sales-dealer contracts + MG Energy → EDGE underwriting fees
          </p>
        </div>
        <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-md p-0.5">
          <button
            onClick={() => setTab('contracts')}
            className={`px-3 py-1 text-xs rounded-sm transition-colors ${
              tab === 'contracts' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Contracts
          </button>
          <button
            onClick={() => setTab('fees')}
            className={`px-3 py-1 text-xs rounded-sm transition-colors ${
              tab === 'fees' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Underwriting Fees
          </button>
        </div>
      </div>

      {orgsLoading ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
          Loading organizations…
        </div>
      ) : tab === 'contracts' ? (
        <ContractsPanel
          epcs={epcs}
          originators={originators}
          orgName={orgName}
          onToast={showToast}
          isSuperAdmin={isSuperAdmin}
          currentUserId={currentUserId}
        />
      ) : (
        <FeesPanel
          epcs={epcs}
          orgs={orgs}
          orgName={orgName}
          onToast={showToast}
          isSuperAdmin={isSuperAdmin}
          currentUserId={currentUserId}
        />
      )}
    </div>
  )
}

// ── Contracts panel ──────────────────────────────────────────────────────────

function ContractsPanel({
  epcs,
  originators,
  orgName,
  onToast,
  isSuperAdmin,
  currentUserId,
}: {
  epcs: OrgOption[]
  originators: OrgOption[]
  orgName: (id: string) => string
  onToast: (msg: string) => void
  isSuperAdmin: boolean
  currentUserId: string | null
}) {
  const [rows, setRows] = useState<SalesDealerRelationship[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [editing, setEditing] = useState<SalesDealerRelationship | null>(null)
  const [draft, setDraft] = useState<Partial<SalesDealerRelationship>>({})
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await loadDealerRelationships())
    } catch (err) {
      handleApiError(err, '[DealerRelationships] load')
    } finally {
      setRowsLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openEdit = (r: SalesDealerRelationship) => {
    setEditing(r)
    setDraft({ ...r })
  }

  const openNew = () => {
    setShowNew(true)
    setDraft({
      status: 'pending_signature',
      originator_org_id: originators[0]?.id ?? '',
    })
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await updateDealerRelationship(editing.id, {
        status: draft.status,
        contract_url: draft.contract_url ?? null,
        signed_at: draft.signed_at ?? null,
        effective_date: draft.effective_date ?? null,
        termination_date: draft.termination_date ?? null,
        underwriting_notes: draft.underwriting_notes ?? null,
      })
      setEditing(null)
      onToast('Contract saved')
      void load()
    } catch {
      onToast('Save failed')
    }
    setSaving(false)
  }

  const create = async () => {
    if (!draft.epc_org_id || !draft.originator_org_id) {
      onToast('EPC and originator are required')
      return
    }
    setSaving(true)
    try {
      await addDealerRelationship({
        epc_org_id: draft.epc_org_id,
        originator_org_id: draft.originator_org_id,
        status: (draft.status ?? 'pending_signature') as SalesDealerStatus,
        contract_url: draft.contract_url ?? null,
        signed_at: draft.signed_at ?? null,
        effective_date: draft.effective_date ?? null,
        termination_date: draft.termination_date ?? null,
        underwriting_notes: draft.underwriting_notes ?? null,
        created_by_id: currentUserId,
      })
      setShowNew(false)
      setDraft({})
      onToast('Contract created')
      void load()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Create failed')
    }
    setSaving(false)
  }

  const remove = async () => {
    if (!editing) return
    if (!confirm(`DELETE contract with ${orgName(editing.epc_org_id)}? This cannot be undone.`)) return
    try {
      await deleteDealerRelationship(editing.id)
      setEditing(null)
      onToast('Contract deleted')
      void load()
    } catch {
      onToast('Delete failed')
    }
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={openNew}
          className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600"
        >
          + New Contract
        </button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['EPC', 'Originator', 'Status', 'Signed', 'Effective', 'Terminated', 'Notes'].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">
                  {h}
                </th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${
                  i % 2 === 0 ? '' : 'bg-gray-900/20'
                }`}
                onClick={() => openEdit(r)}
              >
                <td className="px-3 py-2 text-white font-medium">{orgName(r.epc_org_id)}</td>
                <td className="px-3 py-2 text-gray-300">{orgName(r.originator_org_id)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${DEALER_STATUS_BADGE[r.status]}`}>
                    {DEALER_STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">{fmtDate(r.signed_at)}</td>
                <td className="px-3 py-2 text-gray-500">{fmtDate(r.effective_date)}</td>
                <td className="px-3 py-2 text-gray-500">{fmtDate(r.termination_date)}</td>
                <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate">{r.underwriting_notes || '—'}</td>
                <td className="px-3 py-2">
                  <button className="text-gray-500 hover:text-blue-400" aria-label="Edit">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-600 text-sm">
                  {rowsLoading ? 'Loading contracts…' : 'No dealer contracts yet. Click "New Contract" to add one.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(editing || showNew) && (
        <Modal
          title={editing ? `Edit Contract — ${orgName(editing.epc_org_id)}` : 'New Dealer Contract'}
          onClose={() => {
            setEditing(null)
            setShowNew(false)
            setDraft({})
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">EPC</label>
              <select
                disabled={!!editing}
                value={draft.epc_org_id ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, epc_org_id: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500 disabled:opacity-60"
              >
                <option value="">— Select EPC —</option>
                {epcs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Originator</label>
              <select
                disabled={!!editing}
                value={draft.originator_org_id ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, originator_org_id: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500 disabled:opacity-60"
              >
                <option value="">— Select originator —</option>
                {originators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Status</label>
            <select
              value={draft.status ?? 'pending_signature'}
              onChange={(e) =>
                setDraft((d) => ({ ...d, status: e.target.value as SalesDealerStatus }))
              }
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
            >
              {DEALER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DEALER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Contract URL"
            value={draft.contract_url ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, contract_url: v || null }))}
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Signed At"
              type="date"
              value={draft.signed_at?.slice(0, 10) ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, signed_at: v ? new Date(v).toISOString() : null }))}
            />
            <Input
              label="Effective Date"
              type="date"
              value={draft.effective_date ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, effective_date: v || null }))}
            />
            <Input
              label="Termination Date"
              type="date"
              value={draft.termination_date ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, termination_date: v || null }))}
            />
          </div>

          <Textarea
            label="Underwriting Notes"
            value={draft.underwriting_notes ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, underwriting_notes: v || null }))}
          />

          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button
                onClick={remove}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md"
              >
                Delete
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditing(null)
                  setShowNew(false)
                  setDraft({})
                }}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md"
              >
                Cancel
              </button>
              <SaveBtn onClick={editing ? save : create} saving={saving} />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

// ── Fees panel ───────────────────────────────────────────────────────────────

function FeesPanel({
  epcs,
  orgs,
  orgName,
  onToast,
  isSuperAdmin,
  currentUserId,
}: {
  epcs: OrgOption[]
  orgs: OrgOption[]
  orgName: (id: string) => string
  onToast: (msg: string) => void
  isSuperAdmin: boolean
  currentUserId: string | null
}) {
  const [rows, setRows] = useState<EpcUnderwritingFee[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [editing, setEditing] = useState<EpcUnderwritingFee | null>(null)
  const [draft, setDraft] = useState<Partial<EpcUnderwritingFee>>({})
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)

  // Default org IDs for "who underwrites" and "who pays" — looked up from orgs list.
  // Billing direction per migration 106: MG Energy (is_underwriter=true) is the
  // underwriter, EDGE (org_type='platform') pays.
  const mgEnergyId = orgs.find((o) => o.settings?.is_underwriter === true)?.id ?? ''
  const edgeId = orgs.find((o) => o.org_type === 'platform')?.id ?? ''

  const load = useCallback(async () => {
    try {
      setRows(await loadUnderwritingFees())
    } catch (err) {
      handleApiError(err, '[UnderwritingFees] load')
    } finally {
      setRowsLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openEdit = (r: EpcUnderwritingFee) => {
    setEditing(r)
    setDraft({ ...r })
  }

  const openNew = () => {
    setShowNew(true)
    setDraft({
      fee_type: 'one_time_onboarding',
      status: 'pending',
      underwriter_org_id: mgEnergyId,
      billed_to_org_id: edgeId,
    })
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await updateUnderwritingFee(editing.id, {
        fee_amount: draft.fee_amount,
        fee_type: draft.fee_type,
        status: draft.status,
        notes: draft.notes ?? null,
      })
      setEditing(null)
      onToast('Fee saved')
      void load()
    } catch {
      onToast('Save failed')
    }
    setSaving(false)
  }

  const create = async () => {
    if (!draft.epc_org_id || !draft.underwriter_org_id || !draft.billed_to_org_id) {
      onToast('EPC, underwriter, and payer are required')
      return
    }
    if (!draft.fee_amount || draft.fee_amount <= 0) {
      onToast('Fee amount must be positive')
      return
    }
    setSaving(true)
    try {
      await addUnderwritingFee({
        epc_org_id: draft.epc_org_id,
        underwriter_org_id: draft.underwriter_org_id,
        billed_to_org_id: draft.billed_to_org_id,
        relationship_id: draft.relationship_id ?? null,
        fee_amount: draft.fee_amount,
        fee_type: (draft.fee_type ?? 'one_time_onboarding') as UnderwritingFeeType,
        invoice_id: null,
        status: (draft.status ?? 'pending') as UnderwritingFeeStatus,
        notes: draft.notes ?? null,
        created_by_id: currentUserId,
      })
      setShowNew(false)
      setDraft({})
      onToast('Fee created')
      void load()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Create failed')
    }
    setSaving(false)
  }

  const remove = async () => {
    if (!editing) return
    if (!confirm('DELETE this underwriting fee? This cannot be undone.')) return
    try {
      await deleteUnderwritingFee(editing.id)
      setEditing(null)
      onToast('Fee deleted')
      void load()
    } catch {
      onToast('Delete failed')
    }
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={openNew}
          className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600"
        >
          + New Fee
        </button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['EPC', 'Type', 'Amount', 'Billed To', 'Status', 'Notes'].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">
                  {h}
                </th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${
                  i % 2 === 0 ? '' : 'bg-gray-900/20'
                }`}
                onClick={() => openEdit(r)}
              >
                <td className="px-3 py-2 text-white font-medium">{orgName(r.epc_org_id)}</td>
                <td className="px-3 py-2 text-gray-300">{UNDERWRITING_FEE_TYPE_LABELS[r.fee_type]}</td>
                <td className="px-3 py-2 text-white font-mono">{fmt$(Number(r.fee_amount))}</td>
                <td className="px-3 py-2 text-gray-300">{orgName(r.billed_to_org_id)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${UNDERWRITING_FEE_STATUS_BADGE[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate">{r.notes || '—'}</td>
                <td className="px-3 py-2">
                  <button className="text-gray-500 hover:text-blue-400" aria-label="Edit">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-600 text-sm">
                  {rowsLoading ? 'Loading fees…' : 'No underwriting fees yet. Click "New Fee" to add one.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(editing || showNew) && (
        <Modal
          title={editing ? `Edit Fee — ${orgName(editing.epc_org_id)}` : 'New Underwriting Fee'}
          onClose={() => {
            setEditing(null)
            setShowNew(false)
            setDraft({})
          }}
        >
          {!editing && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">EPC</label>
              <select
                value={draft.epc_org_id ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, epc_org_id: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
              >
                <option value="">— Select EPC —</option>
                {epcs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Fee Type</label>
              <select
                value={draft.fee_type ?? 'one_time_onboarding'}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, fee_type: e.target.value as UnderwritingFeeType }))
                }
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
              >
                {UNDERWRITING_FEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {UNDERWRITING_FEE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Fee Amount ($)"
              type="number"
              value={String(draft.fee_amount ?? '')}
              onChange={(v) => setDraft((d) => ({ ...d, fee_amount: parseFloat(v) || 0 }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Status</label>
            <select
              value={draft.status ?? 'pending'}
              onChange={(e) =>
                setDraft((d) => ({ ...d, status: e.target.value as UnderwritingFeeStatus }))
              }
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
            >
              {UNDERWRITING_FEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <Textarea
            label="Notes"
            value={draft.notes ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, notes: v || null }))}
          />

          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button
                onClick={remove}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md"
              >
                Delete
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditing(null)
                  setShowNew(false)
                  setDraft({})
                }}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md"
              >
                Cancel
              </button>
              <SaveBtn onClick={editing ? save : create} saving={saving} />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
