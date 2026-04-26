-- 178: atlas_shared_kb revisions audit trail (greg_actions #297, follow-up to 174).
--
-- R1 finding from migration 174 was that atlas_shared_kb_update overwrites
-- body_md in place with no history — domain owners (Mark/Paul) could silently
-- rewrite Greg engineering notes and nothing recorded who clobbered what.
--
-- Fix: a trigger on atlas_shared_kb_entries captures OLD values into a
-- per-row revisions side table. The RPC publishes its caller into a
-- transaction-local GUC (`atlas.kb_editor`) so the trigger can record who
-- edited; if anything bypasses the RPC and writes directly via service_role,
-- the prior values are still captured but `editor_email` is NULL — itself a
-- signal that the audit was bypassed.

-- ── Table ─────────────────────────────────────────────────────────────────
-- entry_id is NULLABLE + ON DELETE SET NULL so deleting an entry breaks the
-- back-link but preserves the revision row + its captured prior_* values.
-- An audit trail that vanishes when the audited row is deleted is no audit.
CREATE TABLE IF NOT EXISTS public.atlas_shared_kb_revisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id       uuid REFERENCES public.atlas_shared_kb_entries(id) ON DELETE SET NULL,
  revised_at     timestamptz NOT NULL DEFAULT now(),
  editor_email   text,                  -- NULL = direct UPDATE bypassed the RPC
  prior_title    text NOT NULL,
  prior_body_md  text NOT NULL,
  prior_tags     text[] NOT NULL DEFAULT '{}'
);

ALTER TABLE public.atlas_shared_kb_revisions ENABLE ROW LEVEL SECURITY;
-- Deny-all RLS, no policies. Reads go through atlas_shared_kb_revisions_for
-- (SECURITY DEFINER); service_role bypasses for admin debugging. Revoke the
-- default permissive grants so no future RLS policy can accidentally widen
-- INSERT/UPDATE/DELETE to authenticated.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.atlas_shared_kb_revisions FROM anon, authenticated;

-- Same defense-in-depth on the entries table 174 created. Today RLS deny-all
-- protects the rows, but the schema-level grants are wide open — so any
-- future SELECT-only policy would silently flip on direct UPDATE/DELETE for
-- every authenticated user. R1 audit (#297) caught this.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.atlas_shared_kb_entries   FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS atlas_shared_kb_revisions_entry_idx
  ON public.atlas_shared_kb_revisions (entry_id, revised_at DESC);

-- ── Capture trigger ───────────────────────────────────────────────────────
-- BEFORE UPDATE trigger function. Not SECURITY DEFINER: triggers run with the
-- table owner's privileges anyway, and SECDEF is a footgun if the function is
-- ever invoked directly (R1 L1).
CREATE OR REPLACE FUNCTION public.atlas_shared_kb_capture_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_editor text;
BEGIN
  -- No-op if nothing actually changed (PG fires triggers on UPDATEs that
  -- don't change values — skip those to keep the trail tight).
  IF OLD.title    IS NOT DISTINCT FROM NEW.title
     AND OLD.body_md IS NOT DISTINCT FROM NEW.body_md
     AND OLD.tags    IS NOT DISTINCT FROM NEW.tags THEN
    RETURN NEW;
  END IF;

  v_editor := nullif(current_setting('atlas.kb_editor', true), '');

  INSERT INTO public.atlas_shared_kb_revisions (
    entry_id, editor_email, prior_title, prior_body_md, prior_tags
  ) VALUES (
    OLD.id, v_editor, OLD.title, OLD.body_md, OLD.tags
  );

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_capture_revision() FROM PUBLIC, anon, authenticated;
-- (No GRANT needed — triggers run with the table-owner privileges, not the caller's.)

DROP TRIGGER IF EXISTS atlas_shared_kb_entries_capture ON public.atlas_shared_kb_entries;
CREATE TRIGGER atlas_shared_kb_entries_capture
  BEFORE UPDATE ON public.atlas_shared_kb_entries
  FOR EACH ROW EXECUTE FUNCTION public.atlas_shared_kb_capture_revision();

-- ── Update RPC: publish caller into the GUC before UPDATE ─────────────────
CREATE OR REPLACE FUNCTION public.atlas_shared_kb_update(
  p_id            uuid,
  p_caller_email  text,
  p_title         text,
  p_body_md       text,
  p_tags          text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller          text := lower(coalesce(p_caller_email, ''));
  v_existing_author text;
  v_existing_domain text;
  v_owner_email     text;
BEGIN
  IF NOT public.atlas_shared_kb_is_member(v_caller) THEN
    RAISE EXCEPTION 'atlas_shared_kb_update: caller % not in KB allowlist', v_caller USING ERRCODE = '42501';
  END IF;

  SELECT lower(author_email), domain
    INTO v_existing_author, v_existing_domain
    FROM public.atlas_shared_kb_entries WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'atlas_shared_kb_update: entry % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  SELECT lower(owner_email) INTO v_owner_email
    FROM public.atlas_shared_kb_domains WHERE domain = v_existing_domain;

  IF v_existing_author <> v_caller AND coalesce(v_owner_email, '') <> v_caller THEN
    RAISE EXCEPTION 'atlas_shared_kb_update: % is neither author nor domain owner', v_caller USING ERRCODE = '42501';
  END IF;

  IF length(coalesce(p_body_md, '')) > 64 * 1024 THEN
    RAISE EXCEPTION 'atlas_shared_kb_update: body_md exceeds 64 KB' USING ERRCODE = '22023';
  END IF;

  -- Publish caller for the BEFORE-UPDATE trigger. is_local = true → the
  -- setting reverts at end of transaction so it can't bleed across calls.
  PERFORM set_config('atlas.kb_editor', v_caller, true);

  UPDATE public.atlas_shared_kb_entries
     SET title    = coalesce(p_title, title),
         body_md  = coalesce(p_body_md, body_md),
         tags     = coalesce(p_tags, tags)
   WHERE id = p_id;

  RETURN p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_update(uuid, text, text, text, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_shared_kb_update(uuid, text, text, text, text[]) TO authenticated, service_role;

-- ── Read RPC: list revisions for one entry ────────────────────────────────
CREATE OR REPLACE FUNCTION public.atlas_shared_kb_revisions_for(
  p_id            uuid,
  p_caller_email  text
)
RETURNS TABLE (
  id            uuid,
  revised_at    timestamptz,
  editor_email  text,
  prior_title   text,
  prior_body_md text,
  prior_tags    text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller text := lower(coalesce(p_caller_email, ''));
BEGIN
  IF NOT public.atlas_shared_kb_is_member(v_caller) THEN
    RAISE EXCEPTION 'atlas_shared_kb_revisions_for: caller % not in KB allowlist', v_caller USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.atlas_shared_kb_entries WHERE id = p_id) THEN
    RAISE EXCEPTION 'atlas_shared_kb_revisions_for: entry % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT r.id, r.revised_at, r.editor_email, r.prior_title, r.prior_body_md, r.prior_tags
    FROM public.atlas_shared_kb_revisions r
   WHERE r.entry_id = p_id
   ORDER BY r.revised_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_revisions_for(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_shared_kb_revisions_for(uuid, text) TO authenticated, service_role;
