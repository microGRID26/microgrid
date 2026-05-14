-- Seer Curated-Learning Chain 7 · Phase 6 R2 polish — RPC tightening
-- ----------------------------------------------------------
-- Two CREATE OR REPLACE function bodies, no schema changes.
--
-- (A) seer_curriculum_review_pass: ignore events where (e ->> 'backfilled') = true
--     when computing first_pass_at. Defense vs future bulk-import scripts that
--     populate quiz_attempt_events with synthetic 'pass' events to seed users —
--     those should NOT trip the 7-day spaced-review gate. Today no event in
--     quiz_attempt_events has a 'backfilled' key (verified pre-migration), so
--     this is purely defensive: same runtime behavior on current data, correct
--     behavior on hypothetical future backfills.
--
--     Anchor: Phase 3 carryover spec-delta #3 from HANDOFF-seer-curated-learning.md
--     (decision 4 confirmed default: yes, ship the defensive guard).
--
-- (B) seer_curriculum_quiz_pass: tighten early-return paths to always include
--     `rank_up_to` (null) and `was_idempotent_replay` keys. The client cast in
--     ~/Seer/expo-app/lib/curriculum/state-hooks.ts:curriculumQuizPass declares
--     `{ advanced, rank_up_to: number | null, was_idempotent_replay }`. Today
--     the idempotent-replay branch omits `rank_up_to` and the not-in-curriculum
--     branch omits both `rank_up_to` and `was_idempotent_replay`. Runtime is
--     graceful (undefined behaves like null in most guards) but the cast lies.
--     Server-side fix is cheaper than loosening the client cast — one extra
--     `'rank_up_to', null` per branch.
--
--     Anchor: Phase 3 carryover spec-delta #2 — return-shape drift sweep.
--
-- Both functions stay SECURITY INVOKER, set search_path = public, pg_temp.
-- CREATE OR REPLACE preserves existing grants (EXECUTE to authenticated only).

----------------------------------------------------------
-- (A) seer_curriculum_review_pass — backfill-aware
----------------------------------------------------------

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

  -- Idempotency replay (unchanged from mig 324): same (idempotency_key, slug,
  -- outcome=pass) already present → no-op success. Run BEFORE the precondition
  -- check so a legitimate retry doesn't get downgraded to "no prior pass".
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

  -- Precondition: a NON-BACKFILLED prior pass for this slug must exist AND be
  -- at least 7 days old per the server clock. Phase 6 fix: filter out events
  -- where (e ->> 'backfilled') = 'true' so future bulk-import scripts don't
  -- count as "real" first passes.
  select min((e ->> 'at')::timestamptz)
    into v_first_pass_at
    from public.seer_curriculum_progress p,
         jsonb_array_elements(p.quiz_attempt_events) e
    where p.user_id = v_uid
      and (e ->> 'slug')    = p_slug
      and (e ->> 'outcome') = 'pass'
      and coalesce((e ->> 'backfilled')::boolean, false) = false;

  if v_first_pass_at is null then
    raise exception 'no_prior_pass_for_review (slug=%)', p_slug
      using errcode = '22023',
            detail = jsonb_build_object('reason', 'no_prior_pass_for_review',
                                        'slug',   p_slug)::text;
  end if;

  if v_first_pass_at > now() - interval '7 days' then
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
  'Phase 6: backfill-aware first_pass_at — ignores events where (backfilled) is true so future bulk-import seeds do not satisfy the 7-day spaced-review gate. Preserves Phase 3 R1 guarantees (precondition + 7d server-clock gate).';

----------------------------------------------------------
-- (B) seer_curriculum_quiz_pass — return-shape tightening
----------------------------------------------------------

create or replace function public.seer_curriculum_quiz_pass(
  p_slug             text,
  p_score            integer,
  p_idempotency_key  uuid
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid                uuid := auth.uid();
  v_position           int;
  v_today              date := public.seer_curriculum_logical_today();
  v_prev_date          date;
  v_streak             int;
  v_new_streak         int;
  v_advanced           boolean := false;
  v_rank_up_to         int;
  v_already_recorded   boolean;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null' using errcode = '42501';
  end if;
  if p_score is null or p_score <> 100 then
    raise exception 'quiz pass requires perfect score (got %)', coalesce(p_score::text, 'null') using errcode = '22023';
  end if;
  if p_slug is null or length(p_slug) = 0 or length(p_slug) > 200 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'p_idempotency_key required (uuid)' using errcode = '22023';
  end if;

  insert into public.seer_curriculum_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

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
    -- Phase 6 fix: include rank_up_to=null so client cast {rank_up_to: number|null} matches.
    return jsonb_build_object(
      'advanced',              false,
      'rank_up_to',            null,
      'was_idempotent_replay', true,
      'note',                  'pass event with this (key, slug) already recorded'
    );
  end if;

  select sp.position into v_position
  from public.seer_curriculum_path sp
  where sp.slug = p_slug and sp.kind = 'quiz'
  order by sp.position
  limit 1;

  if v_position is null then
    -- Phase 6 fix: include rank_up_to=null AND was_idempotent_replay=false so
    -- client cast matches on every path.
    return jsonb_build_object(
      'in_curriculum',         false,
      'advanced',              false,
      'rank_up_to',            null,
      'was_idempotent_replay', false,
      'note',                  format('slug %L (kind=quiz) not in curriculum_path', p_slug)
    );
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

  update public.seer_curriculum_progress
     set quizzes_passed = array(select distinct unnest(array_append(quizzes_passed, p_slug)))
   where user_id = v_uid;

  update public.seer_curriculum_progress
     set current_position = greatest(current_position, v_position + 1),
         last_advance_at  = now()
   where user_id = v_uid
     and current_position <= v_position
  returning true into v_advanced;

  if coalesce(v_advanced, false) then
    select curriculum_streak_last_date, curriculum_streak_count
      into v_prev_date, v_streak
      from public.seer_curriculum_progress where user_id = v_uid;

    if v_prev_date is null then
      v_new_streak := 1;
    elsif v_prev_date = v_today then
      v_new_streak := v_streak;
    elsif v_prev_date = v_today - 1 then
      v_new_streak := v_streak + 1;
    else
      v_new_streak := 1;
    end if;

    update public.seer_curriculum_progress
       set curriculum_streak_count     = v_new_streak,
           curriculum_streak_last_date = v_today
     where user_id = v_uid;

    v_rank_up_to := public.seer_curriculum_rank_up_cas();
  else
    select curriculum_streak_count into v_new_streak
      from public.seer_curriculum_progress where user_id = v_uid;
  end if;

  return jsonb_build_object(
    'advanced',              coalesce(v_advanced, false),
    'position_passed',       v_position,
    'streak_count',          v_new_streak,
    'rank_up_to',            v_rank_up_to,
    'was_idempotent_replay', false
  );
end;
$$;

comment on function public.seer_curriculum_quiz_pass(text, integer, uuid) is
  'Phase 6: all return paths now include rank_up_to (null when absent) and was_idempotent_replay so client cast matches at runtime.';
