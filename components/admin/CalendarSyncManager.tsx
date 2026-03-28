'use client'

import { useState, useEffect, useCallback } from 'react'
import { db } from '@/lib/db'
import type { CalendarSettings, CalendarSyncEntry } from '@/lib/api/calendar'

interface CrewRow {
  id: string
  name: string
  active: string
}

export function CalendarSyncManager() {
  const [crews, setCrews] = useState<CrewRow[]>([])
  const [settings, setSettings] = useState<CalendarSettings[]>([])
  const [recentSyncs, setRecentSyncs] = useState<CalendarSyncEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null) // crew_id being synced
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [syncCounts, setSyncCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    const supabase = db()

    // Check if Google Calendar is configured
    try {
      const res = await fetch('/api/calendar/sync')
      const data = await res.json()
      setConfigured(data.configured ?? false)
    } catch {
      setConfigured(false)
    }

    // Load active crews
    const { data: crewData } = await supabase
      .from('crews')
      .select('id, name, active')
      .or('active.eq.TRUE,active.eq.true')
      .order('name', { ascending: true })
    setCrews((crewData as CrewRow[]) ?? [])

    // Load calendar settings
    const { data: settingsData } = await supabase
      .from('calendar_settings')
      .select('*')
      .order('crew_id', { ascending: true })
    setSettings((settingsData as CalendarSettings[]) ?? [])

    // Load recent sync entries
    const { data: syncData } = await supabase
      .from('calendar_sync')
      .select('*')
      .order('last_synced_at', { ascending: false })
      .limit(50)
    setRecentSyncs((syncData as CalendarSyncEntry[]) ?? [])

    // Count all synced entries per crew (separate query for accuracy)
    const { data: allSyncData } = await supabase
      .from('calendar_sync')
      .select('crew_id, sync_status')
      .eq('sync_status', 'synced')
    const counts: Record<string, number> = {}
    for (const entry of ((allSyncData ?? []) as { crew_id: string | null; sync_status: string }[])) {
      if (entry.crew_id) {
        counts[entry.crew_id] = (counts[entry.crew_id] ?? 0) + 1
      }
    }
    setSyncCounts(counts)

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const getSettingsForCrew = (crewId: string): CalendarSettings | undefined =>
    settings.find(s => s.crew_id === crewId)

  async function toggleEnabled(crewId: string) {
    const current = getSettingsForCrew(crewId)
    const newEnabled = !(current?.enabled ?? false)

    await db().from('calendar_settings').upsert({
      crew_id: crewId,
      enabled: newEnabled,
      auto_sync: current?.auto_sync ?? true,
      calendar_id: current?.calendar_id ?? null,
    }, { onConflict: 'crew_id' })

    load()
  }

  async function toggleAutoSync(crewId: string) {
    const current = getSettingsForCrew(crewId)
    const newAutoSync = !(current?.auto_sync ?? true)

    await db().from('calendar_settings').upsert({
      crew_id: crewId,
      auto_sync: newAutoSync,
      enabled: current?.enabled ?? false,
      calendar_id: current?.calendar_id ?? null,
    }, { onConflict: 'crew_id' })

    load()
  }

  async function handleFullSync(crewId: string) {
    setSyncing(crewId)
    try {
      const res = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crew_id: crewId, action: 'full_sync' }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Full sync failed:', data)
      }
    } catch (err) {
      console.error('Full sync error:', err)
    }
    setSyncing(null)
    load()
  }

  if (loading) {
    return <div className="text-gray-500 text-sm animate-pulse">Loading calendar settings...</div>
  }

  const errorSyncs = recentSyncs.filter(s => s.sync_status === 'error')
  const totalSynced = recentSyncs.filter(s => s.sync_status === 'synced').length

  return (
    <div className="h-full overflow-y-auto space-y-6">
      {/* Connection Status */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Google Calendar Connection</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">Status</p>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${configured ? 'bg-green-400' : 'bg-gray-500'}`} />
              <span className={`text-sm ${configured ? 'text-green-400' : 'text-gray-500'}`}>
                {configured ? 'Configured' : 'Not Configured'}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Events Synced</p>
            <p className="text-sm text-white font-medium">{totalSynced}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Sync Errors</p>
            <p className={`text-sm font-medium ${errorSyncs.length > 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {errorSyncs.length}
            </p>
          </div>
        </div>
        {!configured && (
          <p className="text-xs text-amber-400 mt-3 bg-amber-900/20 border border-amber-800/40 rounded px-3 py-2">
            Set the <code className="text-amber-300">GOOGLE_CALENDAR_CREDENTIALS</code> environment variable with your service account JSON to enable calendar sync.
          </p>
        )}
      </div>

      {/* Crew Calendar Settings */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Crew Calendars</h3>
        <div className="space-y-2">
          {crews.map(crew => {
            const crewSettings = getSettingsForCrew(crew.id)
            const enabled = crewSettings?.enabled ?? false
            const autoSync = crewSettings?.auto_sync ?? true
            const calendarId = crewSettings?.calendar_id
            const lastSync = crewSettings?.last_full_sync
            const syncCount = syncCounts[crew.id] ?? 0
            const isSyncing = syncing === crew.id

            return (
              <div key={crew.id} className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Enable/Disable toggle */}
                    <button
                      onClick={() => toggleEnabled(crew.id)}
                      disabled={!configured}
                      aria-label={`${enabled ? 'Disable' : 'Enable'} calendar sync for ${crew.name}`}
                      aria-checked={enabled}
                      role="switch"
                      className={`w-10 h-5 rounded-full transition-colors relative ${
                        enabled ? 'bg-green-600' : 'bg-gray-600'
                      } ${!configured ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </button>

                    <div>
                      <p className="text-sm font-medium text-white">{crew.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {calendarId && (
                          <span className="text-[10px] text-gray-500 font-mono truncate max-w-48">{calendarId}</span>
                        )}
                        {syncCount > 0 && (
                          <span className="text-[10px] text-gray-400">{syncCount} events synced</span>
                        )}
                        {lastSync && (
                          <span className="text-[10px] text-gray-500">
                            Last sync: {new Date(lastSync).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Auto-sync toggle */}
                    <label className="flex items-center gap-1.5 cursor-pointer" title="Auto-sync on schedule changes">
                      <input
                        type="checkbox"
                        checked={autoSync}
                        onChange={() => toggleAutoSync(crew.id)}
                        disabled={!configured || !enabled}
                        className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500 focus:ring-offset-0"
                      />
                      <span className="text-[10px] text-gray-400">Auto</span>
                    </label>

                    {/* Sync Now button */}
                    <button
                      onClick={() => handleFullSync(crew.id)}
                      disabled={!configured || !enabled || isSyncing}
                      className="px-3 py-1 text-[10px] font-medium rounded-md transition-colors
                        bg-blue-600 hover:bg-blue-500 text-white
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {crews.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">No active crews found.</p>
          )}
        </div>
      </div>

      {/* Recent Sync Activity */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Recent Sync Activity</h3>
        {recentSyncs.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No sync activity yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-1.5 px-2">Schedule</th>
                  <th className="text-left py-1.5 px-2">Status</th>
                  <th className="text-left py-1.5 px-2">Event ID</th>
                  <th className="text-left py-1.5 px-2">Synced</th>
                </tr>
              </thead>
              <tbody>
                {recentSyncs.slice(0, 20).map(entry => (
                  <tr key={entry.id} className="border-b border-gray-800/50">
                    <td className="py-1.5 px-2 text-gray-300 font-mono">{entry.schedule_id.slice(0, 8)}</td>
                    <td className="py-1.5 px-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        entry.sync_status === 'synced' ? 'bg-green-900/40 text-green-400' :
                        entry.sync_status === 'error' ? 'bg-red-900/40 text-red-400' :
                        'bg-amber-900/40 text-amber-400'
                      }`}>
                        {entry.sync_status}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-gray-500 font-mono truncate max-w-24">
                      {entry.event_id?.slice(0, 12)}
                    </td>
                    <td className="py-1.5 px-2 text-gray-500">
                      {new Date(entry.last_synced_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Error details */}
        {errorSyncs.length > 0 && (
          <div className="mt-3 bg-red-900/10 border border-red-800/30 rounded p-2">
            <p className="text-xs text-red-400 font-medium mb-1">Recent Errors</p>
            {errorSyncs.slice(0, 5).map(e => (
              <p key={e.id} className="text-[10px] text-red-300/70 truncate">
                {e.schedule_id.slice(0, 8)}: {e.error_message ?? 'Unknown error'}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
