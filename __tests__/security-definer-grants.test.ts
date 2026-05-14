import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

// Postgres default: a CREATE FUNCTION grants EXECUTE to PUBLIC. With SECURITY
// DEFINER that means any logged-in user (role: authenticated) can call the
// function with the function-owner's privileges, bypassing RLS. The fix is
// always REVOKE EXECUTE ... FROM authenticated (or PUBLIC), then GRANT only
// to the roles that should be able to call it (typically service_role, or
// authenticated when the body has its own auth.uid() self-check).
//
// This bug pattern was caught 7+ times in the 30 recaps before the linter
// landed (HQ admin RPCs, Atlas Digests, Anthropic wire-up, Paul rec-accept,
// Paul feedback leak, monthly RLS audit, etc.). The test fails any new
// migration that introduces a SECURITY DEFINER function without a paired
// REVOKE in the same file. Existing offenders are inherited as a punch list
// — capped, so the only direction the list can go is down.

const KNOWN_OFFENDERS = new Set<string>([
  // Inherited 2026-05-01. Each entry has at least one SECURITY DEFINER
  // function in the file with no name-bound REVOKE EXECUTE ... FROM
  // authenticated|anon|public. Some are likely legitimate (trigger
  // functions, intentionally PUBLIC helpers); each needs a one-by-one
  // audit before removal.
  '108-atlas-update-feedback-status.sql',
  '109-partner-api-foundation.sql',
  '111-security-audit-r1.sql',
  '121-atlas-sessions-action-claim.sql',
  '122-atlas-kb-entries.sql',
  '127-provision-user-auto-org-membership.sql',
  '129-provision-user-r1-fixes.sql',
  '130-offboarding-active-gate.sql',
  '131-offboarding-policy-bypass-fixes.sql',
  '132-rls-helpers-resolve-via-email.sql',
  '139b-eval-baseline-only-previous.sql',
  '191-rls-phase2-drop-auth-full-access.sql',
  '192-rls-drop-platform-org-bypass.sql',
  '195-cascade-user-name-trigger-gate-fix.sql',
  '197-fleet-cost-7d.sql',
  // 2026-05-01 — atlas_list_agents_v2 has explicit GRANT TO anon, authenticated
  // but no name-bound REVOKE FROM PUBLIC. In this Supabase env PUBLIC EXECUTE
  // is stripped automatically on functions in public, so the REVOKE is
  // redundant — the GRANT lines are the real ACL. Marked PUBLIC-safe.
  '210-atlas-agent-primary-model.sql',
])

// 2026-05-14 chain planset Phase H4: backported name-bound REVOKE EXECUTE
// on mig 222b/223/224/225 SECDEF trigger functions via mig 227. The four
// were briefly punch-listed in Phase H3 (KNOWN_OFFENDERS_MAX bumped to 20);
// punch-list now back to 16 after mig 227 closed the gap. Live ACL
// post-mig-227: {postgres=X/postgres, service_role=X/postgres} on all four.

const KNOWN_OFFENDERS_MAX = 16

// Match every CREATE FUNCTION that has SECURITY DEFINER somewhere in its
// body (DEFINER usually appears 1-3 lines after the signature). Capturing
// the function name lets us verify each one has its own paired REVOKE,
// not just any REVOKE in the file. \1 in the per-name check below is what
// closes M1 from R1: a multi-function migration that revokes only one
// would otherwise pass.
const CREATE_SD_FUNCTION_RE = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\([\s\S]{0,2000}?\bSECURITY\s+DEFINER\b/gi

// REVOKE must explicitly target authenticated, anon, or PUBLIC — revoking
// from service_role accomplishes the opposite of the intent (closes the
// authorized caller, leaves the privesc surface open to authenticated).
function buildRevokeRe(fnName: string): RegExp {
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `\\bREVOKE\\s+(?:EXECUTE|ALL)(?:\\s+PRIVILEGES)?\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${escaped}\\b[\\s\\S]{0,400}?\\bFROM\\b[\\s\\S]{0,200}?\\b(?:authenticated|anon|public)\\b`,
    'i',
  )
}

// Schema-wide blanket REVOKE on `public` — covers every function the
// migration creates. Restrict to `public` so a migration revoking on
// `pg_temp` (or any other schema) doesn't false-pass.
const BLANKET_REVOKE_RE = /\bREVOKE\s+(?:EXECUTE|ALL)(?:\s+PRIVILEGES)?\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+public\b[\s\S]{0,400}?\bFROM\b[\s\S]{0,200}?\b(?:authenticated|anon|public)\b/i

