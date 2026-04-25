// Self-report helper for ATLAS-HQ /intel Agent Runs tab.
// Posts one row per cron execution to atlas_report_agent_run on the MG Supabase.
// Failure is non-blocking: the agent's own success does not depend on the ping.

export type FleetRunStatus = 'success' | 'error' | 'partial' | 'running'

export interface ReportFleetRunArgs {
  slug: string
  status: FleetRunStatus
  startedAt: Date
  finishedAt?: Date
  itemsProcessed?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  costUsd?: number | null
  outputSummary?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown> | null
}

export async function reportFleetRun(args: ReportFleetRunArgs): Promise<boolean> {
  // Switched 2026-04-25 from HQ_SUPABASE_PUBLISHABLE_KEY (anon) to the
  // service-role key, paired with REVOKE anon EXECUTE on atlas_report_agent_run
  // in MG migration 173 (greg_actions #292). The p_secret gate inside the
  // RPC body remains as defense-in-depth.
  const url = process.env.HQ_SUPABASE_URL
  const key = process.env.MICROGRID_SUPABASE_SERVICE_KEY
  const secret = process.env.HQ_FLEET_SECRET

  if (!url || !key || !secret) return false

  try {
    const res = await fetch(`${url}/rest/v1/rpc/atlas_report_agent_run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        p_secret: secret,
        p_slug: args.slug,
        p_status: args.status,
        p_started_at: args.startedAt.toISOString(),
        p_finished_at: args.finishedAt?.toISOString() ?? null,
        p_items_processed: args.itemsProcessed ?? null,
        p_input_tokens: args.inputTokens ?? null,
        p_output_tokens: args.outputTokens ?? null,
        p_cost_usd: args.costUsd ?? null,
        p_output_summary: args.outputSummary ?? null,
        p_error_message: args.errorMessage ?? null,
        p_metadata: args.metadata ?? null,
      }),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
