import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

// Static guards for migration 225's audit_log AFTER trigger on
// public.projects. Closes greg_actions #1053 (R1 finding from mig 223 +
// 224). The trigger logs an audit_log row when a DB-admin connection
// role (postgres / supabase_admin / service_role) UPDATEs stage,
// stage_date, or use_sld_v2 on a projects row — closing the silent-
// paper-trail gap introduced by the Bypass A escape hatch in mig 223 +
// 224.
//
// Style matches __tests__/migrations/audit-log-resolve-actor.test.ts —
// static inspection of the .sql files. Runtime DB-level coverage is
// blocked on integration-test infra (greg_actions #1058 prereq for
// #1054).

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

describe('projects_log_db_admin_bypass — audit_log trigger on DB-admin bypass (mig 225)', () => {
  it('function exists with SECURITY DEFINER + SET search_path including pg_temp last', async () => {
    const def = await latestFunctionBody('projects_log_db_admin_bypass')
    expect(def).not.toBeNull()
    if (!def) return

    expect(def.body).toMatch(/\bSECURITY\s+DEFINER\b/i)
    // Negative assert: a future CREATE OR REPLACE that silently drops
    // SECURITY DEFINER for SECURITY INVOKER would let auth.uid() resolve
    // to the JWT user inside the function — audit_log_resolve_actor
    // would then overwrite our 'db-admin' attribution with the JWT
    // user's identity, masking the bypass.
    expect(def.body).not.toMatch(/\bSECURITY\s+INVOKER\b/i)
    // pg_temp must appear LAST in the search_path so attacker-created
    // shims in pg_temp can't shadow public objects. Atlas migration
    // guard enforces this at apply time; pin it in source too.
    expect(def.body).toMatch(/\bSET\s+search_path\s*=\s*public\s*,\s*pg_temp\b/i)
  })

  it('discriminates on session_user against the DB-admin allowlist (NOT current_user)', async () => {
    const def = await latestFunctionBody('projects_log_db_admin_bypass')
    expect(def).not.toBeNull()
    if (!def) return

    // session_user is the original connection role; current_user inside a
    // SECURITY DEFINER returns the function OWNER (postgres) for every
    // caller — would log every UPDATE. This was 222b's silent prod break
    // (fixed in mig 224). Pin the session_user pattern here.
    expect(def.body).toMatch(/\bsession_user\b/)
    expect(def.body).not.toMatch(/\bcurrent_user\b/)

    // The allowlist must include all three DB-admin roles. Order is not
    // load-bearing but each role must be present.
    expect(def.body).toMatch(/'postgres'/)
    expect(def.body).toMatch(/'supabase_admin'/)
    expect(def.body).toMatch(/'service_role'/)
  })

  it('gates stage/stage_date logging on app.via_set_project_stage GUC (no double-log on RPC path)', async () => {
    const def = await latestFunctionBody('projects_log_db_admin_bypass')
    expect(def).not.toBeNull()
    if (!def) return

    // set_project_stage RPC writes its own audit_log row. If a DB-admin
    // session invokes that RPC (session_user='postgres'), our AFTER
    // trigger fires AND the RPC writes — without the GUC guard, every
    // stage transition from MCP would log twice. The GUC name is the
    // load-bearing invariant.
    expect(def.body).toMatch(/\bapp\.via_set_project_stage\b/)
    expect(def.body).toMatch(/\bcurrent_setting\s*\(\s*'app\.via_set_project_stage'/i)
  })

  it('logs use_sld_v2 unconditionally (no governing RPC for that column)', async () => {
    const def = await latestFunctionBody('projects_log_db_admin_bypass')
    expect(def).not.toBeNull()
    if (!def) return

    // use_sld_v2 has no governing RPC — any DB-admin direct UPDATE is
    // by definition the unaudited bypass path. The use_sld_v2 INSERT
    // block must NOT be gated on the via_set_project_stage GUC.
    const v2Block = def.body.match(
      /IF\s*\(\s*NEW\.use_sld_v2\s+IS\s+DISTINCT\s+FROM\s+OLD\.use_sld_v2\s*\)[\s\S]*?END\s+IF;/i,
    )
    expect(v2Block).not.toBeNull()
    if (!v2Block) return
    expect(v2Block[0]).not.toMatch(/\bapp\.via_set_project_stage\b/)
  })

  it('writes audit_log rows attributed to db-admin + session_user', async () => {
    const def = await latestFunctionBody('projects_log_db_admin_bypass')
    expect(def).not.toBeNull()
    if (!def) return

    // Three INSERTs total — one per field (stage, stage_date, use_sld_v2).
    const insertCount = (def.body.match(/INSERT\s+INTO\s+public\.audit_log\b/gi) || []).length
    expect(insertCount).toBe(3)

    // Every INSERT must attribute the actor as 'db-admin' (not 'admin',
    // not NEW.changed_by — that would let a caller spoof the attribution
    // by setting other columns) and changed_by_id to the session_user
    // local. audit_log_resolve_actor (mig 214 BEFORE INSERT) is a no-op
    // here because DB-admin connections have no JWT (auth.uid() IS NULL),
    // so our attribution survives.
    const dbAdminCount = (def.body.match(/'db-admin'/g) || []).length
    expect(dbAdminCount).toBe(3)
    const vSessionCount = (def.body.match(/\bv_session\b/g) || []).length
    // Once in the DECLARE block, three times in INSERT VALUES, plus the
    // NOT IN check — total >= 5. Lower bound is enough.
    expect(vSessionCount).toBeGreaterThanOrEqual(4)
  })

  it('trigger is AFTER UPDATE OF stage, stage_date, use_sld_v2 FOR EACH ROW on public.projects', async () => {
    const stmt = await latestTriggerStatement('projects_log_db_admin_bypass_trg')
    expect(stmt).not.toBeNull()
    if (!stmt) return

    // AFTER UPDATE is load-bearing: BEFORE UPDATE would fire before the
    // change is visible to the trigger function's IS DISTINCT FROM checks
    // (actually NEW vs OLD work in either, but writing audit_log from a
    // BEFORE trigger means the row hasn't committed yet — same tx,
    // ROLLBACK takes both with it, which is what we want, so the
    // distinction is structural correctness rather than semantic; pin
    // AFTER for the canonical pattern).
    expect(stmt.body).toMatch(/\bAFTER\s+UPDATE\s+OF\b/i)
    // OF-clause must list all three watched columns. Future schema adds
    // (e.g. install_date) wouldn't auto-extend coverage; pin the three
    // individually so a cosmetic re-sort doesn't break the test.
    const ofClause = stmt.body.match(/\bAFTER\s+UPDATE\s+OF\s+(\w+(?:\s*,\s*\w+)*)/i)
    expect(ofClause).not.toBeNull()
    if (!ofClause) return
    const cols = ofClause[1].split(/\s*,\s*/).map(s => s.trim())
    expect(cols).toContain('stage')
    expect(cols).toContain('stage_date')
    expect(cols).toContain('use_sld_v2')
    expect(stmt.body).toMatch(/\bON\s+(?:public\.)?projects\b/i)
    expect(stmt.body).toMatch(/\bFOR\s+EACH\s+ROW\b/i)
    expect(stmt.body).toMatch(
      /\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?projects_log_db_admin_bypass\s*\(/i,
    )
  })

  it('no later migration neutralizes the trigger via DROP / DISABLE / RENAME / GRANT bypass', async () => {
    const all = await readAllMigrations()
    const violations: { file: string; pattern: string }[] = []
    const dropTriggerRe =
      /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?projects_log_db_admin_bypass_trg\b/i
    const dropFunctionRe =
      /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?projects_log_db_admin_bypass\b/i
    const disableRe =
      /\bALTER\s+TABLE\s+(?:public\.)?projects\s+DISABLE\s+TRIGGER\s+projects_log_db_admin_bypass_trg\b/i
    const renameRe = /\bALTER\s+TRIGGER\s+projects_log_db_admin_bypass_trg\b[\s\S]{0,80}?\bRENAME\b/i
    const grantPublicRe =
      /\bGRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?projects_log_db_admin_bypass[^;]*\bTO[^;]*\b(?:PUBLIC|anon)\b/i

    for (const m of all) {
      // Mig 225 itself contains DROP TRIGGER IF EXISTS immediately before
      // CREATE TRIGGER — that's idempotency, not an attack. Whitelist the
      // file that defines the trigger.
      const definesTrigger = /\bCREATE\s+TRIGGER\s+projects_log_db_admin_bypass_trg\b/i.test(m.sql)

      if (!definesTrigger && dropTriggerRe.test(m.sql))
        violations.push({ file: m.file, pattern: 'DROP TRIGGER projects_log_db_admin_bypass_trg' })
      if (dropFunctionRe.test(m.sql))
        violations.push({ file: m.file, pattern: 'DROP FUNCTION projects_log_db_admin_bypass' })
      if (disableRe.test(m.sql))
        violations.push({
          file: m.file,
          pattern: 'DISABLE TRIGGER projects_log_db_admin_bypass_trg',
        })
      if (renameRe.test(m.sql))
        violations.push({ file: m.file, pattern: 'ALTER TRIGGER ... RENAME' })
      if (grantPublicRe.test(m.sql))
        violations.push({
          file: m.file,
          pattern: 'GRANT EXECUTE ON projects_log_db_admin_bypass TO PUBLIC|anon',
        })
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })

  it('postcondition DO block asserts function + trigger after apply (defense against future drift)', async () => {
    const all = await readAllMigrations()
    const mig225 = all.find(m => m.file === '225-audit-log-db-admin-bypass-trigger.sql')
    expect(mig225).not.toBeUndefined()
    if (!mig225) return

    // Mirrors the R1-sweep pattern from mig 223/224 commit 3: the apply
    // itself fails if the function body or trigger doesn't have the
    // load-bearing invariants. Future CREATE OR REPLACE drift gets
    // caught at migration time, not at runtime.
    expect(mig225.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+225\s+postcondition:\s+function/i)
    expect(mig225.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+225\s+postcondition:[\s\S]*?session_user/i)
    expect(mig225.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+225\s+postcondition:[\s\S]*?via_set_project_stage/i)
    expect(mig225.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+225\s+postcondition:[\s\S]*?use_sld_v2/i)
    expect(mig225.sql).toMatch(/RAISE\s+EXCEPTION\s+'mig\s+225\s+postcondition:[\s\S]*?trigger/i)
  })
})
