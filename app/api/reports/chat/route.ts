import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { escapeIlike } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface QueryFilter {
  field: string
  op: 'eq' | 'neq' | 'ilike' | 'gt' | 'lt' | 'gte' | 'lte' | 'is_null' | 'is_not_null' | 'in'
  value?: string | number | boolean | string[] | null
}

interface ClientFilter {
  field: string
  op: 'daysAgo_gt' | 'daysAgo_lt'
  value: number
}

interface QueryPlan {
  description: string
  query: {
    table: string
    select: string
    filters: QueryFilter[]
    clientFilters?: ClientFilter[]
    order?: { column: string; ascending: boolean }
    limit?: number
  }
  followUp?: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_TABLES = [
  'projects',
  'project_funding',
  'task_state',
  'notes',
  'schedule',
  'service_calls',
  'change_orders',
]

const MAX_RESULTS = 500
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const DAILY_LIMIT = 25
const DAY_MS = 86_400_000

// Simple in-memory rate limiter (per-minute).
// On Vercel serverless, each invocation is short-lived — memory does not persist
// across requests, so these Maps only work within a single instance lifetime.
// This is acceptable: it provides burst protection within a warm instance without
// needing an external store. For true cross-instance rate limiting, use Redis/Upstash.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
// Daily usage tracker (same serverless caveat as above)
const dailyUsageMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

function checkDailyLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = dailyUsageMap.get(userId)
  if (!entry || now > entry.resetAt) {
    dailyUsageMap.set(userId, { count: 1, resetAt: now + DAY_MS })
    return { allowed: true, remaining: DAILY_LIMIT - 1 }
  }
  if (entry.count >= DAILY_LIMIT) return { allowed: false, remaining: 0 }
  entry.count++
  return { allowed: true, remaining: DAILY_LIMIT - entry.count }
}

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a data analyst assistant for MicroGRID Energy's project management system called MicroGRID. You help users query project data using natural language.

You must respond with a valid JSON object (no markdown, no code fences, ONLY raw JSON) that describes the Supabase query to execute.

## Database Schema

### projects (main table — ~938 active residential solar projects)
- id: TEXT (PK, format "PROJ-XXXXX")
- name: TEXT (homeowner name)
- city: TEXT
- zip: TEXT
- address: TEXT
- phone: TEXT
- email: TEXT
- sale_date: DATE
- stage: TEXT — one of: evaluation, survey, design, permit, install, inspection, complete
- stage_date: DATE (when project entered current stage)
- pm: TEXT (project manager name)
- pm_id: UUID (project manager user ID)
- disposition: TEXT — one of: Sale, Loyalty, In Service, Cancelled (NULL means Sale/active)
- contract: NUMERIC (contract value in dollars)
- systemkw: NUMERIC (system size in kW)
- financier: TEXT (financing company, e.g., GoodLeap, Mosaic, Sungage, Dividend, Cash, EDGE, Sunrun, Tesla, Sunnova, Loanpal)
- ahj: TEXT (Authority Having Jurisdiction — city/county permit authority)
- utility: TEXT (electric utility company)
- advisor: TEXT
- consultant: TEXT
- blocker: TEXT (NULL = not blocked; non-null = reason project is blocked)
- financing_type: TEXT
- down_payment: NUMERIC
- module: TEXT (solar panel model)
- module_qty: INTEGER
- inverter: TEXT
- inverter_qty: INTEGER
- battery: TEXT
- battery_qty: INTEGER
- hoa: TEXT (homeowner association name)
- esid: TEXT
- permit_number: TEXT
- utility_app_number: TEXT
- permit_fee: NUMERIC
- reinspection_fee: NUMERIC
- dealer: TEXT
- site_surveyor: TEXT
- follow_up_date: DATE
- city_permit_date: DATE
- utility_permit_date: DATE
- ntp_date: DATE
- survey_scheduled_date: DATE
- survey_date: DATE
- install_scheduled_date: DATE
- install_complete_date: DATE
- city_inspection_date: DATE
- utility_inspection_date: DATE
- pto_date: DATE
- in_service_date: DATE
- created_at: TIMESTAMPTZ

