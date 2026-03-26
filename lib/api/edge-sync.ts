// lib/api/edge-sync.ts — NOVA → EDGE webhook integration
// Sends project data and funding events to the EDGE Portal.
// Fire-and-forget: never blocks UI on webhook success/failure.
//
// #8: Asymmetric signing — NOVA signs outbound payloads with HMAC-SHA256 using
// the shared EDGE_WEBHOOK_SECRET. EDGE must validate the `x-webhook-signature`
// header on their end by computing the same HMAC over the raw request body and
// comparing in constant time. If EDGE does not verify signatures, any party with
// the webhook URL can send forged events.

import { db } from '@/lib/db'

// ── Configuration ────────────────────────────────────────────────────────────

const EDGE_WEBHOOK_URL = process.env.NEXT_PUBLIC_EDGE_WEBHOOK_URL || ''
const EDGE_WEBHOOK_SECRET = process.env.EDGE_WEBHOOK_SECRET || ''

// ── Types ────────────────────────────────────────────────────────────────────

export type EdgeEventType =
  | 'project.created'
  | 'project.updated'
  | 'project.stage_changed'
  | 'funding.m2_eligible'
  | 'funding.m3_eligible'
  | 'funding.milestone_updated'
  | 'project.install_complete'
  | 'project.pto_received'
  | 'project.in_service'

export interface EdgeWebhookPayload {
  event: EdgeEventType
  project_id: string
  timestamp: string
  data: Record<string, unknown>
}

// ── HMAC Signing ─────────────────────────────────────────────────────────────

async function signPayload(body: string): Promise<string> {
  // Use Web Crypto API (available in both Node 18+ and Edge runtime)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(EDGE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Sync Log ─────────────────────────────────────────────────────────────────

async function logSync(
  projectId: string,
  eventType: string,
  direction: 'outbound' | 'inbound',
  payload: EdgeWebhookPayload | Record<string, unknown>,
  status: 'sent' | 'delivered' | 'failed',
  responseCode?: number,
  errorMessage?: string
) {
  try {
    const supabase = db()
    await supabase.from('edge_sync_log').insert({
      project_id: projectId,
      event_type: eventType,
      direction,
      payload,
      status,
      response_code: responseCode ?? null,
      error_message: errorMessage ?? null,
    })
  } catch (err) {
    console.error('edge-sync: failed to write sync log:', err)
  }
}

// ── Send Webhook ─────────────────────────────────────────────────────────────

/**
 * Send a webhook event to the EDGE Portal.
 * Returns true on success (or if not configured), false on failure.
 * Never throws — safe to call fire-and-forget.
 */
export async function sendToEdge(
  event: EdgeEventType,
  projectId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  // If EDGE_WEBHOOK_URL is not set, silently succeed (not configured yet)
  if (!EDGE_WEBHOOK_URL) return true

  const payload: EdgeWebhookPayload = {
    event,
    project_id: projectId,
    timestamp: new Date().toISOString(),
    data,
  }

  const body = JSON.stringify(payload)

  // #3: Retry with exponential backoff — max 3 attempts, only on network errors and 5xx
  const MAX_ATTEMPTS = 3
  const BASE_DELAY_MS = 1000

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // Sign the request if a secret is configured
      // #4: Use lowercase header name to match what inbound handler reads
      if (EDGE_WEBHOOK_SECRET) {
        const signature = await signPayload(body)
        headers['x-webhook-signature'] = signature
      }

      const res = await fetch(`${EDGE_WEBHOOK_URL}/api/webhooks/nova`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      // #5: Consume response body for error details
      const responseBody = await res.text()

      const ok = res.ok
      await logSync(
        projectId,
        event,
        'outbound',
        payload,
        ok ? 'delivered' : 'failed',
        res.status,
        ok ? undefined : `HTTP ${res.status}: ${responseBody.slice(0, 500)}`
      )

      if (ok) return true

      // Don't retry 4xx — these are client errors that won't resolve on retry
      if (res.status >= 400 && res.status < 500) {
        console.error(`edge-sync: ${event} for ${projectId} failed with HTTP ${res.status} (not retrying)`)
        return false
      }

      // 5xx — retry if attempts remain
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) // 1s, 2s, 4s
        console.warn(`edge-sync: ${event} for ${projectId} got HTTP ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      console.error(`edge-sync: ${event} for ${projectId} failed with HTTP ${res.status} after ${MAX_ATTEMPTS} attempts`)
      return false

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
        console.warn(`edge-sync: ${event} for ${projectId} failed (${errorMessage}), retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      console.error(`edge-sync: ${event} for ${projectId} failed after ${MAX_ATTEMPTS} attempts:`, errorMessage)
      await logSync(projectId, event, 'outbound', payload, 'failed', undefined, errorMessage)
      return false
    }
  }

  return false // Should not reach here, but satisfy TypeScript
}

