/**
 * POST /api/atlas/query
 *
 * Atlas data-query agent. Takes a natural-language question, asks Claude
 * to generate SELECT SQL against an allowlist of tables, validates the SQL
 * with regex (defense in depth), then executes via the SECURITY DEFINER
 * RPC `atlas_safe_query` (see migration 108).
 *
 * Manager+ only (RPC enforces; this route checks too for early reject).
 * Rate limited 10/min/user + 25/day/user. Logged to atlas_query_log.
 *
 * R1 audit fixes (2026-04-28):
 *  - Critical: dropped `users` from the validator allowlist (employee PII
 *    leak via SECURITY DEFINER bypassing RLS)
 *  - High: RPC now uses SET LOCAL ROLE authenticated for the EXECUTE so
 *    per-table RLS enforces tenant isolation
 *  - Medium: RPC error messages sanitized in the response body
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'
import { rateLimit } from '@/lib/rate-limit'
import { validateAtlasSql } from '@/lib/atlas/sql-validator'

// Schema hints for Claude. Keep this terse — full information_schema is
// too noisy and burns tokens. Hand-curated to match Heidi's likely
// reporting needs.
const SCHEMA_HINTS = `
Schema (PostgreSQL, all in 'public'):

projects (the central table)
  id text PRIMARY KEY (e.g. 'PROJ-30188')
  name text, email text, phone text
  address text, city text, state text, zip text
  stage text ('evaluation','survey','design','permit','install','inspection','complete')
  stage_date date, sale_date date
  contract numeric, systemkw numeric  (system size in kW)
  module text, module_qty integer  (panel quantity)
  inverter text, inverter_qty integer
  battery text, battery_qty integer
  utility text, hoa text
  consultant text  (rep name as denormalized text)
  consultant_email text
  disposition text ('Sale','Cancel','Test', etc.)
  subhub_id text  (SubHub project id; non-null for SubHub-sourced rows)
  org_id uuid

change_orders
  id uuid, proposal_id uuid, status text, reason text
  output_purchased_kwh_override numeric  (Heidi's admin override)
  production_override_reason text
  snapshot_json jsonb
  requested_at timestamptz, resolved_at timestamptz

project_funding
  project_id text, funded_amount numeric, funded_date date

task_state
  project_id text, task_id text, status text  ('Not Ready', 'Ready To Start', 'In Progress', 'Complete')

stage_history
  project_id text, stage text, entered timestamptz

project_files
  project_id text, file_name text, file_url text, folder_name text
  (folder_name='SubHub' for backfilled SubHub docs)

users (auth identity)
  id uuid, email text, role text  ('admin','manager','team_leader','rep','viewer')

sales_reps
  id uuid, name text, email text

invoices
  id uuid, project_id text, amount numeric, status text, sent_at timestamptz

welcome_call_logs
  id uuid, project_id text, payload jsonb, processed boolean, received_at timestamptz

Common helpful filters:
  projects.disposition <> 'Test'  -- exclude test rows
  projects.sale_date >= current_date - interval '30 days'  -- last 30 days
  projects.systemkw > 15  -- large systems
`.trim()

const SYSTEM_PROMPT = `You are an SQL generator for a solar / energy CRM.

Given a user's natural-language question, generate ONE SQL SELECT statement that answers it. Output ONLY a JSON object with two fields:
  - "sql":         a single SELECT statement (no semicolons, no comments, no CTEs)
  - "explanation": one sentence describing what the query does

RULES:
1. Output ONLY JSON. No prose, no code fences, no markdown.
2. The SQL must start with the keyword SELECT.
3. NO semicolons, NO comments (-- or /* */), NO backslash escapes.
4. NO INSERT, UPDATE, DELETE, DROP, ALTER, GRANT, COPY, or other DDL/DML.
5. NO CTEs (no WITH clauses) — they will be rejected.
6. ONLY reference these tables (no schema prefix, or use public.X):
${[...Array.from(new Set([
  'projects', 'change_orders', 'project_funding', 'task_state',
  'stage_history', 'project_files', 'project_folders',
  'project_documents', 'project_adders', 'project_materials',
  'project_boms', 'notes', 'users', 'sales_reps', 'sales_teams',
  'crews', 'invoices', 'invoice_line_items', 'commission_records',
  'service_calls', 'work_orders', 'equipment', 'financiers',
  'utilities', 'hoas', 'ahjs', 'welcome_call_logs', 'task_due_dates',
  'task_history', 'task_reasons',
]))].sort().map(t => '   - ' + t).join('\n')}
7. Add LIMIT 1000 if no LIMIT is in the question, to keep responses bounded.
8. Use parameter-style values inline (the tool does not bind params); cast types correctly.
9. If the question can't be answered safely with a SELECT against the allowed tables, return: {"sql": "", "explanation": "<why it can't be answered>"}.

