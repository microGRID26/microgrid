import { createClient } from '@/lib/supabase/client'

// ── Change order data access ─────────────────────────────────────────────────

/** Load all change orders with project join */
export async function loadChangeOrders(limit = 2000) {
  const supabase = createClient()
  const { data, error } = await (supabase as any).from('change_orders')
    .select('*, project:projects(name, city, pm, pm_id)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) console.error('change_orders load failed:', error)
  return { data: data ?? [], error }
}
