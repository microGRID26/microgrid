// lib/api/jsa.ts — Job Safety Analysis data access layer
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'

export interface JSA {
  id: string
  schedule_id: string | null
  project_id: string | null
  crew_lead: string
  crew_name: string | null
  site_name: string | null
  date: string
  time: string | null
  completed: boolean
  created_at: string
}

export interface JSAActivity {
  id: string
  jsa_id: string
  activity: string
  hazards: string | null
  controls: string | null
  sort_order: number
}

export interface JSAAcknowledgement {
  id: string
  jsa_id: string
  crew_member_name: string
  acknowledged: boolean
  acknowledged_at: string | null
}

/** Create a JSA with activities and crew acknowledgements in one go */
export async function createJSA(jsa: {
  schedule_id?: string | null
  project_id?: string | null
  crew_lead: string
  crew_name?: string | null
  site_name?: string | null
  time?: string | null
  activities: { activity: string; hazards: string; controls: string }[]
  crewMembers: string[]
}): Promise<string | null> {
  const supabase = db()

  // Create the JSA record
  const { data, error } = await supabase.from('jsa').insert({
    schedule_id: jsa.schedule_id ?? null,
    project_id: jsa.project_id ?? null,
    crew_lead: jsa.crew_lead,
    crew_name: jsa.crew_name ?? null,
    site_name: jsa.site_name ?? null,
    date: new Date().toISOString().slice(0, 10),
    time: jsa.time ?? new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    completed: true,
  }).select('id').single()

  if (error || !data) {
    console.error('[createJSA] insert failed:', error)
    return null
  }

  const jsaId = (data as { id: string }).id

  // Insert activities
  if (jsa.activities.length > 0) {
    const actRows = jsa.activities.map((a, i) => ({
      jsa_id: jsaId,
      activity: a.activity,
      hazards: a.hazards || null,
      controls: a.controls || null,
      sort_order: i,
    }))
    const { error: actErr } = await supabase.from('jsa_activities').insert(actRows)
    if (actErr) console.error('[createJSA] activities insert failed:', actErr)
  }

  // Insert crew acknowledgements (all marked acknowledged on creation)
  if (jsa.crewMembers.length > 0) {
    const ackRows = jsa.crewMembers.map(name => ({
      jsa_id: jsaId,
      crew_member_name: name,
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    }))
    const { error: ackErr } = await supabase.from('jsa_acknowledgements').insert(ackRows)
    if (ackErr) console.error('[createJSA] acknowledgements insert failed:', ackErr)
  }

  return jsaId
}

/** Load JSA for a schedule entry (to check if one exists before starting job) */
export async function loadJSAForSchedule(scheduleId: string): Promise<JSA | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('jsa')
    .select('id, schedule_id, project_id, crew_lead, crew_name, site_name, date, time, completed, created_at')
    .eq('schedule_id', scheduleId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) { console.error('[loadJSAForSchedule]', error); return null }
  return data as JSA | null
}

/** Load recent JSAs for a project */
export async function loadProjectJSAs(projectId: string): Promise<JSA[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('jsa')
    .select('id, schedule_id, project_id, crew_lead, crew_name, site_name, date, time, completed, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) { console.error('[loadProjectJSAs]', error); return [] }
  return (data ?? []) as JSA[]
}
