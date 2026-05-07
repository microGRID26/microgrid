import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'
import { checkScope } from '@/lib/atlas/scope'
import { routeToCanonicalReport } from '@/lib/atlas/router'

const HIGH_CONF = 0.55
const LOW_CONF = 0.25

// Manager-tier roles that can see data answers via the canonical router.
// The router's catalog only returns status='verified' rows, and the wrapper
// RPC enforces the same role gate as /api/atlas/query, so this client-side
// gate is defense-in-depth + a cost guard (skip the router LLM call for
// non-manager roles since they couldn't run the report anyway).
const DATA_ROUTER_ROLES = new Set(['admin', 'super_admin', 'manager', 'team_leader'])

function fmtNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtKw(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

interface CanonicalResultShape {
  rows?: unknown[]
  row_count?: number
  result_columns?: Array<{ key?: string; label?: string }>
  verified_at?: string | null
  verified_by?: string | null
  ground_truth_source?: string | null
  drift_detected?: boolean
}

function summarizeCanonicalResult(
  reportId: string,
  params: Record<string, unknown>,
  result: CanonicalResultShape,
  interpretationNote: string | undefined,
): string {
  const rows = Array.isArray(result.rows) ? (result.rows as Record<string, unknown>[]) : []
  const count = typeof result.row_count === 'number' ? result.row_count : rows.length

  // Report-specific summary builders. As the catalog grows, add a case here
  // for each report so the widget answer is human-readable. The default
  // builder works for any count-style report.
  if (reportId === 'subhub_signed_with_vwc') {
    const ec = typeof params.ec_name === 'string' ? params.ec_name : 'this EC'
    const since = typeof params.since_date === 'string' && params.since_date !== '1900-01-01'
      ? ` since ${params.since_date}`
      : ''
    let vwcYes = 0, vwcPending = 0, inMg = 0, missingFromMg = 0
    let totalKw = 0
    for (const r of rows) {
      if (r.vwc_status === 'likely_yes') vwcYes++
      else if (r.vwc_status === 'pending') vwcPending++
      if (r.in_mg_projects === true) inMg++
      else missingFromMg++
      const kw = typeof r.system_size_kw === 'number' ? r.system_size_kw
        : typeof r.system_size_kw === 'string' && r.system_size_kw.trim() !== '' ? Number(r.system_size_kw) || 0
        : 0
      totalKw += kw
    }
    return [
      `**${fmtNumber(count)} SubHub signed deals** for ${ec}${since}. Total system size: **${fmtKw(totalKw)} kW**.`,
      `**VWC status:** ${fmtNumber(vwcYes)} likely complete (past welcome stage) · ${fmtNumber(vwcPending)} pending (no signal yet — SubHub doesn't fire VWC events; status inferred from stage progression).`,
      `**MG sync coverage:** ${fmtNumber(inMg)} in MG / **${fmtNumber(missingFromMg)} missing from MG** (SubHub→MG ingest started 2026-03-14, pre-March data was never synced).`,
      `[See the full table on /reports →](/reports)`,
    ].join('\n\n')
  }

  if (reportId === 'ec_booked_sales_since') {
    const ec = typeof params.ec_name === 'string' ? params.ec_name : 'this EC'
    const since = typeof params.since_date === 'string' && params.since_date !== '1900-01-01'
      ? ` since ${params.since_date}`
      : ''
    let totalKw = 0
    for (const r of rows) {
      const v = r.systemkw
      if (typeof v === 'number') totalKw += v
      else if (typeof v === 'string' && v.trim() !== '') totalKw += Number(v) || 0
    }
    const interpLine = interpretationNote ? `\n\n*${interpretationNote}*` : ''
    return [
      `**${fmtNumber(count)} booked sales** for ${ec} as Energy Consultant${since}.`,
      `Total system size: **${fmtKw(totalKw)} kW**. Includes Sale + Loyalty dispositions; excludes terminal states.`,
      `[See the full table on /reports →](/reports)${interpLine}`,
    ].join('\n\n')
  }

  // Generic fallback
  const noun = count === 1 ? 'row' : 'rows'
  return `Verified report \`${reportId}\` returned **${fmtNumber(count)} ${noun}**. [See /reports for the full table.](/reports)`
}

type KbHit = {
  id: number
  title: string
  answer_md: string
  owner: string | null
  source_of_truth: string | null
  escalation_conditions: string | null
  similarity: number
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

  const { data: authData } = await supabase.auth.getUser()
  const authUser = authData?.user
  if (!authUser?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { success } = await rateLimit(`atlas-ask:${authUser.id}`, {
    windowMs: 60_000,
    max: 20,
    prefix: 'atlas-ask',
  })
  if (!success) {
    return NextResponse.json({ error: 'Too many questions. Slow down a moment.' }, { status: 429 })
  }

  let body: { question?: unknown; page_path?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const pagePath = typeof body.page_path === 'string' ? body.page_path.slice(0, 200) : null
  if (!question || question.length < 3) {
    return NextResponse.json({ error: 'Question too short' }, { status: 400 })
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: 'Question too long (max 2000 chars)' }, { status: 400 })
  }

  // Scope guard: in-app Atlas is project + sales + workflow + domain only.
  // Engineering / infra / AI-tooling questions get a flat refusal here, before
  // any KB retrieval, so creative phrasings can't slip past via embeddings.
  const scope = checkScope(question)
  if (!scope.inScope) {
    return NextResponse.json({
      id: null,
      answer: scope.refusal,
      citations: [],
      confidence: 'high' as const,
      escalation_suggested: false,
    })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('email', authUser.email)
    .single()
  const role = ((profile as { role?: string } | null)?.role ?? 'user') as string

  // Canonical-router pre-pass (manager+ only — the wrapper RPC won't run the
  // report for lower roles anyway, and this saves the router LLM call). On
  // match → run the wrapper RPC and return a high-confidence answer with a
  // markdown summary. On no-match or RPC error → fall through to the KB path.
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey && DATA_ROUTER_ROLES.has(role)) {
    try {
      const routed = await routeToCanonicalReport(supabase, question, apiKey)
      if (routed.match === 'exact' || routed.match === 'param_tweak') {
        const { data: runResult, error: runError } = await supabase.rpc('atlas_run_canonical_report', {
          p_report_id: routed.report_id,
          p_params: routed.params,
          p_question: question,
          p_page_path: pagePath,
        })
        if (!runError && runResult && typeof runResult === 'object') {
          const r = runResult as CanonicalResultShape
          const answer = summarizeCanonicalResult(routed.report_id, routed.params, r, routed.interpretation_note)
          const citations = [{
            id: -1,
            title: `Canonical report · ${routed.report_id}`,
            owner: r.verified_by ?? null,
            source_of_truth: r.ground_truth_source ?? null,
            similarity: 1,
          }]
          // Log to atlas_questions for trail consistency.
          const { data: logged } = await supabase
            .from('atlas_questions')
            .insert({
              user_id: authUser.id,
              user_email: authUser.email,
              user_role: role,
              question,
              answer,
              citations,
              confidence: 'high',
              page_path: pagePath,
              answered_at: new Date().toISOString(),
            })
            .select('id')
            .single()
          return NextResponse.json({
            id: (logged as { id?: number } | null)?.id ?? null,
            answer,
            citations,
            confidence: 'high' as const,
            escalation_suggested: false,
            canonical: true,
            report_id: routed.report_id,
          })
        }
        if (runError) {
          // R1 audit M1 (2026-05-06) — surface the failure instead of
          // silently falling through to KB. KB path will return "low
          // confidence" with no signal the canonical attempt broke; ops
          // gets only a console line. Match /reports behavior: respond
          // with a high-confidence "verified report failed" answer so
          // Heidi tells Greg within the hour instead of next quarter.
          console.error(`[atlas/ask] canonical run failed for ${routed.report_id}: ${runError.message}`)
          return NextResponse.json({
            id: null,
            answer: `A verified report (\`${routed.report_id}\`) tried to answer this and failed. The team has been notified — try again in a few minutes.`,
            citations: [],
            confidence: 'high' as const,
            escalation_suggested: true,
            canonical: true,
            canonical_attempted_report_id: routed.report_id,
          })
        }
      }
    } catch (err) {
      console.error('[atlas/ask] canonical router threw:', err)
      // fall through to KB
    }
  }

  const { data: hitsRaw, error: searchError } = await supabase.rpc('atlas_kb_search_text', {
    p_query: question,
    p_user_role: role,
    p_limit: 5,
  })
  if (searchError) {
    console.error('[atlas/ask] kb search failed:', searchError.message)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  const hits = (hitsRaw ?? []) as KbHit[]
  const top = hits[0]
  const topSim = top?.similarity ?? 0

  const confidence: 'high' | 'medium' | 'low' =
    topSim >= HIGH_CONF ? 'high' : topSim >= LOW_CONF ? 'medium' : 'low'

  const answer = top && confidence !== 'low' ? top.answer_md : null

  const citations = hits.slice(0, 3).map((h) => ({
    id: h.id,
    title: h.title,
    owner: h.owner,
    source_of_truth: h.source_of_truth,
    similarity: Number(h.similarity.toFixed(3)),
  }))

  // Data answers on the widget are gated to verified canonical reports only
  // (the manager-tier router pre-pass above). When the router doesn't match
  // a verified report, the widget falls back to KB-only — no LLM-improvised
  // SQL on the widget surface. Reason: an LLM-generated SQL answer was off
  // by 9-13% on a recent verification (166 vs 175 sales), and one wrong
  // number erodes more trust than 100 "I don't know" responses. The
  // /reports page is where unverified SQL still runs (with an experimental
  // banner and a "verify before trusting" message).
  // See ~/.claude/plans/twinkly-jumping-thimble.md for the catalog plan.

  const { data: logged, error: logError } = await supabase
    .from('atlas_questions')
    .insert({
      user_id: authUser.id,
      user_email: authUser.email,
      user_role: role,
      question,
      answer,
      citations,
      confidence,
      page_path: pagePath,
      answered_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (logError) {
    console.error('[atlas/ask] log insert failed:', logError.message)
  }

  return NextResponse.json({
    id: (logged as { id?: number } | null)?.id ?? null,
    answer,
    citations,
    confidence,
    escalation_suggested: confidence === 'low',
  })
}
