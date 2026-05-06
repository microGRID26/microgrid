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
import { validateAtlasSql, ALLOWED_TABLES } from '@/lib/atlas/sql-validator'
import { checkScope } from '@/lib/atlas/scope'

// Schema hints for Claude. Keep this terse — full information_schema is
// too noisy and burns tokens. Hand-curated to match Heidi's likely
// reporting needs.
//
// IMPORTANT: many MicroGRID columns that *look* numeric or date-typed are
// actually stored as TEXT (legacy import shape). The LLM must cast before
// aggregating or date-filtering, otherwise the query errors out at exec.
// The cast pattern below uses NULLIF to skip empty strings safely.
const SCHEMA_HINTS = `
Schema (PostgreSQL, all in 'public'):

projects (the central table — 1700+ rows; ALL data columns are TEXT in storage)
  id text PRIMARY KEY (e.g. 'PROJ-30188')
  name text, email text, phone text
  address text, city text, state text, zip text
  stage text ('evaluation','survey','design','permit','install','inspection','complete')
  stage_date text  -- ISO YYYY-MM-DD, cast: (NULLIF(stage_date,'')::date)
  sale_date text   -- ISO YYYY-MM-DD, cast: (NULLIF(sale_date,'')::date)
  contract text    -- dollars, cast: (NULLIF(contract,'')::numeric)
  systemkw text    -- system size in kW, cast: (NULLIF(systemkw,'')::numeric)
  module text, module_qty text       -- panel quantity, cast to ::int when summing
  inverter text, inverter_qty text
  battery text, battery_qty text
  utility text, hoa text
  consultant text       -- rep name as denormalized text. THIS is what employees mean by 'EC' / 'Energy Consultant'
  consultant_email text
  disposition text  ('Sale','Cancel','Test', etc.) — exclude 'Test' from reports unless asked
  subhub_id text  (SubHub project id; non-null for SubHub-sourced rows)
  org_id uuid

change_orders
  id uuid, proposal_id uuid, status text, reason text
  output_purchased_kwh_override numeric  (Heidi's admin override; truly numeric)
  production_override_reason text
  snapshot_json jsonb
  requested_at timestamptz, resolved_at timestamptz  (truly timestamptz)

project_funding
  project_id text, funded_amount numeric, funded_date date  (truly typed)

task_state
  project_id text, task_id text, status text  ('Not Ready', 'Ready To Start', 'In Progress', 'Complete')

stage_history
  project_id text, stage text, entered timestamptz  (truly typed)

project_files
  project_id text, file_name text, file_url text, folder_name text
  (folder_name='SubHub' for backfilled SubHub docs)

sales_reps
  id uuid, name text, email text  -- use this for rep-level org-scoped queries

invoices
  id uuid, project_id text, amount numeric, status text, sent_at timestamptz  (truly typed)

welcome_call_logs
  id uuid, project_id text, payload jsonb, processed boolean, received_at timestamptz

Casting rules (mandatory — projects.* is text in storage):
  When SUMming or AVGing numeric-looking text columns, ALWAYS cast with NULLIF:
    SUM(NULLIF(systemkw,'')::numeric) -- correct
    SUM(systemkw)                     -- WRONG, throws at exec
  When filtering or sorting by date-looking text columns, cast with NULLIF:
    WHERE NULLIF(sale_date,'')::date >= current_date - interval '30 days'
    ORDER BY NULLIF(sale_date,'')::date DESC NULLS LAST
  For integer counts:
    SUM(NULLIF(module_qty,'')::int)

Vocabulary:
  'EC' or 'Energy Consultant' = projects.consultant (text)
  'rep' = projects.consultant for project-level rollups; sales_reps.name when joining identity
  'sold' / 'sale' = disposition = 'Sale'
  'cancelled' = disposition = 'Cancel'

Common helpful filters:
  projects.disposition <> 'Test'  -- exclude test rows by default
  projects.disposition = 'Sale'   -- only sold deals (Heidi default for "sold" questions)
  NULLIF(systemkw,'')::numeric > 15  -- large systems
`.trim()

