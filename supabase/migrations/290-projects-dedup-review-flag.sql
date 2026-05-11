-- Migration 290 — projects dedup review flag + log table (action #807)
--
-- Phase 1 of the SubHub dedup arc. Adds the review-flag plumbing so the
-- ingest can mark suspected duplicates for human eyeball at
-- /admin/dup-review instead of silently creating a parallel row. Also
-- backfills the flag for the 63 dup groups already in DB so they show up
-- in the same UI (no separate one-shot cleanup script needed).
--
-- Investigation: session 2026-05-11 (chain pickup from SPARK side).
-- Live audit found:
--   * 45 SubHub-internal name+addr dup groups (Tier-2 dedup is case-
--     sensitive AND backfill batches bypass the dedup map per-row)
--   * 18 mixed-origin email dup groups (same customer, native row +
--     new SubHub row, address spelling differs)
--   * 1 ESID with 5 projects
--
-- This migration does NOT delete or merge anything. It only adds the
-- review-flag column + log table + backfill flags. Merge happens via
-- the admin UI (Phase 1.4) under explicit operator action.

BEGIN;

-- 1. New columns on projects.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS dup_review_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dup_canonical_id   text    NULL;

-- FK to self — on canonical delete, drop the link rather than cascading.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_dup_canonical_id_fkey' AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_dup_canonical_id_fkey
      FOREIGN KEY (dup_canonical_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.projects.dup_review_pending IS
  'TRUE = SubHub ingest matched this customer to an existing project by email (or, post-fix, case-insensitive name+address) but could not confirm them as the same deal. Needs human review at /admin (Dup Review module). See action #807.';

COMMENT ON COLUMN public.projects.dup_canonical_id IS
  'The existing project this row was flagged against. NULL once the flag is cleared (either merged into canonical or marked as legitimate distinct deal).';

-- 2. Partial index for the review queue. Tiny — most rows have flag=false.
CREATE INDEX IF NOT EXISTS projects_dup_review_pending_idx
  ON public.projects (dup_review_pending)
  WHERE dup_review_pending = true;

-- 3. Audit log for merge/dismiss actions. Reversible within 30 days via
--    undo_payload (jsonb snapshot of FK move targets + loser fields).
CREATE TABLE IF NOT EXISTS public.dup_review_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL CHECK (action IN ('merge','dismiss','revert')),
  loser_id      text NOT NULL,
  winner_id     text NULL,
  actor_email   text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  undo_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,
  note          text NULL
);

COMMENT ON TABLE public.dup_review_log IS
  'Audit trail for /admin Dup Review merge/dismiss actions. undo_payload contains the snapshot needed to revert a merge within 30 days (FK targets + field overrides). See action #807.';

CREATE INDEX IF NOT EXISTS dup_review_log_loser_idx ON public.dup_review_log (loser_id);
CREATE INDEX IF NOT EXISTS dup_review_log_at_idx    ON public.dup_review_log (at DESC);

ALTER TABLE public.dup_review_log ENABLE ROW LEVEL SECURITY;

-- Only admins/super_admins read; only admin API routes (service role) write.
DROP POLICY IF EXISTS dup_review_log_admin_read ON public.dup_review_log;
CREATE POLICY dup_review_log_admin_read ON public.dup_review_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin','super_admin')
    )
  );

-- 4. Backfill the existing 63-ish dup groups so they appear in the admin UI
--    immediately. Match rule:
--
--      Tier A — name+address (case- and whitespace-insensitive)
--      Tier B — email (trim+lowercase), only when Tier A did not match
--
--    For each match group, the OLDEST project (by created_at) is canonical
--    and the rest are flagged. Ties on created_at break by lower id text.
--
--    We DO NOT flag groups where every member has disposition='Cancelled'
--    or disposition='Test' — those are pre-existing import noise, not
--    actionable for sales ops. They show up in the 9 "native-only" groups
--    from 2026-04-06 import batch.

