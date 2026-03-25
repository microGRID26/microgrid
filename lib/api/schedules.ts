import { createClient } from '@/lib/supabase/client'

// ── Schedule data access ─────────────────────────────────────────────────────

/** Load schedule entries for a date range with project name join */
export async function loadScheduleByDateRange(startDate: string, endDate: string) {
  const supabase = createClient()
  const { data, error } = await (supabase as any).from('schedule')
    .select('*, project:projects(name, city)')
    .gte('date', startDate)
    .lte('date', endDate)
  if (error) console.error('schedule load failed:', error)
  return { data: data ?? [], error }
}
