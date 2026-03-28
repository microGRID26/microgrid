'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Input, Textarea, Modal, SaveBtn, SearchBar, Badge } from './shared'
import type { Organization, OrgMembership, OrgType, OrgRole } from '@/types/database'
import { Building2, Users, ChevronDown, ChevronRight, Trash2, UserPlus, X } from 'lucide-react'

// ── Constants ────────────────────────────────────────────────────────────────

const ORG_TYPES: OrgType[] = ['platform', 'epc', 'sales', 'engineering', 'supply', 'customer']

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  platform: 'Platform',
  epc: 'EPC',
  sales: 'Sales',
  engineering: 'Engineering',
  supply: 'Supply',
  customer: 'Customer',
}

const ORG_TYPE_COLORS: Record<OrgType, string> = {
  platform: 'bg-purple-900/40 text-purple-400 border-purple-800',
  epc: 'bg-green-900/40 text-green-400 border-green-800',
  sales: 'bg-blue-900/40 text-blue-400 border-blue-800',
  engineering: 'bg-amber-900/40 text-amber-400 border-amber-800',
  supply: 'bg-cyan-900/40 text-cyan-400 border-cyan-800',
  customer: 'bg-gray-800 text-gray-400 border-gray-700',
}

const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member', 'viewer']

const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

const ORG_ROLE_COLORS: Record<OrgRole, string> = {
  owner: 'bg-red-900/40 text-red-400',
  admin: 'bg-amber-900/40 text-amber-400',
  member: 'bg-gray-800 text-gray-400',
  viewer: 'bg-gray-800 text-gray-500',
}

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgWithCount extends Organization {
  member_count: number
}

interface MemberRow {
  id: string
  user_id: string
  org_role: OrgRole
  is_default: boolean
  created_at: string
  user_name?: string
  user_email?: string
}

