-- Migration 205 — atlas_cost_events ledger
-- 2026-04-30 · ~/.claude/plans/tingly-honking-pearl.md Phase 2
--
-- Per-call cost ledger so every external API call invoked by an agent
-- is attributed to that agent. /intel cost column reads this in v2.
--
-- Applied directly via Supabase MCP on hzymsezqfxzpbcqryeim (MicroGRID
-- prod). Filed here for archival + replay-onto-branch.
--
-- R1 audit (red-teamer 2026-04-30): the original draft used
--   USING (auth_is_owner())
-- and ON DELETE CASCADE on agent_slug, both wrong. Reworked to match
-- the sibling atlas_agents pattern (USING(false) + RPC-only access)
-- and ON DELETE RESTRICT (preserve cost audit trail through agent
-- renames). Idempotency switched from SELECT-then-INSERT to
-- INSERT ... ON CONFLICT (race-free).

CREATE TABLE public.atlas_cost_events (
  id              bigint generated always as identity primary key,
  agent_slug      text not null references public.atlas_agents(slug) on delete restrict,
  vendor          text not null check (length(vendor) > 0 and length(vendor) <= 64),
  units           numeric not null check (units >= 0),
  unit_label      text check (unit_label is null or length(unit_label) <= 64),
  unit_cost_usd   numeric not null check (unit_cost_usd >= 0),
  -- GENERATED column eliminates drift between units * unit_cost_usd
  -- and the stored total. Backfill jobs and live writes both feed
  -- units + unit_cost_usd; total derives.
  total_cost_usd  numeric generated always as (units * unit_cost_usd) stored,
  currency        text not null default 'USD' check (length(currency) = 3),
  pricing_version text check (pricing_version is null or length(pricing_version) <= 64),
  ts              timestamptz not null default now(),
  -- run_id is nullable: per-run-aggregate events have it; standalone
  -- per-call events (e.g. ScreenshotOne capture mid-run) may not.
  run_id          bigint references public.atlas_agent_runs(id) on delete set null,
  source          text not null default 'live' check (source in ('live','backfill')),
  idempotency_key text unique,
  -- 8KB cap on metadata to prevent runaway payload bloat. Most callers
  -- store only {"input_tokens": N, "output_tokens": M, ...} sized blobs.
  metadata        jsonb check (metadata is null or pg_column_size(metadata) < 8192)
);

CREATE INDEX atlas_cost_events_slug_ts_idx ON public.atlas_cost_events (agent_slug, ts desc);
CREATE INDEX atlas_cost_events_vendor_ts_idx ON public.atlas_cost_events (vendor, ts desc);
CREATE INDEX atlas_cost_events_ts_idx ON public.atlas_cost_events (ts desc);
CREATE INDEX atlas_cost_events_run_idx ON public.atlas_cost_events (run_id) WHERE run_id IS NOT NULL;

ALTER TABLE public.atlas_cost_events ENABLE ROW LEVEL SECURITY;

-- Sibling atlas_* table pattern: deny-all RLS on direct access. All
-- reads route through SECURITY DEFINER RPCs that gate on owner.
CREATE POLICY atlas_cost_events_no_direct ON public.atlas_cost_events
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

REVOKE ALL ON public.atlas_cost_events FROM authenticated, anon;
GRANT SELECT, INSERT ON public.atlas_cost_events TO service_role;

COMMENT ON TABLE public.atlas_cost_events IS
  'Per-call cost ledger. Every external API call invoked by an agent gets a row tagged with agent_slug. Direct access blocked by RLS; reads via SECURITY DEFINER RPCs only. Writes via atlas_log_cost_event RPC only.';

-- Logger RPC. Idempotency-safe via ON CONFLICT — no SELECT-then-INSERT
-- race. Returns the row id (existing or new).
CREATE OR REPLACE FUNCTION public.atlas_log_cost_event(
  p_agent_slug      text,
  p_vendor          text,
  p_units           numeric,
  p_unit_cost_usd   numeric,
  p_unit_label      text DEFAULT NULL,
  p_run_id          bigint DEFAULT NULL,
  p_metadata        jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_pricing_version text DEFAULT NULL,
  p_source          text DEFAULT 'live'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_agent_slug IS NULL OR length(p_agent_slug) = 0 THEN
    RAISE EXCEPTION 'agent_slug must be non-empty';
  END IF;
  IF p_units < 0 THEN RAISE EXCEPTION 'units must be >= 0'; END IF;
  IF p_unit_cost_usd < 0 THEN RAISE EXCEPTION 'unit_cost_usd must be >= 0'; END IF;
  IF p_source NOT IN ('live','backfill') THEN
    RAISE EXCEPTION 'source must be live or backfill';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.atlas_cost_events (
      agent_slug, vendor, units, unit_label, unit_cost_usd,
      pricing_version, run_id, source, idempotency_key, metadata
    )
    VALUES (
      p_agent_slug, p_vendor, p_units, p_unit_label, p_unit_cost_usd,
      p_pricing_version, p_run_id, p_source, p_idempotency_key, p_metadata
    )
    ON CONFLICT (idempotency_key) DO UPDATE
      SET idempotency_key = EXCLUDED.idempotency_key
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.atlas_cost_events (
    agent_slug, vendor, units, unit_label, unit_cost_usd,
    pricing_version, run_id, source, idempotency_key, metadata
  )
  VALUES (
    p_agent_slug, p_vendor, p_units, p_unit_label, p_unit_cost_usd,
    p_pricing_version, p_run_id, p_source, NULL, p_metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_log_cost_event(text, text, numeric, numeric, text, bigint, jsonb, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_log_cost_event(text, text, numeric, numeric, text, bigint, jsonb, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_log_cost_event(text, text, numeric, numeric, text, bigint, jsonb, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_log_cost_event(text, text, numeric, numeric, text, bigint, jsonb, text, text, text) TO service_role;

COMMENT ON FUNCTION public.atlas_log_cost_event(text, text, numeric, numeric, text, bigint, jsonb, text, text, text) IS
  'Insert a cost event. Idempotent when p_idempotency_key is supplied (race-free via ON CONFLICT). Total computed by GENERATED ALWAYS column. Server-only via REVOKE/GRANT.';
