'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn, STAGE_LABELS, fmtDate, fmt$ } from '@/lib/utils'
import type { Project, Schedule, Crew } from '@/types/database'

const JOB_LABELS: Record<string, string> = {
  survey: 'Site Survey', install: 'Installation', inspection: 'Inspection', service: 'Service Call'
}

const JOB_BADGE: Record<string, string> = {
  survey: 'bg-blue-900 text-blue-200',
  install: 'bg-green-900 text-green-200',
  inspection: 'bg-amber-900 text-amber-200',
  service: 'bg-pink-900 text-pink-200',
}

const STATUS_BADGE: Record<string, string> = {
  complete: 'bg-green-900 text-green-300',
  scheduled: 'bg-blue-900 text-blue-300',
  in_progress: 'bg-amber-900 text-amber-300',
  cancelled: 'bg-gray-800 text-gray-500',
}

function Row({ label, value, href }: { label: string; value?: string | number | null; href?: string }) {
  if (value == null || value === '') return null
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-green-400 text-xs break-words hover:underline">
          {value}
        </a>
      ) : (
        <span className="text-gray-200 text-xs break-words">{value}</span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 pb-1 border-b border-gray-800">{title}</div>
      {children}
    </div>
  )
}

interface Props {
  scheduleId: string
  onClose: () => void
  onEdit: () => void
  onOpenProject: (project: Project) => void
}

export function JobBriefPanel({ scheduleId, onClose, onEdit, onOpenProject }: Props) {
  const supabase = createClient()

  // Lock background scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const [job, setJob] = useState<any>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [crewName, setCrewName] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      // Fetch the full schedule record (including new install detail fields)
      const { data: jobData } = await (supabase as any)
        .from('schedule')
        .select('*')
        .eq('id', scheduleId)
        .single()

      if (!jobData) { setLoading(false); return }
      setJob(jobData)

      // Fetch full project record
      if (jobData.project_id) {
        const { data: projData } = await supabase
          .from('projects')
          .select('*')
          .eq('id', jobData.project_id)
          .single()
        if (projData) setProject(projData as Project)
      }

      // Fetch crew name
      if (jobData.crew_id) {
        const { data: crewData } = await supabase
          .from('crews')
          .select('name')
          .eq('id', jobData.crew_id)
          .single() as any
        if (crewData) setCrewName(crewData.name)
      }

      setLoading(false)
    }
    load()
  }, [scheduleId])

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1 bg-black/50" onClick={onClose} />
        <div className="w-full max-w-lg bg-gray-950 flex items-center justify-center shadow-2xl">
          <div className="text-green-400 text-sm animate-pulse">Loading job brief...</div>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1 bg-black/50" onClick={onClose} />
        <div className="w-full max-w-lg bg-gray-950 flex items-center justify-center shadow-2xl">
          <div className="text-gray-500 text-sm">Job not found.</div>
        </div>
      </div>
    )
  }

  const p = project
  const jobType = job.job_type ?? 'survey'
  const status = job.status ?? 'scheduled'

  const address = p ? [p.address, p.city, p.zip].filter(Boolean).join(', ') : null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-lg bg-gray-950 flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gray-950 px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-white truncate">{p?.name ?? job.project_id}</h2>
              <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>{job.project_id}</span>
                <span>-</span>
                <span>{fmtDate(job.date)}</span>
                <span>-</span>
                <span>{crewName || 'Unassigned'}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl ml-4 flex-shrink-0">x</button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', JOB_BADGE[jobType] ?? 'bg-gray-800 text-gray-300')}>
              {JOB_LABELS[jobType] ?? jobType}
            </span>
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', STATUS_BADGE[status] ?? 'bg-gray-800 text-gray-300')}>
              {status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
            {p && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-green-400 font-medium">
                {STAGE_LABELS[p.stage] ?? p.stage}
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">

          {/* Customer */}
          <Section title="Customer">
            <Row label="Name" value={p?.name} />
            <Row label="Phone" value={p?.phone} href={p?.phone ? `tel:${p.phone.replace(/\D/g, '')}` : undefined} />
            <Row label="Email" value={p?.email} />
            <Row label="Address" value={address} href={address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : undefined} />
          </Section>

          {/* System */}
          {p && (
            <Section title="System">
              <Row label="System Size" value={p.systemkw ? `${p.systemkw} kW` : null} />
              <Row label="Panels" value={p.module_qty && p.module ? `${p.module_qty}x ${p.module}` : (p.module ?? null)} />
              <Row label="Inverter" value={p.inverter_qty && p.inverter ? `${p.inverter_qty}x ${p.inverter}` : (p.inverter ?? null)} />
              <Row label="Battery" value={p.battery_qty && p.battery ? `${p.battery_qty}x ${p.battery}` : (p.battery ?? null)} />
              <Row label="Financier" value={p.financier} />
            </Section>
          )}

          {/* Install Details (from schedule record) */}
          {jobType === 'install' && (
            <Section title="Install Details">
              <Row label="Arrival Window" value={job.arrival_window} />
              <Row label="Arrays" value={job.arrays} />
              <Row label="Pitch" value={job.pitch} />
              <Row label="Stories" value={job.stories} />
              <Row label="Special Equip." value={job.special_equipment} />
              <Row label="MSP Upgrade" value={job.msp_upgrade} />
              <Row label="WiFi Info" value={job.wifi_info} />
              <Row label="Wind Speed" value={job.wind_speed} />
              <Row label="Risk Category" value={job.risk_category} />
              <Row label="Travel Adder" value={job.travel_adder} />
              {job.electrical_notes && (
                <div className="mt-1">
                  <div className="text-gray-500 text-xs mb-1">Electrical Notes</div>
                  <div className="text-gray-200 text-xs bg-gray-900 rounded px-2 py-1.5 whitespace-pre-wrap">{job.electrical_notes}</div>
                </div>
              )}
            </Section>
          )}

          {/* PM & Team */}
          <Section title="PM & Team">
            <Row label="PM" value={p?.pm ?? job.pm} />
            <Row label="Consultant" value={p?.consultant} />
            <Row label="Advisor" value={p?.advisor} />
          </Section>

          {/* Notes */}
          {job.notes && (
            <Section title="Notes">
              <div className="text-gray-200 text-xs bg-gray-900 rounded px-2 py-1.5 whitespace-pre-wrap">{job.notes}</div>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={onEdit}
            className="text-xs px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
          >
            Edit Job
          </button>
          {p && (
            <button
              onClick={() => onOpenProject(p)}
              className="text-xs px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
            >
              Open Project
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-xs px-4 py-2 text-gray-400 hover:text-white">Close</button>
        </div>
      </div>
    </div>
  )
}