interface OrgDraft {
  name: string
  slug: string
  org_type: OrgType
  allowed_domains: string
  active: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

// ── Component ────────────────────────────────────────────────────────────────

export function OrgManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [orgs, setOrgs] = useState<OrgWithCount[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<OrgType | ''>('')
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<Organization | null>(null)
  const [draft, setDraft] = useState<OrgDraft>({ name: '', slug: '', org_type: 'epc', allowed_domains: '', active: true })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Organization | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<OrgRole>('member')
  const [addingMember, setAddingMember] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  // ── Load organizations ─────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const supabase = db()
    let q = supabase.from('organizations').select('*').order('name')

    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    if (typeFilter) q = q.eq('org_type', typeFilter)

    const { data: orgData } = await q
    const orgList = (orgData ?? []) as Organization[]

    // Load member counts
    const { data: countData } = await supabase
      .from('org_memberships')
      .select('org_id')

    const counts = new Map<string, number>()
    for (const row of (countData ?? []) as { org_id: string }[]) {
      counts.set(row.org_id, (counts.get(row.org_id) ?? 0) + 1)
    }

    setOrgs(orgList.map(o => ({ ...o, member_count: counts.get(o.id) ?? 0 })))
  }, [search, typeFilter])

  useEffect(() => { load() }, [load])

  // ── Load members for expanded org ──────────────────────────────────────────

  const loadMembers = useCallback(async (orgId: string) => {
    setMembersLoading(true)
    const supabase = db()

    const { data: memberData } = await supabase
      .from('org_memberships')
      .select('id, user_id, org_role, is_default, created_at')
      .eq('org_id', orgId)
      .order('created_at')

    const memberList = (memberData ?? []) as Pick<OrgMembership, 'id' | 'user_id' | 'org_role' | 'is_default' | 'created_at'>[]

    if (memberList.length === 0) {
      setMembers([])
      setMembersLoading(false)
      return
    }

    // Load user details
    const userIds = memberList.map(m => m.user_id)
    const { data: userData } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', userIds)

    const userMap = new Map<string, { name: string; email: string }>()
    for (const u of (userData ?? []) as { id: string; name: string; email: string }[]) {
      userMap.set(u.id, { name: u.name, email: u.email })
    }

    setMembers(memberList.map(m => ({
      id: m.id,
      user_id: m.user_id,
      org_role: m.org_role as OrgRole,
      is_default: m.is_default,
      created_at: m.created_at,
      user_name: userMap.get(m.user_id)?.name ?? 'Unknown',
      user_email: userMap.get(m.user_id)?.email ?? '',
    })))
    setMembersLoading(false)
  }, [])

  // ── Toggle expanded org ────────────────────────────────────────────────────

  const toggleExpand = (orgId: string) => {
    if (expandedOrg === orgId) {
      setExpandedOrg(null)
      setMembers([])
    } else {
      setExpandedOrg(orgId)
      loadMembers(orgId)
    }
    setShowAddMember(false)
  }

  // ── Create / Edit org ──────────────────────────────────────────────────────

  const openNew = () => {
    setDraft({ name: '', slug: '', org_type: 'epc', allowed_domains: '', active: true })
    setShowNew(true)
    setEditing(null)
  }

  const openEdit = (org: Organization) => {
    setEditing(org)
    setDraft({
      name: org.name,
      slug: org.slug,
      org_type: org.org_type,
      allowed_domains: (org.allowed_domains ?? []).join(', '),
      active: org.active,
    })
    setShowNew(true)
  }

  const saveOrg = async () => {
    if (!draft.name.trim()) { showToast('Name is required'); return }
    const slug = editing ? editing.slug : (draft.slug.trim() || slugify(draft.name))
    if (!slug) { showToast('Slug is required'); return }

    setSaving(true)
    const domains = draft.allowed_domains
      .split(',')
      .map(d => d.trim())
      .filter(Boolean)

    const payload = {
      name: draft.name.trim(),
      slug,
      org_type: draft.org_type,
      allowed_domains: domains,
      active: draft.active,
      updated_at: new Date().toISOString(),
    }

    if (editing) {
      const { error } = await db().from('organizations').update(payload).eq('id', editing.id)
      if (error) { showToast(`Save failed: ${error.message}`); setSaving(false); return }
      showToast('Organization updated')
    } else {
      const { error } = await db().from('organizations').insert({ ...payload, created_at: new Date().toISOString() })
      if (error) { showToast(`Create failed: ${error.message}`); setSaving(false); return }
      showToast('Organization created')
    }

    setSaving(false)
    setShowNew(false)
    setEditing(null)
    load()
  }

  // ── Delete org ─────────────────────────────────────────────────────────────

  const deleteOrg = async (org: Organization) => {
    // Check for assigned projects
    const { data: projData } = await db().from('projects').select('id').eq('org_id', org.id).limit(1)
    if (projData && projData.length > 0) {
      showToast('Cannot delete: organization has assigned projects')
      setConfirmDelete(null)
      return
    }

    // Delete memberships first, then org
    await db().from('org_memberships').delete().eq('org_id', org.id)
    const { error } = await db().from('organizations').delete().eq('id', org.id)
    if (error) { showToast(`Delete failed: ${error.message}`); setConfirmDelete(null); return }

    showToast('Organization deleted')
    setConfirmDelete(null)
    if (expandedOrg === org.id) { setExpandedOrg(null); setMembers([]) }
    load()
  }

  // ── Add member ─────────────────────────────────────────────────────────────

  const addMember = async () => {
    if (!expandedOrg || !memberEmail.trim()) return
    setAddingMember(true)

    // Find user by email
    const { data: userData } = await db().from('users').select('id').eq('email', memberEmail.trim()).limit(1)
    if (!userData || userData.length === 0) {
      showToast('User not found with that email')
      setAddingMember(false)
      return
    }

    const userId = (userData[0] as { id: string }).id

    // Check if already a member
    const { data: existing } = await db()
      .from('org_memberships')
      .select('id')
      .eq('org_id', expandedOrg)
      .eq('user_id', userId)
      .limit(1)

    if (existing && existing.length > 0) {
      showToast('User is already a member')
      setAddingMember(false)
      return
    }

    const { error } = await db().from('org_memberships').insert({
      user_id: userId,
      org_id: expandedOrg,
      org_role: memberRole,
      is_default: false,
      created_at: new Date().toISOString(),
    })

    if (error) { showToast(`Failed to add member: ${error.message}`); setAddingMember(false); return }

    showToast('Member added')
    setAddingMember(false)
    setShowAddMember(false)
    setMemberEmail('')
    setMemberRole('member')
    loadMembers(expandedOrg)
    load() // refresh counts
  }

  // ── Change member role ─────────────────────────────────────────────────────

  const changeMemberRole = async (membershipId: string, newRole: OrgRole) => {
    const { error } = await db().from('org_memberships').update({ org_role: newRole }).eq('id', membershipId)
    if (error) { showToast('Role update failed'); return }
    showToast('Role updated')
    if (expandedOrg) loadMembers(expandedOrg)
  }

  // ── Remove member ──────────────────────────────────────────────────────────

  const removeMember = async (membershipId: string) => {
    if (!confirm('Remove this member from the organization?')) return
    const { error } = await db().from('org_memberships').delete().eq('id', membershipId)
    if (error) { showToast('Remove failed'); return }
    showToast('Member removed')
    if (expandedOrg) { loadMembers(expandedOrg); load() }
  }

  // ── Toggle active ──────────────────────────────────────────────────────────

  const toggleActive = async (org: Organization) => {
    const { error } = await db().from('organizations')
      .update({ active: !org.active, updated_at: new Date().toISOString() })
      .eq('id', org.id)
    if (error) { showToast('Toggle failed'); return }
    load()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isSuperAdmin) return <div className="text-gray-500 text-sm">Super admin access required.</div>

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[200] bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-xs text-green-400 shadow-xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search organizations..." />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as OrgType | '')}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white"
          >
            <option value="">All Types</option>
            {ORG_TYPES.map(t => (
              <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <button onClick={openNew}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-md transition-colors">
          + Add Organization
        </button>
      </div>

      {/* Summary */}
      <div className="flex gap-3 mb-4 shrink-0">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2">
          <div className="text-lg font-bold text-white">{orgs.length}</div>
          <div className="text-[10px] text-gray-500">Organizations</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2">
          <div className="text-lg font-bold text-green-400">{orgs.filter(o => o.active).length}</div>
          <div className="text-[10px] text-gray-500">Active</div>
        </div>
        {ORG_TYPES.map(t => {
          const count = orgs.filter(o => o.org_type === t).length
          if (!count) return null
          return (
            <div key={t} className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2">
              <div className="text-lg font-bold text-white">{count}</div>
              <div className="text-[10px] text-gray-500">{ORG_TYPE_LABELS[t]}</div>
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 z-10">
            <tr className="text-gray-500 text-left border-b border-gray-800">
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Domains</th>
              <th className="px-3 py-2 text-center">Members</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(org => (
              <>
                <tr key={org.id}
                  className={`border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors ${
                    expandedOrg === org.id ? 'bg-gray-800/40' : ''
                  }`}
                  onClick={() => toggleExpand(org.id)}
                >
                  <td className="px-3 py-2.5 text-gray-500">
                    {expandedOrg === org.id
                      ? <ChevronDown className="w-3.5 h-3.5" />
                      : <ChevronRight className="w-3.5 h-3.5" />
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-gray-500" />
                      <span className="font-medium text-white">{org.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-gray-400 font-mono">{org.slug}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${
                      ORG_TYPE_COLORS[org.org_type] ?? 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}>
                      {ORG_TYPE_LABELS[org.org_type] ?? org.org_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-400">
                    {(org.allowed_domains ?? []).length > 0
                      ? (org.allowed_domains ?? []).join(', ')
                      : <span className="text-gray-600">none</span>
                    }
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="inline-flex items-center gap-1 text-gray-300">
                      <Users className="w-3 h-3 text-gray-500" />
                      {org.member_count}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center" onClick={e => { e.stopPropagation(); toggleActive(org) }}>
                    <Badge active={org.active} />
                  </td>
                  <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(org)}
                        className="px-2 py-1 text-blue-400 hover:text-blue-300 hover:bg-gray-700 rounded transition-colors">
                        Edit
                      </button>
                      <button onClick={() => setConfirmDelete(org)}
                        className="p-1 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Expanded member panel */}
                {expandedOrg === org.id && (
                  <tr key={`${org.id}-members`}>
                    <td colSpan={8} className="bg-gray-850 border-b border-gray-800">
                      <div className="px-6 py-4 bg-gray-800/20">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-semibold text-white flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-gray-400" />
                            Members of {org.name}
                          </h3>
                          <button
                            onClick={() => { setShowAddMember(true); setMemberEmail(''); setMemberRole('member') }}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-green-400 hover:text-green-300 hover:bg-gray-700 rounded transition-colors"
                          >
                            <UserPlus className="w-3 h-3" /> Add Member
                          </button>
                        </div>

                        {/* Add member form */}
                        {showAddMember && (
                          <div className="flex items-end gap-2 mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                            <div className="flex-1">
                              <label className="text-[10px] text-gray-500 block mb-1">User Email</label>
                              <input
                                value={memberEmail}
                                onChange={e => setMemberEmail(e.target.value)}
                                placeholder="user@gomicrogridenergy.com"
                                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 block mb-1">Role</label>
                              <select
                                value={memberRole}
                                onChange={e => setMemberRole(e.target.value as OrgRole)}
                                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white"
                              >
                                {ORG_ROLES.map(r => (
                                  <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>
                                ))}
                              </select>
                            </div>
                            <button onClick={addMember} disabled={addingMember}
                              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors">
                              {addingMember ? 'Adding...' : 'Add'}
                            </button>
                            <button onClick={() => setShowAddMember(false)}
                              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {membersLoading ? (
                          <div className="text-gray-500 text-xs py-4 text-center">Loading members...</div>
                        ) : members.length === 0 ? (
                          <div className="text-gray-500 text-xs py-4 text-center">No members yet</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-500 text-left border-b border-gray-700">
                                <th className="px-3 py-1.5">Name</th>
                                <th className="px-3 py-1.5">Email</th>
                                <th className="px-3 py-1.5">Role</th>
                                <th className="px-3 py-1.5">Joined</th>
                                <th className="px-3 py-1.5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {members.map(m => (
                                <tr key={m.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                                  <td className="px-3 py-2 text-white font-medium">{m.user_name}</td>
                                  <td className="px-3 py-2 text-gray-400">{m.user_email}</td>
                                  <td className="px-3 py-2">
                                    <select
                                      value={m.org_role}
                                      onChange={e => changeMemberRole(m.id, e.target.value as OrgRole)}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer ${
                                        ORG_ROLE_COLORS[m.org_role] ?? 'bg-gray-800 text-gray-400'
                                      }`}
                                    >
                                      {ORG_ROLES.map(r => (
                                        <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2 text-gray-500">
                                    {new Date(m.created_at).toLocaleDateString()}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button onClick={() => removeMember(m.id)}
                                      className="p-1 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded transition-colors">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>

        {orgs.length === 0 && (
          <div className="text-gray-500 text-xs text-center py-8">
            {search || typeFilter ? 'No organizations match your filters' : 'No organizations yet'}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showNew && (
        <Modal title={editing ? 'Edit Organization' : 'Add Organization'} onClose={() => { setShowNew(false); setEditing(null) }}>
          <Input label="Name" value={draft.name} onChange={v => {
            setDraft(d => ({ ...d, name: v, ...(editing ? {} : { slug: slugify(v) }) }))
          }} />
          <Input
            label="Slug"
            value={draft.slug}
            onChange={v => setDraft(d => ({ ...d, slug: v }))}
            className={editing ? 'opacity-50 pointer-events-none' : ''}
          />
          {editing && <p className="text-[10px] text-gray-500 -mt-2">Slug cannot be changed after creation</p>}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Organization Type</label>
            <select
              value={draft.org_type}
              onChange={e => setDraft(d => ({ ...d, org_type: e.target.value as OrgType }))}
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              {ORG_TYPES.map(t => (
                <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <Input
            label="Allowed Domains (comma-separated)"
            value={draft.allowed_domains}
            onChange={v => setDraft(d => ({ ...d, allowed_domains: v }))}
          />
          <p className="text-[10px] text-gray-500 -mt-2">e.g. gomicrogridenergy.com, energydevelopmentgroup.com</p>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 font-medium">Active</label>
            <button
              onClick={() => setDraft(d => ({ ...d, active: !d.active }))}
              className={`relative w-9 h-5 rounded-full transition-colors ${draft.active ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${draft.active ? 'translate-x-4' : ''}`} />
            </button>
          </div>

          <div className="flex justify-end pt-2">
            <SaveBtn onClick={saveOrg} saving={saving} />
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <Modal title="Delete Organization" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-gray-300">
            Are you sure you want to delete <strong className="text-white">{confirmDelete.name}</strong>?
          </p>
          <p className="text-xs text-gray-500">
            This will also remove all memberships. Organizations with assigned projects cannot be deleted.
          </p>
          <div className="flex justify-end gap-2 pt-3">
            <button onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button onClick={() => deleteOrg(confirmDelete)}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-md transition-colors">
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