// ── Full Project Sync ────────────────────────────────────────────────────────

/**
 * Sync full project data to EDGE. Loads project from DB and sends it.
 */
export async function syncProjectToEdge(projectId: string): Promise<boolean> {
  if (!EDGE_WEBHOOK_URL) return true

  try {
    const supabase = db()
    const { data: project, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (error || !project) {
      console.error('edge-sync: failed to load project for sync:', error)
      return false
    }

    return sendToEdge('project.created', projectId, {
      name: project.name,
      address: project.address,
      city: project.city,
      zip: project.zip,
      email: project.email,
      phone: project.phone,
      stage: project.stage,
      stage_date: project.stage_date,
      sale_date: project.sale_date,
      contract: project.contract,
      systemkw: project.systemkw,
      financier: project.financier,
      financing_type: project.financing_type,
      pm: project.pm,
      pm_id: project.pm_id,
      disposition: project.disposition,
      module: project.module,
      module_qty: project.module_qty,
      inverter: project.inverter,
      inverter_qty: project.inverter_qty,
      battery: project.battery,
      battery_qty: project.battery_qty,
      utility: project.utility,
      ahj: project.ahj,
      dealer: project.dealer,
      advisor: project.advisor,
      consultant: project.consultant,
    })
  } catch (err) {
    console.error('edge-sync: syncProjectToEdge failed:', err)
    return false
  }
}

// ── Funding Sync ─────────────────────────────────────────────────────────────

/**
 * Sync funding data to EDGE. Loads project_funding from DB and sends it.
 */
export async function syncFundingToEdge(projectId: string): Promise<boolean> {
  if (!EDGE_WEBHOOK_URL) return true

  try {
    const supabase = db()
    const { data: funding, error } = await supabase
      .from('project_funding')
      .select('*')
      .eq('project_id', projectId)
      .single()

    if (error || !funding) {
      console.error('edge-sync: failed to load funding for sync:', error)
      return false
    }

    return sendToEdge('funding.milestone_updated', projectId, {
      m1_status: funding.m1_status,
      m1_amount: funding.m1_amount,
      m1_funded_date: funding.m1_funded_date,
      m2_status: funding.m2_status,
      m2_amount: funding.m2_amount,
      m2_funded_date: funding.m2_funded_date,
      m3_status: funding.m3_status,
      m3_amount: funding.m3_amount,
      m3_funded_date: funding.m3_funded_date,
      m3_projected: funding.m3_projected,
    })
  } catch (err) {
    console.error('edge-sync: syncFundingToEdge failed:', err)
    return false
  }
}

// ── Edge Integration Status ──────────────────────────────────────────────────

/**
 * Check if EDGE integration is configured.
 */
export function isEdgeConfigured(): boolean {
  return !!EDGE_WEBHOOK_URL
}

export function isEdgeSecretConfigured(): boolean {
  return !!EDGE_WEBHOOK_SECRET
}

/**
 * Get the configured EDGE webhook URL (masked for display).
 */
export function getEdgeWebhookUrl(): string {
  if (!EDGE_WEBHOOK_URL) return '(not configured)'
  try {
    const url = new URL(EDGE_WEBHOOK_URL)
    return `${url.protocol}//${url.host}/...`
  } catch {
    return '(invalid URL)'
  }
}
