-- Migration 226 — Helpers for daily storage-janitor cron (#522).
-- Two SECURITY DEFINER RPCs that list orphan storage objects in the
-- customer-facing private buckets:
--
--   - atlas_list_orphan_ticket_attachments(min_age_hours int)
--   - atlas_list_orphan_customer_feedback_attachments(min_age_hours int)
--
-- An "orphan" is a row in storage.objects whose `name` (the path inside
-- the bucket) is NOT referenced by any matching row in the canonical
-- public-schema reference table. Reasons orphans accumulate:
--
--   1. delete-account route's best-effort storage.remove fails partway
--      after the customer_accounts row has already been deleted and the
--      223+224 trigger has nulled image_path / cascade-deleted the
--      attachment row. The DB pointer is gone; the storage object is
--      stranded.
--   2. ticket_comments / customer_feedback rows deleted by other paths
--      (cascade from a deleted ticket / project) without an explicit
--      storage cleanup step.
--   3. Upload races: a new storage.objects row lands and the corresponding
--      DB insert fails on validation. The min_age_hours window (default 24)
--      excludes very recent objects so an in-flight upload doesn't get
--      swept before its DB row has a chance to land.
--
-- The cron route iterates the RPC output and calls
-- supabase.storage.from(bucket).remove([paths]) — Supabase's blessed path
-- for storage deletes. Raw DELETE on storage.objects is avoided so the
-- backing object metadata cleanup matches the rest of the codebase.
--
-- Each RPC has REVOKE PUBLIC + REVOKE anon + REVOKE authenticated +
-- GRANT service_role. SET search_path = public, pg_temp.

-- ── ticket-attachments ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atlas_list_orphan_ticket_attachments(
  p_min_age_hours int DEFAULT 24,
  p_limit int DEFAULT 500
) RETURNS TABLE (name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'ticket-attachments'
     AND o.created_at < now() - make_interval(hours => GREATEST(p_min_age_hours, 1))
     AND NOT EXISTS (
       SELECT 1
         FROM public.ticket_comments tc
        WHERE tc.image_path = o.name
     )
   ORDER BY o.created_at ASC
   LIMIT GREATEST(p_limit, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_list_orphan_ticket_attachments(int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_list_orphan_ticket_attachments(int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_list_orphan_ticket_attachments(int, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_orphan_ticket_attachments(int, int) TO   service_role;

-- ── customer-feedback ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atlas_list_orphan_customer_feedback_attachments(
  p_min_age_hours int DEFAULT 24,
  p_limit int DEFAULT 500
) RETURNS TABLE (name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'customer-feedback'
     AND o.created_at < now() - make_interval(hours => GREATEST(p_min_age_hours, 1))
     AND NOT EXISTS (
       SELECT 1
         FROM public.customer_feedback_attachments cfa
        WHERE cfa.file_path = o.name
     )
   ORDER BY o.created_at ASC
   LIMIT GREATEST(p_limit, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_list_orphan_customer_feedback_attachments(int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_list_orphan_customer_feedback_attachments(int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_list_orphan_customer_feedback_attachments(int, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_orphan_customer_feedback_attachments(int, int) TO   service_role;

-- ── Partial indexes for the NOT EXISTS subqueries (planner R1 H1) ─────────
-- Both RPCs do `NOT EXISTS (SELECT 1 FROM <ref> WHERE <ref>.path = o.name)`.
-- Today's row counts (32 ticket_comments, 0 customer_feedback_attachments)
-- make a seq-scan trivial; at 100k+ tickets the per-row scan would degrade.
-- Partial-NOT-NULL keeps the indexes small (most ticket_comments have NULL
-- image_path) and exactly matches the predicate the RPC uses to define a
-- "real reference." CONCURRENTLY is omitted because Supabase migrations
-- wrap in a single transaction and these tables are tiny today.
CREATE INDEX IF NOT EXISTS idx_ticket_comments_image_path
  ON public.ticket_comments (image_path)
  WHERE image_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_feedback_attachments_file_path
  ON public.customer_feedback_attachments (file_path)
  WHERE file_path IS NOT NULL;
