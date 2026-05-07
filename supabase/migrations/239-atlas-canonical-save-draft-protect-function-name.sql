-- 239-atlas-canonical-save-draft-protect-function-name.sql
--
-- #598 R1 HIGH-1 fix. atlas_canonical_save_draft (mig 230) ON CONFLICT DO
-- UPDATE freely overwrites function_name. A previously-verified canonical
-- report's function_name is the integrity binding between the catalog row
-- (expected behavior, expected_row_count, expected_aggregates) and the
-- actual SQL the evaluator runs. Letting save_draft re-bind that mapping
-- silently demotes a verified contract — the ON CONFLICT clause already
-- demotes status verified→draft (which is fine), but a re-publish via
-- atlas_canonical_verify with the swapped function_name then re-locks the
-- contract under a different SQL body without the verifier ever seeing the
-- original.
--
-- Fix: refuse function_name mutation on rows where verified_at IS NOT NULL.
-- The caller can still edit name/description/category/example_questions/
-- parameter_schema/result_columns/draft_sql/owner — those are display and
-- behavioral knobs, not the integrity binding.
--
-- To swap function_name on a previously-verified report, the admin must
-- explicitly delete the row via the platform (or future RPC) and re-create.
-- That's the audit-trail-preserving path.
--
-- All other behavior (auth check, role check, INSERT, ON CONFLICT for
-- non-function-name fields, version bump, demote-to-draft) is preserved
-- byte-for-byte from migration 230.

CREATE OR REPLACE FUNCTION public.atlas_canonical_save_draft(
  p_id text,
  p_name text,
  p_description text,
  p_category text,
  p_example_questions text[],
  p_parameter_schema jsonb,
  p_result_columns jsonb,
  p_function_name text,
  p_draft_sql text,
  p_owner text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_role text;
  v_existing_function_name text;
  v_existing_verified_at timestamptz;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT role INTO v_role FROM public.users WHERE id = v_caller_id;
  IF v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Drafting reports requires admin or super_admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- #598 R1 HIGH-1 guard.
  SELECT function_name, verified_at
  INTO v_existing_function_name, v_existing_verified_at
  FROM public.atlas_canonical_reports
  WHERE id = p_id;

  IF v_existing_verified_at IS NOT NULL
     AND v_existing_function_name IS DISTINCT FROM p_function_name THEN
    RAISE EXCEPTION
      'Cannot mutate function_name on previously-verified canonical report % (verified at %); current=%, requested=%. Delete + re-create to swap.',
      p_id, v_existing_verified_at, v_existing_function_name, p_function_name
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.atlas_canonical_reports (
    id, name, description, category, example_questions, parameter_schema,
    result_columns, function_name, draft_sql, owner, status
  ) VALUES (
    p_id, p_name, p_description, p_category, p_example_questions, p_parameter_schema,
    p_result_columns, p_function_name, p_draft_sql, p_owner, 'draft'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    example_questions = EXCLUDED.example_questions,
    parameter_schema = EXCLUDED.parameter_schema,
    result_columns = EXCLUDED.result_columns,
    function_name = EXCLUDED.function_name,
    draft_sql = EXCLUDED.draft_sql,
    owner = EXCLUDED.owner,
    status = CASE WHEN public.atlas_canonical_reports.status = 'verified' THEN 'draft' ELSE public.atlas_canonical_reports.status END,
    version = public.atlas_canonical_reports.version + 1,
    updated_at = now();

  RETURN p_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) TO authenticated;
