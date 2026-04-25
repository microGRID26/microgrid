-- 174: Shared knowledge base across Greg / Mark / Paul Claude accounts
-- greg_actions #211. 2026-04-25.
--
-- NOTE: name prefix is `atlas_shared_kb_*` because `atlas_kb_*` collides
-- with the existing employee Q&A KB (atlas_kb_entries / atlas_kb_search etc).
--
-- Architecture (v0):
--   * Two tables on MG database (deny-all RLS — only the SECDEF RPCs below
--     can read/write).
--   * Domain ownership encoded in atlas_shared_kb_domains. Caller asserts
--     their email via p_caller_email; the write RPC checks it matches the
--     domain's owner_email (or NULL = open, e.g. 'general').
--   * Read RPCs are open to the 3-person allowlist.
--
-- v1 (later) replaces caller-asserted email with a Supabase OAuth 2.1 server
-- JWT, at which point auth.uid() resolves the caller and the helper-script
-- identity moves into JWT claims.

-- ── Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.atlas_shared_kb_domains (
  domain        text PRIMARY KEY,
  owner_email   text,                 -- NULL = anyone in allowlist may write
  label         text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_shared_kb_domains ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.atlas_shared_kb_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        text NOT NULL REFERENCES public.atlas_shared_kb_domains(domain),
  author_email  text NOT NULL,
  title         text NOT NULL,
  body_md       text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_shared_kb_entries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS atlas_shared_kb_entries_domain_idx ON public.atlas_shared_kb_entries (domain);
CREATE INDEX IF NOT EXISTS atlas_shared_kb_entries_author_idx ON public.atlas_shared_kb_entries (author_email);
CREATE INDEX IF NOT EXISTS atlas_shared_kb_entries_tags_idx   ON public.atlas_shared_kb_entries USING gin (tags);
CREATE INDEX IF NOT EXISTS atlas_shared_kb_entries_fts_idx
  ON public.atlas_shared_kb_entries
  USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body_md,'')));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.atlas_shared_kb_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS atlas_shared_kb_entries_touch ON public.atlas_shared_kb_entries;
CREATE TRIGGER atlas_shared_kb_entries_touch
  BEFORE UPDATE ON public.atlas_shared_kb_entries
  FOR EACH ROW EXECUTE FUNCTION public.atlas_shared_kb_touch_updated_at();

-- ── Seed: 5 domains ────────────────────────────────────────────────────────

INSERT INTO public.atlas_shared_kb_domains (domain, owner_email, label, description) VALUES
  ('legal',       'paul@energydevelopmentgroup.com', 'Legal',           'Contracts, legal precedent, regulatory positions. Paul writes; Greg + Mark read.'),
  ('finance',     'paul@energydevelopmentgroup.com', 'Finance',         'Financial model assumptions, ITC interpretations, tax positions. Paul writes; Greg + Mark read.'),
  ('engineering', 'greg@gomicrogridenergy.com',      'Engineering',     'Code architecture, schema decisions, infra notes. Greg writes; Paul + Mark read.'),
  ('strategy',    'mark@energydevelopmentgroup.com', 'CEO / Strategy',  'Org-wide strategy, customer relationships, partner deals. Mark writes; Greg + Paul read.'),
  ('general',     NULL,                              'General',         'Cross-domain notes anyone can write.')
ON CONFLICT (domain) DO UPDATE SET
  owner_email = EXCLUDED.owner_email,
  label       = EXCLUDED.label,
  description = EXCLUDED.description;

