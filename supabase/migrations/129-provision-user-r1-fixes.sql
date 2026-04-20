-- Migration 129: R1 fixes on migrations 127 + 128
--
-- R1 adversarial audit (red-teamer subagent, Grade B) flagged 1 HIGH + 3 MEDIUM
-- findings that this migration addresses in one shot:
--
--   HIGH (127): case-sensitive domain match. split_part(email,'@',2) preserves
--   the IdP-supplied case; = ANY(allowed_domains) is case-sensitive and
--   allowed_domains is stored lowercase. So 'Paul@EnergyDevelopmentGroup.com'
--   from Google OAuth fails the match and produces zero memberships --
--   recreating the exact bug that 127 was written to eliminate. Domains are
--   case-insensitive per RFC, so we lowercase before comparing.
--
--   MEDIUM (127): provision_user is SECURITY DEFINER and its EXECUTE is granted
--   to authenticated (required for the OAuth callback to call it). The TS
--   callback checks INTERNAL_DOMAINS BEFORE calling, but the RPC itself accepts
--   any email. An authenticated user on any app sharing this Supabase project
--   can call provision_user('attacker@gomicrogridenergy.com','x') and mint a
--   users+membership row. Fix: inside the function, require p_email to match
--   auth.email() (case-insensitive) so the caller can only self-provision.
--
--   MEDIUM (128): the LATERAL CASE for scale had no ELSE. If a future template
--   lands with a basis outside the known 8, scale is NULL, all money columns
--   become NULL, the insert either errors on NOT NULL or lands zeroed. Add an
--   explicit pre-check that raises a named exception.
--
--   MEDIUM (128): v_skipped := 28 - v_inserted hardcodes the active-template
--   count. Add or remove a template and the return is wrong. Count dynamically.
--
-- Medium finding NOT patched here (filed as P2 queue item instead): the
-- one-shot backfill in 127 already ran. On re-login, provision_user still
-- re-adds memberships for users whose rows were deliberately deleted. Proper
-- fix requires an offboarding signal (users.active=false filter, or a
-- dedicated offboarded flag) which is a bigger design call.

