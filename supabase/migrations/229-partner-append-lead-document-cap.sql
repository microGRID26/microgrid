-- Migration 229 — Server-side per-lead document cap inside partner_api_append_lead_document (#541).
--
-- Migration 222 introduced the atomic SELECT FOR UPDATE append RPC but left
-- the 50-doc-per-lead cap as a route-level pre-check. That pre-check races:
-- two concurrent POSTs at length=49 both pass the pre-check and the final
-- count becomes 51.
--
-- Fix: check jsonb_array_length(v_next_docs) >= 50 INSIDE the transaction,
-- after the SELECT FOR UPDATE lock is held, before the append. The lock
-- serializes concurrent callers so only the first one through at length=49
-- gets to append. The second sees length=50 and gets SQLSTATE P0001 with
-- message 'docs_limit_exceeded'.
--
-- The cap (50) mirrors MAX_PARTNER_DOCS_PER_LEAD in
-- lib/partner-api/limits.ts — update both together if the limit changes.
--
-- The route-level pre-check (lines 98-115 in documents/route.ts) is removed
-- in the same commit — it is now redundant and the extra SELECT it issued
-- costs a round-trip for every upload.
--
-- Function body is a full republish of migration 222's
-- partner_api_append_lead_document with one new block between the scope
-- check and the append. All other behavior is identical.

CREATE OR REPLACE FUNCTION public.partner_api_append_lead_document(
  p_project_id              text,
  p_caller_org_type         text,
  p_caller_org_id           uuid,
  p_doc                     jsonb
)
  RETURNS TABLE (document_count int)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_origination_org_id uuid;
  v_next_docs          jsonb;
BEGIN
  IF p_caller_org_type IS NULL OR p_caller_org_type NOT IN ('platform', 'partner') THEN
    RAISE EXCEPTION 'invalid_caller_org_type' USING ERRCODE = '22023';
  END IF;
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' THEN
    RAISE EXCEPTION 'invalid_doc_payload' USING ERRCODE = '22023';
  END IF;

  SELECT origination_partner_org_id, partner_documents
    INTO v_origination_org_id, v_next_docs
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_caller_org_type IS DISTINCT FROM 'platform'
     AND (v_origination_org_id IS NULL OR v_origination_org_id IS DISTINCT FROM p_caller_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ── Per-lead cap (closes #541): enforced atomically under the row lock ──
  -- COALESCE guards against a NULL column default regression (same as below).
  IF jsonb_array_length(COALESCE(v_next_docs, '[]'::jsonb)) >= 50 /* MAX_PARTNER_DOCS_PER_LEAD — keep in sync with lib/partner-api/limits.ts */ THEN
    RAISE EXCEPTION 'docs_limit_exceeded' USING ERRCODE = 'P0004';
  END IF;

  v_next_docs := COALESCE(v_next_docs, '[]'::jsonb) || jsonb_build_array(p_doc);

  UPDATE public.projects
     SET partner_documents = v_next_docs
   WHERE id = p_project_id;

  document_count := jsonb_array_length(v_next_docs);
  RETURN NEXT;
END;
$function$;

-- Grant posture unchanged from migration 222 — service_role only.
REVOKE EXECUTE ON FUNCTION public.partner_api_append_lead_document(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.partner_api_append_lead_document(text, text, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.partner_api_append_lead_document(text, text, uuid, jsonb) IS
  'Atomically append a document to projects.partner_documents under SELECT FOR UPDATE. Enforces the 50-doc-per-lead cap inside the lock. Closes #472 + #541. Service-role only.';
