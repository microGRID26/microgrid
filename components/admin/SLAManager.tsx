'use client'

import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { SLAThreshold, DEFAULT_SLA, STAGE_LABELS, SaveBtn } from './shared'

export function SLAManager() {
  const supabase = db()
  const [thresholds, setThresholds] = useState<SLAThreshold[]>(DEFAULT_SLA)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [tableExists, setTableExists] = useState<boolean | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase.from('sla_thresholds').select('*')
      if (error) {
        setTableExists(false)
      } else {
        setTableExists(true)
        if (data && data.length > 0) {
          setThresholds(data.map((row: any) => ({
            stage: row.stage,
            target: row.target,
            risk: row.risk,
            crit: row.crit,
          })))
        }
      }
    }
    init()
  }, [])

  const update = (stage: string, field: keyof SLAThreshold, val: number) => {
    setThresholds(ts => ts.map(t => t.stage === stage ? { ...t, [field]: val } : t))
  }

  const save = async () => {
    setSaving(true)
    if (!tableExists) {
      // Table doesn't exist yet — show instructions
      setToast('Create sla_thresholds table first (see console)')
      console.log(`
-- Run this in Supabase SQL editor:
CREATE TABLE sla_thresholds (
  stage text PRIMARY KEY,
  target integer NOT NULL,
  risk   integer NOT NULL,
  crit   integer NOT NULL
);
INSERT INTO sla_thresholds (stage, target, risk, crit) VALUES
  ('evaluation', 3,  4,  6),
  ('survey',     3,  5,  10),
  ('design',     3,  5,  10),
  ('permit',     21, 30, 45),
  ('install',    5,  7,  10),
  ('inspection', 14, 21, 30),
  ('complete',   3,  5,  7);
      `)
      setSaving(false)
      return
    }
    for (const t of thresholds) {
      const { error } = await supabase.from('sla_thresholds').upsert({
        stage: t.stage,
        target: t.target,
        risk: t.risk,
        crit: t.crit,
      }, { onConflict: 'stage' })
      if (error) { setSaving(false); setToast('Save failed: ' + error.message); setTimeout(() => setToast(''), 3000); return }
    }
    setSaving(false)
    setToast('SLA thresholds saved')
    setTimeout(() => setToast(''), 2500)
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">SLA Thresholds</h2>
          <p className="text-xs text-gray-500 mt-0.5">Days in stage before escalation</p>
        </div>
        {tableExists === false && (
          <span className="text-xs text-amber-400 border border-amber-800 bg-amber-900/20 px-3 py-1.5 rounded-md">
            sla_thresholds table not yet created — see console for SQL
          </span>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              <th className="text-left px-4 py-3 text-gray-400 font-medium w-40">Stage</th>
              <th className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-gray-400 font-medium">Target (days)</span>
                </div>
              </th>
              <th className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-gray-400 font-medium">Risk (days)</span>
                </div>
              </th>
              <th className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-gray-400 font-medium">Critical (days)</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {thresholds.map((t, i) => (
              <tr key={t.stage} className={`border-b border-gray-800/50 ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                    <span className="text-white font-medium">{STAGE_LABELS[t.stage]}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <input type="number" min={1} value={t.target}
                      onChange={e => update(t.stage, 'target', Number(e.target.value))}
                      className="w-20 text-center bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-green-400
                                 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <input type="number" min={1} value={t.risk}
                      onChange={e => update(t.stage, 'risk', Number(e.target.value))}
                      className="w-20 text-center bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-amber-400
                                 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <input type="number" min={1} value={t.crit}
                      onChange={e => update(t.stage, 'crit', Number(e.target.value))}
                      className="w-20 text-center bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-red-400
                                 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-4 bg-gray-800/30 border border-gray-700/50 rounded-lg">
        <p className="text-xs text-gray-500 leading-relaxed">
          <strong className="text-gray-400">How SLA colors work:</strong> A project at a stage shows
          <span className="text-green-400 mx-1">green</span> under Target days,
          <span className="text-amber-400 mx-1">amber</span> between Target and Risk,
          <span className="text-red-400 mx-1">red</span> beyond Risk, and
          <span className="text-red-600 mx-1">flashing red</span> at Critical. Changes here update all views that use SLA coloring.
        </p>
      </div>

      <div className="flex justify-end mt-4">
        <SaveBtn onClick={save} saving={saving} />
      </div>
    </div>
  )
}
