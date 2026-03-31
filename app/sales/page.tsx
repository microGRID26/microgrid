'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg, useRealtimeSubscription } from '@/lib/hooks'
import { fmtDate } from '@/lib/utils'
import { Pagination } from '@/components/Pagination'
import {
  loadPayScales, addPayScale, updatePayScale, deletePayScale,
  loadPayDistribution, updatePayDistribution, addPayDistribution, deletePayDistribution,
  loadSalesTeams, addSalesTeam, updateSalesTeam, deleteSalesTeam,
  loadSalesReps, addSalesRep, updateSalesRep,
  loadOnboardingRequirements, loadRepDocuments, updateOnboardingDocStatus, updateDocFileUrl, initializeRepDocuments,
  calculateOverride,
  loadCommissionRecords,
  REP_STATUSES, REP_STATUS_LABELS, REP_STATUS_BADGE,
  DOC_STATUS_LABELS, DOC_STATUS_BADGE,
  COMMISSION_STATUS_LABELS, COMMISSION_STATUS_BADGE,
  loadUsers,
} from '@/lib/api'
import { fmt$ } from '@/lib/utils'
import type { PayScale, PayDistribution, SalesTeam, SalesRep, OnboardingRequirement, OnboardingDocument, RepStatus, OnboardingDocStatus } from '@/lib/api'
import {
  Users, UserPlus, DollarSign, PieChart, ClipboardCheck, Shield,
  ChevronDown, ChevronUp, Plus, X, Pencil, Trash2, Download,
  Search, AlertTriangle, CheckCircle, Clock, Mail,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'teams' | 'personnel' | 'pay_scales' | 'distribution' | 'onboarding' | 'compliance'
type SortCol = 'last_name' | 'email' | 'team' | 'pay_scale' | 'role_key' | 'status' | 'hire_date'

const TAB_ITEMS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'teams', label: 'Teams', icon: <Users className="w-4 h-4" /> },
  { key: 'personnel', label: 'Personnel', icon: <UserPlus className="w-4 h-4" /> },
  { key: 'pay_scales', label: 'Pay Scales', icon: <DollarSign className="w-4 h-4" /> },
  { key: 'distribution', label: 'Distribution', icon: <PieChart className="w-4 h-4" /> },
  { key: 'onboarding', label: 'Onboarding', icon: <ClipboardCheck className="w-4 h-4" /> },
  { key: 'compliance', label: 'Compliance', icon: <Shield className="w-4 h-4" /> },
]

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, accent }: {
  label: string; value: string | number; icon: React.ReactNode; accent: string
}) {
  const colors: Record<string, { bg: string; border: string; text: string; iconColor: string }> = {
    green: { bg: 'bg-green-900/30', border: 'border-green-700/50', text: 'text-green-400', iconColor: 'text-green-500' },
    blue: { bg: 'bg-blue-900/30', border: 'border-blue-700/50', text: 'text-blue-400', iconColor: 'text-blue-500' },
    amber: { bg: 'bg-amber-900/30', border: 'border-amber-700/50', text: 'text-amber-400', iconColor: 'text-amber-500' },
    purple: { bg: 'bg-purple-900/30', border: 'border-purple-700/50', text: 'text-purple-400', iconColor: 'text-purple-500' },
  }
  const c = colors[accent] ?? colors.green
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        <span className={c.iconColor}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold ${c.text} tracking-tight`}>{value}</p>
    </div>
  )
}

// ── Add Team Modal ───────────────────────────────────────────────────────────

function AddTeamModal({ onClose, onSaved, orgId, users, editing }: {
  onClose: () => void
  onSaved: () => void
  orgId: string | null
  users: { id: string; name: string }[]
  editing?: SalesTeam | null
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [vpUserId, setVpUserId] = useState(editing?.vp_user_id ?? '')
  const [vpName, setVpName] = useState(editing?.vp_name ?? '')
  const [regionalUserId, setRegionalUserId] = useState(editing?.regional_user_id ?? '')
  const [regionalName, setRegionalName] = useState(editing?.regional_name ?? '')
  const [managerUserId, setManagerUserId] = useState(editing?.manager_user_id ?? '')
  const [managerName, setManagerName] = useState(editing?.manager_name ?? '')
  const [asstManagerUserId, setAsstManagerUserId] = useState(editing?.assistant_manager_user_id ?? '')
  const [asstManagerName, setAsstManagerName] = useState(editing?.assistant_manager_name ?? '')
  const [stackPerWatt, setStackPerWatt] = useState(String(editing?.stack_per_watt ?? '0.40'))
  const [saving, setSaving] = useState(false)

  const selectUser = (setter: (v: string) => void, nameSetter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uid = e.target.value
    setter(uid)
    const u = users.find(u => u.id === uid)
    nameSetter(u?.name ?? '')
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    const payload = {
      name: name.trim(),
      vp_user_id: vpUserId || undefined,
      vp_name: vpName || undefined,
      regional_user_id: regionalUserId || undefined,
      regional_name: regionalName || undefined,
      manager_user_id: managerUserId || undefined,
      manager_name: managerName || undefined,
      assistant_manager_user_id: asstManagerUserId || undefined,
      assistant_manager_name: asstManagerName || undefined,
      stack_per_watt: parseFloat(stackPerWatt) || 0.40,
      org_id: orgId || undefined,
    }
    if (editing) {
      await updateSalesTeam(editing.id, payload)
    } else {
      await addSalesTeam(payload)
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">{editing ? 'Edit Team' : 'Add Team'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1">Team Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'VP', value: vpUserId, onChange: selectUser(setVpUserId, setVpName) },
              { label: 'Regional', value: regionalUserId, onChange: selectUser(setRegionalUserId, setRegionalName) },
              { label: 'Manager', value: managerUserId, onChange: selectUser(setManagerUserId, setManagerName) },
              { label: 'Asst. Manager', value: asstManagerUserId, onChange: selectUser(setAsstManagerUserId, setAsstManagerName) },
            ].map(f => (
              <div key={f.label}>
                <label className="text-xs text-gray-400 font-medium block mb-1">{f.label}</label>
                <select value={f.value} onChange={f.onChange}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
                  <option value="">-- None --</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1">Stack Rate ($/W)</label>
            <input type="number" step="0.01" value={stackPerWatt} onChange={e => setStackPerWatt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md">
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Team'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Rep Modal ────────────────────────────────────────────────────────────

function AddRepModal({ onClose, onSaved, orgId, teams, payScales }: {
  onClose: () => void
  onSaved: () => void
  orgId: string | null
  teams: SalesTeam[]
  payScales: PayScale[]
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [teamId, setTeamId] = useState('')
  const [payScaleId, setPayScaleId] = useState('')
  const [roleKey, setRoleKey] = useState('energy_consultant')
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10))

  // #15: Auto-set pay scale by role
  const ROLE_PAY_SCALE: Record<string, string> = {
    energy_consultant: 'Consultant',
    energy_advisor: 'Consultant',
    project_manager: 'Pro',
    assistant_manager: 'Elite',
    vp: 'Exclusive',
    regional: 'Exclusive',
  }
  const handleRoleChange = (role: string) => {
    setRoleKey(role)
    const scaleName = ROLE_PAY_SCALE[role]
    if (scaleName) {
      const match = payScales.find(s => s.active && s.name === scaleName)
      if (match) setPayScaleId(match.id)
    }
  }
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return
    setSaving(true)
    const rep = await addSalesRep({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      team_id: teamId || undefined,
      pay_scale_id: payScaleId || undefined,
      role_key: roleKey,
      hire_date: hireDate || undefined,
      status: 'onboarding',
      org_id: orgId || undefined,
    })
    // Auto-initialize onboarding documents
    if (rep) {
      await initializeRepDocuments(rep.id, orgId)
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">Add Sales Rep</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">First Name *</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Last Name *</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Team</label>
              <select value={teamId} onChange={e => setTeamId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">-- Unassigned --</option>
                {teams.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Pay Scale</label>
              <select value={payScaleId} onChange={e => setPayScaleId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">-- Select --</option>
                {payScales.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} (${s.per_watt_rate}/W)</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Role</label>
              <select value={roleKey} onChange={e => handleRoleChange(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="energy_consultant">Energy Consultant</option>
                <option value="energy_advisor">Energy Advisor</option>
                <option value="project_manager">Project Manager</option>
                <option value="assistant_manager">Assistant Manager</option>
                <option value="vp">VP</option>
                <option value="regional">Regional</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Hire Date</label>
              <input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving || !firstName.trim() || !lastName.trim() || !email.trim()}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md">
            {saving ? 'Creating...' : 'Create Rep'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Teams Tab ────────────────────────────────────────────────────────────────

function TeamsTab({ teams, reps, payScales, users, orgId, onRefresh }: {
  teams: SalesTeam[]
  reps: SalesRep[]
  payScales: PayScale[]
  users: { id: string; name: string }[]
  orgId: string | null
  onRefresh: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editingTeam, setEditingTeam] = useState<SalesTeam | null>(null)

  const activeTeams = teams.filter(t => t.active)
  const activeReps = reps.filter(r => r.status === 'active')
  const onboardingReps = reps.filter(r => r.status === 'onboarding')
  const avgStack = activeTeams.length > 0
    ? activeTeams.reduce((sum, t) => sum + Number(t.stack_per_watt), 0) / activeTeams.length
    : 0

  const scaleMap = useMemo(() => {
    const m = new Map<string, PayScale>()
    payScales.forEach(s => m.set(s.id, s))
    return m
  }, [payScales])

  const teamReps = useCallback((teamId: string) => reps.filter(r => r.team_id === teamId), [reps])

  // #13: Team scorecard — load all commission records once
  const [teamCommissions, setTeamCommissions] = useState<Map<string, { deals: number; total: number; paid: number }>>(new Map())
  useEffect(() => {
    loadCommissionRecords({}).then(records => {
      const byTeam = new Map<string, { deals: number; total: number; paid: number }>()
      for (const r of records) {
        if (r.status === 'cancelled') continue
        // Find the rep to get their team_id
        const rep = reps.find(rep => rep.user_id === r.user_id)
        if (!rep?.team_id) continue
        const existing = byTeam.get(rep.team_id) ?? { deals: 0, total: 0, paid: 0 }
        existing.deals++
        existing.total += r.total_commission ?? 0
        if (r.status === 'paid') existing.paid += r.total_commission ?? 0
        byTeam.set(rep.team_id, existing)
      }
      setTeamCommissions(byTeam)
    })
  }, [reps])

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Teams" value={activeTeams.length} icon={<Users className="w-5 h-5" />} accent="green" />
        <StatCard label="Active Reps" value={activeReps.length} icon={<UserPlus className="w-5 h-5" />} accent="blue" />
        <StatCard label="Onboarding" value={onboardingReps.length} icon={<Clock className="w-5 h-5" />} accent="amber" />
        <StatCard label="Avg Stack Rate" value={`$${avgStack.toFixed(2)}/W`} icon={<DollarSign className="w-5 h-5" />} accent="purple" />
      </div>

      {/* Actions */}
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-md transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Team
        </button>
      </div>

      {/* Team cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {activeTeams.map(team => {
          const members = teamReps(team.id)
          const isExpanded = expandedId === team.id
          return (
            <div key={team.id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : team.id)}
                className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-gray-750 transition-colors"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white">{team.name}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    {team.vp_name && <span className="text-[10px] text-gray-400">VP: {team.vp_name}</span>}
                    <span className="text-[10px] text-gray-500">{members.length} member{members.length !== 1 ? 's' : ''}</span>
                    <span className="text-[10px] text-green-400 font-medium">${Number(team.stack_per_watt).toFixed(2)}/W</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingTeam(team) }}
                    className="text-gray-500 hover:text-white p-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-700 px-5 py-3">
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[
                      { label: 'VP', name: team.vp_name },
                      { label: 'Regional', name: team.regional_name },
                      { label: 'Manager', name: team.manager_name },
                      { label: 'Asst. Mgr', name: team.assistant_manager_name },
                    ].filter(l => l.name).map(l => (
                      <div key={l.label} className="text-[10px]">
                        <span className="text-gray-500">{l.label}:</span>{' '}
                        <span className="text-gray-300">{l.name}</span>
                      </div>
                    ))}
                  </div>

                  {/* #13: Team Scorecard */}
                  {(() => {
                    const tc = teamCommissions.get(team.id)
                    return tc && tc.deals > 0 ? (
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        <div className="bg-gray-900/50 rounded p-2 text-center">
                          <div className="text-[9px] text-gray-500 uppercase">Deals</div>
                          <div className="text-sm font-bold text-white">{tc.deals}</div>
                        </div>
                        <div className="bg-gray-900/50 rounded p-2 text-center">
                          <div className="text-[9px] text-gray-500 uppercase">Total</div>
                          <div className="text-sm font-bold text-green-400">{fmt$(tc.total)}</div>
                        </div>
                        <div className="bg-gray-900/50 rounded p-2 text-center">
                          <div className="text-[9px] text-gray-500 uppercase">Paid</div>
                          <div className="text-sm font-bold text-emerald-400">{fmt$(tc.paid)}</div>
                        </div>
                        <div className="bg-gray-900/50 rounded p-2 text-center">
                          <div className="text-[9px] text-gray-500 uppercase">Avg/Deal</div>
                          <div className="text-sm font-bold text-blue-400">{fmt$(tc.total / tc.deals)}</div>
                        </div>
                      </div>
                    ) : null
                  })()}

                  {members.length === 0 ? (
                    <p className="text-xs text-gray-500">No members assigned</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">Members</p>
                      {members.map(rep => {
                        const scale = rep.pay_scale_id ? scaleMap.get(rep.pay_scale_id) : null
                        return (
                          <div key={rep.id} className="flex items-center justify-between py-1.5 px-2 bg-gray-900/50 rounded">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-white">{rep.first_name} {rep.last_name}</span>
                              {scale && <span className="text-[10px] text-gray-400">{scale.name}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${REP_STATUS_BADGE[rep.status]}`}>
                                {REP_STATUS_LABELS[rep.status]}
                              </span>
                              {rep.hire_date && <span className="text-[10px] text-gray-500">{fmtDate(rep.hire_date)}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {activeTeams.length === 0 && (
        <div className="text-center py-12 text-gray-500 text-sm">No teams created yet. Click &quot;Add Team&quot; to get started.</div>
      )}

      {(showAdd || editingTeam) && (
        <AddTeamModal
          onClose={() => { setShowAdd(false); setEditingTeam(null) }}
          onSaved={onRefresh}
          orgId={orgId}
          users={users}
          editing={editingTeam}
        />
      )}
    </div>
  )
}

