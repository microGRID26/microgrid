'use client'

import { useState } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { Module, SYSTEM_SIDEBAR_ITEMS } from '@/components/admin/shared'
import { CRMInfo } from '@/components/admin/CRMInfo'
import { ReleaseNotes } from '@/components/admin/ReleaseNotes'
import { FeedbackManager } from '@/components/admin/FeedbackManager'
import { NotificationRulesManager } from '@/components/admin/NotificationRulesManager'
import { AuditTrailManager } from '@/components/admin/AuditTrailManager'
import { ReasonsManager } from '@/components/admin/ReasonsManager'
import { EdgeIntegrationManager } from '@/components/admin/EdgeIntegrationManager'
import { CalendarSyncManager } from '@/components/admin/CalendarSyncManager'
import { FeatureFlagManager } from '@/components/admin/FeatureFlagManager'
import { OrgManager } from '@/components/admin/OrgManager'

export default function SystemPage() {
  const { user: authUser, loading } = useCurrentUser()
  const isSuperAdmin = authUser?.isSuperAdmin ?? false
  const [activeModule, setActiveModule] = useState<Module>('organizations')

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Checking permissions…</div>
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <Nav active="System" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-white mb-2">Super Admin Access Required</h1>
            <p className="text-sm text-gray-500">Only super admins can access system settings.</p>
            <a href="/admin" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              ← Back to Admin
            </a>
          </div>
        </div>
      </div>
    )
  }

  const activeItem = SYSTEM_SIDEBAR_ITEMS.find(s => s.id === activeModule)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Nav active="System" />

      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="px-4 py-4 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-red-900/40 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">System</p>
                <p className="text-[10px] text-red-400/70">Super Admin Only</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {SYSTEM_SIDEBAR_ITEMS.map(item => (
              <button key={item.id} onClick={() => setActiveModule(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  activeModule === item.id
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}>
                <span className={activeModule === item.id ? 'text-white' : 'text-gray-500'}>{item.icon}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{item.label}</p>
                  <p className="text-[10px] text-gray-500">{item.desc}</p>
                </div>
              </button>
            ))}
          </nav>

          <div className="p-2 border-t border-gray-800 space-y-0.5">
            <a href="/admin" className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div><p className="text-xs font-medium">Admin</p><p className="text-[10px] text-gray-500">Back to admin</p></div>
            </a>
            <div className="text-[10px] text-gray-600 text-center pt-2">
              Super admin only · {authUser?.name?.split(' ')[0] ?? ''}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="border-b border-gray-800 px-6 py-3 flex items-center gap-2">
            <span className="text-gray-500">{activeItem?.icon}</span>
            <h1 className="text-sm font-semibold text-white">{activeItem?.label}</h1>
          </div>
          <div className="flex-1 overflow-hidden p-6">
            {activeModule === 'organizations' && <OrgManager isSuperAdmin={isSuperAdmin} />}
            {activeModule === 'feature_flags' && <FeatureFlagManager isSuperAdmin={isSuperAdmin} />}
            {activeModule === 'calendar_sync' && <CalendarSyncManager />}
            {activeModule === 'edge_integration' && <EdgeIntegrationManager />}
            {activeModule === 'audit'    && <AuditTrailManager />}
            {activeModule === 'notifications' && <NotificationRulesManager />}
            {activeModule === 'reasons'  && <ReasonsManager isSuperAdmin={isSuperAdmin} />}
            {activeModule === 'feedback' && <FeedbackManager isSuperAdmin={isSuperAdmin} />}
            {activeModule === 'info'    && <CRMInfo />}
            {activeModule === 'releases' && <ReleaseNotes />}
          </div>
        </main>
      </div>
    </div>
  )
}