async function listMigrations(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.sql'))
    .map(e => e.name)
    .sort()
}

describe('SECURITY DEFINER grant hygiene', () => {
  it('every SECURITY DEFINER function also has a name-bound REVOKE (or is on the punch list)', async () => {
    const root = process.cwd()
    const migDir = path.join(root, 'supabase/migrations')
    const files = await listMigrations(migDir)
    expect(files.length, 'expected migrations under supabase/migrations/').toBeGreaterThan(0)

    // Cross-file scan: a REVOKE for function X in a LATER migration also
    // closes the gap (mig 227 backports REVOKEs for mig 222b/223/224/225
    // SECDEF trigger functions). Build the union of all .sql content so
    // buildRevokeRe(fnName) can match against any file. Added 2026-05-14
    // (Phase H4) — prior pass required same-file REVOKE which made it
    // impossible to retroactively close historical SECDEF grants without
    // mutating already-applied migration files.
    const allContent = (
      await Promise.all(files.map(n => fs.readFile(path.join(migDir, n), 'utf-8')))
    ).join('\n;-- next file --;\n')

    const newOffenders: string[] = []
    for (const name of files) {
      const content = await fs.readFile(path.join(migDir, name), 'utf-8')
      if (BLANKET_REVOKE_RE.test(content)) continue   // schema-wide revoke covers every fn
      const matches = [...content.matchAll(CREATE_SD_FUNCTION_RE)]
      if (matches.length === 0) continue
      if (KNOWN_OFFENDERS.has(name)) continue
      const ungated: string[] = []
      for (const m of matches) {
        const fnName = m[1]
        // Accept REVOKE in the same file (preferred — fresh migration
        // hygiene) OR in any later migration (back-fix path).
        if (!buildRevokeRe(fnName).test(content) && !buildRevokeRe(fnName).test(allContent)) {
          ungated.push(fnName)
        }
      }
      if (ungated.length > 0) {
        newOffenders.push(`${name} → ${ungated.join(', ')}`)
      }
    }

    expect(
      newOffenders,
      `These SECURITY DEFINER functions don't have a paired REVOKE EXECUTE ... FROM authenticated|anon|public in the same migration. Postgres defaults grant to PUBLIC, so each is callable by every logged-in user — likely a privilege-escalation hole. Add a function-specific REVOKE (and a GRANT to the intended role), or if intentional, add the filename to KNOWN_OFFENDERS in this test with a one-line justification:\n  ${newOffenders.join('\n  ')}`,
    ).toEqual([])
  })

  it(`KNOWN_OFFENDERS has not grown past ${KNOWN_OFFENDERS_MAX}`, () => {
    expect(
      KNOWN_OFFENDERS.size,
      `Punch list grew. Either remove an entry (preferred — add the REVOKE to the migration) or raise KNOWN_OFFENDERS_MAX with explicit justification.`,
    ).toBeLessThanOrEqual(KNOWN_OFFENDERS_MAX)
  })

  it('KNOWN_OFFENDERS entries still exist on disk and still lack a name-bound REVOKE', async () => {
    const root = process.cwd()
    const migDir = path.join(root, 'supabase/migrations')
    const stale: string[] = []
    for (const name of KNOWN_OFFENDERS) {
      const filePath = path.join(migDir, name)
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const matches = [...content.matchAll(CREATE_SD_FUNCTION_RE)]
        if (matches.length === 0) {
          stale.push(`${name} (no longer has SECURITY DEFINER — remove from list)`)
          continue
        }
        if (BLANKET_REVOKE_RE.test(content)) {
          stale.push(`${name} (now has schema-wide REVOKE — remove from list)`)
          continue
        }
        const allRevoked = matches.every(m => buildRevokeRe(m[1]).test(content))
        if (allRevoked) {
          stale.push(`${name} (every function now has a paired REVOKE — remove from list)`)
        }
      } catch {
        stale.push(`${name} (file gone — remove from list)`)
      }
    }
    expect(
      stale,
      `KNOWN_OFFENDERS is stale:\n  ${stale.join('\n  ')}`,
    ).toEqual([])
  })
})
