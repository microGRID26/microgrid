-- Migration 325 — harden _atlas_resolve_source_feedback (R1 mitigations on mig 324)
--
-- R1 red-teamer on mig 324 (2026-05-13): grade B (0C/1H/3M/1L).
-- H-1 verified safe inline (normalizeStatus in lib/feedback/fetch.ts accepts
-- 'closed' as terminal for all status-column sources). Mitigating the 3 Mediums
-- + 1 Low here.
--
-- M-1: recursion guard via pg_trigger_depth() — defensive against future
--      source-table triggers that write back to atlas_feedback_actions.
-- M-2: qualify now() as pg_catalog.now() — belt-and-suspenders SECDEF pattern.
-- M-3: explicit REVOKE EXECUTE on the trigger function from public — even
--      though trigger fns can only run as triggers, atlas-fn-grant-guard
--      pattern requires it for posture consistency.
-- L-1: inline comment on bread_of_life branch — column shape differs by design.

CREATE OR REPLACE FUNCTION public._atlas_resolve_source_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fid uuid;
BEGIN
  -- M-1: recursion guard. If a future trigger on a source table writes back
  -- to atlas_feedback_actions, prevent loop. Idempotency guard below would
  -- terminate the cycle one round-trip later, but cheaper to short-circuit.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.fix_status IS NOT DISTINCT FROM OLD.fix_status THEN
    RETURN NEW;
  END IF;
  IF NEW.fix_status <> 'shipped' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_fid := NEW.feedback_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;

  CASE NEW.source
    WHEN 'microgrid' THEN
      UPDATE public.customer_feedback
         SET status = 'closed', updated_at = pg_catalog.now()
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
         SET status = 'closed', updated_at = pg_catalog.now()
       WHERE id = v_fid AND status IS DISTINCT FROM 'closed';
    WHEN 'bread_of_life' THEN
      -- L-1: BoL schema has no status column (only read boolean). Intentional
      -- divergence — don't "fix" by adding a status write here.
      UPDATE public.bread_of_life_feedback
         SET read = true
       WHERE id = v_fid AND read = false;
    ELSE
      -- Cross-tenant: bloom (Collector), quest (Quest), spark (SPARK).
      -- Follow-up #1055 — per-tenant callback.
      NULL;
  END CASE;

  RETURN NEW;
END $$;

-- M-3: even though trigger fns aren't directly callable, mirror the codebase
-- SECDEF posture standard (atlas-fn-grant-guard pattern).
REVOKE EXECUTE ON FUNCTION public._atlas_resolve_source_feedback() FROM public;
