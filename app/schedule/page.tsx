'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { ScheduleAssignModal } from '@/components/project/ScheduleAssignModal'
import type { Project, Schedule, Crew } from '@/types/database'

const JOB_COLORS: Record<string, { bg: string; text: string }> = {
  survey:     { bg: 'bg-blue-900',   text: 'text-blue-200'   },
  install:    { bg: 'bg-green-900',  text: 'text-green-200'  },
  inspection: { bg: 'bg-amber-900',  text: 'text-amber-200'  },
  service:    { bg: 'bg-pink-900',   text: 'text-pink-200'   },
}

const JOB_LABELS: Record<string, string> = {
  survey: 'Site Survey', install: 'Installation', inspection: 'Inspection', service: 'Service Call'
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat']

function getWeekDates(offset: number): Date[] {
  const base = new Date()
  const dow = base.getDay()
  const monday = new Date(base)
  monday.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h)) return ''
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  return m ? `${hr}:${String(m).padStart(2, '0')}${ampm}` : `${hr}${ampm}`
}

export default function SchedulePage() {
  const supabase = createClient()
  const [crews, setCrews] = useState<Crew[]>([])
  const [schedule, setSchedule] = useState<Schedule[]>([])
  const [projectMap, setProjectMap] = useState<Record<string, Project>>({})
  const [weekOffset, setWeekOffset] = useState(0)
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [jobFilter, setJobFilter] = useState('all')
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [assignModal, setAssignModal] = useState<{
    crewId: string | null
    date: string
    scheduleId: string | null
    projectId: string | null
    jobType: string
  } | null>(null)

  const loadData = useCallback(async () => {
    const [crewRes, schedRes, projRes] = await Promise.all([
      supabase.from('crews').select('*').eq('active', 'TRUE').order('name'),
      supabase.from('schedule').select('*'),
      supabase.from('projects').select('id, name, city, stage, stage_date, pm, blocker, contract, financier, phone, email, address, systemkw, ahj, utility, advisor, consultant, sale_date, ntp_date, permit_number, module, module_qty, inverter, inverter_qty, battery, battery_qty, optimizer, optimizer_qty, meter_location, panel_location, voltage, msp_bus_rating, mpu, shutdown, performance_meter, interconnection_breaker, main_breaker, hoa, esid, utility_app_number, permit_fee, city_permit_date, utility_permit_date, survey_scheduled_date, survey_date, install_scheduled_date, install_complete_date, city_inspection_date, utility_inspection_date, pto_date, in_service_date, site_surveyor, consultant_email, dealer, financing_type, down_payment, tpo_escalator, financier_adv_pmt, disposition, loyalty, created_at'),
    ])

    if (crewRes.data) setCrews(crewRes.data as Crew[])
    if (schedRes.data) setSchedule(schedRes.data as Schedule[])
    if (projRes.data) {
      const map: Record<string, Project> = {}
      projRes.data.forEach((p: any) => { map[p.id] = p as Project })
      setProjectMap(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const days = getWeekDates(weekOffset)
  const todayIso = isoDate(new Date())
  const weekLabel = `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[5].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const warehouses = [...new Set(crews.map(c => c.warehouse).filter(Boolean))].sort() as string[]
  const filteredCrews = warehouseFilter === 'all' ? crews : crews.filter(c => c.warehouse === warehouseFilter)

  // Build schedule map: crewId|date -> jobs[]
  const schedMap: Record<string, Schedule[]> = {}
  schedule.forEach(s => {
    if (!s.crew_id || !s.date) return
    const key = `${s.crew_id}|${s.date}`
    if (!schedMap[key]) schedMap[key] = []
    schedMap[key].push(s)
  })
  Object.values(schedMap).forEach(arr => arr.sort((a, b) => (a.time ?? '99:99') > (b.time ?? '99:99') ? 1 : -1))

  function jobsFor(crewId: string, date: string): Schedule[] {
    const all = schedMap[`${crewId}|${date}`] ?? []
    if (jobFilter === 'all') return all
    return all.filter(j => j.job_type === jobFilter)
  }

  const totalJobs = filteredCrews.reduce((sum, crew) =>
    sum + days.reduce((s, d) => s + jobsFor(crew.id, isoDate(d)).length, 0), 0)

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading schedule...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Nav */}
      <nav className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 sticky top-0 z-50 flex-shrink-0">
        <span className="text-green-400 font-bold text-base mr-2">MicroGRID</span>
        {[
          { label: 'Command',  href: '/command'  },
          { label: 'Queue',    href: '/queue'    },
          { label: 'Pipeline', href: '/pipeline' },
          { label: 'Analytics',href: '/analytics'},
          { label: 'Audit',    href: '/audit'    },
          { label: 'Schedule', href: '/schedule' },
          { label: 'Service',  href: '/service'  },
          { label: 'Funding',  href: '/funding'  },
        ].map(v => (
          <a key={v.label} href={v.href}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${v.label === 'Schedule' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            {v.label}
          </a>
        ))}
        <a href="/admin"
          className="text-xs px-3 py-1.5 rounded-md transition-colors text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Admin
        </a>

        <div className="ml-auto text-xs text-gray-500">{totalJobs} jobs this week</div>
      </nav>

      {/* Controls */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-3 px-4 py-2 flex-shrink-0">
        <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white text-sm px-2">◀</button>
        <span className="text-xs text-white font-medium">{weekLabel}</span>
        <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white text-sm px-2">▶</button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="text-xs text-green-400 hover:text-green-300">Today</button>
        )}
        <div className="ml-4 flex items-center gap-2">
          <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All Warehouses</option>
            {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <select value={jobFilter} onChange={e => setJobFilter(e.target.value)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All Job Types</option>
            {Object.entries(JOB_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {/* Legend */}
        <div className="ml-auto flex items-center gap-3">
          {Object.entries(JOB_LABELS).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-sm ${JOB_COLORS[k]?.bg}`} />
              <span className="text-xs text-gray-400">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse min-w-max">
          <thead>
            <tr className="bg-gray-950 sticky top-0 z-10">
              <th className="text-xs text-gray-400 font-medium text-left px-3 py-2 border-b border-r border-gray-800 w-32">Crew</th>
              {days.map((d, i) => {
                const iso = isoDate(d)
                const isToday = iso === todayIso
                return (
                  <th key={i} className={`text-xs font-medium text-left px-3 py-2 border-b border-r border-gray-800 min-w-36 ${isToday ? 'text-green-400' : 'text-gray-400'}`}>
                    <div>{DAYS[i]}</div>
                    <div className={`text-xs font-normal ${isToday ? 'text-green-400' : 'text-gray-500'}`}>
                      {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredCrews.map(crew => (
              <tr key={crew.id} className="border-b border-gray-800 hover:bg-gray-850">
                <td className="px-3 py-2 border-r border-gray-800 align-top">
                  <div className="text-xs font-medium text-white">{crew.name}</div>
                  {crew.warehouse && <div className="text-xs text-gray-500">{crew.warehouse}</div>}
                </td>
                {days.map((d, i) => {
                  const iso = isoDate(d)
                  const isToday = iso === todayIso
                  const jobs = jobsFor(crew.id, iso)
                  return (
                    <td key={i}
                      onClick={() => setAssignModal({ crewId: crew.id, date: iso, scheduleId: null, projectId: null, jobType: 'install' })}
                      className={`px-2 py-2 border-r border-gray-800 align-top min-h-16 cursor-pointer hover:bg-gray-800/50 transition-colors ${isToday ? 'bg-green-950/20' : ''}`}>
                      {jobs.map(job => {
                        const p = projectMap[job.project_id]
                        const colors = JOB_COLORS[job.job_type] ?? { bg: 'bg-gray-800', text: 'text-gray-300' }
                        return (
                          <div
                            key={job.id}
                            onClick={e => { e.stopPropagation(); setAssignModal({ crewId: crew.id, date: iso, scheduleId: job.id, projectId: job.project_id, jobType: job.job_type }) }}
                            className={`${colors.bg} ${colors.text} rounded px-2 py-1 mb-1 cursor-pointer hover:opacity-80 transition-opacity`}
                          >
                            {job.time && <div className="text-xs font-bold opacity-90">{fmtTime(job.time)}</div>}
                            <div className="text-xs font-semibold truncate max-w-32">{p?.name ?? job.project_id}</div>
                            <div className="text-xs opacity-70 uppercase tracking-wide">{JOB_LABELS[job.job_type] ?? job.job_type}</div>
                            {p?.city && <div className="text-xs opacity-60">{p.city}</div>}
                            {job.notes && <div className="text-xs opacity-60 truncate">{job.notes}</div>}
                          </div>
                        )
                      })}
                    </td>
                  )
                })}
              </tr>
            ))}
            {filteredCrews.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-500 text-sm">No crews found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedProject && (
        <ProjectPanel project={selectedProject} onClose={() => setSelectedProject(null)} onProjectUpdated={loadData} />
      )}

      {assignModal && (
        <ScheduleAssignModal
          crewId={assignModal.crewId}
          date={assignModal.date}
          scheduleId={assignModal.scheduleId}
          projectId={assignModal.projectId}
          jobType={assignModal.jobType}
          crews={filteredCrews}
          onClose={() => setAssignModal(null)}
          onSaved={() => { setAssignModal(null); loadData() }}
        />
      )}
    </div>
  )
}
