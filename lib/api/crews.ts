import { createClient } from '@/lib/supabase/client'

// ── Crew data access ─────────────────────────────────────────────────────────

/** Load crews by IDs (batch lookup for enrichment) */
export async function loadCrewsByIds(crewIds: string[]): Promise<{ id: string; name: string }[]> {
  if (!crewIds.length) return []
  const supabase = createClient()
  const { data, error } = await (supabase as any).from('crews')
    .select('id, name')
    .in('id', crewIds)
  if (error) console.error('crews batch load failed:', error)
  return (data ?? []) as { id: string; name: string }[]
}

/** Load all active crews */
export async function loadActiveCrews() {
  const supabase = createClient()
  const { data, error } = await (supabase as any).from('crews')
    .select('*')
    .eq('active', 'TRUE')
    .order('name')
  if (error) console.error('active crews load failed:', error)
  return { data: data ?? [], error }
}
