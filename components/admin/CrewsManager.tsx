'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { Crew, Input, Modal, SaveBtn, Badge } from './shared'

export function CrewsManager() {
  const supabase = db()
  const [crews, setCrews] = useState<Crew[]>([])
  const [editing, setEditing] = useState<Crew | null>(null)
  const [draft, setDraft] = useState<Partial<Crew>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const { data: crewData } = await supabase.from('crews').select('*').order('name')
    setCrews(crewData ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('crews').update({
      name: draft.name,
      warehouse: draft.warehouse,
      active: draft.active,
      license_holder: draft.license_holder || null,
      electrician: draft.electrician || null,
      solar_lead: draft.solar_lead || null,
      battery_lead: draft.battery_lead || null,
      installer1: draft.installer1 || null,
      installer2: draft.installer2 || null,
      battery_tech1: draft.battery_tech1 || null,
      battery_tech2: draft.battery_tech2 || null,
      battery_apprentice: draft.battery_apprentice || null,
      mpu_electrician: draft.mpu_electrician || null,
    }).eq('id', editing.id)
    setSaving(false)
    if (error) { setToast('Save failed: ' + error.message); setTimeout(() => setToast(''), 3000); return }
    setEditing(null)
    setToast('Crew saved')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">Crews</h2>
        {/* NB: crews.active is stored as STRING 'TRUE'/'FALSE', not a boolean — see CLAUDE.md "Crews Table Quirk" */}
        <p className="text-xs text-gray-500 mt-0.5">{crews.filter(c => c.active === 'TRUE' || c.active === 'true').length} active crews</p>
      </div>

      <div className="grid grid-cols-1 gap-3 overflow-auto">
        {crews.map(crew => (
          <div key={crew.id} className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${crew.active === 'TRUE' || crew.active === 'true' ? 'bg-green-400' : 'bg-gray-600'}`} />
                <div>
                  <h3 className="text-sm font-semibold text-white">{crew.name}</h3>
                  <p className="text-xs text-gray-500">{crew.warehouse ? `Warehouse: ${crew.warehouse}` : 'No warehouse set'}</p>
                </div>
                <Badge active={crew.active === 'TRUE' || crew.active === 'true'} />
              </div>
              <button onClick={() => { setEditing(crew); setDraft({ ...crew }) }}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-md transition-colors">
                Edit
              </button>
            </div>
            {(() => {
              const roles = [
                { label: 'License Holder', value: crew.license_holder },
                { label: 'Electrician', value: crew.electrician },
                { label: 'Solar Lead', value: crew.solar_lead },
                { label: 'Battery Lead', value: crew.battery_lead },
                { label: 'Installer 1', value: crew.installer1 },
                { label: 'Installer 2', value: crew.installer2 },
                { label: 'Battery Tech 1', value: crew.battery_tech1 },
                { label: 'Battery Tech 2', value: crew.battery_tech2 },
                { label: 'Battery Apprentice', value: crew.battery_apprentice },
                { label: 'MPU Electrician', value: crew.mpu_electrician },
              ].filter(r => r.value)
              return roles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {roles.map(r => (
                    <div key={r.label} className="flex items-center gap-1.5 bg-gray-700/50 rounded-full px-2.5 py-1">
                      <span className="text-[10px] text-gray-500">{r.label}:</span>
                      <span className="text-xs text-gray-300">{r.value}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-600 italic">No members assigned</p>
            })()}
          </div>
        ))}
        {crews.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">No crews found</div>
        )}
      </div>

      {editing && (
        <Modal title={`Edit Crew — ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Crew Name" value={draft.name ?? ''} onChange={v => setDraft(d => ({ ...d, name: v }))} />
            <Input label="Warehouse" value={draft.warehouse ?? ''} onChange={v => setDraft(d => ({ ...d, warehouse: v }))} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox"
              checked={draft.active === 'TRUE' || draft.active === 'true'}
              onChange={e => setDraft(d => ({ ...d, active: e.target.checked ? 'TRUE' : 'FALSE' }))}
              className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500" />
            <span className="text-xs text-gray-300">Active</span>
          </label>
          <div className="border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-wide">Crew Members</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="License Holder" value={draft.license_holder ?? ''} onChange={v => setDraft(d => ({ ...d, license_holder: v }))} />
              <Input label="Electrician" value={draft.electrician ?? ''} onChange={v => setDraft(d => ({ ...d, electrician: v }))} />
              <Input label="Solar Lead" value={draft.solar_lead ?? ''} onChange={v => setDraft(d => ({ ...d, solar_lead: v }))} />
              <Input label="Battery Lead" value={draft.battery_lead ?? ''} onChange={v => setDraft(d => ({ ...d, battery_lead: v }))} />
              <Input label="Installer 1" value={draft.installer1 ?? ''} onChange={v => setDraft(d => ({ ...d, installer1: v }))} />
              <Input label="Installer 2" value={draft.installer2 ?? ''} onChange={v => setDraft(d => ({ ...d, installer2: v }))} />
              <Input label="Battery Tech 1" value={draft.battery_tech1 ?? ''} onChange={v => setDraft(d => ({ ...d, battery_tech1: v }))} />
              <Input label="Battery Tech 2" value={draft.battery_tech2 ?? ''} onChange={v => setDraft(d => ({ ...d, battery_tech2: v }))} />
              <Input label="Battery Apprentice" value={draft.battery_apprentice ?? ''} onChange={v => setDraft(d => ({ ...d, battery_apprentice: v }))} />
              <Input label="MPU Electrician" value={draft.mpu_electrician ?? ''} onChange={v => setDraft(d => ({ ...d, mpu_electrician: v }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditing(null)}
              className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors">
              Cancel
            </button>
            <SaveBtn onClick={save} saving={saving} />
          </div>
        </Modal>
      )}
    </div>
  )
}
