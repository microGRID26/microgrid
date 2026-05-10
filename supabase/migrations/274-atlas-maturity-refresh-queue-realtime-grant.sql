-- 274: maturity v1.5 — table-level SELECT grant for Realtime delivery
--
-- R1 hotfix (caught by red-teamer R1 audit). Migration 273 added the RLS
-- read policy + publication, but the queue table had service_role-only
-- grants — every other table in supabase_realtime publication has explicit
-- authenticated grants (the Supabase Studio default; queue was bootstrapped
-- via raw SQL in mig 270, missing the auto-grant). Postgres ANDs grant +
-- policy at evaluation time, so the Realtime postgres_changes evaluator
-- (running AS authenticated) hits the missing grant first and drops every
-- event silently. Result without this fix: every Refresh click falls through
-- to the 5-min fallback timer regardless of policy correctness.
--
-- SELECT-only grant — service_role still owns INSERT/UPDATE/DELETE. RLS
-- policy from mig 273 keeps row visibility owner-only.

grant select on public.atlas_maturity_refresh_queue to authenticated;
