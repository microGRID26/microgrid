import { describe, it, expect } from 'vitest'
import { validateAtlasSql, ALLOWED_TABLES } from '@/lib/atlas/sql-validator'

// Adversarial test suite for the Atlas data-query SQL validator.
// Every "rejected" path here must also be rejected by the SECURITY DEFINER
// RPC `atlas_safe_query` (defense in depth). When in doubt, ADD a test here.

describe('validateAtlasSql — happy paths', () => {
  it('accepts a basic SELECT', () => {
    const r = validateAtlasSql('SELECT id, name FROM projects WHERE state = ?')
    expect(r.ok).toBe(true)
    expect(r.tablesReferenced).toEqual(['projects'])
  })

  it('accepts SELECT with JOIN', () => {
    const r = validateAtlasSql('SELECT p.id FROM projects p JOIN sales_reps sr ON sr.id = p.rep_id')
    expect(r.ok).toBe(true)
    expect(r.tablesReferenced).toEqual(['projects', 'sales_reps'])
  })

  it('rejects CTE (WITH ...) — alias detection needs a real parser, not regex', () => {
    const r = validateAtlasSql(`WITH recent AS (SELECT id FROM projects WHERE sale_date > '2026-01-01') SELECT * FROM recent JOIN change_orders ON true`)
    expect(r.ok).toBe(false)
  })

  it('accepts schema-qualified public.table', () => {
    const r = validateAtlasSql('SELECT * FROM public.projects')
    expect(r.ok).toBe(true)
  })

  it('accepts mixed-case keywords', () => {
    const r = validateAtlasSql('Select * From projects Where systemkw > 15')
    expect(r.ok).toBe(true)
  })
})

describe('validateAtlasSql — DML rejections', () => {
  it('rejects INSERT', () => {
    expect(validateAtlasSql('INSERT INTO projects (id) VALUES (1)').ok).toBe(false)
  })
  it('rejects UPDATE', () => {
    expect(validateAtlasSql('UPDATE projects SET name = ?').ok).toBe(false)
  })
  it('rejects DELETE', () => {
    expect(validateAtlasSql('DELETE FROM projects').ok).toBe(false)
  })
  it('rejects DROP TABLE', () => {
    expect(validateAtlasSql('DROP TABLE projects').ok).toBe(false)
  })
  it('rejects ALTER', () => {
    expect(validateAtlasSql('ALTER TABLE projects ADD COLUMN x int').ok).toBe(false)
  })
  it('rejects TRUNCATE', () => {
    expect(validateAtlasSql('TRUNCATE projects').ok).toBe(false)
  })
  it('rejects GRANT', () => {
    expect(validateAtlasSql('GRANT ALL ON projects TO public').ok).toBe(false)
  })
})

describe('validateAtlasSql — multi-statement / comment injection', () => {
  it('rejects semicolon-separated statements', () => {
    expect(validateAtlasSql('SELECT 1; DROP TABLE projects').ok).toBe(false)
  })
  it('rejects line-comment after SELECT', () => {
    expect(validateAtlasSql('SELECT 1 -- malicious').ok).toBe(false)
  })
  it('rejects block-comment injection', () => {
    expect(validateAtlasSql('SELECT 1 /* stuff */ FROM projects').ok).toBe(false)
  })
  it('rejects backslash escapes', () => {
    expect(validateAtlasSql('SELECT \\\\ FROM projects').ok).toBe(false)
  })
})

