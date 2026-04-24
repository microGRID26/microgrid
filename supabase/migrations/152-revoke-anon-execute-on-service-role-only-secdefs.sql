-- Migration 152 — Revoke anon/authenticated/public EXECUTE on SECURITY DEFINER
-- functions whose only legitimate caller is service_role.
--
-- Context
-- -------
-- Follow-up to the R1 audit triggered by the auth_is_internal_writer outage
-- (migration 151). The same audit surfaced four partner-ops helpers and four
-- trigger helpers with broad EXECUTE grants. Trigger functions don't need
-- grants at all (the trigger system fires them regardless of calling role).
-- The four partner-ops functions are only called from cron routes that use a
-- service_role Supabase client (service_role bypasses EXECUTE grants).
--
-- Why this matters
-- ----------------
-- SECURITY DEFINER bypasses RLS. An anon caller with the publishable key can
-- reach any SECDEF whose EXECUTE grant includes anon. Today that means:
--   - partner_emit_event(text,jsonb)         → inject arbitrary webhook payloads
--                                               to partner customers.
--   - drop_old_partner_partitions(integer)   → wipe partner log history by
--                                               calling with retention_days=0.
--   - sweep_partner_idempotency_keys(integer)→ clear idempotency rows to enable
--                                               replay attacks on Partner API.
--   - ensure_partner_partitions(integer)     → balloon partition count (DoS).
--
-- Verified callers in ~/Desktop/MicroGRID:
--   lib/partner-api/events/emit.ts            → partnerApiAdmin() [service_role]
--   app/api/cron/partner-logs-retention/      → partnerApiAdmin() [service_role]
--
-- The trigger helpers (aggregate_earnings, cascade_user_name_change,
-- link_customer_account_on_signup, touch_ticket_on_comment) fire from AFTER/
-- BEFORE triggers — role grants are irrelevant to trigger execution.
--
-- Impact
-- ------
-- Zero runtime impact. service_role always retains EXECUTE (implicit via
-- `GRANT ALL` on schema objects), triggers invoke their functions as the row
-- owner. Anon/authenticated callers (publishable-key and session-authenticated
-- users) never had a legitimate reason to call any of these directly.

REVOKE EXECUTE ON FUNCTION public.partner_emit_event(text, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.drop_old_partner_partitions(integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.ensure_partner_partitions(integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sweep_partner_idempotency_keys(integer) FROM anon, authenticated, public;

REVOKE EXECUTE ON FUNCTION public.cascade_user_name_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.link_customer_account_on_signup() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_ticket_on_comment() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.aggregate_earnings(text, uuid, text, text) FROM anon, authenticated, public;
