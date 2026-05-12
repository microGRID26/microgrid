-- 312-seer-quiz-rebalance-and-feed-prefix-strip
--
-- Two related Seer data hygiene fixes shipped together:
--
-- 1. Rebalance correctIndex positions in learn_quizzes. Authored data has
--    35/41 (85%) correct answers at position B and zero at A or D — a
--    test-wise user can score ~85% by always picking B. This Fisher-Yates
--    shuffles each question's options[] array per-row and remaps
--    correctIndex to the new position of the originally-correct option.
--    Snapshot of pre-rebalance data lands in learn_quizzes_pre_rebalance_20260512
--    so a regression is one INSERT...SELECT away from being undone.
--
--    Client-side option shuffle ships in parallel (app/quiz/[slug].tsx)
--    as defense-in-depth — even biased future data is hidden behind a
--    per-session shuffle. The DB rebalance ensures the canonical store
--    is balanced for any non-shuffling consumer (summary screens, future
--    integrations).
--
-- 2. Strip leading bracketed bucket prefixes (e.g. "[AINews] …") from
--    seer_feed_items.title. 16 of 56 rows carry the AINews bucket prefix —
--    Swyx's newsletter convention syndicated through the Latent Space feed.
--    Render-side helper (app/(tabs)/feed.tsx cleanFeedTitle) handles future
--    arrivals; this backfill normalizes the existing rows so plain SQL
--    consumers see clean titles.

begin;

-- 1. Snapshot learn_quizzes before rebalance (idempotent — only takes a
-- snapshot the first time this runs).
create table if not exists public.learn_quizzes_pre_rebalance_20260512 as
  select * from public.learn_quizzes where false;

-- Snapshot table is for owner-only recovery — no app surface should reach
-- it, so RLS on + no policies = deny-all. Matches the snapshot-table
-- pattern from prior migrations.
alter table public.learn_quizzes_pre_rebalance_20260512 enable row level security;

insert into public.learn_quizzes_pre_rebalance_20260512
select * from public.learn_quizzes
where concept_slug not in (
  select concept_slug from public.learn_quizzes_pre_rebalance_20260512
);

-- 2. Rebalance each question's options[] order and remap correctIndex.
do $$
declare
  row_rec record;
  new_questions jsonb;
  qd jsonb;
  qi int;
  opts jsonb;
  n int;
  perm int[];
  k int;
  swap_i int;
  tmp int;
  old_correct int;
  new_correct int;
  new_opts jsonb;
  oi int;
begin
  for row_rec in select concept_slug, questions from public.learn_quizzes loop
    new_questions := '[]'::jsonb;
    for qi in 0..jsonb_array_length(row_rec.questions) - 1 loop
      qd := row_rec.questions -> qi;
      opts := qd -> 'options';
      n := jsonb_array_length(opts);
      old_correct := (qd ->> 'correctIndex')::int;

      -- Build initial perm[1..n] = [0, 1, ..., n-1] (Postgres arrays are 1-indexed).
      perm := array(select generate_series(0, n - 1));

      -- Fisher-Yates over perm (in shuffled-place over a 1-indexed int[]).
      for k in reverse n..2 loop
        swap_i := floor(random() * k)::int + 1;  -- 1..k
        tmp := perm[k];
        perm[k] := perm[swap_i];
        perm[swap_i] := tmp;
      end loop;

      -- Build new options array per perm; track new correctIndex.
      new_opts := '[]'::jsonb;
      new_correct := null;
      for oi in 1..n loop
        new_opts := new_opts || jsonb_build_array(opts -> perm[oi]);
        if perm[oi] = old_correct then
          new_correct := oi - 1;
        end if;
      end loop;

      qd := jsonb_set(qd, '{options}', new_opts);
      qd := jsonb_set(qd, '{correctIndex}', to_jsonb(new_correct));
      new_questions := new_questions || jsonb_build_array(qd);
    end loop;

    update public.learn_quizzes
       set questions = new_questions,
           updated_at = now()
     where concept_slug = row_rec.concept_slug;
  end loop;
end $$;

-- 3. Strip leading "[Bucket] " prefix from feed item titles (16 rows expected).
update public.seer_feed_items
   set title = regexp_replace(title, '^\s*\[[^\]]+\]\s*', '')
 where title ~ '^\s*\[[^\]]+\]';

commit;
