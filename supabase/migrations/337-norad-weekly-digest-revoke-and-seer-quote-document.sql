-- 337: NORAD batch — drain two deferred rows from the 2026-05-15 wide-net wave.
--   #1155 — weekly-digest mutators defense-in-depth REVOKE from anon + authenticated
--   #1156 — seer_today_quote document the public-by-design rationale
--
-- WIDE-NET R1 UPGRADE: while reading current proacl for #1155, found the
-- finding was understated. The audit said "granted to authenticated"; live
-- proacl is `{postgres=X, anon=X, authenticated=X, service_role=X}` — anon
-- is ALSO granted (Supabase public-schema default ACL persisted because
-- mig 200 only `revoke ... from public`, which doesn't strip per-role
-- defaults — same lesson as greg_actions #636 / mig 336 PUBLIC-inheritance
-- gap). So anyone with the publishable key can already call these mutators
-- today. Severity nudges Medium→High; closed defensively in this migration.
--
-- Callers (verified by grep across ATLAS-HQ / MG / scripts):
--   atlas_record_weekly_digest, atlas_attach_weekly_draft, atlas_mark_weekly_sent,
--   atlas_record_daily_brief: ATLAS-HQ `lib/digest/persist.ts` via
--   `getProjectClient('microgrid')` — comment at file top: "All RPCs are
--   called via service-role". Tests in __tests__/digest/persist.test.ts
--   mock the RPC layer; no behavior dependency on authenticated grant.
--   Also greg_actions.py:338 mark-weekly-sent helper (uses
--   MICROGRID_SUPABASE_SERVICE_KEY = service_role).
--
-- Fix shape for the 4 mutators: REVOKE PUBLIC + anon + authenticated, GRANT
-- service_role. Same pattern as mig 336.
--
-- seer_today_quote: COMMENT ON FUNCTION documenting the threat-shape it
-- resembles (zero-arg SECDEF no-auth read — same shape as the R3-caught
-- C-NEW in mig 335) plus why it's intentionally open (quotes are public
-- devotional content). Inline rationale so a future NORAD wide-net audit
-- reads the comment and skips re-flagging.

-- =============================================================================
-- (1) Weekly digest mutators — REVOKE anon + authenticated (#1155)
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.atlas_record_weekly_digest(date, date, jsonb, jsonb, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_record_weekly_digest(date, date, jsonb, jsonb, integer, jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_attach_weekly_draft(bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_attach_weekly_draft(bigint, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_mark_weekly_sent(bigint, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_mark_weekly_sent(bigint, boolean)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_record_daily_brief(date, integer, integer, integer, integer, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_record_daily_brief(date, integer, integer, integer, integer, jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.atlas_record_weekly_digest(date, date, jsonb, jsonb, integer, jsonb) IS
  'Server-side only. Called by ATLAS-HQ digest cron via service_role. PUBLIC + anon + authenticated revoked in mig 337 (NORAD #1155 — closes defense-in-depth gap; anon was already granted via Supabase public-schema default ACL).';
COMMENT ON FUNCTION public.atlas_attach_weekly_draft(bigint, text) IS
  'Server-side only. Same lockdown as atlas_record_weekly_digest (mig 337).';
COMMENT ON FUNCTION public.atlas_mark_weekly_sent(bigint, boolean) IS
  'Server-side only. Same lockdown as atlas_record_weekly_digest (mig 337).';
COMMENT ON FUNCTION public.atlas_record_daily_brief(date, integer, integer, integer, integer, jsonb, jsonb) IS
  'Server-side only. Same lockdown as atlas_record_weekly_digest (mig 337).';

-- =============================================================================
-- (2) seer_today_quote — document public-by-design rationale (#1156)
-- =============================================================================

COMMENT ON FUNCTION public.seer_today_quote() IS
  'Public-by-design. Zero-arg SECDEF returning one row from seer_daily_quotes WHERE active=true. Shape resembles the NORAD R3-caught Critical (mig 335 atlas_get_live_edge_model_source — zero-arg SECDEF, no auth gate, returns sensitive data) BUT here the content is devotional quotes intentionally public for the Seer app. anon EXECUTE is intentional. If a future migration repurposes seer_daily_quotes for non-public content, this function MUST be retrofitted with an auth_is_admin() or auth.uid() gate. Audited and accepted: NORAD wide-net R1 2026-05-15 (chain norad-mg-secdef-sweep, mig-336-2026-05-15 version, audit-log id 03d8c53f-7e68-446e-a1e1-c8c77e2e4b1e).';