describe('validateAtlasSql — allowlist enforcement', () => {
  it('rejects auth.users (not in allowlist, schema)', () => {
    expect(validateAtlasSql('SELECT * FROM auth.users').ok).toBe(false)
  })
  it('rejects pg_catalog tables', () => {
    expect(validateAtlasSql('SELECT * FROM pg_catalog.pg_tables').ok).toBe(false)
  })
  it('rejects atlas_query_log (the audit table itself)', () => {
    // atlas_query_log is intentionally NOT in the allowlist — admins can query
    // it via the dashboard, not via the AI agent.
    expect(validateAtlasSql('SELECT * FROM atlas_query_log').ok).toBe(false)
  })
  it('rejects greg_actions (operational table)', () => {
    expect(validateAtlasSql('SELECT * FROM greg_actions').ok).toBe(false)
  })
  it('rejects partner_api_keys (secrets-adjacent)', () => {
    expect(validateAtlasSql('SELECT * FROM partner_api_keys').ok).toBe(false)
  })
  it('accepts UNION over two allowlisted tables', () => {
    const r = validateAtlasSql('SELECT id FROM projects UNION SELECT id FROM change_orders')
    expect(r.ok).toBe(true)
  })
  it('rejects UNION that smuggles a non-allowlisted table', () => {
    expect(validateAtlasSql('SELECT id FROM projects UNION SELECT id FROM auth.users').ok).toBe(false)
  })
  it('rejects JOIN against a non-allowlisted table', () => {
    expect(validateAtlasSql('SELECT * FROM projects JOIN auth.users ON true').ok).toBe(false)
  })
})

describe('validateAtlasSql — dangerous functions', () => {
  it('rejects pg_read_file()', () => {
    expect(validateAtlasSql("SELECT pg_read_file('/etc/passwd') FROM projects").ok).toBe(false)
  })
  it('rejects pg_sleep (DoS)', () => {
    expect(validateAtlasSql('SELECT pg_sleep(60) FROM projects').ok).toBe(false)
  })
  it('rejects dblink()', () => {
    expect(validateAtlasSql("SELECT * FROM dblink('host=evil','SELECT 1') AS t(x int)").ok).toBe(false)
  })
  it('rejects lo_import()', () => {
    expect(validateAtlasSql("SELECT lo_import('/etc/passwd')").ok).toBe(false)
  })
})

describe('validateAtlasSql — input shape', () => {
  it('rejects empty string', () => {
    expect(validateAtlasSql('').ok).toBe(false)
  })
  it('rejects whitespace-only', () => {
    expect(validateAtlasSql('   \t\n   ').ok).toBe(false)
  })
  it('rejects null', () => {
    expect(validateAtlasSql(null).ok).toBe(false)
  })
  it('rejects non-string', () => {
    expect(validateAtlasSql({ select: 1 }).ok).toBe(false)
  })
  it('rejects oversized SQL (>8000 chars)', () => {
    const long = 'SELECT * FROM projects WHERE name = ' + ' OR name = ?'.repeat(800)
    expect(validateAtlasSql(long).ok).toBe(false)
  })
  it('rejects non-prefix tokens', () => {
    expect(validateAtlasSql('hello world').ok).toBe(false)
    expect(validateAtlasSql('-- just a comment').ok).toBe(false)
  })
})

describe('validateAtlasSql — allowlist health check', () => {
  it('has 29 tables (matches RPC v_allowlist; users removed per R1 audit)', () => {
    expect(ALLOWED_TABLES.size).toBe(29)
  })
  it('includes projects + change_orders + welcome_call_logs + sales_reps', () => {
    expect(ALLOWED_TABLES.has('projects')).toBe(true)
    expect(ALLOWED_TABLES.has('change_orders')).toBe(true)
    expect(ALLOWED_TABLES.has('welcome_call_logs')).toBe(true)
    expect(ALLOWED_TABLES.has('sales_reps')).toBe(true)
  })
  it('does NOT include users (R1 audit Critical: cross-tenant PII leak via SECURITY DEFINER)', () => {
    expect(ALLOWED_TABLES.has('users')).toBe(false)
  })
  it('does NOT include atlas_*, paul_*, partner_*', () => {
    for (const t of ['atlas_query_log', 'paul_morning_reviews', 'partner_api_keys']) {
      expect(ALLOWED_TABLES.has(t)).toBe(false)
    }
  })
})
