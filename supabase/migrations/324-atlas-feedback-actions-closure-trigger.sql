-- Migration 324 — auto-close source feedback row when fix ships
--
-- Greg's standing rule 2026-05-13: when a feedback action is genuinely
-- resolved, the source-of-truth feedback row in the per-app table should
-- flip to a terminal "closed" status so it disappears from the HQ inbox.
-- Previously the autofix flow closed the greg_action but left the source
-- feedback row at status='new' — the "ghost-done" pattern. Result: the
-- inbox kept showing 14 SPARK items as "untouched" even though Atlas had
-- attempted (and skipped/failed/PR'd) every one.
--
-- This trigger fires when atlas_feedback_actions.fix_status flips to
-- 'shipped' (terminal-success state — autofix flow must set this when a
-- PR merges or a manual fix lands). Only same-tenant sources can be
-- updated by this trigger; cross-tenant sources (bloom, quest, spark) need
-- a separate callback mechanism (follow-up).
--
-- Idempotent: re-applying does CREATE OR REPLACE the function and DROP+CREATE
-- the trigger. Safe to re-run.

CREATE OR REPLACE FUNCTION public._atlas_resolve_source_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fid uuid;
BEGIN
  -- Only fire on fix_status transitions INTO 'shipped'. Idempotent — repeated
  -- updates landing on 'shipped' from 'shipped' are no-ops.
  IF NEW.fix_status IS NOT DISTINCT FROM OLD.fix_status THEN
    RETURN NEW;
  END IF;
  IF NEW.fix_status <> 'shipped' THEN
    RETURN NEW;
  END IF;

  -- atlas_feedback_actions.feedback_id is text (handles both uuid and bigint
  -- source PKs). Same-tenant sources here all use uuid PKs so we cast.
  -- bread_of_life is also uuid-keyed.
  BEGIN
    v_fid := NEW.feedback_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Source PK isn't a uuid (e.g. legacy 'feedback' bigint, or future
    -- non-uuid sources). Skip rather than fail the UPDATE on
    -- atlas_feedback_actions.
    RETURN NEW;
  END;

  CASE NEW.source
    WHEN 'microgrid' THEN
      UPDATE public.customer_feedback
         SET status = 'closed', updated_at = now()
       WHERE id = v_fid AND status IS DISTINCT FROM 'closed';

    WHEN 'spoke' THEN
      UPDATE public.spoke_feedback
         SET status = 'closed'
       WHERE id = v_fid AND status IS DISTINCT FROM 'closed';

    WHEN 'seer' THEN
      UPDATE public.seer_feedback
         SET status = 'closed'
       WHERE id = v_fid AND status IS DISTINCT FROM 'closed';

    WHEN 'atlas_hq' THEN
      UPDATE public.atlas_hq_feedback
         SET status = 'closed', updated_at = now()
       WHERE id = v_fid AND status IS DISTINCT FROM 'closed';

    WHEN 'bread_of_life' THEN
      UPDATE public.bread_of_life_feedback
         SET read = true
       WHERE id = v_fid AND read = false;

    ELSE
      -- Cross-tenant sources: bloom (Collector), quest (Quest), spark (SPARK).
      -- Their feedback tables live on a different Supabase project, so this
      -- MG-local trigger cannot reach them. Follow-up: per-tenant edge fn
      -- callback or FDW.
      NULL;
  END CASE;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS atlas_feedback_actions_resolve_source
  ON public.atlas_feedback_actions;

CREATE TRIGGER atlas_feedback_actions_resolve_source
AFTER UPDATE OF fix_status ON public.atlas_feedback_actions
FOR EACH ROW
WHEN (NEW.fix_status = 'shipped')
EXECUTE FUNCTION public._atlas_resolve_source_feedback();

COMMENT ON FUNCTION public._atlas_resolve_source_feedback IS
  'Fires when atlas_feedback_actions.fix_status flips to ''shipped''. Updates the source feedback row to a terminal state so the HQ /feedback inbox stops showing it. Same-tenant only (microgrid/spoke/seer/atlas_hq/bread_of_life). Cross-tenant (bloom/quest/spark) need a callback. Mig 324, 2026-05-13.';
