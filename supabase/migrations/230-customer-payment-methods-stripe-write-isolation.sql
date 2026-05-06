-- Migration 230 — customer_payment_methods Stripe-write isolation (#544 R1 Critical)
--
-- The /api/customer/delete-account route now calls stripe.customers.del()
-- for each stripe_customer_id stamped on the deleting user's payment-method
-- rows. red-teamer R1 found a cross-tenant wipe vector: the prior
-- `cpm_customer_manage` INSERT policy let an authenticated user create a
-- payment-method row scoped to their own account but containing ANY
-- stripe_customer_id value — including another customer's. When the
-- attacker then deleted their account, the route would happily destroy
-- the victim's Stripe customer record (and per Stripe cascade: saved
-- cards, subscriptions, invoices).
--
-- Three layers of defense, all applied here:
--   1. Drop the customer INSERT policy. Stripe webhooks (service_role) are
--      the sole authoritative writer for these rows; no app code does
--      customer-bound INSERT today.
--   2. Column-level REVOKE on (stripe_customer_id, stripe_payment_method_id)
--      so no future RLS policy or grant can reintroduce the gap.
--   3. Unique partial index on stripe_customer_id — catches any future
--      backfill or admin-tool bug that would dupe a single Stripe customer
--      across customer_accounts rows.
--
-- Plus pending_auth_deletions table (durable record for partial-success
-- state when /api/customer/delete-account erases data but the auth.users
-- delete fails — janitor cron can retry).

begin;

-- ── 1. Drop customer-side INSERT policy ──────────────────────────────────
drop policy if exists cpm_customer_manage on public.customer_payment_methods;
-- (No replacement. service_role bypasses RLS; webhooks insert rows.)

-- ── 2. Column-level REVOKE — belt + suspenders ───────────────────────────
revoke insert (stripe_customer_id, stripe_payment_method_id)
  on public.customer_payment_methods from authenticated, anon;
revoke update (stripe_customer_id, stripe_payment_method_id)
  on public.customer_payment_methods from authenticated, anon;

-- ── 3. Unique partial index on stripe_customer_id ────────────────────────
-- Null allowed (pre-Stripe-go-live rows + rows from non-Stripe payment
-- providers if added later). Two non-null rows with the same Stripe
-- customer ID across distinct customer_accounts now fail at INSERT.
-- The drop is a no-op against current prod (083's idx_cpm_stripe_customer
-- was dropped in a later sweep) but kept idempotent for any environment
-- still carrying the legacy non-unique index.
drop index if exists public.idx_cpm_stripe_customer;
create unique index if not exists idx_cpm_stripe_customer_unique
  on public.customer_payment_methods (stripe_customer_id)
  where stripe_customer_id is not null;

-- ── 4. pending_auth_deletions ────────────────────────────────────────────
-- Records the partial-success case where customer data was erased but
-- auth.admin.deleteUser failed (Supabase Auth flap, network, etc.).
-- Janitor cron sweeps this table and retries the auth delete; once
-- successful the row is removed.
create table if not exists public.pending_auth_deletions (
  auth_user_id uuid primary key,
  customer_account_id uuid,
  reason text,
  attempts int not null default 1,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.pending_auth_deletions enable row level security;
-- No policies — service_role only. authenticated/anon have no access.

comment on table public.pending_auth_deletions is
  'Customers whose data was erased by /api/customer/delete-account but auth.users delete failed. Janitor cron retries.';

commit;
