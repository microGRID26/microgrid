-- 179: greg_actions structured snooze (replaces "[SNOOZED YYYY-MM-DD]" title-prefix hack)
--
-- Until this migration the snooze convention was a string prefix in the title
-- ("[SNOOZED 2026-04-29] foo"). That's what `list` ignored, but the convention
-- was unenforced — every consumer (helper script, ATLAS HQ /actions, anything
-- else that filters Greg's queue) had to know the prefix shape and re-implement
-- the parse, plus there was no way to query snoozed-until-date directly.
--
-- This migration:
--   1. Adds snoozed_until timestamptz column on greg_actions.
--   2. Indexes it (partial — only non-null rows).
--   3. Backfills the column from existing "[SNOOZED YYYY-MM-DD]" prefixes and
--      strips the prefix from titles in the same UPDATE.
--
-- Consumers updated in the same commit:
--   - ~/.claude/scripts/greg_actions.py — `list` filters out snoozed rows
--     client-side; new `snooze`/`unsnooze`/`snoozed` commands.
--   - ATLAS-HQ lib/actions/{types,fetch}.ts — adds snoozed_until + isSnoozed,
--     fetchSnoozedActions, default fetchGregActions hides snoozed.
--   - ATLAS-HQ app/actions/{page,ActionsClient}.tsx — renders a SnoozedSection
--     under the priority sections; auto-clears when each row's date passes.

ALTER TABLE public.greg_actions
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

CREATE INDEX IF NOT EXISTS greg_actions_snoozed_until_idx
  ON public.greg_actions (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- Backfill: parse "[SNOOZED YYYY-MM-DD] " prefixes into snoozed_until +
-- strip the prefix from title in the same UPDATE.
UPDATE public.greg_actions
SET
  snoozed_until = (substring(title from '\[SNOOZED (\d{4}-\d{2}-\d{2})\]') || ' 00:00:00+00')::timestamptz,
  title         = regexp_replace(title, '^\[SNOOZED \d{4}-\d{2}-\d{2}\]\s*', '')
WHERE title ~ '^\[SNOOZED \d{4}-\d{2}-\d{2}\]';
