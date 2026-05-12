# MicroGRID Partner Webhooks — Delivery Contract

This document defines the runtime contract between MicroGRID's webhook fanout
and a partner's receiver endpoint. Partners that fail to meet the idempotency
half of this contract will see **duplicate deliveries** during normal operation.

## Delivery semantics

MicroGRID guarantees **at-least-once** delivery, not exactly-once.

A signed event may be POSTed to your endpoint more than once. Specifically:

- **Per-event retries, not per-(event, partner) retries.** If your endpoint
  succeeds but a sibling partner's endpoint fails on the same event, the next
  fanout pass re-POSTs to *both* endpoints. The retry surface is the event,
  not the (event, partner) pair.
- **5 attempts, then DLQ.** Each fanout pass increments `delivery_attempts`.
  On the 5th failed pass the event is force-marked delivered (stamped
  `fanned_out_at`) and given up. Your endpoint will not be re-tried beyond
  the cap. The fanout cron flips fleet status to `error` on any DLQ event,
  so MicroGRID notices, but redelivery requires manual intervention.
- **Retry cadence ≈ 5 minutes.** Failed events become re-claimable after the
  stale-reclaim window (5 min). A 5xx today means a retry attempt in ~5 min.
- **No exponential backoff today.** Linear 5-min retries, 5 attempts, ~25 min
  total before DLQ. If you need a backoff curve, file an action.

## Idempotency contract (required of partners)

Every event carries two surfaces a receiver can use as the dedup key:

1. **HTTP header `X-MG-Event-Id`** — UUID, set by the outbound POST. Stable
   across retries of the same event.
2. **Signed payload field `event_id`** — same UUID, also stable across retries.
   The signed body is what `X-MG-Signature-256` covers, so a partner that
   wants the dedup key inside the signature scope must use this field.

Partners **must** dedup on one of these surfaces. The recommended pattern:

- On receive, look up `(event_id, your_partner_slug)` in your own table.
- If a 2xx was already recorded → return 200 immediately, do no work.
- Otherwise → process, record the 2xx, return 200.

This collapses retries of the same event to a single side-effect on your side.

Partners that cannot meet this contract today should signal to MicroGRID before
production traffic begins so we can wire the per-(event, partner) tracking
(`partner_webhook_deliveries`) ahead of their integration.

## Payload shape

```json
{
  "event_type": "string",
  "event_id":   "uuid",
  "emitted_at": "ISO 8601 timestamp",
  "payload":    { ... event-specific ... }
}
```

The HTTP body is exactly this JSON, no envelope. The four top-level keys are
stable across all event types; `payload` varies by `event_type`.

## Headers

| Header | Value | Notes |
|---|---|---|
| `Content-Type` | `application/json` | |
| `User-Agent` | `MicroGRID-Webhooks/1.0` | |
| `X-MG-Event-Type` | event type name | |
| `X-MG-Event-Id` | UUID | dedup key, stable across retries |
| `X-MG-Timestamp` | unix seconds | feeds the signature |
| `X-MG-Signature-256` | `sha256=<hex>` | HMAC-SHA256(secret, `${ts}.${body}`) |

The receiver MUST reject payloads whose `X-MG-Timestamp` is more than 5
minutes off wall clock (replay-attack mitigation).

## Signature verification (recommended)

```
expected = HMAC-SHA256(your_subscription_secret, X-MG-Timestamp + "." + raw_body)
received = X-MG-Signature-256.replace("sha256=", "")
constant_time_compare(expected_hex, received)
```

Use a constant-time comparison; reject on mismatch.

## Bounded concurrency

A single fanout pass POSTs at most 10 in-flight requests per event across
configured partners. With ~50 partners enrolled, an event still finishes
fanout in 5 round-trips per event, not 50 concurrent. This caps blast radius
on slow partners and prevents a 50-partner amplification on every event.

## What partners should monitor

- 200/non-200 rate on your end of the webhook endpoint.
- Duplicate-event arrivals — count of (`event_id`, your_slug) pairs already
  seen. If this is non-zero, your dedup table is doing real work.
- Median latency of your handler — the fanout uses a 10s HTTP timeout, so
  anything past 9s is at risk of being a "failed" delivery from MicroGRID's
  perspective even if your handler eventually succeeds.

## Versioning

The contract above is **v1**. Breaking changes (renaming `event_id`, changing
signature format, swapping header names) will ship as v2 alongside an
overlap window. Partners get at least 30 days of notice.