### project_funding (milestone funding)
- project_id: TEXT (FK -> projects.id)
- m1_amount: NUMERIC, m1_funded_date: DATE, m1_cb: NUMERIC, m1_cb_credit: NUMERIC, m1_notes: TEXT, m1_status: TEXT (Submitted/Funded/Rejected)
- m2_amount: NUMERIC, m2_funded_date: DATE, m2_cb: NUMERIC, m2_cb_credit: NUMERIC, m2_notes: TEXT, m2_status: TEXT
- m3_amount: NUMERIC, m3_funded_date: DATE, m3_projected: NUMERIC, m3_notes: TEXT, m3_status: TEXT
- nonfunded_code_1: TEXT, nonfunded_code_2: TEXT, nonfunded_code_3: TEXT

### task_state (task tracking per project)
- project_id: TEXT (FK -> projects.id)
- task_id: TEXT (task identifier)
- status: TEXT — one of: Complete, Pending Resolution, Revision Required, In Progress, Scheduled, Ready To Start, Not Ready
- reason: TEXT (reason for Pending Resolution or Revision Required)
- completed_date: DATE
- started_date: DATE
- notes: TEXT
- follow_up_date: DATE

### notes (project notes)
- id: UUID
- project_id: TEXT
- task_id: TEXT (optional, for per-task notes)
- text: TEXT
- time: TIMESTAMPTZ
- pm: TEXT (author name)
- pm_id: UUID

### schedule (crew assignments)
- id: UUID
- project_id: TEXT
- crew_id: TEXT
- job_type: TEXT (survey/install/inspection/service)
- date: DATE
- time: TEXT
- notes: TEXT
- status: TEXT
- pm: TEXT

### service_calls (service cases)
- id: UUID
- project_id: TEXT
- status: TEXT
- type: TEXT
- issue: TEXT
- created: DATE
- date: DATE
- resolution: TEXT
- pm: TEXT
- priority: TEXT

### change_orders
- id: INTEGER
- project_id: TEXT
- title: TEXT
- status: TEXT (Open/In Progress/Waiting On Signature/Complete/Cancelled)
- priority: TEXT
- type: TEXT
- reason: TEXT
- assigned_to: TEXT
- created_by: TEXT
- notes: TEXT

## Important Notes
- "Days in stage" = number of days since stage_date (today minus stage_date). Use clientFilters with daysAgo_gt or daysAgo_lt for these queries.
- A project is "blocked" when blocker IS NOT NULL.
- A project is "stuck" when it has tasks in Pending Resolution or Revision Required status.
- CRITICAL: Most active projects have disposition = NULL (not "Sale"). To find active/Sale projects, filter where disposition IS NULL or use is_null op. Do NOT filter disposition = 'Sale' — that will return almost nothing. Only use eq:'Loyalty', eq:'Cancelled', or eq:'In Service' for those specific dispositions.
- To exclude cancelled projects, use: {"field": "disposition", "op": "neq", "value": "Cancelled"} combined with {"field": "disposition", "op": "neq", "value": "In Service"}
- Loyalty projects are being transitioned out but still actively managed.
- "In Service" means the project is complete and operational.
- The "dealer" field contains the dealer/sales company name. The "financier" field contains the financing company (e.g., GoodLeap, EDGE, Mosaic, Sungage, Dividend, Cash, Solrite, Monalee, HDM Capital). These are different fields — dealer is who sold it, financier is who financed it.
- IMPORTANT: When a user mentions a company name and you're unsure if it's a dealer or financier, search the "financier" field first. Most user queries about companies refer to the financier. Only search "dealer" if the user specifically says "dealer" or "sales company".
- For text searches, always use ilike with % wildcards for partial matching.
- For date comparisons, use ISO format (YYYY-MM-DD).
- When asked about "total value" or "portfolio value", sum the contract field.
- When asked about funding, query project_funding table.
- When no specific columns are requested, include: id, name, city, stage, financier, stage_date, blocker, pm, contract, disposition

