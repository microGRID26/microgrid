import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

// Static guards for migration 226's audit_log BEFORE UPDATE/DELETE
// trigger. Closes greg_actions #1059 (R1 red-teamer Low on mig 225).
// The trigger raises 42501 on UPDATE/DELETE against public.audit_log
// unless the transaction sets `app.audit_log_admin_purge = 'true'`,
// defending the paper trail mig 225 writes against post-mutation by
// the same DB-admin trust principals (postgres / supabase_admin /
// service_role) whose actions mig 225 records.
//
// Style matches __tests__/migrations/projects-log-db-admin-bypass.test.ts
// (mig 225 test) — static inspection of the .sql files. Runtime DB-level
// coverage of the BEFORE UPDATE/DELETE behavior lives outside this file
// (live MCP smoke in commit message; PostgREST E2E gated on greg_actions
// #1058 + #1054 integration-test scaffolding).

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'supabase', 'migrations')

async function listMigrations(): Promise<string[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.sql'))
    .map(e => e.name)
    .sort()
}

async function readAllMigrations(): Promise<{ file: string; sql: string }[]> {
  const files = await listMigrations()
  return Promise.all(
    files.map(async file => ({
      file,
      sql: await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8'),
    })),
  )
}

async function latestFunctionBody(fnName: string): Promise<{ file: string; body: string } | null> {
  const all = await readAllMigrations()
  for (let i = all.length - 1; i >= 0; i--) {
    const re = new RegExp(
      `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\b[\\s\\S]*?\\$\\$;`,
      'gi',
    )
    const m = re.exec(all[i].sql)
    if (m) return { file: all[i].file, body: m[0] }
  }
  return null
}

async function latestTriggerStatement(triggerName: string): Promise<{ file: string; body: string } | null> {
  const all = await readAllMigrations()
  for (let i = all.length - 1; i >= 0; i--) {
    const re = new RegExp(`\\bCREATE\\s+TRIGGER\\s+${triggerName}\\b[\\s\\S]*?;`, 'gi')
    const m = re.exec(all[i].sql)
    if (m) return { file: all[i].file, body: m[0] }
  }
  return null
}

