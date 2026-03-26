'use client'

import { useState, useEffect } from 'react'
import { db } from '@/lib/db'
import { isEdgeConfigured, isEdgeSecretConfigured, getEdgeWebhookUrl, syncProjectToEdge } from '@/lib/api/edge-sync'
import { Input } from '@/components/admin/shared'

interface SyncLogEntry {
  id: string
  project_id: string
  event_type: string
  direction: string
  status: string
  response_code: number | null
  error_message: string | null
  created_at: string
}

export function EdgeIntegrationManager() {
  const [configured] = useState(isEdgeConfigured())
  const [secretConfigured] = useState(isEdgeSecretConfigured())
  const [webhookUrl] = useState(getEdgeWebhookUrl())
  const [recentLogs, setRecentLogs] = useState<SyncLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [syncProjectId, setSyncProjectId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  // Load recent sync logs
  useEffect(() => {
    async function load() {
      const supabase = db()
      const { data } = await supabase
        .from('edge_sync_log')
        .select('id, project_id, event_type, direction, status, response_code, error_message, created_at')
        .order('created_at', { ascending: false })
        .limit(20)
      setRecentLogs((data as SyncLogEntry[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function handleManualSync() {
    if (!syncProjectId.trim()) return
    setSyncing(true)
    setSyncResult(null)
    const ok = await syncProjectToEdge(syncProjectId.trim())
    setSyncResult(ok ? 'Sync sent successfully' : 'Sync failed — check logs')
    setSyncing(false)
    // Reload logs
    const supabase = db()
    const { data } = await supabase
      .from('edge_sync_log')
      .select('id, project_id, event_type, direction, status, response_code, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    setRecentLogs((data as SyncLogEntry[]) ?? [])
  }

  const lastSync = recentLogs.length > 0 ? recentLogs[0].created_at : null

  return (
    <div className="h-full overflow-y-auto space-y-6">
      {/* Connection Status */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Connection Status</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">Status</p>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${configured ? 'bg-green-400' : 'bg-gray-500'}`} />
              <span className={`text-sm ${configured ? 'text-green-400' : 'text-gray-500'}`}>
                {configured ? 'Connected' : 'Not Configured'}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Endpoint</p>
            <p className="text-sm text-gray-300 font-mono">{webhookUrl}</p>
          </div>
          {configured && !secretConfigured && (
            <div className="col-span-full bg-amber-900/30 border border-amber-800/50 rounded-lg px-3 py-2 text-xs text-amber-400">
              Warning: EDGE_WEBHOOK_SECRET is not set. Webhooks are unsigned and EDGE cannot verify authenticity. Set the secret in environment variables.
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 mb-1">Last Sync</p>
            <p className="text-sm text-gray-300">
              {lastSync ? new Date(lastSync).toLocaleString() : 'No syncs yet'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Recent Events</p>
            <p className="text-sm text-gray-300">{recentLogs.length} in log</p>
          </div>
        </div>
      </div>

      {/* Manual Sync */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Manual Sync</h3>
        <p className="text-xs text-gray-400 mb-3">Push a single project to EDGE Portal for one-off syncs.</p>
        <div className="flex gap-2 items-end">
          <Input
            label="Project ID"
            value={syncProjectId}
            onChange={setSyncProjectId}
            className="flex-1"
          />
          <button
            onClick={handleManualSync}
            disabled={syncing || !syncProjectId.trim() || !configured}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors whitespace-nowrap"
          >
            {syncing ? 'Syncing...' : 'Sync to EDGE'}
          </button>
        </div>
        {syncResult && (
          <p className={`text-xs mt-2 ${syncResult.includes('success') ? 'text-green-400' : 'text-red-400'}`}>
            {syncResult}
          </p>
        )}
        {!configured && (
          <p className="text-xs text-amber-400 mt-2">
            Set EDGE_WEBHOOK_URL environment variable to enable syncing.
          </p>
        )}
      </div>

      {/* Recent Sync Log */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Recent Sync Log</h3>
        {loading ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : recentLogs.length === 0 ? (
          <p className="text-xs text-gray-500">No sync events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 pr-3">Time</th>
                  <th className="text-left py-2 pr-3">Project</th>
                  <th className="text-left py-2 pr-3">Event</th>
                  <th className="text-left py-2 pr-3">Direction</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-left py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map(log => (
                  <tr key={log.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="py-2 pr-3 text-gray-300 font-mono">{log.project_id}</td>
                    <td className="py-2 pr-3 text-gray-300">{log.event_type}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        log.direction === 'outbound'
                          ? 'bg-blue-900/40 text-blue-400 border border-blue-800'
                          : 'bg-purple-900/40 text-purple-400 border border-purple-800'
                      }`}>
                        {log.direction === 'outbound' ? 'OUT' : 'IN'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        log.status === 'delivered' ? 'bg-green-900/40 text-green-400 border border-green-800' :
                        log.status === 'failed' ? 'bg-red-900/40 text-red-400 border border-red-800' :
                        'bg-gray-800 text-gray-400 border border-gray-700'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2 text-red-400 truncate max-w-[200px]">{log.error_message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
