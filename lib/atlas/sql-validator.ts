/**
 * Atlas data-query SQL validator.
 *
 * First line of defense before sending LLM-generated SQL to atlas_safe_query().
 * The RPC enforces the same rules server-side, so this is defense in depth.
 *
 * Three layers:
 *   1. Prefix: must start with SELECT or WITH (case-insensitive, after trim)
 *   2. Forbidden tokens: no ; -- /* INSERT UPDATE etc.
 *   3. Allowlist: every \bFROM <ident> and \bJOIN <ident> must be in
 *      ALLOWED_TABLES (modulo `public.` schema prefix).
 *
 * Heidi 2026-04-28: pitched in the call as the "Ask Atlas" feature.
 * #208 (assumption tracking): the LLM may produce invalid SQL or attempt
 * to reference off-allowlist tables (e.g. auth.users). Reject before
 * execution; the LLM's promise to follow the system prompt isn't trusted.
 */

// R1 audit Critical (2026-04-28): `users` removed from the allowlist.
// `users` holds employee identity + role; with SECURITY DEFINER RPC, querying
// it would leak email/role across tenants. Rep-related queries should go
// through `sales_reps` (org-scoped via RLS) instead. We also moved the RPC
// to invoke RLS via `SET LOCAL ROLE authenticated`, so the remaining tables
// rely on per-table RLS for tenant isolation.
export const ALLOWED_TABLES = new Set([
  'projects', 'change_orders', 'project_funding', 'task_state',
  'stage_history', 'project_files', 'project_folders',
  'project_documents', 'project_adders', 'project_materials',
  'project_boms', 'notes', 'sales_reps', 'sales_teams',
  'crews', 'invoices', 'invoice_line_items', 'commission_records',
  'service_calls', 'work_orders', 'equipment', 'financiers',
  'utilities', 'hoas', 'ahjs', 'welcome_call_logs', 'task_due_dates',
  'task_history', 'task_reasons',
])

export interface ValidationResult {
  ok: boolean
  reason?: string
  tablesReferenced?: string[]
}

/**
 * Validate that `sql` is a pure SELECT/WITH against allowed tables.
 * Returns {ok: true} on success, or {ok: false, reason} on rejection.
 */
export function validateAtlasSql(sql: unknown): ValidationResult {
  if (typeof sql !== 'string') return { ok: false, reason: 'sql must be a string' }
  const trimmed = sql.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'sql is empty' }
  if (trimmed.length > 8000) return { ok: false, reason: 'sql exceeds 8000 chars' }

  const lower = trimmed.toLowerCase()

  // (a) Prefix — only SELECT. CTEs (WITH) are excluded for v1 because the
  // alias-vs-table distinction needs a real SQL parser to enforce safely;
  // a regex allowlist would silently accept "JOIN <cte_alias>" as if it
  // were a table.
  if (!/^select\b/.test(lower)) {
    return { ok: false, reason: `Only SELECT queries allowed (got prefix: ${lower.slice(0, 20)})` }
  }

  // (b) Forbidden tokens
  if (/(;|--|\/\*|\\)/.test(lower)) {
    return { ok: false, reason: 'SQL contains forbidden punctuation (semicolon, comment, backslash)' }
  }
  // Word-boundary check on dangerous keywords. \b in JS = word boundary.
  const dml = /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|call|do|copy|merge|reindex|cluster|vacuum|analyze|listen|notify|prepare|execute|deallocate|lock|set|reset|fetch|move|comment|security|invoker|definer)\b/
  if (dml.test(lower)) {
    return { ok: false, reason: 'SQL contains forbidden keyword (DML/DDL/transaction control)' }
  }
  const dangerousFns = /\b(pg_read_file|pg_read_binary_file|lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend|pg_sleep|copy_program)\b/
  if (dangerousFns.test(lower)) {
    return { ok: false, reason: 'SQL references a forbidden function' }
  }

  // (c) Allowlist
  const tablesReferenced: string[] = []
  // Match FROM/JOIN <ident>, where <ident> may be quoted, schema-prefixed.
  const re = /\b(?:from|join)\s+("[^"]+"|[a-z_][a-z0-9_.]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lower)) !== null) {
    let raw = m[1].replace(/"/g, '').trim()
    // Strip schema prefix if present.
    if (raw.includes('.')) {
      const parts = raw.split('.')
      if (parts[0] !== 'public') {
        return { ok: false, reason: `Cross-schema reference rejected: ${raw}` }
      }
      raw = parts.slice(1).join('.')
    }
    // Strip alias / trailing punctuation.
    const tableName = raw.replace(/[,\s)].*$/, '').trim()
    tablesReferenced.push(tableName)
    if (!ALLOWED_TABLES.has(tableName)) {
      return { ok: false, reason: `Table not in allowlist: ${tableName}` }
    }
  }

  if (tablesReferenced.length === 0) {
    return { ok: false, reason: 'No FROM/JOIN found — query must reference at least one allowlisted table' }
  }

  return { ok: true, tablesReferenced }
}
