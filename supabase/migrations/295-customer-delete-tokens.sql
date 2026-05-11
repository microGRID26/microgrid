-- 295: customer_delete_tokens — email-token gate for account deletion
--
-- Action #548 (P1) — #544 R1 H2 follow-up.
--
-- Why this exists:
--   POST /api/customer/delete-account accepts a Bearer JWT (mobile) or
--   cookie session (web) and immediately CASCADE-deletes customer_accounts
--   + 6 child tables + auth.users + Stripe customer (per #544). A leaked
--   mobile JWT (crash report, analytics breadcrumb, error-tracker capture)
--   is sufficient ALONE to permanently destroy the victim's account.
--
-- The fix: require a one-time email-delivered token between request and
-- delete. Phase 1 of the route POST issues a 32-char URL-safe token,
-- emails it (plaintext), stores SHA-256 hash in this table. Phase 2 of the
-- route POST takes a `confirmation_token` in the body, hashes it, looks up
-- the row, marks it used, performs the cascade delete. Attacker needs
-- BOTH the leaked JWT AND access to the victim's email — the BEC-style
-- pivot that a single leaked credential enabled is now blocked.
--
-- Apple App Store guideline 5.1.1(v) "permits" a confirmation flow before
-- irreversible deletion — this is defense-in-depth, not Apple-required.

CREATE TABLE IF NOT EXISTS public.customer_delete_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK CASCADE addresses R1 M-1: when auth.users row is deleted, orphan
  -- token rows go with it. Also forecloses inserting a token for a
  -- nonexistent user (service-role-only writes already mitigate, but FK
  -- is the structural belt).
  auth_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of live tokens per user (the WHERE clause in route Phase 2).
CREATE INDEX IF NOT EXISTS idx_customer_delete_tokens_user_expires
  ON public.customer_delete_tokens (auth_user_id, expires_at DESC);

-- Token uniqueness — defense-in-depth. With 144-bit entropy collisions
-- are astronomically unlikely, but the unique index also makes the
-- INSERT in Phase 1 fail fast on collision instead of silently issuing
-- a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_delete_tokens_token_hash
  ON public.customer_delete_tokens (token_hash);

COMMENT ON TABLE public.customer_delete_tokens IS
  'Email-token confirmation gate for POST /api/customer/delete-account. '
  'Plaintext token (32-char URL-safe random) is emailed to the customer; '
  'SHA-256 hash is stored here. Phase 2 of the route looks up by hash + '
  'auth_user_id + expires_at>now() + used_at IS NULL, marks used_at, '
  'then proceeds with the existing CASCADE delete. Service-role-only — '
  'RLS enabled with no policies (deny-all from authenticated/anon). '
  'Stale-token cleanup is filter-driven (expired rows ignored by Phase 2 '
  'lookup); a pruning cron can be added later if growth becomes real.';

ALTER TABLE public.customer_delete_tokens ENABLE ROW LEVEL SECURITY;

-- No INSERT/SELECT/UPDATE/DELETE policies by design — service-role writes
-- and reads only. authenticated/anon callers get RLS deny-all on every op.
-- The route's createClient() uses SUPABASE_SECRET_KEY (service role).
