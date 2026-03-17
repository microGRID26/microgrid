import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Project } from '@/types/database'

export default async function CommandPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('projects')
    .select('id, name, city, stage, stage_date, pm, blocker, contract')
    .order('stage_date', { ascending: true })
    .limit(500)

  const projects = (data ?? []) as Pick<Project, 'id'|'name'|'city'|'stage'|'stage_date'|'pm'|'blocker'|'contract'>[]

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-green-400">MicroGRID CRM</h1>
            <p className="text-gray-400 text-sm mt-1">Command Center</p>
          </div>
          <div className="text-sm text-gray-400">
            {user.email} · {projects.length} projects
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {projects.map(p => (
            <div key={p.id} className="bg-gray-800 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-gray-400">{p.id} · {p.city} · {p.pm}</div>
              </div>
              <div className="text-xs bg-gray-700 px-3 py-1 rounded-full text-gray-300">
                {p.stage}
              </div>
              {p.blocker && (
                <div className="text-xs text-red-400 max-w-xs truncate">
                  🚫 {p.blocker}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
