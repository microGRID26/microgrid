-- Migration 222 — block direct UPDATE on projects.use_sld_v2 (cumulative R1 M1)
--
-- DRAFT — needs Greg auth before apply.
--
-- Migration 221 added the `use_sld_v2 boolean` column for per-project v2
-- SLD rollout. Phase 7a framed it as "flip one project at a time without
-- env-wide blast radius," but as shipped any manager in the project's org
-- can flip the column on any project in their org via direct UPDATE in the
-- Supabase client. Bounded blast (single org, not cross-tenant), so
-- Medium-severity in cumulative R1, but the rollout-gating contract is not
-- enforced — Atlas/Greg should be the only flip authority during the v2
-- pilot.
--
-- Pattern: 215b's BEFORE UPDATE trigger on stage / stage_date. The trigger
-- raises an exception unless either:
--   (a) the caller is service_role / unauthenticated (deploys, ops, CLI), OR
--   (b) the caller is a platform admin (super_admin or admin role).
--
-- Manager-role users keep all their other UPDATE privileges on projects;
-- only the use_sld_v2 column is gated. When Phase 8 lifts the v2 rollout
-- from per-project to default, this trigger can be dropped in a follow-up.

CREATE OR REPLACE FUNCTION public.projects_block_direct_use_sld_v2_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF (NEW.use_sld_v2 IS DISTINCT FROM OLD.use_sld_v2) THEN
    IF NOT public.auth_is_admin() THEN
      RAISE EXCEPTION 'projects.use_sld_v2 can only be flipped by admin/super_admin during the v2 rollout'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.projects_block_direct_use_sld_v2_update() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.projects_block_direct_use_sld_v2_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.projects_block_direct_use_sld_v2_update() TO authenticated;

DROP TRIGGER IF EXISTS projects_block_direct_use_sld_v2_update_trg ON public.projects;
CREATE TRIGGER projects_block_direct_use_sld_v2_update_trg
BEFORE UPDATE OF use_sld_v2 ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.projects_block_direct_use_sld_v2_update();
