-- 044-rls-performance.sql — Optimize org RLS performance
-- Replace the per-row auth_user_org_ids() function call with a session-cached version.
-- The original function queries org_memberships on EVERY row evaluation.
-- This version caches the result for the duration of the transaction.

-- Use a GUC (Grand Unified Configuration) variable to cache org IDs per session
CREATE OR REPLACE FUNCTION public.auth_user_org_ids()
RETURNS UUID[] LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  cached TEXT;
  result UUID[];
BEGIN
  -- Try to read from session cache
  BEGIN
    cached := current_setting('app.user_org_ids', true);
  EXCEPTION WHEN OTHERS THEN
    cached := NULL;
  END;

  IF cached IS NOT NULL AND cached != '' THEN
    RETURN cached::UUID[];
  END IF;

  -- Query and cache
  SELECT COALESCE(
    ARRAY(SELECT org_id FROM org_memberships WHERE user_id = auth.uid()),
    '{}'::UUID[]
  ) INTO result;

  -- Cache for this transaction
  PERFORM set_config('app.user_org_ids', result::TEXT, true);

  RETURN result;
END;
$$;

-- Also optimize auth_is_platform_user — cache per transaction
CREATE OR REPLACE FUNCTION public.auth_is_platform_user()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  cached TEXT;
  result BOOLEAN;
BEGIN
  BEGIN
    cached := current_setting('app.is_platform_user', true);
  EXCEPTION WHEN OTHERS THEN
    cached := NULL;
  END;

  IF cached IS NOT NULL AND cached != '' THEN
    RETURN cached::BOOLEAN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM org_memberships om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = auth.uid() AND o.org_type = 'platform'
  ) OR auth_is_super_admin() INTO result;

  PERFORM set_config('app.is_platform_user', result::TEXT, true);

  RETURN result;
END;
$$;
