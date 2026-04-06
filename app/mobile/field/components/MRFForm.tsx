import { useState } from 'react'
import { createMaterialRequest } from '@/lib/api/material-requests'

interface MRFFormProps {
  projectId: string
  projectName: string
  scheduleId?: string | null
  crewName: string | null
  requestedBy: string
  onComplete: () => void
  onCancel: () => void
}

interface ItemRow {
  description: string
  quantity: number
  unit: string
  notes: string
}

const COMMON_UNITS = ['ea', 'ft', 'roll', 'box', 'set', 'pair', 'bag']

export function MRFForm({ projectId, projectName, scheduleId, crewName, requestedBy, onComplete, onCancel }: MRFFormProps) {
  const [items, setItems] = useState<ItemRow[]>([
    { description: '', quantity: 1, unit: 'ea', notes: '' },
  ])
  const [neededBy, setNeededBy] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const addRow = () => setItems(prev => [...prev, { description: '', quantity: 1, unit: 'ea', notes: '' }])
  const removeRow = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i))
  const updateRow = (i: number, field: keyof ItemRow, value: string | number) => {
    setItems(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  const validItems = items.filter(i => i.description.trim())

  const handleSubmit = async () => {
    if (validItems.length === 0 || saving) return
    setSaving(true)
    const id = await createMaterialRequest({
      project_id: projectId,
      schedule_id: scheduleId,
      requested_by: requestedBy,
      crew_name: crewName,
      notes: notes.trim() || null,
      needed_by: neededBy || null,
      items: validItems.map(i => ({
        description: i.description.trim(),
        quantity: i.quantity,
        unit: i.unit,
        notes: i.notes.trim() || undefined,
      })),
    })
    setSaving(false)
    if (id) onComplete()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900/98 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Material Request</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">{projectName}</p>
          </div>
          <button onClick={onCancel} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 active:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4 pb-32">
        {/* Job info */}
        <div className="bg-gray-800 rounded-xl p-3 flex justify-between text-sm">
          <div>
            <span className="text-gray-500 text-xs">Requested by</span>
            <div className="text-white">{requestedBy}</div>
          </div>
          {crewName && (
            <div className="text-right">
              <span className="text-gray-500 text-xs">Crew</span>
              <div className="text-white">{crewName}</div>
            </div>
          )}
        </div>

        {/* Needed by date */}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Needed By (optional)</label>
          <input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-green-500" />
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">Items</h3>
            <button onClick={addRow} className="text-xs text-green-400 active:text-green-300 px-3 py-1.5 bg-green-900/30 rounded-lg">+ Add Item</button>
          </div>
          <div className="space-y-3">
            {items.map((row, i) => (
              <div key={i} className="bg-gray-800 rounded-xl p-3 space-y-2 relative">
                {items.length > 1 && (
                  <button onClick={() => removeRow(i)} className="absolute top-2 right-2 text-gray-600 active:text-red-400 min-w-[32px] min-h-[32px] flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                )}
                <input value={row.description} onChange={e => updateRow(i, 'description', e.target.value)}
                  placeholder="Item description (e.g., 3/4&quot; coupling)"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500" />
                <div className="flex gap-2">
                  <div className="w-20">
                    <label className="text-[9px] text-gray-600">Qty</label>
                    <input type="number" min={1} value={row.quantity} onChange={e => updateRow(i, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-green-500" />
                  </div>
                  <div className="w-24">
                    <label className="text-[9px] text-gray-600">Unit</label>
                    <select value={row.unit} onChange={e => updateRow(i, 'unit', e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white">
                      {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] text-gray-600">Note</label>
                    <input value={row.notes} onChange={e => updateRow(i, 'notes', e.target.value)}
                      placeholder="Optional"
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Additional Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Special instructions for Danny..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none focus:outline-none focus:border-green-500" />
        </div>
      </div>

      {/* Fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-400 bg-gray-800 active:bg-gray-700">Cancel</button>
          <button onClick={handleSubmit} disabled={validItems.length === 0 || saving}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-white bg-green-700 active:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500">
            {saving ? 'Submitting...' : `Submit MRF (${validItems.length} item${validItems.length !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>
    </div>
  )
}
