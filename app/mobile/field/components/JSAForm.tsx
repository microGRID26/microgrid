import { useState } from 'react'
import { createJSA } from '@/lib/api/jsa'

interface JSAFormProps {
  scheduleId: string
  projectId: string
  projectName: string
  crewLead: string
  crewName: string | null
  onComplete: () => void
  onCancel: () => void
}

interface ActivityRow {
  activity: string
  hazards: string
  controls: string
}

export function JSAForm({ scheduleId, projectId, projectName, crewLead, crewName, onComplete, onCancel }: JSAFormProps) {
  const [activities, setActivities] = useState<ActivityRow[]>([
    { activity: '', hazards: '', controls: '' },
  ])
  const [crewMembers, setCrewMembers] = useState<string[]>([crewLead])
  const [newMember, setNewMember] = useState('')
  const [saving, setSaving] = useState(false)

  const addRow = () => setActivities(prev => [...prev, { activity: '', hazards: '', controls: '' }])
  const removeRow = (i: number) => setActivities(prev => prev.filter((_, idx) => idx !== i))
  const updateRow = (i: number, field: keyof ActivityRow, value: string) => {
    setActivities(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  const addMember = () => {
    if (newMember.trim() && !crewMembers.includes(newMember.trim())) {
      setCrewMembers(prev => [...prev, newMember.trim()])
      setNewMember('')
    }
  }

  const removeMember = (name: string) => {
    if (name === crewLead) return // Can't remove lead
    setCrewMembers(prev => prev.filter(m => m !== name))
  }

  const hasContent = activities.some(a => a.activity.trim())

  const handleSubmit = async () => {
    if (!hasContent || saving) return
    setSaving(true)
    const jsaId = await createJSA({
      schedule_id: scheduleId,
      project_id: projectId,
      crew_lead: crewLead,
      crew_name: crewName,
      site_name: projectName,
      activities: activities.filter(a => a.activity.trim()),
      crewMembers,
    })
    setSaving(false)
    if (jsaId) onComplete()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900/98 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Job Safety Analysis</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Complete before starting work</p>
          </div>
          <button onClick={onCancel} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 active:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-5 pb-32">
        {/* Job Info (read-only) */}
        <div className="bg-gray-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Site</span>
            <span className="text-sm text-white font-medium">{projectName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Crew Lead</span>
            <span className="text-sm text-white">{crewLead}</span>
          </div>
          {crewName && (
            <div className="flex justify-between">
              <span className="text-xs text-gray-500">Crew</span>
              <span className="text-sm text-white">{crewName}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Date</span>
            <span className="text-sm text-white">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
        </div>

        {/* Activities Table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">Hazard Analysis</h3>
            <button onClick={addRow} className="text-xs text-green-400 active:text-green-300 px-3 py-1.5 bg-green-900/30 rounded-lg">+ Add Row</button>
          </div>
          <div className="space-y-3">
            {activities.map((row, i) => (
              <div key={i} className="bg-gray-800 rounded-xl p-3 space-y-2 relative">
                {activities.length > 1 && (
                  <button onClick={() => removeRow(i)} className="absolute top-2 right-2 text-gray-600 active:text-red-400 min-w-[32px] min-h-[32px] flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                )}
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Activity / Task</label>
                  <input value={row.activity} onChange={e => updateRow(i, 'activity', e.target.value)}
                    placeholder="e.g., Panel installation on roof"
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Hazards</label>
                  <input value={row.hazards} onChange={e => updateRow(i, 'hazards', e.target.value)}
                    placeholder="e.g., Fall from height, electrical shock"
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Risk Control Measures</label>
                  <input value={row.controls} onChange={e => updateRow(i, 'controls', e.target.value)}
                    placeholder="e.g., Harness required, lockout/tagout"
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Crew Acknowledgement */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2">Crew Acknowledgement</h3>
          <p className="text-[10px] text-gray-500 mb-3">All crew members acknowledge they have reviewed the hazards and controls for this job.</p>
          <div className="space-y-2">
            {crewMembers.map(name => (
              <div key={name} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2.5">
                <div className="w-5 h-5 rounded border-2 bg-green-600 border-green-500 flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </div>
                <span className="text-sm text-white flex-1">{name}</span>
                {name === crewLead && <span className="text-[10px] text-green-400 bg-green-900/30 px-2 py-0.5 rounded">Lead</span>}
                {name !== crewLead && (
                  <button onClick={() => removeMember(name)} className="text-gray-600 active:text-red-400 min-w-[32px] min-h-[32px] flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input value={newMember} onChange={e => setNewMember(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addMember() }}
              placeholder="Add crew member name..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500" />
            <button onClick={addMember} disabled={!newMember.trim()}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-gray-800 border border-gray-700 rounded-lg text-green-400 active:bg-gray-700 disabled:text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-400 bg-gray-800 active:bg-gray-700">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!hasContent || saving}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-white bg-green-700 active:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500">
            {saving ? 'Saving...' : 'Complete JSA & Start Job'}
          </button>
        </div>
      </div>
    </div>
  )
}
