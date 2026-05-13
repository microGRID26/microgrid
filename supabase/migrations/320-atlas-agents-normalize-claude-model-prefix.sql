-- Normalize atlas_agents.primary_model from long-form 'claude-haiku-4-5-20251001'
-- to short form 'haiku-4-5'.
--
-- Why: lib/intel/agent-display.ts modelTextClass() uses startsWith('haiku')
-- to apply brand color. Long-form values fall through to default slate-200,
-- making the two Atlas brief/digest rows render dim while sibling haiku agents
-- render in brand emerald. Anchor: 2026-05-13 Agent Fleet correctness sweep.
--
-- Affects 2 rows (atlas-daily-brief, atlas-weekly-digest). Idempotent.

UPDATE public.atlas_agents
SET primary_model = 'haiku-4-5'
WHERE slug IN ('atlas-daily-brief', 'atlas-weekly-digest')
  AND primary_model = 'claude-haiku-4-5-20251001';