-- ── RPCs ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atlas_shared_kb_is_member(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
STABLE
AS $function$
  SELECT lower(p_email) = ANY(ARRAY[
    'greg@gomicrogridenergy.com',
    'mark@energydevelopmentgroup.com',
    'paul@energydevelopmentgroup.com'
  ]);
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_is_member(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_shared_kb_is_member(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atlas_shared_kb_write(
  p_domain        text,
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
  v_owner_email text;
  v_id uuid;
  v_caller text := lower(coalesce(p_caller_email, ''));
BEGIN
  IF NOT public.atlas_shared_kb_is_member(v_caller) THEN
    RAISE EXCEPTION 'atlas_shared_kb_write: caller % not in KB allowlist', v_caller USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'atlas_shared_kb_write: title required' USING ERRCODE = '22023';
  END IF;
  IF p_body_md IS NULL OR length(trim(p_body_md)) = 0 THEN
    RAISE EXCEPTION 'atlas_shared_kb_write: body_md required' USING ERRCODE = '22023';
  END IF;
  IF length(p_body_md) > 64 * 1024 THEN
    RAISE EXCEPTION 'atlas_shared_kb_write: body_md exceeds 64 KB' USING ERRCODE = '22023';
  END IF;

  SELECT lower(owner_email) INTO v_owner_email
    FROM public.atlas_shared_kb_domains
   WHERE domain = p_domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'atlas_shared_kb_write: unknown domain %', p_domain USING ERRCODE = '22023';
  END IF;

  IF v_owner_email IS NOT NULL AND v_owner_email <> v_caller THEN
    RAISE EXCEPTION 'atlas_shared_kb_write: % is not the owner of domain %', v_caller, p_domain USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.atlas_shared_kb_entries (domain, author_email, title, body_md, tags)
    VALUES (p_domain, v_caller, p_title, p_body_md, coalesce(p_tags, '{}'))
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_write(text, text, text, text, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_shared_kb_write(text, text, text, text, text[]) TO authenticated, service_role;

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
  v_caller text := lower(coalesce(p_caller_email, ''));
  v_existing_author text;
  v_existing_domain text;
  v_owner_email text;
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

CREATE OR REPLACE FUNCTION public.atlas_shared_kb_read(
  p_id           uuid,
  p_caller_email text
)
RETURNS TABLE (
  id            uuid,
  domain        text,
  author_email  text,
  title         text,
  body_md       text,
  tags          text[],
  created_at    timestamptz,
  updated_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller text := lower(coalesce(p_caller_email, ''));
BEGIN
  IF NOT public.atlas_shared_kb_is_member(v_caller) THEN
    RAISE EXCEPTION 'atlas_shared_kb_read: caller % not in KB allowlist', v_caller USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT e.id, e.domain, e.author_email, e.title, e.body_md, e.tags, e.created_at, e.updated_at
    FROM public.atlas_shared_kb_entries e
   WHERE e.id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_read(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_shared_kb_read(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atlas_shared_kb_search(
  p_caller_email text,
  p_query        text DEFAULT NULL,
  p_domain       text DEFAULT NULL,
  p_tag          text DEFAULT NULL,
  p_limit        integer DEFAULT 20
)
RETURNS TABLE (
  id            uuid,
  domain        text,
  author_email  text,
  title         text,
  snippet       text,
  tags          text[],
  updated_at    timestamptz,
  rank          real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller text := lower(coalesce(p_caller_email, ''));
  v_q tsquery;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 200);
BEGIN
  IF NOT public.atlas_shared_kb_is_member(v_caller) THEN
    RAISE EXCEPTION 'atlas_shared_kb_search: caller % not in KB allowlist', v_caller USING ERRCODE = '42501';
  END IF;

  IF p_query IS NOT NULL AND length(trim(p_query)) > 0 THEN
    v_q := websearch_to_tsquery('english', p_query);
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.domain,
    e.author_email,
    e.title,
    CASE
      WHEN v_q IS NOT NULL THEN
        ts_headline('english', e.body_md, v_q, 'MaxWords=40, MinWords=15, ShortWord=3, MaxFragments=1')
      ELSE substring(e.body_md, 1, 240)
    END AS snippet,
    e.tags,
    e.updated_at,
    CASE
      WHEN v_q IS NOT NULL THEN ts_rank(to_tsvector('english', coalesce(e.title,'') || ' ' || coalesce(e.body_md,'')), v_q)
      ELSE 0::real
    END AS rank
  FROM public.atlas_shared_kb_entries e
  WHERE (p_domain IS NULL OR e.domain = p_domain)
    AND (p_tag    IS NULL OR p_tag = ANY(e.tags))
    AND (v_q IS NULL OR to_tsvector('english', coalesce(e.title,'') || ' ' || coalesce(e.body_md,'')) @@ v_q)
  ORDER BY (CASE WHEN v_q IS NOT NULL THEN ts_rank(to_tsvector('english', coalesce(e.title,'') || ' ' || coalesce(e.body_md,'')), v_q) ELSE 0 END) DESC,
           e.updated_at DESC
  LIMIT v_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_search(text, text, text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_shared_kb_search(text, text, text, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atlas_shared_kb_list_domains()
RETURNS TABLE (domain text, owner_email text, label text, description text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT d.domain, d.owner_email, d.label, d.description
    FROM public.atlas_shared_kb_domains d
   ORDER BY d.label;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_shared_kb_list_domains() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_shared_kb_list_domains() TO authenticated, service_role;

COMMENT ON TABLE public.atlas_shared_kb_entries IS
  'Shared knowledge base across Greg/Mark/Paul. Access only via atlas_shared_kb_* RPCs (RLS deny-all). Migration 174 (greg_actions #211).';
COMMENT ON TABLE public.atlas_shared_kb_domains IS
  'Domain to owner_email mapping for atlas_shared_kb_entries. NULL owner = open (general). Migration 174.';