${SCHEMA_HINTS}`.trim()

interface ClaudeQueryPlan {
  sql?: unknown
  explanation?: unknown
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    },
  )

  // Auth
  const { data: authData } = await supabase.auth.getUser()
  const authUser = authData?.user
  if (!authUser?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Role gate (early reject; RPC also checks)
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', authUser.id)
    .single()
  const role = (profile as { role?: string } | null)?.role ?? 'viewer'
  if (!['admin', 'manager', 'team_leader'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden — Atlas data query is for managers and above' }, { status: 403 })
  }

  // Rate limit
  const { success: minuteOk } = await rateLimit(`atlas-query:${authUser.id}`, { max: 10, prefix: 'atlas-query' })
  if (!minuteOk) {
    return NextResponse.json({ error: 'Rate limit: 10 queries per minute' }, { status: 429 })
  }
  // R1 audit M (2026-04-28): drop daily cap from 100 to 25 to constrain
  // boolean-blind exfil rate (12 bits/day at 25 queries/day = ~3 days
  // per character of arbitrary data; still possible but slow enough
  // that the audit log alerts before meaningful damage).
  const { success: dailyOk } = await rateLimit(`atlas-query-daily:${authUser.id}`, {
    max: 25, windowMs: 86_400_000, prefix: 'atlas-query-daily',
  })
  if (!dailyOk) {
    return NextResponse.json({ error: 'Daily limit: 25 queries per day' }, { status: 429 })
  }

  // Body
  let body: { question?: unknown; page_path?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const pagePath = typeof body.page_path === 'string' ? body.page_path.slice(0, 200) : null
  if (!question || question.length < 3) {
    return NextResponse.json({ error: 'Question too short' }, { status: 400 })
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: 'Question too long (max 2000 chars)' }, { status: 400 })
  }

  // Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[atlas/query] ANTHROPIC_API_KEY not set')
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
  }
  const anthropic = new Anthropic({ apiKey })

  let plan: ClaudeQueryPlan
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }
    let raw = textBlock.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    plan = JSON.parse(raw) as ClaudeQueryPlan
  } catch (err) {
    console.error('[atlas/query] LLM call failed:', err)
    return NextResponse.json({ error: 'AI query generation failed' }, { status: 500 })
  }

  const sql = typeof plan.sql === 'string' ? plan.sql : ''
  const explanation = typeof plan.explanation === 'string' ? plan.explanation : ''

  // LLM may return empty sql when it refuses (e.g. write request).
  if (!sql) {
    return NextResponse.json({
      ok: false,
      explanation,
      reason: 'AI declined to generate SQL for this question.',
    })
  }

  // Validator (defense in depth — RPC enforces too)
  const validation = validateAtlasSql(sql)
  if (!validation.ok) {
    console.error(`[atlas/query] validator rejected for user=${authUser.email}: ${validation.reason}`)
    return NextResponse.json({
      ok: false,
      explanation,
      reason: validation.reason,
      sql,  // returned so the user sees what was rejected
    }, { status: 400 })
  }

  // Execute via SECURITY DEFINER RPC
  const { data: rpcResult, error: rpcError } = await supabase.rpc('atlas_safe_query', {
    p_question: question,
    p_sql: sql,
    p_page_path: pagePath,
  })

  if (rpcError) {
    // R1 audit M (2026-04-28): sanitize RPC error to a safe category.
    // Postgres SQLERRM strings can leak schema info (column names, types).
    // Server log keeps the detail; client gets the bucket.
    console.error(`[atlas/query] RPC error for user=${authUser.email}: ${rpcError.message}`)
    const msg = rpcError.message?.toLowerCase() ?? ''
    let safeReason = 'Query rejected by safe-query gate.'
    if (msg.includes('not in allowlist') || msg.includes('cross-schema')) {
      safeReason = 'Query references a table that is not allowed.'
    } else if (msg.includes('only select')) {
      safeReason = 'Only SELECT queries are allowed.'
    } else if (msg.includes('forbidden token')) {
      safeReason = 'Query contains a forbidden keyword or punctuation.'
    } else if (msg.includes('insufficient_privilege') || msg.includes('restricted')) {
      safeReason = 'Insufficient privilege.'
    } else if (msg.includes('statement timeout') || msg.includes('canceling statement')) {
      safeReason = 'Query timed out (5s limit). Try a more specific filter.'
    } else if (msg.includes('query failed:')) {
      safeReason = 'Query failed during execution. Try simpler filters or column names.'
    }
    return NextResponse.json({
      ok: false,
      explanation,
      reason: safeReason,
      sql,
    }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    explanation,
    sql,
    ...(rpcResult as Record<string, unknown>),
  })
}
