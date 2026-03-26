'use client'

import React from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AHJ {
  id: number
  name: string
  permit_phone: string | null
  permit_website: string | null
  max_duration: number | null
  electric_code: string | null
  permit_notes: string | null
  username: string | null
  password: string | null
}

export interface Utility {
  id: number
  name: string
  phone: string | null
  website: string | null
  notes: string | null
}

export interface HOA {
  id: number
  name: string
  phone: string | null
  website: string | null
  contact_name: string | null
  contact_email: string | null
  notes: string | null
}

export type UserRole = 'super_admin' | 'admin' | 'finance' | 'manager' | 'user' | 'sales'

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  finance: 'Finance',
  manager: 'Manager',
  user: 'User',
  sales: 'Sales',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-red-900/40 text-red-400 border-red-800',
  admin: 'bg-amber-900/40 text-amber-400 border-amber-800',
  finance: 'bg-blue-900/40 text-blue-400 border-blue-800',
  manager: 'bg-purple-900/40 text-purple-400 border-purple-800',
  user: 'bg-gray-800 text-gray-400 border-gray-700',
  sales: 'bg-emerald-900/40 text-emerald-400 border-emerald-800',
}

export interface User {
  id: string
  name: string
  email: string
  department: string | null
  position: string | null
  role: UserRole
  admin: boolean
  active: boolean
  color: string | null
  crew?: string | null
}

export interface Crew {
  id: string
  name: string
  warehouse: string | null
  active: string
  license_holder: string | null
  electrician: string | null
  solar_lead: string | null
  battery_lead: string | null
  installer1: string | null
  installer2: string | null
  battery_tech1: string | null
  battery_tech2: string | null
  battery_apprentice: string | null
  mpu_electrician: string | null
}

export interface SLAThreshold {
  stage: string
  target: number
  risk: number
  crit: number
}

export interface CRMStats {
  projects: number
  ahjs: number
  utilities: number
  hoas: number
  users: number
  crews: number
  serviceCalls: number
}

export type Module = 'ahj' | 'utility' | 'hoa' | 'financier' | 'equipment' | 'vendors' | 'users' | 'crews' | 'sla' | 'info' | 'releases' | 'feedback' | 'audit' | 'permissions' | 'notifications' | 'queue_config' | 'reasons' | 'doc_requirements' | 'edge_integration'

export const DEPARTMENTS = [
  'Inside Operations', 'Sales', 'Executive', 'Field Operations',
  'Funding', 'Payroll', 'HR', 'Accounting', 'Dealer',
]

export const STAGE_ORDER = ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete']
export const STAGE_LABELS: Record<string, string> = {
  evaluation: 'Evaluation', survey: 'Site Survey', design: 'Design',
  permit: 'Permitting', install: 'Installation', inspection: 'Inspection', complete: 'Complete',
}

export const DEFAULT_SLA: SLAThreshold[] = [
  { stage: 'evaluation', target: 3,  risk: 4,  crit: 6  },
  { stage: 'survey',     target: 3,  risk: 5,  crit: 10 },
  { stage: 'design',     target: 3,  risk: 5,  crit: 10 },
  { stage: 'permit',     target: 21, risk: 30, crit: 45 },
  { stage: 'install',    target: 5,  risk: 7,  crit: 10 },
  { stage: 'inspection', target: 14, risk: 21, crit: 30 },
  { stage: 'complete',   target: 3,  risk: 5,  crit: 7  },
]

export const AVATAR_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#64748b',
]

export interface NotificationRule {
  id: string
  task_id: string
  trigger_status: string
  trigger_reason: string | null
  action_type: string
  action_message: string
  notify_role: string | null
  active: boolean
  created_by: string | null
}

export interface QueueSection {
  id: string
  label: string
  task_id: string
  match_status: string
  color: string
  icon: string
  sort_order: number
  active: boolean
}

export interface AuditChange {
  id: string
  project_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_by_id: string | null
  changed_at: string
}

