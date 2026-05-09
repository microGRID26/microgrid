-- Migration 248 — atlas_append_greg_action_note RPC.
--
-- Closes the qa-autofix callback's silent-drop bug surfaced by the Phase C
-- discovery audit (2026-05-08): the callback was logging "note dropped —
-- RPC not wired" and returning ok:true, so PR URLs and agent summaries from
-- the autofix loop never reached the linked greg_action. Greg saw "ok"
-- responses while the body_md silently stayed empty.
--
-- Appends a markdown-formatted note to greg_actions.body_md without changing
-- status. Includes a UTC timestamp + horizontal-rule separator so the body_md
-- stays readable as multiple notes accumulate over the lifecycle of an action.

create or replace function public.atlas_append_greg_action_note(
  p_id int,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  if p_id is null or p_id <= 0 then
    raise exception 'invalid action id: %', p_id;
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'note is required';
  end if;
  -- Length cap: greg_actions.body_md has no schema cap today, but autofix
  -- summaries can be big. 64KB is plenty per call for human review without
  -- bloating the row past the toast threshold.
  if length(p_note) > 65536 then
    raise exception 'note too long (max 64KB, got %)', length(p_note);
  end if;

  -- Cumulative cap: a runaway callback loop fired N times against the same
  -- p_id would otherwise grow body_md unboundedly (audit 248 R1 Medium).
  -- 1MB is a hard ceiling — at that point a human needs to look at the
  -- action anyway, and the /actions UI starts choking on the <pre> render.
  if (select coalesce(length(body_md), 0) from public.greg_actions where id = p_id) +
     length(p_note) > 1048576 then
    raise exception 'append would push greg_action.body_md past 1MB cap';
  end if;

  update public.greg_actions
    set body_md = coalesce(body_md, '') ||
      E'\n\n---\n\n_appended ' ||
      to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
      E'_\n\n' || p_note
    where id = p_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'greg_action not found: %', p_id;
  end if;
end;
$$;

-- Service-role-only. Called by HQ /api/qa/autofix/callback with the
-- MICROGRID_SUPABASE_SERVICE_KEY (sb_secret_*). No anon/authenticated path.
revoke execute on function public.atlas_append_greg_action_note(int, text) from public;
revoke execute on function public.atlas_append_greg_action_note(int, text) from anon;
revoke execute on function public.atlas_append_greg_action_note(int, text) from authenticated;
grant  execute on function public.atlas_append_greg_action_note(int, text) to service_role;
