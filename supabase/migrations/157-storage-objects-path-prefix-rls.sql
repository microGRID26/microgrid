-- Migration 157 — storage.objects path-prefix RLS + row-level path-integrity triggers.
-- Closes residual client-controlled path surface post-bucket-flip (migration 150/154).
-- Two-layer defense: (1) storage.objects RLS so upload/read only works at paths matching
-- a row the caller can see via existing table RLS; (2) BEFORE INSERT/UPDATE trigger on
-- ticket_comments + rep_files that enforces image_path/file_path first-segment equals
-- the row's ticket_id/rep_id. Service-role bypass preserved so HQ rendering + server
-- actions still work.

DROP POLICY IF EXISTS "ticket_attachments_upload" ON storage.objects;

CREATE POLICY "ticket_attachments_insert_path_prefix"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND name ~ '^[0-9a-f-]{36}/[^/]+$'
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id::text = (storage.foldername(name))[1]
      AND (
        (t.org_id IS NULL)
        OR (t.org_id = ANY (auth_user_org_ids()))
        OR auth_is_platform_user()
        OR EXISTS (
          SELECT 1 FROM public.customer_accounts ca
          WHERE ca.project_id = t.project_id
            AND ca.auth_user_id = (SELECT auth.uid())
            AND ca.status = 'active'
        )
      )
  )
);

CREATE POLICY "ticket_attachments_select_path_prefix"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND name ~ '^[0-9a-f-]{36}/[^/]+$'
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id::text = (storage.foldername(name))[1]
      AND (
        (t.org_id IS NULL)
        OR (t.org_id = ANY (auth_user_org_ids()))
        OR auth_is_platform_user()
        OR EXISTS (
          SELECT 1 FROM public.customer_accounts ca
          WHERE ca.project_id = t.project_id
            AND ca.auth_user_id = (SELECT auth.uid())
            AND ca.status = 'active'
        )
      )
  )
);

CREATE POLICY "ticket_attachments_service_role_all"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'ticket-attachments')
WITH CHECK (bucket_id = 'ticket-attachments');

DROP POLICY IF EXISTS "rep_files_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "rep_files_storage_delete" ON storage.objects;

CREATE POLICY "rep_files_insert_path_prefix"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'rep-files'
  AND name ~ '^[0-9a-f-]{36}/[^/]+$'
  AND (auth_is_admin() OR auth_is_super_admin())
  AND EXISTS (
    SELECT 1 FROM public.sales_reps r
    WHERE r.id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "rep_files_select_path_prefix"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'rep-files'
  AND name ~ '^[0-9a-f-]{36}/[^/]+$'
  AND (auth_is_admin() OR auth_is_super_admin())
  AND EXISTS (
    SELECT 1 FROM public.sales_reps r
    WHERE r.id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "rep_files_delete_path_prefix"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'rep-files'
  AND (auth_is_admin() OR auth_is_super_admin())
);

CREATE POLICY "rep_files_service_role_all"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'rep-files')
WITH CHECK (bucket_id = 'rep-files');

CREATE OR REPLACE FUNCTION public.enforce_ticket_comment_image_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.image_path IS NOT NULL THEN
    IF NEW.image_path !~ ('^' || NEW.ticket_id::text || '/[^/]+$') THEN
      RAISE EXCEPTION 'image_path must be <ticket_id>/<filename>, got: %', NEW.image_path
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_ticket_comment_image_path() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_ticket_comment_image_path() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_ticket_comment_image_path() FROM authenticated;

DROP TRIGGER IF EXISTS trg_enforce_ticket_comment_image_path ON public.ticket_comments;
CREATE TRIGGER trg_enforce_ticket_comment_image_path
BEFORE INSERT OR UPDATE ON public.ticket_comments
FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_comment_image_path();

CREATE OR REPLACE FUNCTION public.enforce_rep_file_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.file_path IS NOT NULL THEN
    IF NEW.file_path !~ ('^' || NEW.rep_id::text || '/[^/]+$') THEN
      RAISE EXCEPTION 'file_path must be <rep_id>/<filename>, got: %', NEW.file_path
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_rep_file_path() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_rep_file_path() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_rep_file_path() FROM authenticated;

DROP TRIGGER IF EXISTS trg_enforce_rep_file_path ON public.rep_files;
CREATE TRIGGER trg_enforce_rep_file_path
BEFORE INSERT OR UPDATE ON public.rep_files
FOR EACH ROW EXECUTE FUNCTION public.enforce_rep_file_path();
