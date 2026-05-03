-- Atomic append for projects.partner_documents (closes #472).
--
-- The Partner API doc-upload route does read-modify-write on a JSONB array:
--   1. SELECT partner_documents from projects WHERE id = $1
--   2. nextDocs = [...prior, doc]
--   3. UPDATE projects SET partner_documents = nextDocs WHERE id = $1
--
-- Two concurrent POSTs from the same partner read the same prior array,
-- each appends its own doc, second UPDATE clobbers the first → silent data
-- loss. Idempotency keys don't help (different keys per real upload).
--
-- Real-world risk surfaced 2026-05-02 audit-rotation slot `partner-api-v1`
-- (Medium #1 of 4): a solicit rep mobile app retrying on flaky network or
-- batch-uploading 5 docs in parallel could lose N-1 docs. No DB-level
-- optimistic lock today, no conditional-update predicate.
--
-- This migration introduces an RPC that wraps the read + scope-check +
-- append in a single transaction with SELECT FOR UPDATE on the projects
-- row. Concurrent appends serialize on the row lock; no doc is ever lost.
--
-- The route handler (app/api/v1/partner/leads/[id]/documents/route.ts) is
-- updated in the same commit to call this RPC instead of the read-modify-
-- write pair.
--
-- Future: a child table with FK to projects is the cleanest end-state
-- (per-doc indexed lookups, soft-delete, no JSONB row-rewrite cost). Out
-- of scope here — that's a larger migration. This unblocks today.

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
  -- Validate arguments. Service role is the only EXECUTE grantee, so this
  -- guards against an internal caller passing a malformed p_caller_org_type
  -- string and accidentally hitting the platform-bypass branch below.
  IF p_caller_org_type IS NULL OR p_caller_org_type NOT IN ('platform', 'partner') THEN
    RAISE EXCEPTION 'invalid_caller_org_type' USING ERRCODE = '22023';
  END IF;
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' THEN
    RAISE EXCEPTION 'invalid_doc_payload' USING ERRCODE = '22023';
  END IF;

  -- Lock the row for the duration of this transaction. Concurrent callers
  -- block here until the first one commits.
  SELECT origination_partner_org_id, partner_documents
    INTO v_origination_org_id, v_next_docs
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Re-enforce the origination-org scope server-side. The route handler
  -- already checks this pre-RPC, but a defense-in-depth check inside the
  -- transaction prevents a future caller from skipping the check.
  IF p_caller_org_type IS DISTINCT FROM 'platform'
     AND (v_origination_org_id IS NULL OR v_origination_org_id IS DISTINCT FROM p_caller_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Atomic append. COALESCE keeps the function safe if a column default
  -- regresses to NULL.
  v_next_docs := COALESCE(v_next_docs, '[]'::jsonb) || jsonb_build_array(p_doc);

  UPDATE public.projects
     SET partner_documents = v_next_docs
   WHERE id = p_project_id;

  document_count := jsonb_array_length(v_next_docs);
  RETURN NEXT;
END;
$function$;

-- Service-role only. Partner API admin client uses the service role key.
-- No anon / authenticated execute — those clients never call this directly.
REVOKE EXECUTE ON FUNCTION public.partner_api_append_lead_document(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.partner_api_append_lead_document(text, text, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.partner_api_append_lead_document(text, text, uuid, jsonb) IS
  'Atomically append a document to projects.partner_documents under SELECT FOR UPDATE. Closes #472. Service-role only — called from app/api/v1/partner/leads/[id]/documents/route.ts.';
