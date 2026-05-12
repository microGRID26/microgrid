-- ─────────────────────────────────────────────────────────────────────────
-- mig 311 · Seer · Daily AI brief — table + RPCs
-- ─────────────────────────────────────────────────────────────────────────
-- Closes greg_actions #762. Gives Greg a 5-item plain-English roundup of
-- the most important AI news from the last 24h, surfaced on /today every
-- morning. The 7am Central cron + LLM call live in ATLAS-HQ
-- (`app/api/cron/seer-daily-brief/route.ts`); this migration is the data
-- model + the owner-gated RPCs the mobile app reads / writes through.
--
-- R1 red-teamer (B / 0C / 1H / 4M / 3L) folded inline pre-apply:
--   H-1: top_5_items element shape now validated INSIDE seer_upsert_daily_brief
--        — required keys, https?:// link regex, per-field length caps.
--        DB-level CHECK can't easily encode that; RPC-side is the only
--        writer so the gate is sufficient.
--   M-1: ON CONFLICT in upsert now preserves read_at if content didn't
--        change (so cron retries on identical output don't clobber state).
--   M-2: seer_get_today_brief now returns ONLY today's brief (NULL otherwise)
--        — no more "stale brief silently rendered as today's." Mobile UI
--        owns the empty state.
--   M-3: explicit deny-all RLS policy silences the rls_no_policy advisor
--        lint (SECDEF helpers bypass policies, so this is decorative).
--   M-4: seer_list_brief_owners returns (owner_id, email) for cron-log
--        observability when N>1.
--
-- Schema (with R1 H-1 element-shape validation enforced in the upsert RPC):
--   public.seer_daily_brief
--     owner_id   uuid NOT NULL FK atlas_hq_users(id) ON DELETE CASCADE
--     brief_date date NOT NULL
--     summary_md       text NOT NULL  (1..5000 chars)
--     top_5_items      jsonb NOT NULL  (array of 1..5 elements)
--     generated_at     timestamptz NOT NULL DEFAULT now()
--     read_at          timestamptz   NULL
--     model            text NOT NULL  (1..80 chars)
--     input_token_count  int NOT NULL DEFAULT 0
--     output_token_count int NOT NULL DEFAULT 0
--   PRIMARY KEY (owner_id, brief_date)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.seer_daily_brief (
  owner_id           uuid NOT NULL REFERENCES public.atlas_hq_users(id) ON DELETE CASCADE,
  brief_date         date NOT NULL,
  summary_md         text NOT NULL CHECK (length(summary_md) BETWEEN 1 AND 5000),
  top_5_items        jsonb NOT NULL CHECK (jsonb_typeof(top_5_items) = 'array'
                                            AND jsonb_array_length(top_5_items) BETWEEN 1 AND 5),
  generated_at       timestamptz NOT NULL DEFAULT now(),
  read_at            timestamptz NULL,
  model              text NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
  input_token_count  int NOT NULL DEFAULT 0 CHECK (input_token_count >= 0),
  output_token_count int NOT NULL DEFAULT 0 CHECK (output_token_count >= 0),
  PRIMARY KEY (owner_id, brief_date)
);

ALTER TABLE public.seer_daily_brief ENABLE ROW LEVEL SECURITY;

-- M-3 fix: explicit deny-all policy silences `rls_no_policy` advisor lint.
-- SECDEF RPCs bypass policies; this only matters for `anon`/`authenticated`
-- attempting direct table access, which is also blocked by lack of GRANT.
-- Double-deny + clean advisor surface.
DROP POLICY IF EXISTS seer_daily_brief_deny_all ON public.seer_daily_brief;
CREATE POLICY seer_daily_brief_deny_all ON public.seer_daily_brief
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ─── seer_get_today_brief ───────────────────────────────────────────────
-- M-2 fix: returns ONLY today's-Chicago brief. NULL if not yet generated.
-- Mobile UI owns the empty state (skeleton / "brief drops at 7am" copy)
-- so a missed cron doesn't silently render Monday's news on Thursday.
DROP FUNCTION IF EXISTS public.seer_get_today_brief();
CREATE OR REPLACE FUNCTION public.seer_get_today_brief()
RETURNS public.seer_daily_brief
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
  v_today    date;
  v_row      public.seer_daily_brief;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  v_today := public.seer_today_chicago();

  SELECT * INTO v_row
    FROM public.seer_daily_brief
   WHERE owner_id = v_owner_id
     AND brief_date = v_today;
  RETURN v_row;  -- NULL composite if no row — fine for the client
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_get_today_brief() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_get_today_brief() TO authenticated;

-- ─── seer_mark_brief_read ───────────────────────────────────────────────
-- Idempotent: sets read_at = now() on first call, no-op on subsequent
-- calls. Returns the updated row (or null if no brief exists for that
-- date for the calling owner — caller should have just gotten the row
-- back from get_today_brief, so missing-row implies a race).
DROP FUNCTION IF EXISTS public.seer_mark_brief_read(date);
CREATE OR REPLACE FUNCTION public.seer_mark_brief_read(p_brief_date date)
RETURNS public.seer_daily_brief
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
  v_row      public.seer_daily_brief;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_brief_date IS NULL THEN
    RAISE EXCEPTION 'invalid_brief_date' USING ERRCODE = '22023';
  END IF;

  UPDATE public.seer_daily_brief
     SET read_at = COALESCE(read_at, now())
   WHERE owner_id = v_owner_id AND brief_date = p_brief_date
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_mark_brief_read(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_mark_brief_read(date) TO authenticated;

-- ─── seer_upsert_daily_brief (INTERNAL — service-role only) ─────────────
-- Called by the ATLAS-HQ Vercel cron. R1 H-1 element-shape validation
-- enforced here: every top_5_items entry must be an object with required
-- keys + https?:// link + per-field length caps.
-- R1 M-1 fix: ON CONFLICT only clears read_at when content actually
-- changed, so cron retries on identical output don't wipe read state.
DROP FUNCTION IF EXISTS public.seer_upsert_daily_brief(uuid, date, text, jsonb, text, int, int);
CREATE OR REPLACE FUNCTION public.seer_upsert_daily_brief(
  p_owner_id   uuid,
  p_date       date,
  p_summary_md text,
  p_top_items  jsonb,
  p_model      text,
  p_in_tokens  int,
  p_out_tokens int
)
RETURNS public.seer_daily_brief
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_row     public.seer_daily_brief;
  v_elem    jsonb;
  v_link    text;
BEGIN
  IF p_owner_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_top_items) <> 'array'
     OR jsonb_array_length(p_top_items) < 1
     OR jsonb_array_length(p_top_items) > 5 THEN
    RAISE EXCEPTION 'top_items must be a 1..5-element JSON array' USING ERRCODE = '22023';
  END IF;

  -- R1 H-1: per-element shape + content validation. Stored XSS / malformed
  -- link vector if a poisoned LLM output or compromised cron writes
  -- arbitrary jsonb here. Validate every element before insert.
  FOR v_elem IN SELECT jsonb_array_elements(p_top_items) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'top_items[*] must each be a JSON object' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_elem ? 'item_id' AND v_elem ? 'headline' AND v_elem ? 'blurb'
            AND v_elem ? 'link'  AND v_elem ? 'source') THEN
      RAISE EXCEPTION 'top_items[*] missing required keys (item_id, headline, blurb, link, source)'
        USING ERRCODE = '22023';
    END IF;
    IF length(v_elem->>'headline') > 200 OR length(v_elem->>'headline') < 1 THEN
      RAISE EXCEPTION 'top_items[*].headline length out of bounds (1..200)' USING ERRCODE = '22023';
    END IF;
    IF length(v_elem->>'blurb') > 600 OR length(v_elem->>'blurb') < 1 THEN
      RAISE EXCEPTION 'top_items[*].blurb length out of bounds (1..600)' USING ERRCODE = '22023';
    END IF;
    IF length(v_elem->>'source') > 80 OR length(v_elem->>'source') < 1 THEN
      RAISE EXCEPTION 'top_items[*].source length out of bounds (1..80)' USING ERRCODE = '22023';
    END IF;
    v_link := v_elem->>'link';
    IF v_link IS NULL OR length(v_link) > 500 OR length(v_link) < 8
       OR NOT (v_link ~* '^https?://[a-z0-9.-]+(:[0-9]+)?(/.*)?$') THEN
      RAISE EXCEPTION 'top_items[*].link must match ^https?://… and be 8..500 chars (got: %)',
        left(coalesce(v_link, '<null>'), 60) USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.atlas_hq_users WHERE id = p_owner_id AND active AND role = 'owner') THEN
    RAISE EXCEPTION 'unknown_owner: %', p_owner_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.seer_daily_brief (owner_id, brief_date, summary_md, top_5_items, model,
                                        input_token_count, output_token_count, generated_at, read_at)
  VALUES (p_owner_id, p_date, p_summary_md, p_top_items, p_model,
          GREATEST(p_in_tokens, 0), GREATEST(p_out_tokens, 0), now(), NULL)
  ON CONFLICT (owner_id, brief_date) DO UPDATE
    SET summary_md         = EXCLUDED.summary_md,
        top_5_items        = EXCLUDED.top_5_items,
        model              = EXCLUDED.model,
        input_token_count  = EXCLUDED.input_token_count,
        output_token_count = EXCLUDED.output_token_count,
        generated_at       = now(),
        -- M-1 fix: only clear read_at if the content actually changed.
        -- A cron retry that produces identical bytes preserves read state.
        read_at = CASE
          WHEN public.seer_daily_brief.summary_md IS DISTINCT FROM EXCLUDED.summary_md
            OR public.seer_daily_brief.top_5_items IS DISTINCT FROM EXCLUDED.top_5_items
          THEN NULL
          ELSE public.seer_daily_brief.read_at
        END
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_upsert_daily_brief(uuid, date, text, jsonb, text, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_upsert_daily_brief(uuid, date, text, jsonb, text, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_upsert_daily_brief(uuid, date, text, jsonb, text, int, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.seer_upsert_daily_brief(uuid, date, text, jsonb, text, int, int) TO service_role;

-- ─── seer_list_brief_owners (INTERNAL — service-role only) ──────────────
-- M-4 fix: return (owner_id, email) so the cron's structured Vercel logs
-- carry a human-readable identifier alongside the uuid.
DROP FUNCTION IF EXISTS public.seer_list_brief_owners();
CREATE OR REPLACE FUNCTION public.seer_list_brief_owners()
RETURNS TABLE(owner_id uuid, email text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  RETURN QUERY
  SELECT hu.id, hu.email
    FROM public.atlas_hq_users hu
   WHERE hu.role = 'owner' AND hu.active
   ORDER BY hu.id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_list_brief_owners() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_list_brief_owners() FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_list_brief_owners() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.seer_list_brief_owners() TO service_role;