-- ── 1. provision_user: case-insensitive match + auth.email identity check ──
CREATE OR REPLACE FUNCTION public.provision_user(p_email text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      uuid;
  v_domain       text;
  v_caller_email text;
BEGIN
  -- Identity check: the RPC can only provision the caller's own email.
  -- SECURITY DEFINER + PUBLIC/authenticated EXECUTE means anyone who can reach
  -- PostgREST could otherwise mint a row for an arbitrary internal email.
  v_caller_email := auth.email();
  IF v_caller_email IS NULL OR lower(p_email) <> lower(v_caller_email) THEN
    RAISE EXCEPTION 'provision_user: email mismatch (caller=%, requested=%)',
      v_caller_email, p_email
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.users (email, name, active, admin)
  VALUES (p_email, p_name, true, false)
  ON CONFLICT (email) DO NOTHING;

  SELECT id INTO v_user_id FROM public.users WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  v_domain := lower(split_part(p_email, '@', 2));
  IF v_domain IS NULL OR v_domain = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.org_memberships (user_id, org_id)
  SELECT v_user_id, o.id
  FROM public.organizations o
  WHERE o.active = true
    AND o.allowed_domains IS NOT NULL
    AND v_domain = ANY (o.allowed_domains)
  ON CONFLICT DO NOTHING;
END;
$function$;

-- ── 2. Backfill: align the one-shot catch-up to the case-insensitive match ──
-- Handles any existing internal-domain users whose emails were stored with
-- uppercase characters and therefore didn't match allowed_domains on 127's
-- backfill pass.
INSERT INTO public.org_memberships (user_id, org_id)
SELECT u.id, o.id
FROM public.users u
JOIN public.organizations o
  ON o.active = true
 AND o.allowed_domains IS NOT NULL
 AND lower(split_part(u.email, '@', 2)) = ANY (o.allowed_domains)
WHERE u.active = true
ON CONFLICT DO NOTHING;

-- ── 3. backfill_project_cost_line_items: explicit basis guard + dyn count ──
CREATE OR REPLACE FUNCTION public.backfill_project_cost_line_items(p_project_id text)
RETURNS TABLE(inserted_count integer, skipped_count integer)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_systemkw      numeric;
  v_systemwatts   numeric;
  v_battery_qty   numeric;
  v_battery_kwh   numeric;
  v_inverter_qty  numeric;
  v_panel_qty     numeric;
  v_panel_pairs   numeric;
  v_inserted      int := 0;
  v_total_active  int := 0;
  v_unknown_basis text;
BEGIN
  -- R1 fix: fail loudly if any active template has a basis the CASE below
  -- does not handle. Previously the CASE silently returned NULL -> NULL
  -- money columns -> either NOT NULL violation or zeroed rows. Prefer a
  -- named exception so the error message points at the actual cause.
  SELECT default_unit_basis INTO v_unknown_basis
    FROM project_cost_line_item_templates
   WHERE active = true
     AND default_unit_basis NOT IN (
       'flat','per_kw','per_kwh','per_battery','per_inverter',
       'per_panel','per_panel_pair','per_watt'
     )
   LIMIT 1;
  IF v_unknown_basis IS NOT NULL THEN
    RAISE EXCEPTION
      'backfill_project_cost_line_items: unsupported default_unit_basis %s in active templates',
      quote_literal(v_unknown_basis);
  END IF;

  SELECT
    COALESCE(NULLIF(NULLIF(systemkw::text, '')::numeric, 0), 24.2),
    COALESCE(NULLIF(NULLIF(battery_qty::text, '')::numeric, 0), 16),
    COALESCE(NULLIF(NULLIF(inverter_qty::text, '')::numeric, 0), 2),
    COALESCE(NULLIF(NULLIF(module_qty::text, '')::numeric, 0), 55)
  INTO v_systemkw, v_battery_qty, v_inverter_qty, v_panel_qty
  FROM projects WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found: %', p_project_id;
  END IF;

  v_systemwatts := v_systemkw * 1000;
  v_battery_kwh := v_battery_qty * 5;
  v_panel_pairs := ceil(v_panel_qty / 2);

  WITH new_rows AS (
    INSERT INTO project_cost_line_items (
      project_id, template_id, sort_order, section, category, system_bucket, item_name,
      raw_cost, markup_to_distro, distro_price, markup_distro_to_epc, epc_price,
      battery_pct, pv_pct, battery_cost, pv_cost,
      proof_of_payment_status, proof_type, basis_eligibility,
      is_epc_internal, is_itc_excluded
    )
    SELECT
      p_project_id, t.id,
      t.sort_order, t.section, t.category, t.system_bucket, t.item_name,
      ROUND(s.scale * 1::numeric, 2)                                                                AS raw_cost,
      t.default_markup_to_distro,
      ROUND(s.scale * (1 + t.default_markup_to_distro), 2)                                          AS distro_price,
      t.default_markup_distro_to_epc,
      ROUND(s.scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc), 2)   AS epc_price,
      t.default_battery_pct,
      t.default_pv_pct,
      ROUND(s.scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc) * t.default_battery_pct, 2) AS battery_cost,
      ROUND(s.scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc) * t.default_pv_pct, 2)      AS pv_cost,
      'Pending'::text, t.default_proof_type, t.default_basis_eligibility,
      t.is_epc_internal, t.is_itc_excluded
    FROM project_cost_line_item_templates t,
    LATERAL (
      SELECT t.default_raw_cost * (CASE t.default_unit_basis
        WHEN 'flat'           THEN 1
        WHEN 'per_kw'         THEN v_systemkw
        WHEN 'per_kwh'        THEN v_battery_kwh
        WHEN 'per_battery'    THEN v_battery_qty
        WHEN 'per_inverter'   THEN v_inverter_qty
        WHEN 'per_panel'      THEN v_panel_qty
        WHEN 'per_panel_pair' THEN v_panel_pairs
        WHEN 'per_watt'       THEN v_systemwatts
        ELSE NULL  -- defensive: pre-flight check above prevents reaching this
      END)::numeric AS scale
    ) s
    WHERE t.active = true
      AND NOT EXISTS (
        SELECT 1 FROM project_cost_line_items existing
        WHERE existing.project_id = p_project_id AND existing.template_id = t.id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM new_rows;

  -- R1 fix: dynamic active-template count (was hardcoded 28).
  SELECT count(*) INTO v_total_active
    FROM project_cost_line_item_templates
   WHERE active = true;

  RETURN QUERY SELECT v_inserted, (v_total_active - v_inserted);
END;
$function$;
