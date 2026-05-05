// lib/partner-api/events/fanout.ts — Drain the outbox and POST to partners.
//
// Called by the partner-event-fanout cron on a 1-minute schedule. For v1 the
// delivery is inline (no retry queue): each event is POSTed to each matching
// env-configured partner with a 10s timeout. Non-2xx responses are logged
// but do NOT re-queue the event. Phase 4 introduces persistent retries via
// partner_webhook_deliveries + partner-webhook-deliver cron.

import { partnerApiAdmin } from '../supabase-admin'
import { loadPartnerRegistry, subscriptionsForEvent, type PartnerSubscription } from './partner-registry'
import { signOutbound } from './signer'
import { validateOutboundUrl, validateOutboundUrlWithDns } from './ssrf'

const OUTBOX_BATCH_SIZE = 100
const HTTP_TIMEOUT_MS = 10_000

export interface FanoutResult {
  events_processed: number
  deliveries_attempted: number
  deliveries_succeeded: number
  deliveries_failed: number
  errors: string[]
}

export async function runFanout(nowMs: number = Date.now()): Promise<FanoutResult> {
  const result: FanoutResult = {
    events_processed: 0,
    deliveries_attempted: 0,
    deliveries_succeeded: 0,
    deliveries_failed: 0,
    errors: [],
  }

  const subs = loadPartnerRegistry()
  const sb = partnerApiAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = sb as any

  // Pull a batch of unfanned events ordered by age.
  const { data: events, error } = await client
    .from('partner_event_outbox')
    .select('id, event_type, event_id, payload, emitted_at')
    .is('fanned_out_at', null)
    .order('emitted_at', { ascending: true })
    .limit(OUTBOX_BATCH_SIZE)

  if (error) {
    result.errors.push(`[fanout] outbox read failed: ${error.message}`)
    return result
  }

  const rows = (events as Array<{
    id: string
    event_type: string
    event_id: string
    payload: Record<string, unknown>
    emitted_at: string
  }> | null) ?? []

  for (const evt of rows) {
    result.events_processed++
    const targets = subscriptionsForEvent(subs, evt.event_type)

    // Even if no targets match, mark fanned_out so we don't re-scan forever.
    const deliveries = targets.length === 0
      ? []
      : await Promise.all(targets.map((s) => deliverToSubscription(s, evt, nowMs).catch((err) => ({
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : String(err),
        }))))

    for (const d of deliveries) {
      result.deliveries_attempted++
      if (d.ok) result.deliveries_succeeded++
      else {
        result.deliveries_failed++
        if (d.error) result.errors.push(`[fanout] ${evt.event_type} → ${d.error}`)
      }
    }

    const markErr = await client
      .from('partner_event_outbox')
      .update({ fanned_out_at: new Date(nowMs).toISOString() })
      .eq('id', evt.id)
    if (markErr?.error) {
      result.errors.push(`[fanout] mark fanned_out failed for ${evt.id}: ${markErr.error.message}`)
    }
  }

  return result
}

interface DeliveryOutcome {
  ok: boolean
  status: number
  error?: string
}

async function deliverToSubscription(
  sub: PartnerSubscription,
  evt: { event_type: string; event_id: string; payload: Record<string, unknown>; emitted_at: string },
  nowMs: number,
): Promise<DeliveryOutcome> {
  // Belt + suspenders: the registry already validated URLs at load time, but
  // re-check in case env was swapped mid-process without a restart.
  validateOutboundUrl(sub.url)

  // Resolve the hostname and reject if any A/AAAA record falls in the private
  // / reserved blocklist (#380). Closes the "register attacker.example whose
  // DNS returns 169.254.169.254" SSRF amplification. Residual: DNS rebinding
  // between this lookup and the fetch() below is still possible — closes
  // when Phase 4 subscription CRUD adds connection pinning via custom Agent.
  await validateOutboundUrlWithDns(sub.url)

  const body = JSON.stringify({
    event_type: evt.event_type,
    event_id: evt.event_id,
    emitted_at: evt.emitted_at,
    payload: evt.payload,
  })
  const headers = await signOutbound(body, sub.secret, nowMs)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'MicroGRID-Webhooks/1.0',
        'X-MG-Event-Type': evt.event_type,
        'X-MG-Event-Id': evt.event_id,
        ...headers,
      },
      body,
      signal: controller.signal,
      // #503 closure: refuse to follow redirects. A partner's validated URL
      // could 302 to a private IP (169.254.169.254 etc), bypassing the
      // submit-time + DNS-time SSRF guards. With manual redirect handling,
      // any 30x is surfaced as a delivery error and the destination is
      // never fetched. Partners running real webhooks return 2xx on accept.
      redirect: 'manual',
    })
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status }
    }
    if (res.status >= 300 && res.status < 400) {
      // R1 HIGH: do NOT reflect Location into the surfaced error. The redirect
      // target is fully attacker-controlled and `result.errors` lands in
      // atlas_fleet_runs.error_message via the cron route — that would turn
      // this guard into a recon channel (probe 169.254.169.254 / metadata
      // endpoints, read the Location back out of HQ logs). Status code only.
      return {
        ok: false,
        status: res.status,
        error: `${sub.org_slug} → redirect refused (${res.status})`,
      }
    }
    const text = (await res.text().catch(() => '')).slice(0, 200)
    return {
      ok: false,
      status: res.status,
      error: `${sub.org_slug} → ${res.status} ${text}`.trim(),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, error: `${sub.org_slug} → ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}
