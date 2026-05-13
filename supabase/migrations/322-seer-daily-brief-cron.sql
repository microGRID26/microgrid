-- 322 — seer-daily-brief cron + relax top_5_items length to 0..5
--
-- Adds the pg_cron schedule that invokes the seer-daily-brief edge function
-- daily at 12:00 UTC (= 7am CDT during DST, 6am CST in winter). Greg's
-- standing ask is "7am everyday"; ship the closer-to-the-mark cadence during
-- the longer DST half of the year.
--
-- ALSO relaxes the top_5_items array-length check on seer_daily_brief from
-- 1..5 to 0..5. The empty-day branch in the edge function writes a row with
-- top_5_items=[] so Greg gets a "Quiet day — nothing notable." confidence
-- signal. The original check blocked that.
--
-- Two sites to update in lockstep so they never disagree:
--   1. The table-level CHECK constraint.
--   2. The seer_upsert_daily_brief RPC's internal validation.
--
-- Bearer auth is via vault secret `seer_daily_brief_token` (created out-of-
-- band before this migration ran; the cron just reads it).
--
-- Idempotency: cron.unschedule + cron.schedule pair tolerates re-application.

begin;

-- 1. Drop + recreate the table-level check at 0..5.
alter table public.seer_daily_brief
  drop constraint if exists seer_daily_brief_top_5_items_check;

alter table public.seer_daily_brief
  add constraint seer_daily_brief_top_5_items_check
  check (
    jsonb_typeof(top_5_items) = 'array'
    and jsonb_array_length(top_5_items) >= 0
    and jsonb_array_length(top_5_items) <= 5
  );

-- 2. Relax the RPC's internal validation from 1..5 → 0..5. Keep all other
--    validation (per-item shape, length caps, URL regex, owner gate) intact.
--    The diff vs the prior body is only the top-array bounds and the empty-
--    array short-circuit (skip per-item validation when length=0).
create or replace function public.seer_upsert_daily_brief(
  p_owner_id  uuid,
  p_date      date,
  p_summary_md text,
  p_top_items jsonb,
  p_model     text,
  p_in_tokens integer,
  p_out_tokens integer
)
returns public.seer_daily_brief
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_row public.seer_daily_brief;
  v_elem jsonb;
  v_link text;
begin
  if p_owner_id is null or p_date is null then
    raise exception 'invalid_args' using errcode = '22023';
  end if;

  if jsonb_typeof(p_top_items) <> 'array'
     or jsonb_array_length(p_top_items) < 0
     or jsonb_array_length(p_top_items) > 5 then
    raise exception 'top_items must be a 0..5-element JSON array' using errcode = '22023';
  end if;

  -- Per-item validation only fires when the array is non-empty.
  if jsonb_array_length(p_top_items) > 0 then
    for v_elem in select jsonb_array_elements(p_top_items) loop
      if jsonb_typeof(v_elem) <> 'object' then
        raise exception 'top_items[*] must each be a JSON object' using errcode = '22023';
      end if;
      if not (v_elem ? 'item_id' and v_elem ? 'headline' and v_elem ? 'blurb'
              and v_elem ? 'link' and v_elem ? 'source') then
        raise exception 'top_items[*] missing required keys' using errcode = '22023';
      end if;
      if length(v_elem->>'headline') > 200 or length(v_elem->>'headline') < 1 then
        raise exception 'top_items[*].headline length out of bounds (1..200)' using errcode = '22023';
      end if;
      if length(v_elem->>'blurb') > 600 or length(v_elem->>'blurb') < 1 then
        raise exception 'top_items[*].blurb length out of bounds (1..600)' using errcode = '22023';
      end if;
      if length(v_elem->>'source') > 80 or length(v_elem->>'source') < 1 then
        raise exception 'top_items[*].source length out of bounds (1..80)' using errcode = '22023';
      end if;
      v_link := v_elem->>'link';
      if v_link is null or length(v_link) > 500 or length(v_link) < 8
         or not (v_link ~* '^https?://[a-z0-9.-]+(:[0-9]+)?(/.*)?$') then
        raise exception 'top_items[*].link must be https?:// URL, 8..500 chars (got: %)',
          left(coalesce(v_link, '<null>'), 60) using errcode = '22023';
      end if;
    end loop;
  end if;

  if not exists (
    select 1 from public.atlas_hq_users
    where id = p_owner_id and active and role = 'owner'
  ) then
    raise exception 'unknown_owner: %', p_owner_id using errcode = '22023';
  end if;

  insert into public.seer_daily_brief (
    owner_id, brief_date, summary_md, top_5_items, model,
    input_token_count, output_token_count, generated_at, read_at
  )
  values (
    p_owner_id, p_date, p_summary_md, p_top_items, p_model,
    greatest(p_in_tokens, 0), greatest(p_out_tokens, 0), now(), null
  )
  on conflict (owner_id, brief_date) do update
    set summary_md = excluded.summary_md,
        top_5_items = excluded.top_5_items,
        model = excluded.model,
        input_token_count = excluded.input_token_count,
        output_token_count = excluded.output_token_count,
        generated_at = now(),
        read_at = case
          when public.seer_daily_brief.summary_md is distinct from excluded.summary_md
            or public.seer_daily_brief.top_5_items is distinct from excluded.top_5_items
          then null
          else public.seer_daily_brief.read_at
        end
  returning * into v_row;

  return v_row;
end;
$function$;

-- 3. Schedule the cron. Unschedule first for idempotent re-apply.
select cron.unschedule('seer-daily-brief') where exists (
  select 1 from cron.job where jobname = 'seer-daily-brief'
);

select cron.schedule(
  'seer-daily-brief',
  '0 12 * * *',
  $$
    select net.http_post(
      url := 'https://hzymsezqfxzpbcqryeim.supabase.co/functions/v1/seer-daily-brief',
      headers := jsonb_build_object(
        'apikey', 'sb_publishable_mY0uHkw46TOFM2FmX3Dczw_9xbS1sJD',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
           where name = 'seer_daily_brief_token'
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

commit;
