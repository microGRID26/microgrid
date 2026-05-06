// lib/partner-api/events/fanout.ts — Drain the outbox and POST to partners.
//
// Called by the partner-event-fanout cron on a 1-minute schedule. Each event
// is POSTed to each matching env-configured partner with a 10s timeout.
//
// Retry semantics (#553, audit 2026-05 cron-fanout High 1):
//   - On any non-2xx / timeout, fanned_out_at is NOT stamped — the row's
//     claimed_at is set by the claim RPC, so it stays unclaimable for 5 min,
//     then becomes re-claimable on the next stale-reclaim cycle.
//   - delivery_attempts increments on every pass. After 5 failed passes the
//     row is force-stamped fanned_out_at and given up (effective DLQ).
//   - Trades: per-event retries (not per-(event, partner)). If partner A
//     succeeded but partner B failed, the next attempt re-delivers to BOTH.
//     Partners are required to be idempotent on event_id (signed payload).
//
// Phase 4 follow-up: per-(event, partner) tracking via partner_webhook_deliveries
// (table from migration 109, currently unused — registry is env-driven).

import { partnerApiAdmin } from '../supabase-admin'
import { loadPartnerRegistry, subscriptionsForEvent, type PartnerSubscription } from './partner-registry'
import { signOutbound } from './signer'
import { validateOutboundUrl, validateOutboundUrlWithDns } from './ssrf'

const OUTBOX_BATCH_SIZE = 100
const HTTP_TIMEOUT_MS = 10_000
// Bound concurrent outbound POSTs per fanout invocation. With 50 partners
// configured, the previous Promise.all(targets.map(...)) per event could
// fire 5000 in-flight requests in a tick (audit 2026-05 cron-fanout H3).
const PER_EVENT_CONCURRENCY = 10

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

  // ATOMIC CLAIM (audit 2026-05 cron-fanout C1, migration 226). Calls the
  // partner_event_outbox_claim_batch RPC which uses FOR UPDATE SKIP LOCKED
  // inside a CTE — concurrent fanout workers (Vercel routinely double-fires
  // crons + retries on 5xx) get disjoint batches. Stale-claim window: rows
  // claimed > 5 min ago without fanned_out_at are re-claimable, so a worker
  // crash doesn't permanently lose events. A proper persistent retry queue
  // + DLQ is the High 1 follow-up.
  const { data: events, error } = await client
    .rpc('partner_event_outbox_claim_batch', {
      p_limit: OUTBOX_BATCH_SIZE,
      p_now: new Date(nowMs).toISOString(),
    })

  if (error) {
    result.errors.push(`[fanout] outbox claim failed: ${error.message}`)
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
      : await deliverWithBoundedConcurrency(targets, evt, nowMs, PER_EVENT_CONCURRENCY)

    for (const d of deliveries) {
      result.deliveries_attempted++
      if (d.ok) result.deliveries_succeeded++
      else {
        result.deliveries_failed++
        if (d.error) result.errors.push(`[fanout] ${evt.event_type} → ${d.error}`)
      }
    }

    // #553: atomically increment delivery_attempts and conditionally stamp
    // fanned_out_at. Stamps when (a) all deliveries succeeded OR (b) attempts
    // hit the 5-pass cap (give up). On partial failure with attempts < 5,
    // fanned_out_at stays NULL — stale-reclaim (5 min) re-queues the row.
    const allOk = targets.length === 0 || deliveries.every((d) => d.ok)
    const recordErr = await client.rpc('partner_event_outbox_record_attempt', {
      p_id: evt.id,
      p_all_ok: allOk,
      p_max_attempts: 5,
      p_now: new Date(nowMs).toISOString(),
    })
    if (recordErr?.error) {
      result.errors.push(`[fanout] record_attempt failed for ${evt.id}: ${recordErr.error.message}`)
    }
  }

  return result
}

/** Per-event delivery with bounded concurrency. Caps in-flight HTTP at
 *  `limit` so a 50-partner event doesn't fire 50 concurrent fetches.
 *  No external deps (would otherwise reach for p-limit). */
async function deliverWithBoundedConcurrency(
  targets: PartnerSubscription[],
  evt: { event_type: string; event_id: string; payload: Record<string, unknown>; emitted_at: string },
  nowMs: number,
  limit: number,
): Promise<DeliveryOutcome[]> {
  const results: DeliveryOutcome[] = new Array(targets.length)
  let next = 0
  async function worker() {
    while (true) {
      const idx = next++
      if (idx >= targets.length) return
      results[idx] = await deliverToSubscription(targets[idx], evt, nowMs).catch((err) => ({
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }
  const workers: Promise<void>[] = []
  const n = Math.min(limit, targets.length)
  for (let i = 0; i < n; i++) workers.push(worker())
  await Promise.all(workers)
  return results
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
    })
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status }
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