export type AuditTab = 'sessions' | 'changes'
export type DateRange = 'today' | '7days' | '30days' | 'all'

// ── Shared UI ─────────────────────────────────────────────────────────────────

export function Input({ label, value, onChange, type = 'text', className = '' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; className?: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                   focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
      />
    </div>
  )
}

export function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                   focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
      />
    </div>
  )
}

export function Badge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      active ? 'bg-green-900/40 text-green-400 border border-green-800' : 'bg-gray-800 text-gray-500 border border-gray-700'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const modalId = React.useId()
  const titleId = `${modalId}-title`

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 id={titleId} className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">{children}</div>
      </div>
    </div>
  )
}

export function SaveBtn({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors">
      {saving ? 'Saving…' : 'Save'}
    </button>
  )
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-white
                   placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  )
}

// ── Helper functions ──────────────────────────────────────────────────────────

export function formatDuration(startStr: string, endStr: string): string {
  const start = new Date(startStr).getTime()
  const end = new Date(endStr).getTime()
  if (isNaN(start) || isNaN(end)) return '—'
  const diffMs = Math.max(0, end - start)
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0 && minutes === 0) return '<1m'
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function isOnline(lastActive: string): boolean {
  const diff = Date.now() - new Date(lastActive).getTime()
  return diff < 5 * 60 * 1000
}

export function getDateRangeStart(range: DateRange): string | null {
  if (range === 'all') return null
  const now = new Date()
  if (range === 'today') {
    now.setHours(0, 0, 0, 0)
  } else if (range === '7days') {
    now.setDate(now.getDate() - 7)
  } else if (range === '30days') {
    now.setDate(now.getDate() - 30)
  }
  return now.toISOString()
}

// ── Sidebar items ─────────────────────────────────────────────────────────────

export const SIDEBAR_ITEMS: { id: Module; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    id: 'ahj', label: 'AHJ Manager', desc: '1,633 AHJs',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  },
  {
    id: 'utility', label: 'Utility Manager', desc: '203 utilities',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  },
  {
    id: 'hoa' as Module, label: 'HOA Manager', desc: 'HOA records',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  },
  {
    id: 'financier' as Module, label: 'Financier Manager', desc: 'Financier records',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  },
  {
    id: 'equipment' as Module, label: 'Equipment Catalog', desc: 'Modules, inverters, batteries',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>,
  },
  {
    id: 'vendors' as Module, label: 'Vendor Manager', desc: 'Suppliers & contractors',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17l4 4 4-4m-4-5v9M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29" /></svg>,
  },
  {
    id: 'users', label: 'Users', desc: 'Team members',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  },
  {
    id: 'crews', label: 'Crews', desc: '5 active crews',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  },
  {
    id: 'sla', label: 'SLA Thresholds', desc: '7 stages',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  },
  {
    id: 'info', label: 'CRM Info', desc: 'Live stats',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  },
  {
    id: 'releases', label: 'Release Notes', desc: 'Version history',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  },
  {
    id: 'feedback', label: 'Feedback', desc: 'User feedback',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>,
  },
  {
    id: 'permissions', label: 'Permissions', desc: 'Role access matrix',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  },
  {
    id: 'notifications', label: 'Notification Rules', desc: 'Task triggers',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>,
  },
  {
    id: 'queue_config', label: 'Queue Config', desc: 'Queue sections',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>,
  },
  {
    id: 'audit', label: 'Audit Trail', desc: 'Sessions & changes',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
  },
  {
    id: 'reasons' as Module, label: 'Reasons Manager', desc: 'Task reasons config',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>,
  },
  {
    id: 'doc_requirements' as Module, label: 'Document Requirements', desc: 'Required documents per stage',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  },
  {
    id: 'edge_integration' as Module, label: 'EDGE Integration', desc: 'NOVA ↔ EDGE sync',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>,
  },
]
