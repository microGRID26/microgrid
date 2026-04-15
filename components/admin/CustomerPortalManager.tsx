'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { inviteCustomer } from '@/lib/api/customer-portal'
import type { CustomerAccount } from '@/lib/api/customer-portal'
import { Input, Modal, SaveBtn, SearchBar } from './shared'
import { UserPlus, ExternalLink } from 'lucide-react'

export function CustomerPortalManager() {
  const [accounts, setAccounts] = useState<CustomerAccount[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteProjectId, setInviteProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let q = db().from('customer_accounts').select('*').order('created_at', { ascending: false }).limit(500)
    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    const { data } = await q
    setAccounts((data ?? []) as CustomerAccount[])
    setLoading(false)
  }, [search])

  useEffect(() => { load() }, [load])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim() || !inviteProjectId.trim()) return
    setSaving(true)
    const account = await inviteCustomer(
      inviteEmail.trim(),
      inviteName.trim(),
      inviteProjectId.trim(),
      invitePhone.trim() || undefined,
      'Admin',
    )
    setSaving(false)
    if (account) {
      setShowInvite(false)
      setInviteEmail('')
      setInviteName('')
      setInvitePhone('')
      setInviteProjectId('')
      setToast('Customer invited')
      setTimeout(() => setToast(''), 2500)
      load()
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'active': return 'bg-green-900 text-green-300'
      case 'invited': return 'bg-blue-900 text-blue-300'
      case 'suspended': return 'bg-red-900 text-red-300'
      default: return 'bg-gray-700 text-gray-300'
    }
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Customer Portal</h2>
          <p className="text-xs text-gray-500 mt-0.5">{accounts.length} customer accounts</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-48">
            <SearchBar value={search} onChange={setSearch} placeholder="Search customers..." />
          </div>
          <button onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors">
            <UserPlus className="w-3.5 h-3.5" />
            Invite Customer
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-white">{accounts.length}</div>
          <div className="text-[10px] text-gray-500 uppercase">Total</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-green-400">{accounts.filter(a => a.status === 'active').length}</div>
          <div className="text-[10px] text-gray-500 uppercase">Active</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-blue-400">{accounts.filter(a => a.status === 'invited').length}</div>
          <div className="text-[10px] text-gray-500 uppercase">Invited</div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Name', 'Email', 'Project', 'Status', 'Last Login', 'Invited'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-600">Loading...</td></tr>
            ) : accounts.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-600">No customer accounts</td></tr>
            ) : accounts.map((a, i) => (
              <tr key={a.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                <td className="px-3 py-2 text-white font-medium">{a.name}</td>
                <td className="px-3 py-2 text-gray-400">{a.email}</td>
                <td className="px-3 py-2 text-blue-400 font-mono text-[10px]">{a.project_id}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor(a.status)}`}>
                    {a.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {a.last_login_at ? new Date(a.last_login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Portal Link */}
      <div className="mt-3 flex items-center justify-end">
        <a href="/portal/login" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-400 transition-colors">
          <ExternalLink className="w-3 h-3" />
          Open Customer Portal
        </a>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <Modal title="Invite Customer to Portal" onClose={() => setShowInvite(false)}>
          <Input label="Customer Email" value={inviteEmail} onChange={setInviteEmail} />
          <Input label="Customer Name" value={inviteName} onChange={setInviteName} />
          <Input label="Phone (optional)" value={invitePhone} onChange={setInvitePhone} />
          <Input label="Project ID" value={inviteProjectId} onChange={setInviteProjectId} />
          <p className="text-[10px] text-gray-500 mt-1">
            The customer will receive a magic link email to access their project dashboard.
          </p>
          <div className="flex justify-end gap-2 pt-3">
            <button onClick={() => setShowInvite(false)}
              className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors">
              Cancel
            </button>
            <SaveBtn onClick={handleInvite} saving={saving} />
          </div>
        </Modal>
      )}
    </div>
  )
}