// ── Personnel Tab ────────────────────────────────────────────────────────────

function PersonnelTab({ reps, teams, payScales, requirements, orgId, isAdmin, onRefresh }: {
  reps: SalesRep[]
  teams: SalesTeam[]
  payScales: PayScale[]
  requirements: OnboardingRequirement[]
  orgId: string | null
  isAdmin: boolean
  onRefresh: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('last_name')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [repDocs, setRepDocs] = useState<Map<string, OnboardingDocument[]>>(new Map())
  const [repCommissions, setRepCommissions] = useState<Map<string, { total: number; paid: number; pending: number; count: number; projects: { id: string; amount: number; status: string }[] }>>(new Map())
  const [editingRepId, setEditingRepId] = useState<string | null>(null)
  const [repDraft, setRepDraft] = useState<{ recheck_id: string; blacklisted: boolean; blacklist_reason: string; notes: string }>({ recheck_id: '', blacklisted: false, blacklist_reason: '', notes: '' })
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  const teamMap = useMemo(() => {
    const m = new Map<string, SalesTeam>()
    teams.forEach(t => m.set(t.id, t))
    return m
  }, [teams])

  const scaleMap = useMemo(() => {
    const m = new Map<string, PayScale>()
    payScales.forEach(s => m.set(s.id, s))
    return m
  }, [payScales])

  const loadDocs = useCallback(async (repId: string) => {
    const docs = await loadRepDocuments(repId)
    setRepDocs(prev => new Map(prev).set(repId, docs))
  }, [])

  const loadRepCommissions = useCallback(async (rep: SalesRep) => {
    const records = await loadCommissionRecords({ userId: rep.user_id ?? undefined })
    const summary = { total: 0, paid: 0, pending: 0, count: records.length, projects: [] as { id: string; amount: number; status: string }[] }
    for (const r of records) {
      if (r.status === 'cancelled') continue
      summary.total += r.total_commission ?? 0
      if (r.status === 'paid') summary.paid += r.total_commission ?? 0
      if (r.status === 'pending' || r.status === 'approved') summary.pending += r.total_commission ?? 0
      summary.projects.push({ id: r.project_id, amount: r.total_commission ?? 0, status: r.status })
    }
    setRepCommissions(prev => new Map(prev).set(rep.id, summary))
  }, [])

  const startEditRep = useCallback((rep: SalesRep) => {
    setEditingRepId(rep.id)
    setRepDraft({
      recheck_id: rep.recheck_id ?? '',
      blacklisted: rep.blacklisted ?? false,
      blacklist_reason: rep.blacklist_reason ?? '',
      notes: rep.notes ?? '',
    })
  }, [])

  const saveRepFields = useCallback(async (repId: string) => {
    await updateSalesRep(repId, {
      recheck_id: repDraft.recheck_id || null,
      blacklisted: repDraft.blacklisted,
      blacklist_reason: repDraft.blacklisted ? (repDraft.blacklist_reason || null) : null,
      notes: repDraft.notes || null,
    })
    setEditingRepId(null)
    onRefresh()
  }, [repDraft, onRefresh])

  const toggleExpand = useCallback((repId: string) => {
    if (expandedId === repId) {
      setExpandedId(null)
    } else {
      setExpandedId(repId)
      if (!repDocs.has(repId)) loadDocs(repId)
      const rep = reps.find(r => r.id === repId)
      if (rep && !repCommissions.has(repId)) loadRepCommissions(rep)
    }
  }, [expandedId, repDocs, loadDocs, reps, repCommissions, loadRepCommissions])

  const filtered = useMemo(() => {
    let list = [...reps]
    const q = search.toLowerCase().trim()
    if (q) {
      list = list.filter(r =>
        `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q)
      )
    }
    if (filterTeam) list = list.filter(r => r.team_id === filterTeam)
    if (filterStatus) list = list.filter(r => r.status === filterStatus)

    list.sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'last_name': cmp = a.last_name.localeCompare(b.last_name); break
        case 'email': cmp = a.email.localeCompare(b.email); break
        case 'team': {
          const at = a.team_id ? teamMap.get(a.team_id)?.name ?? '' : ''
          const bt = b.team_id ? teamMap.get(b.team_id)?.name ?? '' : ''
          cmp = at.localeCompare(bt); break
        }
        case 'pay_scale': {
          const as2 = a.pay_scale_id ? scaleMap.get(a.pay_scale_id)?.name ?? '' : ''
          const bs = b.pay_scale_id ? scaleMap.get(b.pay_scale_id)?.name ?? '' : ''
          cmp = as2.localeCompare(bs); break
        }
        case 'role_key': cmp = a.role_key.localeCompare(b.role_key); break
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'hire_date': cmp = (a.hire_date ?? '').localeCompare(b.hire_date ?? ''); break
      }
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [reps, search, filterTeam, filterStatus, sortCol, sortAsc, teamMap, scaleMap])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const SortIcon = ({ col }: { col: SortCol }) => (
    sortCol === col
      ? sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />
      : null
  )

  const exportCSV = () => {
    const header = ['Name', 'Email', 'Phone', 'Team', 'Pay Scale', 'Role', 'Status', 'Hire Date']
    const rows = filtered.map(r => [
      `${r.first_name} ${r.last_name}`,
      r.email,
      r.phone ?? '',
      r.team_id ? teamMap.get(r.team_id)?.name ?? '' : '',
      r.pay_scale_id ? scaleMap.get(r.pay_scale_id)?.name ?? '' : '',
      r.role_key,
      r.status,
      r.hire_date ?? '',
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sales-reps-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search reps..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select value={filterTeam} onChange={e => { setFilterTeam(e.target.value); setPage(1) }}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">All Teams</option>
          {teams.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">All Status</option>
          {REP_STATUSES.map(s => <option key={s} value={s}>{REP_STATUS_LABELS[s]}</option>)}
        </select>
        <button onClick={exportCSV} className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-md">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-md">
          <Plus className="w-3.5 h-3.5" /> Add Rep
        </button>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-400">
                {([
                  ['last_name', 'Name'], ['email', 'Email'], ['team', 'Team'], ['pay_scale', 'Pay Scale'],
                  ['role_key', 'Role'], ['status', 'Status'], ['hire_date', 'Hire Date'],
                ] as [SortCol, string][]).map(([col, label]) => (
                  <th key={col} className="px-4 py-2 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort(col)}>
                    {label} <SortIcon col={col} />
                  </th>
                ))}
                <th className="px-4 py-2 font-medium">Onboarding</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(rep => {
                const team = rep.team_id ? teamMap.get(rep.team_id) : null
                const scale = rep.pay_scale_id ? scaleMap.get(rep.pay_scale_id) : null
                const docs = repDocs.get(rep.id) ?? []
                const reqCount = requirements.filter(r => r.active && r.required).length
                const verifiedCount = docs.filter(d => d.status === 'verified').length
                const isExpanded = expandedId === rep.id

                return (
                  <React.Fragment key={rep.id}>
                    <tr
                      className={`border-b border-gray-700/50 hover:bg-gray-750 cursor-pointer text-xs transition-colors ${isExpanded ? 'bg-gray-750' : ''}`}
                      onClick={() => toggleExpand(rep.id)}
                    >
                      <td className="px-4 py-2.5 text-white font-medium">{rep.first_name} {rep.last_name}</td>
                      <td className="px-4 py-2.5 text-gray-400">{rep.email}</td>
                      <td className="px-4 py-2.5 text-gray-300">{team?.name ?? <span className="text-gray-600">--</span>}</td>
                      <td className="px-4 py-2.5 text-gray-300">{scale?.name ?? <span className="text-gray-600">--</span>}</td>
                      <td className="px-4 py-2.5 text-gray-300 capitalize">{rep.role_key.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${REP_STATUS_BADGE[rep.status]}`}>
                          {REP_STATUS_LABELS[rep.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">{fmtDate(rep.hire_date)}</td>
                      <td className="px-4 py-2.5">
                        {rep.status === 'onboarding' && reqCount > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-500 rounded-full transition-all"
                                style={{ width: `${reqCount > 0 ? (verifiedCount / reqCount) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400">{verifiedCount}/{reqCount}</span>
                          </div>
                        ) : rep.status === 'active' ? (
                          <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <span className="text-gray-600">--</span>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-4 py-4 bg-gray-900/50 border-b border-gray-700">
                          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <h4 className="text-[10px] uppercase text-gray-500 font-medium tracking-wider">Contact</h4>
                                {isAdmin && editingRepId !== rep.id && (
                                  <button onClick={(e) => { e.stopPropagation(); startEditRep(rep) }} className="text-[10px] text-blue-400 hover:text-blue-300">
                                    <Pencil className="w-3 h-3 inline mr-0.5" />Edit
                                  </button>
                                )}
                              </div>
                              {editingRepId === rep.id ? (
                                <div className="text-xs space-y-2" onClick={e => e.stopPropagation()}>
                                  <p className="text-gray-300">{rep.email}</p>
                                  {rep.phone && <p className="text-gray-400">{rep.phone}</p>}
                                  <div>
                                    <label className="text-[10px] text-gray-500">RECHECK ID</label>
                                    <input value={repDraft.recheck_id} onChange={e => setRepDraft(d => ({ ...d, recheck_id: e.target.value }))}
                                      className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white font-mono" placeholder="e.g. RC-12345" />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-gray-500">Blacklisted</label>
                                    <button onClick={() => setRepDraft(d => ({ ...d, blacklisted: !d.blacklisted }))}
                                      className={`w-8 h-4 rounded-full transition-colors ${repDraft.blacklisted ? 'bg-red-500' : 'bg-gray-600'}`}>
                                      <div className={`w-3 h-3 rounded-full bg-white transition-transform mx-0.5 ${repDraft.blacklisted ? 'translate-x-4' : ''}`} />
                                    </button>
                                  </div>
                                  {repDraft.blacklisted && (
                                    <div>
                                      <label className="text-[10px] text-gray-500">Blacklist Reason</label>
                                      <input value={repDraft.blacklist_reason} onChange={e => setRepDraft(d => ({ ...d, blacklist_reason: e.target.value }))}
                                        className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" placeholder="Reason..." />
                                    </div>
                                  )}
                                  <div>
                                    <label className="text-[10px] text-gray-500">Notes</label>
                                    <textarea value={repDraft.notes} onChange={e => setRepDraft(d => ({ ...d, notes: e.target.value }))}
                                      rows={2} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white resize-none" placeholder="Internal notes..." />
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button onClick={() => saveRepFields(rep.id)} className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-[10px] text-white font-medium">Save</button>
                                    <button onClick={() => setEditingRepId(null)} className="px-2 py-1 text-gray-400 hover:text-white text-[10px]">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs space-y-1">
                                  <p className="text-gray-300">{rep.email}</p>
                                  {rep.phone && <p className="text-gray-400">{rep.phone}</p>}
                                  {rep.recheck_id && <p><span className="text-gray-500">RECHECK ID:</span> <span className="text-gray-300 font-mono">{rep.recheck_id}</span></p>}
                                  {rep.blacklisted && (
                                    <p className="text-red-400 text-[10px] font-medium">
                                      BLACKLISTED{rep.blacklist_reason ? `: ${rep.blacklist_reason}` : ''}
                                    </p>
                                  )}
                                  {rep.notes && <p className="text-gray-500 text-[10px]">{rep.notes}</p>}
                                </div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <h4 className="text-[10px] uppercase text-gray-500 font-medium tracking-wider">Assignment</h4>
                              <div className="text-xs space-y-1">
                                <p><span className="text-gray-500">Team:</span> <span className="text-gray-300">{team?.name ?? 'Unassigned'}</span></p>
                                <p><span className="text-gray-500">Pay Scale:</span> <span className="text-gray-300">{scale ? `${scale.name} ($${scale.per_watt_rate}/W)` : 'None'}</span></p>
                                <p><span className="text-gray-500">Role:</span> <span className="text-gray-300 capitalize">{rep.role_key.replace(/_/g, ' ')}</span></p>
                                {team && scale && (
                                  <p className="text-green-400 text-[10px] font-medium">
                                    Override: ${calculateOverride(Number(team.stack_per_watt), Number(scale.per_watt_rate), 1000).overridePerWatt.toFixed(2)}/W
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <h4 className="text-[10px] uppercase text-gray-500 font-medium tracking-wider">Documents</h4>
                              {docs.length > 0 ? (
                                <div className="space-y-1">
                                  {docs.map(doc => {
                                    const req = requirements.find(r => r.id === doc.requirement_id)
                                    return (
                                      <div key={doc.id} className="flex items-center justify-between text-[10px] py-0.5">
                                        <span className="text-gray-300">{req?.name ?? 'Unknown'}</span>
                                        <span className={`px-1.5 py-0.5 rounded font-medium ${DOC_STATUS_BADGE[doc.status]}`}>
                                          {DOC_STATUS_LABELS[doc.status]}
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <p className="text-[10px] text-gray-500">No documents</p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <h4 className="text-[10px] uppercase text-gray-500 font-medium tracking-wider">Commission History</h4>
                              {(() => {
                                const cs = repCommissions.get(rep.id)
                                if (!cs) return <p className="text-[10px] text-gray-500">Loading...</p>
                                if (cs.count === 0) return <p className="text-[10px] text-gray-500">No commission records</p>
                                return (
                                  <div className="text-xs space-y-1">
                                    <p><span className="text-gray-500">Deals:</span> <span className="text-gray-300">{cs.count}</span></p>
                                    <p><span className="text-gray-500">Total:</span> <span className="text-white font-medium">{fmt$(cs.total)}</span></p>
                                    <p><span className="text-gray-500">Paid:</span> <span className="text-green-400">{fmt$(cs.paid)}</span></p>
                                    <p><span className="text-gray-500">Pending:</span> <span className="text-amber-400">{fmt$(cs.pending)}</span></p>
                                    {cs.projects.length > 0 && (
                                      <div className="mt-2 pt-2 border-t border-gray-700/50 space-y-0.5">
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Projects</p>
                                        {cs.projects.slice(0, 8).map((p) => (
                                          <div key={`${p.id}-${p.status}`} className="flex items-center justify-between">
                                            <span className="text-blue-400 text-[10px]">{p.id}</span>
                                            <div className="flex items-center gap-2">
                                              <span className="text-gray-300 text-[10px]">{fmt$(p.amount)}</span>
                                              <span className={`text-[9px] px-1 rounded ${p.status === 'paid' ? 'bg-green-900/40 text-green-400' : p.status === 'pending' ? 'bg-amber-900/40 text-amber-400' : 'bg-gray-700 text-gray-400'}`}>
                                                {p.status}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                        {cs.projects.length > 8 && (
                                          <p className="text-[10px] text-gray-500">+ {cs.projects.length - 8} more</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                            </div>
                          </div>

                          {/* #12: Rep Scorecard */}
                          <div className="mt-3 pt-3 border-t border-gray-700/50">
                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                              {(() => {
                                const cs = repCommissions.get(rep.id)
                                const lastSale = cs?.projects?.filter(p => p.status !== 'cancelled').sort((a, b) => b.id.localeCompare(a.id))[0]
                                return <>
                                  <div className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                                    <div className="text-[10px] text-gray-500 uppercase">Deals</div>
                                    <div className="text-lg font-bold text-white">{cs?.count ?? 0}</div>
                                  </div>
                                  <div className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                                    <div className="text-[10px] text-gray-500 uppercase">Total Earned</div>
                                    <div className="text-lg font-bold text-green-400">{fmt$(cs?.total ?? 0)}</div>
                                  </div>
                                  <div className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                                    <div className="text-[10px] text-gray-500 uppercase">Paid</div>
                                    <div className="text-lg font-bold text-emerald-400">{fmt$(cs?.paid ?? 0)}</div>
                                  </div>
                                  <div className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                                    <div className="text-[10px] text-gray-500 uppercase">Pending</div>
                                    <div className="text-lg font-bold text-amber-400">{fmt$(cs?.pending ?? 0)}</div>
                                  </div>
                                  <div className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                                    <div className="text-[10px] text-gray-500 uppercase">Avg / Deal</div>
                                    <div className="text-lg font-bold text-blue-400">{cs && cs.count > 0 ? fmt$(cs.total / cs.count) : '$0'}</div>
                                  </div>
                                </>
                              })()}
                            </div>
                          </div>

                          {/* #11: Notes Section */}
                          <div className="mt-3 pt-3 border-t border-gray-700/50">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-[10px] uppercase text-gray-500 font-medium tracking-wider">Notes</h4>
                            </div>
                            {rep.notes ? (
                              <div className="space-y-1 max-h-24 overflow-y-auto">
                                {rep.notes.split('\n').filter(Boolean).map((line, i) => (
                                  <p key={i} className="text-[11px] text-gray-400">{line}</p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-gray-600">No notes yet</p>
                            )}
                            {isAdmin && editingRepId !== rep.id && (
                              <div className="mt-2 flex gap-2" onClick={e => e.stopPropagation()}>
                                <input
                                  placeholder="Add a note..."
                                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                      const input = e.target as HTMLInputElement
                                      const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                      const newNote = `[${stamp}] ${input.value.trim()}`
                                      const updated = rep.notes ? `${newNote}\n${rep.notes}` : newNote
                                      await updateSalesRep(rep.id, { notes: updated })
                                      input.value = ''
                                      onRefresh()
                                    }
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">No reps found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalCount={filtered.length}
          pageSize={PAGE_SIZE}
          hasMore={page < totalPages}
          onPrevPage={() => setPage(p => Math.max(1, p - 1))}
          onNextPage={() => setPage(p => Math.min(totalPages, p + 1))}
        />
      )}

      {showAdd && (
        <AddRepModal
          onClose={() => setShowAdd(false)}
          onSaved={onRefresh}
          orgId={orgId}
          teams={teams}
          payScales={payScales}
        />
      )}
    </div>
  )
}

// ── Pay Scales Tab ───────────────────────────────────────────────────────────

function PayScalesTab({ payScales, orgId, isAdmin, onRefresh }: {
  payScales: PayScale[]
  orgId: string | null
  isAdmin: boolean
  onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', per_watt_rate: '', adder_percentage: '10', referral_bonus: '500' })
  const [saving, setSaving] = useState(false)

  const startEdit = (scale: PayScale) => {
    setEditingId(scale.id)
    setForm({
      name: scale.name,
      description: scale.description ?? '',
      per_watt_rate: String(scale.per_watt_rate),
      adder_percentage: String(scale.adder_percentage),
      referral_bonus: String(scale.referral_bonus),
    })
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    await updatePayScale(editingId, {
      name: form.name.trim(),
      description: form.description.trim() || null,
      per_watt_rate: parseFloat(form.per_watt_rate) || 0,
      adder_percentage: parseFloat(form.adder_percentage) || 0,
      referral_bonus: parseFloat(form.referral_bonus) || 0,
    })
    setSaving(false)
    setEditingId(null)
    onRefresh()
  }

  const saveNew = async () => {
    setSaving(true)
    await addPayScale({
      name: form.name.trim(),
      per_watt_rate: parseFloat(form.per_watt_rate) || 0,
      description: form.description.trim() || undefined,
      adder_percentage: parseFloat(form.adder_percentage) || 0,
      referral_bonus: parseFloat(form.referral_bonus) || 0,
      sort_order: payScales.length + 1,
      org_id: orgId || undefined,
    })
    setSaving(false)
    setShowAdd(false)
    setForm({ name: '', description: '', per_watt_rate: '', adder_percentage: '10', referral_bonus: '500' })
    onRefresh()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this pay scale tier?')) return
    await deletePayScale(id)
    onRefresh()
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="bg-blue-900/20 border border-blue-800/30 rounded-xl p-4">
        <p className="text-xs text-blue-300">
          Pay scale tiers define how much a rep earns per watt. The <strong>override</strong> is the difference between
          the team&apos;s stack rate and the rep&apos;s tier rate. For example, if a team stack is $0.40/W and the rep
          is on Consultant ($0.20/W), the override is <strong>$0.20/W</strong> -- which gets distributed to leadership per the Distribution tab.
        </p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {payScales.map(scale => {
          const isEditing = editingId === scale.id
          return (
            <div key={scale.id} className="bg-gray-800 border border-gray-700 rounded-xl p-5 relative group">
              {isEditing ? (
                <div className="space-y-2">
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description"
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500" />
                  <div>
                    <label className="text-[10px] text-gray-500">Rate ($/W)</label>
                    <input type="number" step="0.01" value={form.per_watt_rate} onChange={e => setForm({ ...form, per_watt_rate: e.target.value })}
                      className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500">Adder %</label>
                      <input type="number" value={form.adder_percentage} onChange={e => setForm({ ...form, adder_percentage: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Referral $</label>
                      <input type="number" value={form.referral_bonus} onChange={e => setForm({ ...form, referral_bonus: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={saveEdit} disabled={saving}
                      className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[10px] rounded">
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1 text-gray-400 hover:text-white text-[10px]">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {isAdmin && (
                    <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(scale)} className="text-gray-500 hover:text-white p-1"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => handleDelete(scale.id)} className="text-gray-500 hover:text-red-400 p-1"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  )}
                  <div className="text-center">
                    <h3 className="text-sm font-semibold text-white mb-1">{scale.name}</h3>
                    {scale.description && <p className="text-[10px] text-gray-400 mb-3">{scale.description}</p>}
                    <p className="text-3xl font-bold text-green-400 tracking-tight">${Number(scale.per_watt_rate).toFixed(2)}<span className="text-lg text-green-500">/W</span></p>
                    <div className="mt-3 flex justify-center gap-4">
                      <div className="text-center">
                        <p className="text-[10px] text-gray-500">Adder</p>
                        <p className="text-xs text-gray-300 font-medium">{Number(scale.adder_percentage)}%</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-gray-500">Referral</p>
                        <p className="text-xs text-gray-300 font-medium">${Number(scale.referral_bonus)}</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )
        })}

        {/* Add card */}
        {isAdmin && !showAdd && (
          <button onClick={() => { setShowAdd(true); setForm({ name: '', description: '', per_watt_rate: '', adder_percentage: '10', referral_bonus: '500' }) }}
            className="bg-gray-800/50 border border-dashed border-gray-700 rounded-xl p-5 flex flex-col items-center justify-center gap-2 hover:border-green-600 hover:bg-gray-800 transition-colors min-h-[180px]">
            <Plus className="w-6 h-6 text-gray-500" />
            <span className="text-xs text-gray-500">Add Tier</span>
          </button>
        )}

        {showAdd && (
          <div className="bg-gray-800 border border-green-700/50 rounded-xl p-5">
            <div className="space-y-2">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Tier name"
                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description"
                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500" />
              <div>
                <label className="text-[10px] text-gray-500">Rate ($/W)</label>
                <input type="number" step="0.01" value={form.per_watt_rate} onChange={e => setForm({ ...form, per_watt_rate: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500">Adder %</label>
                  <input type="number" value={form.adder_percentage} onChange={e => setForm({ ...form, adder_percentage: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Referral $</label>
                  <input type="number" value={form.referral_bonus} onChange={e => setForm({ ...form, referral_bonus: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={saveNew} disabled={saving || !form.name.trim() || !form.per_watt_rate}
                  className="flex-1 px-2 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-[10px] rounded">
                  {saving ? 'Creating...' : 'Create'}
                </button>
                <button onClick={() => setShowAdd(false)} className="px-2 py-1 text-gray-400 hover:text-white text-[10px]">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Distribution Tab ─────────────────────────────────────────────────────────

function DistributionTab({ distribution, orgId, isAdmin, onRefresh }: {
  distribution: PayDistribution[]
  orgId: string | null
  isAdmin: boolean
  onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPct, setEditPct] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newRoleKey, setNewRoleKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newPct, setNewPct] = useState('')
  const [saving, setSaving] = useState(false)

  const active = distribution.filter(d => d.active)
  const totalPct = active.reduce((sum, d) => sum + Number(d.percentage), 0)
  const isBalanced = Math.abs(totalPct - 100) < 0.01
  const maxPct = Math.max(...active.map(d => Number(d.percentage)), 1)

  const startEdit = (d: PayDistribution) => {
    setEditingId(d.id)
    setEditPct(String(d.percentage))
    setEditLabel(d.label)
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    await updatePayDistribution(editingId, {
      label: editLabel.trim(),
      percentage: parseFloat(editPct) || 0,
    })
    setSaving(false)
    setEditingId(null)
    onRefresh()
  }

  const handleAdd = async () => {
    if (!newRoleKey.trim() || !newLabel.trim()) return
    setSaving(true)
    await addPayDistribution({
      role_key: newRoleKey.trim().toLowerCase().replace(/\s+/g, '_'),
      label: newLabel.trim(),
      percentage: parseFloat(newPct) || 0,
      sort_order: distribution.length + 1,
      active: true,
      org_id: orgId || undefined,
    })
    setSaving(false)
    setShowAdd(false)
    setNewRoleKey(''); setNewLabel(''); setNewPct('')
    onRefresh()
  }

  const toggleActive = async (d: PayDistribution) => {
    await updatePayDistribution(d.id, { active: !d.active })
    onRefresh()
  }

  return (
    <div className="space-y-6">
      {/* Sum warning */}
      {!isBalanced && (
        <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">
            Distribution percentages total <strong>{totalPct.toFixed(1)}%</strong> -- they must sum to 100%.
          </p>
        </div>
      )}
      {isBalanced && (
        <div className="bg-green-900/20 border border-green-800/30 rounded-xl p-4 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
          <p className="text-xs text-green-300">Distribution totals <strong>100%</strong>. All good.</p>
        </div>
      )}

      {/* Horizontal bar chart */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-white mb-4">Override Distribution Split</h3>
        <div className="space-y-3">
          {active.map(d => (
            <div key={d.id} className="flex items-center gap-3">
              <span className="text-[10px] text-gray-400 w-32 text-right truncate">{d.label}</span>
              <div className="flex-1 h-6 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-600 rounded-full flex items-center justify-end pr-2 transition-all"
                  style={{ width: `${(Number(d.percentage) / maxPct) * 100}%`, minWidth: Number(d.percentage) > 0 ? '24px' : '0' }}
                >
                  <span className="text-[10px] text-white font-medium">{Number(d.percentage)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Editable table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-400">
              <th className="px-4 py-2 font-medium">Role Key</th>
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">Percentage</th>
              <th className="px-4 py-2 font-medium">Active</th>
              {isAdmin && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {distribution.map(d => {
              const isEditing = editingId === d.id
              return (
                <tr key={d.id} className="border-b border-gray-700/50 text-xs">
                  <td className="px-4 py-2 text-gray-400 font-mono text-[10px]">{d.role_key}</td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white w-32 focus:outline-none focus:border-blue-500" />
                    ) : (
                      <span className="text-gray-300">{d.label}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <input type="number" step="0.5" value={editPct} onChange={e => setEditPct(e.target.value)}
                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white w-20 focus:outline-none focus:border-blue-500" />
                    ) : (
                      <span className="text-white font-medium">{Number(d.percentage)}%</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isAdmin ? (
                      <button onClick={() => toggleActive(d)}
                        className={`w-3 h-3 rounded-full ${d.active ? 'bg-green-500' : 'bg-gray-600'}`}
                        title={d.active ? 'Active' : 'Inactive'}
                      />
                    ) : (
                      <span className={`w-3 h-3 rounded-full inline-block ${d.active ? 'bg-green-500' : 'bg-gray-600'}`} />
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={saveEdit} disabled={saving}
                            className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => setEditingId(null)}
                            className="px-2 py-0.5 text-gray-400 hover:text-white text-[10px]">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(d)} className="text-gray-500 hover:text-white">
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-600">
              <td className="px-4 py-2" />
              <td className="px-4 py-2 text-xs text-gray-400 font-medium">Total</td>
              <td className="px-4 py-2">
                <span className={`text-xs font-bold ${isBalanced ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPct.toFixed(1)}%
                </span>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add row */}
      {isAdmin && (
        <div>
          {showAdd ? (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Role Key</label>
                <input value={newRoleKey} onChange={e => setNewRoleKey(e.target.value)} placeholder="e.g. trainer"
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white w-28 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Label</label>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Trainer"
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white w-28 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">%</label>
                <input type="number" step="0.5" value={newPct} onChange={e => setNewPct(e.target.value)}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white w-16 focus:outline-none focus:border-blue-500" />
              </div>
              <button onClick={handleAdd} disabled={saving || !newRoleKey.trim() || !newLabel.trim()}
                className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded">Add</button>
              <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-gray-400 hover:text-white text-xs">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-md">
              <Plus className="w-3.5 h-3.5" /> Add Role
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Onboarding Tab ───────────────────────────────────────────────────────────

function OnboardingTab({ reps, teams, requirements, onRefresh }: {
  reps: SalesRep[]
  teams: SalesTeam[]
  requirements: OnboardingRequirement[]
  onRefresh: () => void
}) {
  const [repDocsMap, setRepDocsMap] = useState<Map<string, OnboardingDocument[]>>(new Map())
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null)
  const [urlDraft, setUrlDraft] = useState('')

  const onboardingReps = useMemo(() => reps.filter(r => r.status === 'onboarding'), [reps])
  const teamMap = useMemo(() => {
    const m = new Map<string, SalesTeam>()
    teams.forEach(t => m.set(t.id, t))
    return m
  }, [teams])

  const repIdKey = onboardingReps.map(r => r.id).join(',')
  useEffect(() => {
    async function load() {
      setLoadingDocs(true)
      const map = new Map<string, OnboardingDocument[]>()
      for (const rep of onboardingReps) {
        const docs = await loadRepDocuments(rep.id)
        map.set(rep.id, docs)
      }
      setRepDocsMap(map)
      setLoadingDocs(false)
    }
    if (onboardingReps.length > 0) load()
    else setLoadingDocs(false)
  }, [repIdKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = async (docId: string, status: OnboardingDocStatus) => {
    setActionInProgress(docId)
    await updateOnboardingDocStatus(docId, status)
    // Refresh docs for affected rep
    for (const rep of onboardingReps) {
      const docs = repDocsMap.get(rep.id)
      if (docs?.find(d => d.id === docId)) {
        const refreshed = await loadRepDocuments(rep.id)
        setRepDocsMap(prev => new Map(prev).set(rep.id, refreshed))
        break
      }
    }
    setActionInProgress(null)
  }

  const handleSaveUrl = async (docId: string) => {
    setActionInProgress(docId)
    await updateDocFileUrl(docId, urlDraft.trim() || null)
    // Refresh docs for affected rep
    for (const rep of onboardingReps) {
      const docs = repDocsMap.get(rep.id)
      if (docs?.find(d => d.id === docId)) {
        const refreshed = await loadRepDocuments(rep.id)
        setRepDocsMap(prev => new Map(prev).set(rep.id, refreshed))
        break
      }
    }
    setEditingUrlId(null)
    setUrlDraft('')
    setActionInProgress(null)
  }

  const activateRep = async (repId: string) => {
    if (!confirm('Activate this rep? They will be moved to Active status.')) return
    await updateSalesRep(repId, { status: 'active' })
    onRefresh()
  }

  const requiredReqs = requirements.filter(r => r.active && r.required)

  if (onboardingReps.length === 0) {
    return (
      <div className="text-center py-16">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-white mb-1">No reps currently onboarding</h3>
        <p className="text-xs text-gray-500">All sales reps are either active or inactive.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        {onboardingReps.length} rep{onboardingReps.length !== 1 ? 's' : ''} currently in onboarding.
        {requiredReqs.length > 0 && ` Each must complete ${requiredReqs.length} required document${requiredReqs.length !== 1 ? 's' : ''}.`}
      </p>

      {onboardingReps.map(rep => {
        const docs = repDocsMap.get(rep.id) ?? []
        const team = rep.team_id ? teamMap.get(rep.team_id) : null
        const requiredDocs = docs.filter(d => requiredReqs.some(r => r.id === d.requirement_id))
        const allVerified = requiredDocs.length > 0 && requiredDocs.every(d => d.status === 'verified')
        const verifiedCount = requiredDocs.filter(d => d.status === 'verified').length
        const isExpanded = expandedId === rep.id

        return (
          <div key={rep.id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpandedId(isExpanded ? null : rep.id)}
              className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-gray-750 transition-colors"
            >
              <div>
                <h3 className="text-sm font-semibold text-white">{rep.first_name} {rep.last_name}</h3>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-gray-400">{rep.email}</span>
                  {team && <span className="text-[10px] text-gray-500">{team.name}</span>}
                  {rep.hire_date && <span className="text-[10px] text-gray-500">Hired {fmtDate(rep.hire_date)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${allVerified ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${requiredReqs.length > 0 ? (verifiedCount / requiredReqs.length) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400">{verifiedCount}/{requiredReqs.length}</span>
                </div>
                {allVerified && (
                  <button
                    onClick={(e) => { e.stopPropagation(); activateRep(rep.id) }}
                    className="px-2 py-1 bg-green-700 hover:bg-green-600 text-white text-[10px] font-medium rounded transition-colors"
                  >
                    Ready to Activate
                  </button>
                )}
                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-700 px-5 py-4">
                {loadingDocs ? (
                  <p className="text-xs text-gray-500">Loading documents...</p>
                ) : docs.length === 0 ? (
                  <p className="text-xs text-gray-500">No documents initialized. Re-save the rep to create them.</p>
                ) : (
                  <div className="space-y-2">
                    {docs.map(doc => {
                      const req = requirements.find(r => r.id === doc.requirement_id)
                      const isRequired = req?.required ?? false
                      return (
                        <div key={doc.id} className="py-2 px-3 bg-gray-900/50 rounded-lg group/doc space-y-1">
                          <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${DOC_STATUS_BADGE[doc.status]}`}>
                              {DOC_STATUS_LABELS[doc.status]}
                            </span>
                            <span className="text-xs text-white">{req?.name ?? 'Unknown'}</span>
                            {isRequired && <span className="text-[10px] text-red-400">*</span>}
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Timestamps on hover */}
                            <div className="hidden group-hover/doc:flex items-center gap-2 text-[10px] text-gray-500">
                              {doc.sent_at && <span>Sent {fmtDate(doc.sent_at)}</span>}
                              {doc.viewed_at && <span>Viewed {fmtDate(doc.viewed_at)}</span>}
                              {doc.signed_at && <span>Signed {fmtDate(doc.signed_at)}</span>}
                              {doc.verified_at && <span>Verified {fmtDate(doc.verified_at)}</span>}
                            </div>

                            {doc.status !== 'verified' && doc.status !== 'rejected' && (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleStatusChange(doc.id, 'verified')}
                                  disabled={actionInProgress === doc.id}
                                  className="px-2 py-0.5 bg-green-700/50 hover:bg-green-700 text-green-300 text-[10px] rounded transition-colors disabled:opacity-50"
                                  title="Mark as Verified"
                                >
                                  <CheckCircle className="w-3 h-3 inline" /> Verify
                                </button>
                                <button
                                  onClick={() => handleStatusChange(doc.id, 'rejected')}
                                  disabled={actionInProgress === doc.id}
                                  className="px-2 py-0.5 bg-red-700/50 hover:bg-red-700 text-red-300 text-[10px] rounded transition-colors disabled:opacity-50"
                                  title="Reject"
                                >
                                  <X className="w-3 h-3 inline" /> Reject
                                </button>
                                {doc.status === 'pending' && (
                                  <button
                                    onClick={() => handleStatusChange(doc.id, 'sent')}
                                    disabled={actionInProgress === doc.id}
                                    className="px-2 py-0.5 bg-blue-700/50 hover:bg-blue-700 text-blue-300 text-[10px] rounded transition-colors disabled:opacity-50"
                                    title="Send Reminder"
                                  >
                                    <Mail className="w-3 h-3 inline" /> Send
                                  </button>
                                )}
                              </div>
                            )}
                            {doc.status === 'verified' && (
                              <CheckCircle className="w-4 h-4 text-green-500" />
                            )}
                            {doc.status === 'rejected' && (
                              <button
                                onClick={() => handleStatusChange(doc.id, 'pending')}
                                className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-[10px] rounded"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                          </div>
                          {/* File URL — view or edit */}
                          <div className="flex items-center gap-2 pl-8">
                            {editingUrlId === doc.id ? (
                              <div className="flex items-center gap-1 flex-1">
                                <input
                                  type="url"
                                  value={urlDraft}
                                  onChange={e => setUrlDraft(e.target.value)}
                                  placeholder="https://drive.google.com/..."
                                  className="flex-1 bg-gray-800 border border-gray-600 text-xs text-white px-2 py-0.5 rounded focus:border-green-500 outline-none"
                                  onKeyDown={e => { if (e.key === 'Enter') handleSaveUrl(doc.id); if (e.key === 'Escape') setEditingUrlId(null) }}
                                  autoFocus
                                />
                                <button onClick={() => handleSaveUrl(doc.id)} className="text-[10px] text-green-400 hover:text-green-300">Save</button>
                                <button onClick={() => setEditingUrlId(null)} className="text-[10px] text-gray-500 hover:text-gray-400">Cancel</button>
                              </div>
                            ) : doc.file_url ? (
                              <div className="flex items-center gap-2">
                                <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 truncate max-w-[200px]">
                                  {doc.file_url.replace(/^https?:\/\//, '').slice(0, 40)}...
                                </a>
                                <button onClick={() => { setEditingUrlId(doc.id); setUrlDraft(doc.file_url ?? '') }} className="text-[10px] text-gray-500 hover:text-gray-400">
                                  <Pencil className="w-2.5 h-2.5 inline" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setEditingUrlId(doc.id); setUrlDraft('') }}
                                className="text-[10px] text-gray-500 hover:text-gray-400"
                              >
                                + Add file link
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Compliance Tab (#14 + #10) ───────────────────────────────────────────────

function ComplianceTab({ reps, isAdmin }: { reps: SalesRep[]; isAdmin: boolean }) {
  const [licenses, setLicenses] = useState<any[]>([])
  const [files, setFiles] = useState<Map<string, any[]>>(new Map())
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addRepId, setAddRepId] = useState('')
  const [addType, setAddType] = useState('state_license')
  const [addNumber, setAddNumber] = useState('')
  const [addState, setAddState] = useState('')
  const [addExpiry, setAddExpiry] = useState('')
  const [addFileUrl, setAddFileUrl] = useState('')
  const LICENSE_TYPES = ['state_license', 'certification', 'insurance', 'background_check', 'drug_test']
  const STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-900/40 text-green-400',
    expired: 'bg-red-900/40 text-red-400',
    pending: 'bg-amber-900/40 text-amber-400',
    revoked: 'bg-red-900/60 text-red-300',
  }

  useEffect(() => {
    db().from('rep_licenses').select('*').order('expiry_date').limit(500).then(({ data }: any) => {
      setLicenses(data ?? [])
    })
  }, [])

  const repMap = useMemo(() => {
    const m = new Map<string, SalesRep>()
    reps.forEach(r => m.set(r.id, r))
    return m
  }, [reps])

  const filtered = useMemo(() => {
    let list = [...licenses]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(l => {
        const rep = repMap.get(l.rep_id)
        return rep && `${rep.first_name} ${rep.last_name}`.toLowerCase().includes(q) || l.license_number?.toLowerCase().includes(q)
      })
    }
    if (filterType) list = list.filter(l => l.license_type === filterType)
    return list
  }, [licenses, search, filterType, repMap])

  // Expiry stats
  const now = new Date()
  const expiringSoon = licenses.filter(l => {
    if (!l.expiry_date || l.status !== 'active') return false
    const d = new Date(l.expiry_date)
    const diff = (d.getTime() - now.getTime()) / 86400000
    return diff <= 30 && diff > 0
  })
  const expired = licenses.filter(l => l.status === 'expired' || (l.expiry_date && new Date(l.expiry_date) < now && l.status === 'active'))

  async function addLicense() {
    if (!addRepId) return
    await db().from('rep_licenses').insert({
      rep_id: addRepId,
      license_type: addType,
      license_number: addNumber || null,
      state: addState || null,
      expiry_date: addExpiry || null,
      file_url: addFileUrl || null,
      status: 'active',
    })
    setShowAdd(false)
    setAddRepId(''); setAddNumber(''); setAddState(''); setAddExpiry(''); setAddFileUrl('')
    db().from('rep_licenses').select('*').order('expiry_date').limit(500).then(({ data }: any) => setLicenses(data ?? []))
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Licenses" value={licenses.length} icon={<Shield className="w-5 h-5" />} accent="green" />
        <StatCard label="Expiring (30d)" value={expiringSoon.length} icon={<AlertTriangle className="w-5 h-5" />} accent="amber" />
        <StatCard label="Expired" value={expired.length} icon={<X className="w-5 h-5" />} accent="red" />
        <StatCard label="Reps Tracked" value={new Set(licenses.map(l => l.rep_id)).size} icon={<Users className="w-5 h-5" />} accent="blue" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rep name or license #..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white">
          <option value="">All Types</option>
          {LICENSE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
        </select>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-md">
            <Plus className="w-3.5 h-3.5" /> Add License
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="px-4 py-2 font-medium">Rep</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">License #</th>
              <th className="px-4 py-2 font-medium">State</th>
              <th className="px-4 py-2 font-medium">Expiry</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">File</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => {
              const rep = repMap.get(l.rep_id)
              const isExpiringSoon = l.expiry_date && l.status === 'active' && new Date(l.expiry_date) > now && (new Date(l.expiry_date).getTime() - now.getTime()) / 86400000 <= 30
              return (
                <tr key={l.id} className="border-b border-gray-700/50 hover:bg-gray-750">
                  <td className="px-4 py-2 text-white font-medium">{rep ? `${rep.first_name} ${rep.last_name}` : 'Unknown'}</td>
                  <td className="px-4 py-2 text-gray-300 capitalize">{l.license_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-gray-300 font-mono">{l.license_number ?? '\u2014'}</td>
                  <td className="px-4 py-2 text-gray-300">{l.state ?? '\u2014'}</td>
                  <td className={`px-4 py-2 ${isExpiringSoon ? 'text-amber-400 font-medium' : 'text-gray-300'}`}>
                    {l.expiry_date ? fmtDate(l.expiry_date) : '\u2014'}
                    {isExpiringSoon && <span className="ml-1 text-[10px]">&#9888;</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[l.status] ?? 'bg-gray-700 text-gray-400'}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {l.file_url ? (
                      <a href={l.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-[10px]">View</a>
                    ) : '\u2014'}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                {licenses.length === 0 ? 'No licenses tracked yet. Click "Add License" to start.' : 'No licenses match filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add License Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Add License / Certification</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Sales Rep *</label>
                <select value={addRepId} onChange={e => setAddRepId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                  <option value="">Select rep...</option>
                  {reps.filter(r => r.status !== 'terminated').map(r => <option key={r.id} value={r.id}>{r.first_name} {r.last_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Type</label>
                  <select value={addType} onChange={e => setAddType(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                    {LICENSE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">License #</label>
                  <input value={addNumber} onChange={e => setAddNumber(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">State</label>
                  <input value={addState} onChange={e => setAddState(e.target.value)} placeholder="TX"
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Expiry Date</label>
                  <input type="date" value={addExpiry} onChange={e => setAddExpiry(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">File URL (Google Drive / link)</label>
                <input value={addFileUrl} onChange={e => setAddFileUrl(e.target.value)} placeholder="https://..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
              <button onClick={addLicense} disabled={!addRepId}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md">
                Add License
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const { user: currentUser, loading: authLoading } = useCurrentUser()
  const { orgId } = useOrg()
  const [tab, setTab] = useState<Tab>('teams')
  const [loading, setLoading] = useState(true)

  const [payScales, setPayScales] = useState<PayScale[]>([])
  const [distribution, setDistribution] = useState<PayDistribution[]>([])
  const [teams, setTeams] = useState<SalesTeam[]>([])
  const [reps, setReps] = useState<SalesRep[]>([])
  const [requirements, setRequirements] = useState<OnboardingRequirement[]>([])
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])

  const isAdmin = !authLoading && !!currentUser?.isAdmin
  const isManager = !authLoading && (!!currentUser?.isManager || !!currentUser?.isAdmin)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [ps, dist, t, r, reqs, u] = await Promise.all([
      loadPayScales(orgId),
      loadPayDistribution(orgId),
      loadSalesTeams(orgId),
      loadSalesReps({ orgId }),
      loadOnboardingRequirements(orgId),
      loadUsers(),
    ])
    setPayScales(ps)
    setDistribution(dist)
    setTeams(t)
    setReps(r)
    setRequirements(reqs)
    setUsers((u?.data ?? []).map((usr: { id: string; name: string }) => ({ id: usr.id, name: usr.name })))
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadAll() }, [loadAll])

  // Realtime subscriptions
  useRealtimeSubscription('sales_reps' as any, { onChange: loadAll, debounceMs: 500 })
  useRealtimeSubscription('onboarding_documents' as any, { onChange: loadAll, debounceMs: 500 })

  // Role gate
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <Nav active="Sales Teams" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-600" />
            </div>
            <h1 className="text-lg font-semibold text-white mb-2">Admin Access Required</h1>
            <p className="text-sm text-gray-500">Sales team management requires Admin role.</p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300">Back to Command Center</a>
          </div>
        </div>
      </div>
    )
  }

  const onboardingCount = reps.filter(r => r.status === 'onboarding').length

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Nav active="Sales Teams" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Sales Teams</h1>
          <p className="text-xs text-gray-500 mt-1">Manage teams, personnel, pay scale stacks, and rep onboarding</p>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-gray-800 mb-6 overflow-x-auto">
          {TAB_ITEMS.map(t => {
            if (t.key === 'onboarding' && onboardingCount === 0) return null
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? 'border-green-500 text-green-400'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
                }`}
              >
                {t.icon}
                {t.label}
                {t.key === 'onboarding' && onboardingCount > 0 && (
                  <span className="ml-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {onboardingCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-gray-500 text-sm">Loading sales data...</div>
          </div>
        ) : (
          <>
            {tab === 'teams' && <TeamsTab teams={teams} reps={reps} payScales={payScales} users={users} orgId={orgId} onRefresh={loadAll} />}
            {tab === 'personnel' && <PersonnelTab reps={reps} teams={teams} payScales={payScales} requirements={requirements} orgId={orgId} isAdmin={isAdmin} onRefresh={loadAll} />}
            {tab === 'pay_scales' && <PayScalesTab payScales={payScales} orgId={orgId} isAdmin={isAdmin} onRefresh={loadAll} />}
            {tab === 'distribution' && <DistributionTab distribution={distribution} orgId={orgId} isAdmin={isAdmin} onRefresh={loadAll} />}
            {tab === 'onboarding' && <OnboardingTab reps={reps} teams={teams} requirements={requirements} onRefresh={loadAll} />}
            {tab === 'compliance' && <ComplianceTab reps={reps} isAdmin={isAdmin} />}
          </>
        )}
      </div>
    </div>
  )
}
