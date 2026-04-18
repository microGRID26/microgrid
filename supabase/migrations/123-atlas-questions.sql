-- ============================================================
-- atlas_questions: logs every Q+A+feedback from the Ask Atlas widget
-- atlas_kb_search_text: keyword/trigram/fulltext retrieval (v1, no embeddings)
-- atlas_record_feedback: owner-only feedback mutation for logged questions
-- ============================================================

-- ---------- atlas_questions TABLE ----------

create table public.atlas_questions (
  id bigserial primary key,

  user_id    uuid references auth.users(id),
  user_email text not null,
  user_role  text not null,

  question   text not null,
  answer     text,
  citations  jsonb not null default '[]'::jsonb,

  confidence text not null default 'unknown'
    check (confidence in ('high','medium','low','unknown')),

  page_path  text,

  escalated           boolean not null default false,
  escalated_action_id bigint,

  feedback      text check (feedback in ('up','down')),
  feedback_note text,

  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  feedback_at  timestamptz
);

create index idx_atlas_q_user        on public.atlas_questions(user_email, created_at desc);
create index idx_atlas_q_confidence  on public.atlas_questions(confidence, created_at desc);
create index idx_atlas_q_escalated   on public.atlas_questions(escalated) where escalated = true;
create index idx_atlas_q_created     on public.atlas_questions(created_at desc);

alter table public.atlas_questions enable row level security;

create policy aq_super_admin_all on public.atlas_questions
  for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.email = auth.jwt() ->> 'email' and u.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.email = auth.jwt() ->> 'email' and u.role = 'super_admin'
    )
  );

create policy aq_self on public.atlas_questions
  for all to authenticated
  using (user_email = auth.jwt() ->> 'email')
  with check (user_email = auth.jwt() ->> 'email');

-- ---------- atlas_kb_search_text RPC ----------
-- Keyword + trigram + tsvector search against approved KB entries,
-- role-gated identical to kb_employees_read RLS.

create or replace function public.atlas_kb_search_text(
  p_query     text,
  p_user_role text,
  p_limit     int default 5
)
returns table (
  id                    bigint,
  title                 text,
  answer_md             text,
  owner                 text,
  source_of_truth       text,
  escalation_conditions text,
  similarity            float
)
language sql stable security definer
set search_path = public, extensions, pg_catalog as $$
  select
    e.id,
    e.title,
    e.answer_md,
    e.owner,
    e.source_of_truth,
    e.escalation_conditions,
    greatest(
      extensions.similarity(e.title, p_query),
      extensions.similarity(coalesce(array_to_string(e.question_phrasings, ' '), ''), p_query),
      extensions.similarity(left(e.answer_md, 500), p_query)
    )::float as similarity
  from public.atlas_kb_entries e
  where e.status = 'approved'
    and case
      when p_user_role = 'super_admin'       then true
      when p_user_role in ('admin','sales')  then e.audience in ('all','sales')
      else                                         e.audience = 'all'
    end
    and (
      e.title ilike '%' || p_query || '%'
      or exists (select 1 from unnest(e.question_phrasings) qp where qp ilike '%' || p_query || '%')
      or extensions.similarity(e.title, p_query) > 0.2
      or to_tsvector('english',
           e.title || ' ' || e.answer_md || ' ' ||
           coalesce(array_to_string(e.question_phrasings, ' '), '')
         ) @@ plainto_tsquery('english', p_query)
    )
  order by similarity desc nulls last, e.id asc
  limit p_limit;
$$;

revoke execute on function public.atlas_kb_search_text(text, text, int) from public;
grant  execute on function public.atlas_kb_search_text(text, text, int) to authenticated;

-- ---------- atlas_record_feedback RPC ----------

create or replace function public.atlas_record_feedback(
  p_question_id bigint,
  p_feedback    text,
  p_note        text default null
)
returns void
language plpgsql security invoker
set search_path = public, pg_catalog as $$
begin
  if p_feedback not in ('up','down') then
    raise exception 'feedback must be up or down';
  end if;
  update public.atlas_questions
     set feedback      = p_feedback,
         feedback_note = p_note,
         feedback_at   = now()
   where id = p_question_id
     and user_email = auth.jwt() ->> 'email';
  if not found then
    raise exception 'question not found or not owned by caller';
  end if;
end;
$$;

revoke execute on function public.atlas_record_feedback(bigint, text, text) from public;
grant  execute on function public.atlas_record_feedback(bigint, text, text) to authenticated;