## Response Format
Return ONLY a JSON object with this structure:
{
  "description": "Human-readable description of what the query returns",
  "query": {
    "table": "projects",
    "select": "comma-separated column names",
    "filters": [
      {"field": "column_name", "op": "eq|neq|ilike|gt|lt|gte|lte|is_null|is_not_null|in", "value": "value"}
    ],
    "clientFilters": [
      {"field": "date_column", "op": "daysAgo_gt|daysAgo_lt", "value": 30}
    ],
    "order": {"column": "column_name", "ascending": true},
    "limit": 200
  },
  "followUp": "Optional suggested follow-up question"
}

Rules:
- For is_null and is_not_null ops, omit the value field
- For "in" op, value should be an array of strings
- Always include a limit (default 200, max 500)
- Only query the tables listed above
- The select field must only contain columns that exist on the queried table
- NEVER return SQL — only the JSON query plan
- If the user asks something you cannot answer with a database query, set table to "projects", select to "id", filters to [], and explain in the description why you cannot fulfill the request`

// ── Supabase Client ──────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  // Service role key is intentionally used here — the anon key returns empty results
  // because RLS restricts row-level access. This route is protected by the Manager+
  // role gate below (server-side session check) so only authorized users can invoke it.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase configuration')
  return createClient(url, key)
}

/** Create a user-scoped Supabase client from request cookies for auth checks */
function getUserSupabase(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  // Pass cookies from the request for session-based auth
  const cookieHeader = request.headers.get('cookie') ?? ''
  return createClient(url, key, { global: { headers: { cookie: cookieHeader } } })
}

// ── Query Execution ──────────────────────────────────────────────────────────

function daysAgo(dateStr: string | null | undefined): number {
  if (!dateStr) return 0
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 0
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function validateQueryPlan(plan: QueryPlan): string | null {
  if (!plan.query?.table) return 'Missing table in query plan'
  if (!ALLOWED_TABLES.includes(plan.query.table)) {
    return `Table "${plan.query.table}" is not in the allowed list: ${ALLOWED_TABLES.join(', ')}`
  }
  if (!plan.query.select) return 'Missing select in query plan'
  if (!Array.isArray(plan.query.filters)) return 'Filters must be an array'

  const validOps = ['eq', 'neq', 'ilike', 'gt', 'lt', 'gte', 'lte', 'is_null', 'is_not_null', 'in']
  for (const f of plan.query.filters) {
    if (!f.field || !f.op) return `Invalid filter: ${JSON.stringify(f)}`
    if (!validOps.includes(f.op)) return `Invalid filter op: ${f.op}`
  }

  const validClientOps = ['daysAgo_gt', 'daysAgo_lt']
  if (plan.query.clientFilters) {
    for (const f of plan.query.clientFilters) {
      if (!f.field || !f.op) return `Invalid client filter: ${JSON.stringify(f)}`
      if (!validClientOps.includes(f.op)) return `Invalid client filter op: ${f.op}`
    }
  }

  return null
}

async function executeQuery(plan: QueryPlan) {
  const supabase = getSupabase()
  const { table, select, filters, clientFilters, order, limit } = plan.query

  const effectiveLimit = Math.min(limit || 200, MAX_RESULTS)

  // Build the query
  // Dynamic table/column access — table name comes from AI query plan, not typed in Database schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as unknown as { from: (t: string) => any }).from(table).select(select, { count: 'exact' })

  // Apply filters
  for (const f of filters) {
    switch (f.op) {
      case 'eq':
        query = query.eq(f.field, f.value)
        break
      case 'neq':
        query = query.neq(f.field, f.value)
        break
      case 'ilike': {
        const val = String(f.value ?? '')
        // Claude sends values like %Houston% — escape the inner content
        const inner = val.replace(/^%|%$/g, '')
        const escaped = inner.length > 0 ? `%${escapeIlike(inner)}%` : val
        query = query.ilike(f.field, escaped)
        break
      }
      case 'gt':
        query = query.gt(f.field, f.value)
        break
      case 'lt':
        query = query.lt(f.field, f.value)
        break
      case 'gte':
        query = query.gte(f.field, f.value)
        break
      case 'lte':
        query = query.lte(f.field, f.value)
        break
      case 'is_null':
        query = query.is(f.field, null)
        break
      case 'is_not_null':
        query = query.not(f.field, 'is', null)
        break
      case 'in':
        query = query.in(f.field, f.value as string[])
        break
    }
  }

  // Apply ordering
  if (order) {
    query = query.order(order.column, { ascending: order.ascending })
  }

  // Apply limit (fetch extra for client filters)
  const fetchLimit = clientFilters?.length ? Math.min(effectiveLimit * 3, 1500) : effectiveLimit
  query = query.limit(fetchLimit)

  const { data, error, count } = await query

  if (error) {
    console.error('[reports/chat] query error:', error.message)
    throw new Error('Query execution failed')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let results = (Array.isArray(data) ? data : []) as Record<string, any>[]

  // Apply client-side filters
  if (clientFilters?.length) {
    for (const cf of clientFilters) {
      results = results.filter((row) => {
        const days = daysAgo(row[cf.field])
        if (cf.op === 'daysAgo_gt') return days > cf.value
        if (cf.op === 'daysAgo_lt') return days < cf.value && days > 0
        return true
      })
    }
    // Trim to effective limit after client filtering
    results = results.slice(0, effectiveLimit)
  }

  return { results, totalCount: count ?? results.length }
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'AI reports are not configured. Set the ANTHROPIC_API_KEY environment variable to enable this feature.',
      },
      { status: 503 }
    )
  }

  // Server-side auth check — Manager+ role required.
  // This supplements the frontend role gate (isManager check in the Reports page).
  const userSupabase = getUserSupabase(request)
  if (userSupabase) {
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    // Check role — only manager, admin, super_admin allowed
    const { data: userRow } = await userSupabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = userRow?.role ?? 'user'
    const allowedRoles = ['manager', 'admin', 'super_admin']
    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'Insufficient permissions. Manager role required.' }, { status: 403 })
    }
  }

  // Parse request body
  let message: string
  let history: ChatMessage[]
  try {
    const body = await request.json()
    message = body.message
    history = body.history || []
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "message" field' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Rate limiting — use auth cookie as stable identifier (not spoofable headers)
  const authCookie = request.cookies.getAll().find(c => c.name.startsWith('sb-'))?.value ?? ''
  const userId = authCookie || 'anonymous'
  if (!checkRateLimit(userId)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a minute before trying again.' },
      { status: 429 }
    )
  }

  // Daily usage limit (25/day per user)
  const daily = checkDailyLimit(userId)
  if (!daily.allowed) {
    return NextResponse.json(
      { error: 'Daily query limit reached (25 per day). Try again tomorrow.' },
      { status: 429 }
    )
  }

  try {
    // Build conversation messages for Claude
    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ]

    // Call Claude to generate query plan
    const anthropic = new Anthropic({ apiKey })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', // claude-sonnet-4-6 — fast model for query generation
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    })

    // Extract text response
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    // Parse query plan from Claude's response
    let queryPlan: QueryPlan
    try {
      // Strip any accidental markdown code fences
      let rawJson = textBlock.text.trim()
      if (rawJson.startsWith('```')) {
        rawJson = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      queryPlan = JSON.parse(rawJson)
    } catch {
      return NextResponse.json(
        {
          error: 'Failed to parse AI response as a query plan',
          rawResponse: textBlock.text,
        },
        { status: 500 }
      )
    }

    // Validate the query plan
    const validationError = validateQueryPlan(queryPlan)
    if (validationError) {
      return NextResponse.json(
        {
          error: `Invalid query plan: ${validationError}`,
          queryPlan,
        },
        { status: 400 }
      )
    }

    // Execute the query
    const { results, totalCount } = await executeQuery(queryPlan)

    return NextResponse.json({
      description: queryPlan.description,
      results,
      count: results.length,
      totalCount,
      followUp: queryPlan.followUp || null,
      queryPlan: queryPlan.query,
    })
  } catch (err) {
    console.error('[reports/chat] Error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
