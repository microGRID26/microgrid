-- Seer Curated-Learning Chain 7 · Phase 3 R1 fixes
-- ----------------------------------------------------------
-- H-1 RT: seer_curriculum_review_pass had no precondition that a prior pass
--         exists for the slug. A user could direct-navigate to
--         /quiz/<slug>?mode=review on any slug, score 100, and forge a
--         "mastered" status they never earned. Server is now the gate.
--
-- M-2 RT: isReviewDue() lives client-side (Date.now). A user with a skewed
--         device clock could trigger the review band early. Server now
--         enforces "first pass must be at least 7 days old" inside the
--         review_pass RPC itself, regardless of client clock.
--
-- The function stays SECURITY INVOKER, set search_path = public, pg_temp.
-- Existing grants (EXECUTE to authenticated only, REVOKE PUBLIC/anon) are
-- not touched; CREATE OR REPLACE preserves them.

create or replace function public.seer_curriculum_review_pass(
  p_slug             text,
  p_score            integer,
  p_idempotency_key  uuid
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid               uuid := auth.uid();
  v_already_recorded  boolean;
  v_first_pass_at     timestamptz;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null' using errcode = '42501';
  end if;
  if p_score is null or p_score <> 100 then
    raise exception 'review pass requires perfect score (got %)',
      coalesce(p_score::text, 'null') using errcode = '22023';
  end if;
  if p_slug is null or length(p_slug) = 0 or length(p_slug) > 200 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'p_idempotency_key required (uuid)' using errcode = '22023';
  end if;

  -- Idempotency replay: same (idempotency_key, slug, outcome=pass) already
  -- present → no-op success. Must run BEFORE the precondition check so a
  -- legitimate retry doesn't get downgraded to a "no prior pass" reject.
  select exists (
    select 1
    from public.seer_curriculum_progress p,
         jsonb_array_elements(p.quiz_attempt_events) e
    where p.user_id = v_uid
      and (e ->> 'idempotency_key')::uuid = p_idempotency_key
      and (e ->> 'slug')                  = p_slug
      and (e ->> 'outcome')               = 'pass'
  ) into v_already_recorded;

  if v_already_recorded then
    return jsonb_build_object('was_idempotent_replay', true, 'mastered_now', false);
  end if;

  -- Precondition: a prior pass for this slug must exist AND be at least
  -- 7 days old per the server clock. Same-row scan; one statement.
  select min((e ->> 'at')::timestamptz)
    into v_first_pass_at
    from public.seer_curriculum_progress p,
         jsonb_array_elements(p.quiz_attempt_events) e
    where p.user_id = v_uid
      and (e ->> 'slug')    = p_slug
      and (e ->> 'outcome') = 'pass';

  if v_first_pass_at is null then
    -- No prior pass — user is trying to mark a slug mastered without ever
    -- having passed it. Reject with a structured DETAIL so the client can
    -- branch on `reason` without parsing message text.
    raise exception 'no_prior_pass_for_review (slug=%)', p_slug
      using errcode = '22023',
            detail = jsonb_build_object('reason', 'no_prior_pass_for_review',
                                        'slug',   p_slug)::text;
  end if;

  if v_first_pass_at > now() - interval '7 days' then
    -- Spaced-review window not yet open. DETAIL carries first_pass_at so
    -- the UI can render "due on YYYY-MM-DD" without an extra fetch.
    raise exception 'review_not_due (first_pass_at=%, slug=%)',
      v_first_pass_at, p_slug
      using errcode = '22023',
            detail = jsonb_build_object('reason',         'review_not_due',
                                        'slug',           p_slug,
                                        'first_pass_at',  v_first_pass_at,
                                        'due_at',         v_first_pass_at + interval '7 days')::text;
  end if;

  update public.seer_curriculum_progress
     set quiz_attempt_events = quiz_attempt_events || jsonb_build_array(
           jsonb_build_object(
             'slug',            p_slug,
             'at',              now(),
             'outcome',         'pass',
             'score',           p_score,
             'idempotency_key', p_idempotency_key
           )
         )
   where user_id = v_uid;

  return jsonb_build_object(
    'mastered_now',          true,
    'was_idempotent_replay', false
  );
end;
$$;

comment on function public.seer_curriculum_review_pass(text, integer, uuid) is
  'Phase 3 R1: requires prior pass for slug and ≥7d server-clock gap before accepting review pass. Defense vs URL-bypass mastery forgery (H-1 RT) and device-clock-skew early review (M-2 RT).';