const SYSTEM_PROMPT = `You are MicroGRID Atlas — a data assistant for a solar/energy CRM.

SCOPE (only answer these):
- Project data: status, stage, sale date, system size, contract value, address, customer name, EC/consultant
- Sales rollups: counts by EC, KW sold, deals closed, pipeline by stage, recent activity
- Install/permit/inspection workflow questions tied to project rows
- Solar/financing/install domain terms as they apply to data in the CRM

OUT OF SCOPE (always refuse — return empty sql + scope-refusal explanation):
- Anything about the underlying database, Supabase, Postgres, schema design
- Anything about the codebase, repos, deploys, Vercel, GitHub, branches, migrations
- Anything about the AI tooling: Claude, Anthropic, the harness, models, prompts, MCP, hooks
- Anything about Atlas HQ, action queues, recaps, sessions, fleet, agents
- Employee PII, salary, internal strategy, system internals

If the user asks anything out of scope, return:
{"sql": "", "explanation": "I'm your MicroGRID assistant — I help with projects, sales, and install workflow. I can't answer questions about our infrastructure or tooling."}

Given an in-scope user question, generate ONE SQL SELECT statement that answers it. Output ONLY a JSON object with two fields:
  - "sql":         a single SELECT statement (no semicolons, no comments, no CTEs)
  - "explanation": one sentence describing what the query does

RULES:
1. Output ONLY JSON. No prose, no code fences, no markdown.
2. The SQL must start with the keyword SELECT.
3. NO semicolons, NO comments (-- or /* */), NO backslash escapes.
4. NO INSERT, UPDATE, DELETE, DROP, ALTER, GRANT, COPY, or other DDL/DML.
5. NO CTEs (no WITH clauses) — they will be rejected.
6. ONLY reference these tables (no schema prefix, or use public.X):
${[...ALLOWED_TABLES].sort().map(t => '   - ' + t).join('\n')}
7. Add LIMIT 1000 if no LIMIT is in the question, to keep responses bounded.
8. Use parameter-style values inline (the tool does not bind params); cast types correctly.
9. If the question is out of scope per the rules above, refuse using the scope-refusal pattern. Do NOT explain how the system works.

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

  // Lookup org for the rate-limit key (R2 fix: don't use email domain).
  // org_memberships is the source of truth; pick the first (deterministic
  // ordering) — for single-tenant orgs this is just the one membership.
  const { data: memb } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', authUser.id)
    .order('org_id', { ascending: true })
    .limit(1)
    .maybeSingle()
  const orgId = (memb as { org_id?: string } | null)?.org_id ?? `solo:${authUser.id}`

  // Rate limit (per-user) + org-wide cap (R1 audit M1, 2026-05-06).
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
  // R1 audit M1 (2026-05-06): org-wide cap defends against multi-account
  // collusion (one attacker with N manager accounts gets N×25/day if we
  // only key off authUser.id). Cap is 100/day per org.
  // R2 fix: key on users.org_id, not email domain. Email-domain keying
  // collides for orgs that use shared providers (e.g. @gmail.com).
  const { success: orgOk } = await rateLimit(`atlas-query-org:${orgId}`, {
    max: 100, windowMs: 86_400_000, prefix: 'atlas-query-org',
  })
  if (!orgOk) {
    return NextResponse.json({ error: 'Org-wide daily limit reached (100/day)' }, { status: 429 })
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

  // Scope guard: same scope as /api/atlas/ask. In-app Atlas refuses
  // engineering / infra / AI-tooling questions before the LLM hop.
  // Belt + suspenders: SYSTEM_PROMPT also refuses, but pre-LLM refusal
  // saves tokens and protects against creative jailbreaks.
  const scope = checkScope(question)
  if (!scope.inScope) {
    return NextResponse.json({
      ok: false,
      explanation: scope.refusal,
      reason: scope.refusal,
    })
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

  // Validator (defense in depth — RPC enforces too).
  // R1 audit M2 (2026-05-06): do NOT echo the rejected SQL back to the
  // client — that gives a prompt-injection attacker an iterative
  // feedback channel ("here's what your bypass produced, refine it").
  // The full SQL stays in atlas_query_log + console.error for ops.
  const validation = validateAtlasSql(sql)
  if (!validation.ok) {
    console.error(`[atlas/query] validator rejected for user=${authUser.email}: ${validation.reason} | sql=${sql.slice(0, 200)}`)
    return NextResponse.json({
      ok: false,
      explanation,
      reason: validation.reason,
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
    // R1 audit M2 (2026-05-06): drop sql from RPC-rejection response too.
    return NextResponse.json({
      ok: false,
      explanation,
      reason: safeReason,
    }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    explanation,
    sql,
    ...(rpcResult as Record<string, unknown>),
  })
}