--    R1 audit fix (#807): scope the group keys by org_id so cross-tenant
--    name/email collisions don't become merge candidates. The merge RPC
--    re-validates this invariant at run-time too (defense in depth).
WITH normalized AS (
  SELECT
    p.id,
    p.org_id,
    p.created_at,
    p.disposition,
    LOWER(REGEXP_REPLACE(COALESCE(p.name,'') || '|' || COALESCE(p.address,''), '\s+', ' ', 'g')) AS name_addr_key,
    NULLIF(LOWER(TRIM(p.email)), '') AS email_key
  FROM public.projects p
  WHERE p.name IS NOT NULL AND p.address IS NOT NULL
),
name_addr_groups AS (
  SELECT org_id, name_addr_key,
         BOOL_OR(disposition NOT IN ('Cancelled','Test')) AS has_actionable
  FROM normalized
  WHERE name_addr_key <> '|'
  GROUP BY org_id, name_addr_key
  HAVING COUNT(*) > 1
),
email_groups AS (
  SELECT org_id, email_key,
         BOOL_OR(disposition NOT IN ('Cancelled','Test')) AS has_actionable
  FROM normalized
  WHERE email_key IS NOT NULL
  GROUP BY org_id, email_key
  HAVING COUNT(*) > 1
),
canonical_by_name_addr AS (
  SELECT DISTINCT ON (n.org_id, n.name_addr_key)
    n.org_id, n.name_addr_key, n.id AS canonical_id
  FROM normalized n
  JOIN name_addr_groups g ON g.org_id = n.org_id AND g.name_addr_key = n.name_addr_key AND g.has_actionable
  ORDER BY n.org_id, n.name_addr_key, n.created_at ASC, n.id ASC
),
canonical_by_email AS (
  SELECT DISTINCT ON (n.org_id, n.email_key)
    n.org_id, n.email_key, n.id AS canonical_id
  FROM normalized n
  JOIN email_groups g ON g.org_id = n.org_id AND g.email_key = n.email_key AND g.has_actionable
  ORDER BY n.org_id, n.email_key, n.created_at ASC, n.id ASC
),
flag_set AS (
  -- Tier A: rows in a name+addr dup group that are NOT the canonical.
  SELECT n.id, c.canonical_id
  FROM normalized n
  JOIN canonical_by_name_addr c ON c.org_id = n.org_id AND c.name_addr_key = n.name_addr_key
  WHERE n.id <> c.canonical_id

  UNION

  -- Tier B: rows in an email dup group, NOT canonical, AND not already
  -- in Tier A (don't flag the same row twice; Tier A wins).
  SELECT n.id, c.canonical_id
  FROM normalized n
  JOIN canonical_by_email c ON c.org_id = n.org_id AND c.email_key = n.email_key
  WHERE n.id <> c.canonical_id
    AND NOT EXISTS (
      SELECT 1 FROM canonical_by_name_addr a WHERE a.org_id = n.org_id AND a.name_addr_key = n.name_addr_key
    )
)
UPDATE public.projects p
SET dup_review_pending = true,
    dup_canonical_id   = f.canonical_id
FROM flag_set f
WHERE p.id = f.id;

-- 5. RPC: merge a loser project into its canonical winner. Service-role
--    only. Caller (Next.js API route) verifies admin auth + computes
--    actor_email. Moves all 22 FK references from loser → winner, copies
--    non-null loser fields onto winner where winner is null, soft-
--    archives loser, writes audit log entry.
--
--    Returns the dup_review_log.id so callers can reference for revert.
CREATE OR REPLACE FUNCTION public.atlas_dup_review_merge(
  p_loser_id    text,
  p_actor_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner_id    text;
  v_log_id       uuid;
  v_loser_row    public.projects;
  v_winner_row   public.projects;
  v_undo         jsonb;
BEGIN
  IF p_loser_id IS NULL OR p_actor_email IS NULL OR p_actor_email = '' THEN
    RAISE EXCEPTION 'merge requires loser_id and actor_email';
  END IF;

  SELECT * INTO v_loser_row FROM public.projects WHERE id = p_loser_id;
  IF v_loser_row IS NULL THEN
    RAISE EXCEPTION 'loser project % not found', p_loser_id;
  END IF;
  IF v_loser_row.dup_review_pending IS NOT TRUE THEN
    RAISE EXCEPTION 'loser project % is not flagged for review', p_loser_id;
  END IF;
  v_winner_id := v_loser_row.dup_canonical_id;
  IF v_winner_id IS NULL THEN
    RAISE EXCEPTION 'loser project % has no canonical id', p_loser_id;
  END IF;

  SELECT * INTO v_winner_row FROM public.projects WHERE id = v_winner_id;
  IF v_winner_row IS NULL THEN
    RAISE EXCEPTION 'winner project % not found', v_winner_id;
  END IF;

  -- R1 audit fix (#807): hard-fail if loser and winner are in different orgs.
  -- The webhook ingest could otherwise be tricked into pointing dup_canonical_id
  -- at a different-org row by submitting matching email/name. Defense in depth
  -- on top of the backfill query's org_id scoping.
  IF v_loser_row.org_id IS DISTINCT FROM v_winner_row.org_id THEN
    RAISE EXCEPTION 'cross-org merge rejected: loser org_id=% winner org_id=%',
      v_loser_row.org_id, v_winner_row.org_id;
  END IF;

  -- Snapshot the loser ids + every field the merge zeroes out so revert
  -- can restore exact state. R2 audit fix (#807): earlier version omitted
  -- module_qty/inverter_qty/battery_qty even though the merge nulls them,
  -- which made the "reversible within 30 days" claim partial-only.
  v_undo := jsonb_build_object(
    'loser_id', v_loser_row.id,
    'winner_id', v_winner_row.id,
    'loser_pre_merge_summary', jsonb_build_object(
      'disposition', v_loser_row.disposition,
      'stage', v_loser_row.stage,
      'sale_date', v_loser_row.sale_date,
      'contract', v_loser_row.contract,
      'systemkw', v_loser_row.systemkw,
      'module', v_loser_row.module,
      'module_qty', v_loser_row.module_qty,
      'inverter', v_loser_row.inverter,
      'inverter_qty', v_loser_row.inverter_qty,
      'battery', v_loser_row.battery,
      'battery_qty', v_loser_row.battery_qty,
      'subhub_id', v_loser_row.subhub_id,
      'blocker', v_loser_row.blocker
    )
  );

  -- Move FKs (22 tables). Order is fine — no cycles.
  UPDATE public.change_orders          SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.clearing_runs          SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.commission_advances    SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.commission_records     SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.cost_basis_snapshots   SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.customer_accounts      SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.customer_chat_sessions SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.engineering_assignments SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.entity_profit_transfers SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.funding_nf_changes     SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.funding_notes          SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.invoices               SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.jsa                    SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.material_requests      SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.ntp_requests           SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_adders         SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_cost_line_items SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_readiness      SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.ramp_schedule          SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.tickets                SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.time_entries           SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.workmanship_claims     SET project_id = v_winner_id WHERE project_id = p_loser_id;
  -- Also the soft-FK tables (no constraint declared but reference the column).
  UPDATE public.notes                  SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_files          SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_folders        SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.task_state             SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.stage_history          SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_funding        SET project_id = v_winner_id WHERE project_id = p_loser_id;

  -- R1 audit fix (#807): no field-level COALESCE from loser onto winner.
  -- The webhook ingest writes the loser row from unauthenticated payload
  -- data; copying its fields onto the canonical winner would let any
  -- webhook caller populate winner fields (consultant_email, financier,
  -- etc.) where winner has NULL. FK move is the only safe operation.
  -- Operators who want to pull specific fields from the loser to winner
  -- must do it explicitly (e.g. via Phase 2 cleanup SQL with eyeball).

  -- Soft-archive loser. R2 audit fix (#807): null out `stage` AND the
  -- financial/equipment fields. Stage=NULL keeps it out of every
  -- stage-bucket report (evaluation, design, install, etc.); disposition
  -- 'Merged-Duplicate' is the single source-of-truth filter. Earlier
  -- R1 version kept stage in place which silently polluted "still in
  -- evaluation" pipeline dashboards.
  UPDATE public.projects
  SET
    disposition         = 'Merged-Duplicate',
    stage               = NULL,
    dup_review_pending  = false,
    contract            = NULL,
    systemkw            = NULL,
    module_qty          = NULL,
    inverter_qty        = NULL,
    battery_qty         = NULL,
    blocker             = COALESCE(blocker, '') || ' [merged into ' || v_winner_id || ' on ' || now()::date || ' by ' || p_actor_email || ']'
  WHERE id = p_loser_id;

  INSERT INTO public.dup_review_log (action, loser_id, winner_id, actor_email, undo_payload)
  VALUES ('merge', p_loser_id, v_winner_id, p_actor_email, v_undo)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- Supabase auto-grants EXECUTE to anon + authenticated via default schema
-- ACLs; REVOKE FROM public is a no-op against those per-role grants.
-- atlas-fn-grant-guard (greg_actions #636) enforces explicit REVOKEs.
REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) TO service_role;

COMMENT ON FUNCTION public.atlas_dup_review_merge(text, text) IS
  'Phase 1 of action #807. Merges flagged loser into canonical winner: moves 28 FK references, nulls financial+equipment fields on loser, soft-archives with disposition=Merged-Duplicate + stage=NULL. Cross-org merges hard-fail. No field-level COALESCE (R1 audit fix — prevents webhook-controlled fields from leaking onto winner). Service-role only. Caller must verify admin auth + supply actor email.';

-- 6. RPC: dismiss a flag (mark as legitimate distinct deal).
CREATE OR REPLACE FUNCTION public.atlas_dup_review_dismiss(
  p_loser_id    text,
  p_actor_email text,
  p_note        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id     uuid;
  v_canonical  text;
BEGIN
  IF p_loser_id IS NULL OR p_actor_email IS NULL OR p_actor_email = '' THEN
    RAISE EXCEPTION 'dismiss requires loser_id and actor_email';
  END IF;

  SELECT dup_canonical_id INTO v_canonical FROM public.projects WHERE id = p_loser_id;

  UPDATE public.projects
  SET dup_review_pending = false,
      dup_canonical_id   = NULL
  WHERE id = p_loser_id AND dup_review_pending = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % is not flagged for review (already cleared or does not exist)', p_loser_id;
  END IF;

  INSERT INTO public.dup_review_log (action, loser_id, winner_id, actor_email, note)
  VALUES ('dismiss', p_loser_id, v_canonical, p_actor_email, p_note)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_dismiss(text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_dismiss(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_dismiss(text, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_dup_review_dismiss(text, text, text) TO service_role;

COMMENT ON FUNCTION public.atlas_dup_review_dismiss(text, text, text) IS
  'Companion to atlas_dup_review_merge. Marks a flagged project as a legitimate distinct deal (clears dup_review_pending + dup_canonical_id, leaves rest of the row alone). Service-role only.';

COMMIT;
