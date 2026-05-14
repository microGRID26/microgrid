-- Seer Curated-Learning Chain 7 · Phase 6 — canonicalize 'infra' → 'infrastructure'
-- ----------------------------------------------------------
-- Live data has 1 'infra' row and 8 'infrastructure' rows in seer_curriculum_path
-- (rank 5, infra/security/web/system-design family). The Phase 5 classifier
-- prompt accepted both as valid enum values, perpetuating the drift. Phase 6
-- canonicalizes to the spelled-out form.
--
-- Companion to the edge-function edit that removes 'infra' from VALID_CATEGORIES
-- and the prompt enum — this migration handles the historical row; the function
-- edit prevents new ones.
--
-- Anchor: HANDOFF-seer-curated-learning.md decision 2 (default: yes).
-- Pre-mig SELECT verified: 1 row with category='infra' (slug expected unique).

update public.seer_curriculum_path
   set category = 'infrastructure'
 where category = 'infra';

-- Defensive: confirm 0 rows remain with the alias after the update.
do $$
declare
  v_remaining int;
begin
  select count(*) into v_remaining
    from public.seer_curriculum_path
   where category = 'infra';
  if v_remaining <> 0 then
    raise exception 'phase6_canonicalize_infra: % rows still have category=infra after update', v_remaining;
  end if;
end;
$$;
