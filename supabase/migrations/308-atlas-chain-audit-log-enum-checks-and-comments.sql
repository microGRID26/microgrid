-- atlas_chain_audit_log hygiene — three Lows carried forward from mig 275
-- audit (greg_actions #758): CHECK constraints on gate + agent (so future
-- typos can't fragment recurrence analysis) + column comment on
-- findings_json + table comment noting the deny-all-on-DML stance.
--
-- Allowlists derived empirically from current data (2026-05-12 distinct
-- values + #758's proposed enum). Existing values:
--   gate:   r1 (30), r2 (25), pre-apply (9), spec (3)
--   agent:  red-teamer (28), self (27), migration-planner (9),
--           ux-auditor (2), general-purpose (1)
-- All present values are in the allowlist below. The CHECK validates
-- existing rows on ADD CONSTRAINT — pre-flight confirms 0 rejects.
--
-- NOT VALID + VALIDATE split would be needed for a > ~1M row table; this
-- one has < 100 rows so the inline check is fine.

-- Idempotency wrappers (R1 M-1 fix): Postgres lacks ADD CONSTRAINT IF NOT
-- EXISTS, so we DO-block-check pg_constraint first. Makes this file safe
-- to replay against a branch that already has the constraints.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'atlas_chain_audit_log_gate_check'
  ) THEN
    ALTER TABLE public.atlas_chain_audit_log
      ADD CONSTRAINT atlas_chain_audit_log_gate_check
      CHECK (gate IN ('spec', 'pre-apply', 'r1', 'r2', 'post-merge', 'monthly'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'atlas_chain_audit_log_agent_check'
  ) THEN
    ALTER TABLE public.atlas_chain_audit_log
      ADD CONSTRAINT atlas_chain_audit_log_agent_check
      CHECK (agent IN (
        'red-teamer',
        'migration-planner',
        'drift-checker',
        'finance-auditor',
        'ux-auditor',
        'chairman',
        'test-author',
        'dep-upgrader',
        'doc-verifier',
        'recap-drafter',
        'general-purpose',
        'self',
        'custom'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.atlas_chain_audit_log.findings_json IS
  'Structured audit findings array. Each element: {severity, file, summary, fix?}. '
  'Severity is one of critical|high|medium|low. PII must NOT appear here — '
  'audits sometimes paste customer names from prod into findings; if such a row '
  'is committed, scrub via the SECDEF RPC, never via direct UPDATE.';

COMMENT ON TABLE public.atlas_chain_audit_log IS
  'Audit-trail of every R1/R2/pre-apply/monthly gate run across all Atlas '
  'projects. Deny-all-on-DML by design: RLS is enabled with NO INSERT/UPDATE/'
  'DELETE policies so the table is service_role-only at the data plane. The '
  'canonical write path is atlas_chain_audit_log_record(...) — a SECDEF RPC '
  'that scrubs caller input and enforces the gate/agent vocab. SELECT is '
  'allowed to all roles for transparency. Hygiene: greg_actions #757 + #758.';

-- Verify the constraints landed and zero existing rows violate (would be
-- caught at ALTER TABLE ADD CONSTRAINT, but defense-in-depth).
DO $$
DECLARE bad_gate int; bad_agent int;
BEGIN
  SELECT COUNT(*) INTO bad_gate FROM public.atlas_chain_audit_log
    WHERE gate NOT IN ('spec','pre-apply','r1','r2','post-merge','monthly');
  SELECT COUNT(*) INTO bad_agent FROM public.atlas_chain_audit_log
    WHERE agent NOT IN ('red-teamer','migration-planner','drift-checker',
                        'finance-auditor','ux-auditor','chairman','test-author',
                        'dep-upgrader','doc-verifier','recap-drafter',
                        'general-purpose','self','custom');
  IF bad_gate > 0 OR bad_agent > 0 THEN
    RAISE EXCEPTION 'mig 308: post-apply data does not satisfy CHECK constraints — bad_gate=%, bad_agent=%', bad_gate, bad_agent;
  END IF;
END $$;