describe('audit_log_block_admin_tamper — BEFORE UPDATE/DELETE seal on audit_log (mig 226)', () => {
  it('function exists with SECURITY DEFINER + SET search_path including pg_temp last', async () => {
    const def = await latestFunctionBody('audit_log_block_admin_tamper')
    expect(def).not.toBeNull()
    if (!def) return

    expect(def.body).toMatch(/\bSECURITY\s+DEFINER\b/i)
    // Negative assert: a future CREATE OR REPLACE that silently drops
    // SECURITY DEFINER for SECURITY INVOKER would resolve `current_setting`
    // checks under the caller's auth context rather than the function-
    // owner's — not strictly broken here (the GUC is txn-local either way)
    // but the standard pattern across mig 223/224/225 is SECURITY DEFINER
    // and divergence should be loud, not silent.
    expect(def.body).not.toMatch(/\bSECURITY\s+INVOKER\b/i)
    // pg_temp must appear LAST in the search_path so attacker-created
    // shims in pg_temp can't shadow public objects. Atlas migration
    // guard enforces this at apply time; pin it in source too.
    expect(def.body).toMatch(/\bSET\s+search_path\s*=\s*public\s*,\s*pg_temp\b/i)
  })

  it('gates on the app.audit_log_admin_purge GUC (positive + name pin)', async () => {
    const def = await latestFunctionBody('audit_log_block_admin_tamper')
    expect(def).not.toBeNull()
    if (!def) return

    // GUC name is the load-bearing invariant — every retention/purge tool
    // in the future has to set this exact name. Pin both the bare
    // identifier and the current_setting() call against it.
    expect(def.body).toMatch(/\bapp\.audit_log_admin_purge\b/)
    expect(def.body).toMatch(/\bcurrent_setting\s*\(\s*'app\.audit_log_admin_purge'/i)
  })

  it('uses NULL-safe IS NOT DISTINCT FROM (not =, which is falsy on NULL)', async () => {
    const def = await latestFunctionBody('audit_log_block_admin_tamper')
    expect(def).not.toBeNull()
    if (!def) return

    // current_setting('missing.guc', true) returns NULL. Comparing
    // `NULL = 'true'` evaluates to NULL — falsy in plpgsql IF semantics,
    // so the gate would (correctly) deny. But mig 222b's silent prod break
    // (auth.role() <> 'authenticated' being NULL-falsy in the OPPOSITE
    // direction) is the cautionary tale: NULL-aware comparison must be
    // explicit. Pin the IS NOT DISTINCT FROM pattern so a future cleanup
    // that "simplifies" it back to `=` regresses out loud.
    expect(def.body).toMatch(/IS\s+NOT\s+DISTINCT\s+FROM\s+'true'/i)
    // Defense in depth: ensure no plain-= against the literal 'true'
    // sneaks in.
    expect(def.body).not.toMatch(/current_setting[^)]*\)\s*=\s*'true'/i)
  })

  it('raises SQLSTATE 42501 (insufficient_privilege) when GUC not set', async () => {
    const def = await latestFunctionBody('audit_log_block_admin_tamper')
    expect(def).not.toBeNull()
    if (!def) return

    // 42501 mirrors mig 223/224's permission-denied SQLSTATE on direct
    // stage/use_sld_v2 UPDATEs — same SQLSTATE means client error
    // handling is uniform across the trio.
    expect(def.body).toMatch(/RAISE\s+EXCEPTION\b/i)
    expect(def.body).toMatch(/\bERRCODE\s*=\s*'42501'/i)
  })

  it('returns OLD for DELETE and NEW for UPDATE on the purge-authorized path', async () => {
    const def = await latestFunctionBody('audit_log_block_admin_tamper')
    expect(def).not.toBeNull()
    if (!def) return

    // BEFORE DELETE trigger that returns NEW would silently no-op the
    // DELETE (NEW is NULL in DELETE context). BEFORE UPDATE trigger that
    // returns NULL aborts the UPDATE. Pin both the TG_OP discriminator
    // and the correct RETURNs so a future refactor can't accidentally
    // make the purge path a silent no-op.
    expect(def.body).toMatch(/\bTG_OP\s*=\s*'DELETE'/i)
    expect(def.body).toMatch(/\bRETURN\s+OLD\b/i)
    expect(def.body).toMatch(/\bRETURN\s+NEW\b/i)
  })

  it('trigger is BEFORE UPDATE OR DELETE on public.audit_log FOR EACH ROW', async () => {
    const stmt = await latestTriggerStatement('audit_log_block_admin_tamper_trg')
    expect(stmt).not.toBeNull()
    if (!stmt) return

    // BEFORE timing is load-bearing: an AFTER trigger that RAISEs still
    // rolls the txn back, but the UPDATE/DELETE statement counts as
    // "succeeded" from the caller's perspective for one tick before the
    // raise. BEFORE makes the rejection synchronous with the statement.
    expect(stmt.body).toMatch(/\bBEFORE\b/i)
    // OR DELETE must be present — UPDATE-only would leave DELETE as the
    // tamper path.
    expect(stmt.body).toMatch(/\bUPDATE\b/i)
    expect(stmt.body).toMatch(/\bDELETE\b/i)
    // Verify the trigger doesn't also fire on INSERT — that would conflict
    // with mig 214's audit_log_resolve_actor_trg and mig 225's writes.
    expect(stmt.body).not.toMatch(/\bINSERT\b/i)
    expect(stmt.body).toMatch(/\bON\s+(?:public\.)?audit_log\b/i)
    expect(stmt.body).toMatch(/\bFOR\s+EACH\s+ROW\b/i)
    expect(stmt.body).toMatch(
      /\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?audit_log_block_admin_tamper\s*\(/i,
    )
  })

  it('no later migration neutralizes the trigger via DROP / DISABLE / RENAME / GRANT bypass', async () => {
    const all = await readAllMigrations()
    const violations: { file: string; pattern: string }[] = []
    const dropTriggerRe =
      /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?audit_log_block_admin_tamper_trg\b/i
    const dropFunctionRe =
      /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?audit_log_block_admin_tamper\b/i
    const disableRe =
      /\bALTER\s+TABLE\s+(?:public\.)?audit_log\s+DISABLE\s+TRIGGER\s+audit_log_block_admin_tamper_trg\b/i
    const renameRe = /\bALTER\s+TRIGGER\s+audit_log_block_admin_tamper_trg\b[\s\S]{0,80}?\bRENAME\b/i
    const grantPublicRe =
      /\bGRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?audit_log_block_admin_tamper[^;]*\bTO[^;]*\b(?:PUBLIC|anon)\b/i

    for (const m of all) {
      // Mig 226 itself contains DROP TRIGGER IF EXISTS immediately before
      // CREATE TRIGGER — that's idempotency, not an attack. Whitelist the
      // file that defines the trigger.
      const definesTrigger = /\bCREATE\s+TRIGGER\s+audit_log_block_admin_tamper_trg\b/i.test(m.sql)

      if (!definesTrigger && dropTriggerRe.test(m.sql))
        violations.push({ file: m.file, pattern: 'DROP TRIGGER audit_log_block_admin_tamper_trg' })
      if (dropFunctionRe.test(m.sql))
        violations.push({ file: m.file, pattern: 'DROP FUNCTION audit_log_block_admin_tamper' })
      if (disableRe.test(m.sql))
        violations.push({
          file: m.file,
          pattern: 'DISABLE TRIGGER audit_log_block_admin_tamper_trg',
        })
      if (renameRe.test(m.sql))
        violations.push({ file: m.file, pattern: 'ALTER TRIGGER ... RENAME' })
      if (grantPublicRe.test(m.sql))
        violations.push({
          file: m.file,
          pattern: 'GRANT EXECUTE ON audit_log_block_admin_tamper TO PUBLIC|anon',
        })
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })

  it('revokes EXECUTE from PUBLIC + anon + authenticated (defense in depth)', async () => {
    const all = await readAllMigrations()
    const mig226 = all.find(m => m.file === '226-audit-log-append-only-seal.sql')
    expect(mig226).not.toBeUndefined()
    if (!mig226) return

    // R1 red-teamer M1 fold (2026-05-14). The trigger function is invoked
    // by the table owner on UPDATE/DELETE regardless of EXECUTE grants —
    // revoking direct EXECUTE blocks the discoverable `SELECT
    // public.audit_log_block_admin_tamper()` surface (which raises with
    // NULL OLD but is still surface). Mig 223/224/225 share the gap;
    // backport in a hygiene pass.
    expect(mig226.sql).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?audit_log_block_admin_tamper\s*\(\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i,
    )
  })

  it('postcondition DO block asserts function + trigger + GUC name + 42501 + BEFORE+enabled after apply', async () => {
    const all = await readAllMigrations()
    const mig226 = all.find(m => m.file === '226-audit-log-append-only-seal.sql')
    expect(mig226).not.toBeUndefined()
    if (!mig226) return

    // Mirrors the R1-sweep pattern from mig 223/224/225: the apply itself
    // fails if the function body or trigger doesn't have the load-bearing
    // invariants. Future CREATE OR REPLACE drift gets caught at migration
    // time, not at runtime.
    expect(mig226.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+226\s+postcondition:\s+function/i)
    expect(mig226.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+226\s+postcondition:[\s\S]*?app\\\.audit_log_admin_purge/i)
    expect(mig226.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+226\s+postcondition:[\s\S]*?IS NOT DISTINCT FROM/i)
    expect(mig226.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+226\s+postcondition:[\s\S]*?42501/i)
    expect(mig226.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+226\s+postcondition:[\s\S]*?trigger/i)
    // R1 M2 fold: postcondition must pin BEFORE timing bit + tgenabled='O'
    // so ad-hoc DISABLE TRIGGER doesn't silently neuter the seal.
    expect(mig226.sql).toMatch(/\(tgtype\s*&\s*2\)\s*<>\s*0/)
    expect(mig226.sql).toMatch(/tgenabled\s*=\s*'O'/)
  })
})
