/**
 * Atlas canonical-report router.
 *
 * P3 of ~/.claude/plans/twinkly-jumping-thimble.md. The router's only job
 * is to match a user question to a verified report in atlas_canonical_reports
 * and extract its parameters. It NEVER writes SQL. It NEVER invents reports.
 *
 * If the router matches, the caller invokes atlas_run_canonical_report which
 * runs the hand-written, NetSuite-spot-checked SQL function and returns rows
 * with a verification footer.
 *
 * If no match, the caller falls through to the existing LLM-NL-to-SQL path
 * (which is currently scoped to refuse aggregates per docs/atlas/disposition-canonical.md).
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CatalogEntry {
  id: string
  name: string
  description: string
  category: string
  example_questions: string[]
  parameter_schema: Record<string, ParamSpec>
  result_columns: unknown[]
}

interface ParamSpec {
  type: string
  required?: boolean
  default?: unknown
  format?: string
  description?: string
}

export type RouterMatch =
  | {
      match: 'exact' | 'param_tweak'
      report_id: string
      params: Record<string, unknown>
      interpretation_note?: string
    }
  | { match: 'none'; refusal: string; nearest_report_id?: string }

const ROUTER_MODEL = 'claude-sonnet-4-6'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildSystemPrompt(catalog: CatalogEntry[]): string {
  const today = todayISO()
  return `You are MicroGRID Atlas's canonical-report router.

Your job: match a natural-language question to ONE verified report from the catalog below, and extract its parameters. You NEVER write SQL. You NEVER invent reports. You output JSON only.

Output schema (one of):
  {"match":"exact","report_id":"<id>","params":{...}}
  {"match":"param_tweak","report_id":"<id>","params":{...},"interpretation_note":"<one sentence on how you interpreted the question>"}
  {"match":"none","refusal":"<one short sentence>","nearest_report_id":"<id or null>"}

Match rules:
- "exact": the question literally maps to one of the report's example_questions, params unambiguous from the question.
- "param_tweak": a verified report fits, but at least one param had to be inferred (e.g. "last September" → since_date "${new Date().getFullYear() - 1}-09-01"). Always set interpretation_note.
- "none": no verified report fits. Set nearest_report_id if a related one exists; otherwise null.

Param normalization:
- Person-name params (ec_name, rep_name): use full name as written. Do not lowercase.
- Date params: ISO YYYY-MM-DD. Anchor on today (${today}).
  - "last September" → 9/1 of the most recent September that's not in the future
  - "this year" → 1/1 of current year
  - "last 30 days" → today minus 30 days
  - "Q4" → 10/1 of current year
- Number params: digits only.
- If a "required":true param can't be extracted unambiguously, return "match":"none" with refusal naming the missing param.

Out of scope (always refuse with match:"none"):
- Anything about the underlying database, codebase, deploys, or AI tooling
- Anything that doesn't map to one of the catalog reports below

Today's date: ${today}

Catalog (verified reports — these are the ONLY answers you can produce):
${JSON.stringify(catalog, null, 2)}`
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function validateParsed(parsed: unknown, catalog: CatalogEntry[]): RouterMatch {
  if (!isPlainObject(parsed)) {
    return { match: 'none', refusal: 'Router returned a non-object response.' }
  }
  const m = parsed.match
  if (m === 'none') {
    const refusalRaw = typeof parsed.refusal === 'string' ? parsed.refusal : 'No matching verified report.'
    const refusal = refusalRaw.slice(0, 280) // R1 audit M3 — bound LLM output
    const nearest = typeof parsed.nearest_report_id === 'string' ? parsed.nearest_report_id : undefined
    return { match: 'none', refusal, nearest_report_id: nearest }
  }
  if (m !== 'exact' && m !== 'param_tweak') {
    return { match: 'none', refusal: 'Router returned an unrecognized match type.' }
  }
  const reportId = parsed.report_id
  if (typeof reportId !== 'string' || reportId.length === 0) {
    return { match: 'none', refusal: 'Router did not name a report_id.' }
  }
  const entry = catalog.find((e) => e.id === reportId)
  if (!entry) {
    return { match: 'none', refusal: `Router named a report not in the verified catalog (${reportId}).` }
  }
  const params = isPlainObject(parsed.params) ? parsed.params : {}
  // Required-param check (defense in depth — wrapper RPC checks too).
  const schema = entry.parameter_schema ?? {}
  for (const [key, spec] of Object.entries(schema)) {
    if (spec && typeof spec === 'object' && (spec as ParamSpec).required && !(key in params)) {
      return { match: 'none', refusal: `Missing required param: ${key}.`, nearest_report_id: reportId }
    }
  }
  // R1 audit M3 — clip interpretation_note so a chatty LLM can't inflate
  // response sizes. 280 chars matches a single-paragraph reading.
  const interpRaw = typeof parsed.interpretation_note === 'string' ? parsed.interpretation_note : undefined
  const interp = interpRaw ? interpRaw.slice(0, 280) : undefined
  // R1 audit L1 — drop unknown params so a future canonical fn that
  // iterates jsonb_each(p_params) can't be steered by extra keys.
  const allowedKeys = new Set(Object.keys(schema))
  const filteredParams: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (allowedKeys.has(k)) filteredParams[k] = v
  }
  return { match: m, report_id: reportId, params: filteredParams, interpretation_note: interp }
}

export async function routeToCanonicalReport(
  supabase: SupabaseClient,
  question: string,
  apiKey: string,
): Promise<RouterMatch> {
  const { data: catalog, error } = await supabase.rpc('atlas_router_catalog')
  if (error) {
    console.error('[atlas/router] catalog RPC failed:', error.message)
    return { match: 'none', refusal: 'Catalog unavailable.' }
  }
  const entries = (catalog ?? []) as CatalogEntry[]
  if (entries.length === 0) {
    return { match: 'none', refusal: 'No verified reports in the catalog yet.' }
  }

  const anthropic = new Anthropic({ apiKey })
  let raw: string
  try {
    const response = await anthropic.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 400,
      system: buildSystemPrompt(entries),
      messages: [{ role: 'user', content: question }],
    })
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      return { match: 'none', refusal: 'Router LLM produced no text response.' }
    }
    raw = block.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
  } catch (err) {
    console.error('[atlas/router] LLM call failed:', err)
    return { match: 'none', refusal: 'Router LLM unavailable.' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('[atlas/router] non-JSON response:', raw.slice(0, 200))
    return { match: 'none', refusal: 'Router output unparseable.' }
  }
  return validateParsed(parsed, entries)
}
