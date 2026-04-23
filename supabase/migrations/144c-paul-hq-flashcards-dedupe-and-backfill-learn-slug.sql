-- 144c: deduplicate paul_hq_flashcards + backfill learn_slug.
--
-- Context from 2026-04-23 walkthrough: after migration 144 imported 121
-- Atlas cards with the rich technical/simple/example shape, Paul's
-- original 10 hand-authored cards (all AI-concept basics with only a
-- definition_md — no technical/simple/example) sorted first in the deck
-- because they had lower display_order. They duplicated topics Atlas
-- covers more richly (Token, Prompt Caching, Temperature, Sub-agent,
-- MCP, etc.) and surfaced the "no plain english, no example" gap.
-- Several also had loose learn_slug mappings ("Temperature" →
-- /paul/learn/economics) that landed users on unrelated concept pages.
--
-- Fixes:
--   1. Delete the 10 legacy Paul-curated cards (source_slug IS NULL).
--      Atlas imports cover the same topics with fuller content.
--   2. Backfill learn_slug on the 7 Atlas cards that have a direct
--      match in paul_hq_concepts so "Learn more →" actually jumps to
--      the right concept page.
--
-- Rollback: legacy cards are lost — restore from backup if needed.
-- The learn_slug backfill is reversible by
--   update paul_hq_flashcards set learn_slug = null
--     where source_slug in (...the 7 slugs below...);

begin;

-- 1. Drop legacy Paul-curated cards (duplicates of Atlas topics).
delete from public.paul_hq_flashcards
  where source_slug is null;

-- 2. Backfill learn_slug for Atlas cards that map cleanly to a
--    paul_hq_concepts slug.
update public.paul_hq_flashcards
  set learn_slug = case source_slug
    when 'token'           then 'tokens'
    when 'context-window'  then 'tokens'
    when 'prompt-caching'  then 'prompt-caching'
    when 'agent'           then 'subagents'
    when 'mcp'             then 'tool-use'
    when 'tool-use'        then 'tool-use'
    when 'atlas-protocol'  then 'atlas-protocol'
    end
  where source_slug in (
    'token','context-window','prompt-caching','agent','mcp','tool-use','atlas-protocol'
  );

commit;
