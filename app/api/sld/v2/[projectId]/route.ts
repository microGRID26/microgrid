import crypto from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { buildPlansetData } from '@/lib/planset-types'
import { equipmentGraphFromPlansetData, isDuracellHybrid } from '@/lib/sld-v2/from-planset-data'
import { renderSldToPdf } from '@/lib/sld-v2/pdf'
import { shouldUseSldV2 } from '@/lib/sld-v2/feature-flag'
import { loadNodeOverrides } from '@/lib/sld-v2/overrides/loader'
import type { Project } from '@/types/database'

// renderSldToPdf lazy-imports jsdom and uses the native `canvas` package; both
// require the Node runtime. Edge runtime would fail at module-load time.
export const runtime = 'nodejs'
// Feature-flag responses must not be cached at the edge — flag-on/flag-off
// behaviour changes per-request and SLD bytes are user-scoped.
export const dynamic = 'force-dynamic'

// Cumulative R1 M2 fix — `finance` was copy-paste drift from the cost-basis
// PDF route's role set. SLDs are engineering output; finance has no business
// rendering one. Scoped to engineering + ops roles only. If a finance user
// needs to view an SLD, route through the planset viewer (which renders a
// preview HTML, not a stamp-worthy PDF).
const INTERNAL_ROLES = new Set(['admin', 'super_admin', 'manager'])

function makeCorrelationId(): string {
  // Cumulative R1 L3 fix — was Math.random().toString(36).slice(2,10) which
  // collides statistically. UUIDv4 first 8 chars is still ~16M combinations
  // per minute, safe for the route's 20/min rate limit per user.
  return crypto.randomUUID().slice(0, 8)
}

interface CatchableError {
  name?: string
  code?: unknown
  stack?: string
}

// Cumulative R1 M4 fix — never log raw err.message because upstream libs
// (svg2pdf, jspdf-core) can include fragments of project data in their
// errors. Log structure-only: name, code, top-5 stack frames. This is
// enough to bisect a regression without putting customer PII (address,
// owner name, ESID) into Vercel runtime logs.
function structuredErrorLog(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { name: 'NonError', repr: typeof err }
  const e = err as CatchableError
  return {
    name: e.name ?? 'Error',
    code: e.code,
    stack: e.stack?.split('\n').slice(0, 5).join('\n'),
  }
}

/**
 * GET /api/sld/v2/[projectId]
 *
 * Renders the project's SLD via the Phase 5 v2 pipeline (elkjs auto-layout +
 * jsPDF) and streams the PDF as the response body. Internal users only.
 *
 * Feature-flagged on three independent paths (any one enables the route):
 *   1. URL `?sld=v2`  — per-request testing path; reveals route existence
 *      on auth failure (caller is intentionally probing).
 *   2. Env `SLD_V2_DEFAULT=1` — process-wide override for preview/dev.
 *   3. `projects.use_sld_v2 = true` — Phase 7a per-project rollout path.
 *
 * Invisibility contract: when URL + env are BOTH off (i.e. the only
 * possible activation is the per-project flag), auth/role failures return
 * 404 (not 401/403) so the route stays invisible to non-testing callers
 * probing flag-off projects. When URL or env is on, the caller knows the
 * route — normal HTTP semantics apply.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const searchParams = request.nextUrl.searchParams

  // ── Pre-auth flag check (URL + env only, no project arg) ───────────────
  // When this returns true the caller is in the "testing" or "preview" path
  // and the route is intentionally visible. When false, the route MIGHT
  // still activate via the per-project flag (Phase 7a) — but the route stays
  // invisible to unauth callers and to flag-off projects.
  const urlOrEnvFlag = shouldUseSldV2(searchParams)
  const respond404OrAuthError = (
    authBody: { error: string },
    authStatus: number,
  ) =>
    urlOrEnvFlag
      ? NextResponse.json(authBody, { status: authStatus })
      : NextResponse.json({ error: 'Not Found' }, { status: 404 })

  // ── Auth + role gate (mirrors cost-basis PDF route) ────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) {
    return respond404OrAuthError({ error: 'Unauthorized' }, 401)
  }

  // Cumulative R1 L1 fix — was `.eq('email', user.email)` which drifts when
  // a user changes their email in Supabase Auth (users.email and auth.users.email
  // can diverge). The `users.id` FK to `auth.users.id` is stable across email
  // changes and is the canonical join elsewhere in this codebase.
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = (userRow as { role: string } | null)?.role
  if (!role || !INTERNAL_ROLES.has(role)) {
    return respond404OrAuthError({ error: 'Internal users only' }, 403)
  }

  // ── Rate limit (PDF render is expensive; v2 is iterative-proof territory)
  // Rate-limit failures return 429 unconditionally — the caller is authed
  // and the response leaks no new information beyond the rate-limit headers
  // they were already seeing.
  //
  // Cumulative R1 L2 fix — keyed on user.id, not email. Email-keyed buckets
  // reset when a user updates their email; user.id is immutable.
  const { success } = await rateLimit(`sld-v2-pdf:${user.id}`, {
    windowMs: 60_000,
    max: 20,
    prefix: 'sld-v2',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded (20 PDFs/minute)' }, { status: 429 })
  }

  // ── Load project (RLS-scoped via the user's session) ───────────────────
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (projectErr || !project) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }

  // ── Phase 7b R1-M3 fix — runtime type guard replaces the bare `as Project`
  // cast. Asserts the project row carries the `use_sld_v2` column shape
  // (migration 221). If `types/database.ts` is ever regenerated without the
  // hand-written field, the cast would silently hide the regression and
  // break the per-project rollout flag. This narrow surfaces the drift as
  // a 500 + server-side log entry on the first request after a bad regen.
  //
  // Steady state (column NOT NULL DEFAULT false) = boolean. Defensive
  // accepts of null/undefined cover migration-rollback races and ORM
  // omission. Anything else fails the invariant.
  //
  // R1-H1 fix (Phase 7b red-teamer) — guard MUST fire AFTER the 3-arg
  // flag check so flag-off projects keep returning the same 404 they
  // returned before (preserves invisibility contract documented in the
  // route header). Without this ordering, a future bad type-regen could
  // distinguish flag-off-but-existing projects from genuine 404s to
  // authed-internal callers. R1-M1 fix — correlationId is server-side
  // log only; response body returns the same opaque shape as the catch
  // block so 500-vs-500 doesn't become an oracle.
  const proj = project as Project

  // ── Phase 7a 3-arg flag check (URL + env + project.use_sld_v2) ─────────
  // If all three are off the route is "fully off" for this project; return
  // 404 to preserve invisibility for flag-off projects.
  if (!shouldUseSldV2(searchParams, proj)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }

  // R1-M3 shape invariant runs HERE (post-flag-check) so flag-off
  // projects exit at the 404 above before the invariant is even checked.
  if (!hasUseSldV2Shape(project)) {
    const shapeCid = makeCorrelationId()
    console.error(
      `[GET /api/sld/v2/[projectId]] cid=${shapeCid} use_sld_v2 shape invariant failed`,
      { id: projectId },
    )
    return NextResponse.json(
      { error: 'Render failed', correlationId: shapeCid },
      { status: 500 },
    )
  }

  try {
    // Phase 7a strips Phase 6's hardcoded Duracell-hybrid overrides — they
    // were byte-identical to DURACELL_DEFAULTS, so calling buildPlansetData
    // with no overrides produces the same output. Phase 7b will wire real
    // per-project options when project rows gain inverter/battery columns.
    const data = buildPlansetData(proj)

    // Phase 5 R1-M6 (R3 catch) — only route to v2 when the topology has
    // shipped equipment kinds. Non-Duracell topologies produce an empty
    // graph + warn note today; rendering them yields a broken PDF. Reject
    // with 422 until Phase 7.x fills StringInverter / MicroInverter / EV
    // kinds.
    //
    // Today this gate is a no-op because DURACELL_DEFAULTS in
    // lib/planset-types.ts hardcodes the Duracell inverter model — when
    // buildPlansetData is called with no `inverterModel` override (as
    // Phase 7a does), it falls back to those defaults, so isDuracellHybrid
    // is always true. The gate goes live in Phase 7b/7.x when project rows
    // gain an inverter-model column and buildPlansetData reads it directly.
    // Don't remove it — the dead-code window is exactly until that swap.
    if (!isDuracellHybrid(data)) {
      return NextResponse.json(
        { error: 'sld_v2_unsupported_topology', detail: 'Phase 6 supports Duracell hybrid topology only.' },
        { status: 422 },
      )
    }

    const graph = equipmentGraphFromPlansetData(data)

    // Splice in node overrides (file-based for now; Phase 7 may promote to DB).
    const overrides = await loadNodeOverrides(projectId)
    if (overrides) {
      graph.nodeOverrides = { ...(graph.nodeOverrides ?? {}), ...overrides }
    }

    // Phase 7b — pass title-block data to the renderer so the v2 PDF
    // gets the v1-style right-sidebar plan-sheet anatomy (contractor,
    // project, PE stamp area, drawn date, revision, sheet size, AHJ,
    // sheet name, sheet number). Mirrors the v1 TitleBlockHtml layout
    // field-for-field so RUSH Engineering sees the same shape they're
    // used to from existing plansheets.
    const bytes = await renderSldToPdf(graph, {
      titleBlock: {
        data,
        sheetName: 'Electrical Three Line Diagram',
        sheetNumber: 'PV-5',
      },
    })

    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="sld-v2-${projectId}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    // R1-H1 fix — never leak internal error messages to the client. They
    // surface library names + graph-id state that an authenticated internal
    // user could fuzz to enumerate. Return an opaque string plus a short
    // correlation id; keep structured error info in server logs.
    //
    // Cumulative R1 M4 fix — was `console.error(..., message)` with the raw
    // err.message verbatim. Upstream libs (svg2pdf, jspdf-core, jsdom) can
    // surface fragments of project data inside error messages; logging them
    // pushed customer PII into Vercel runtime logs. Switched to structured
    // {name, code, stack-truncated} via structuredErrorLog().
    const correlationId = makeCorrelationId()
    console.error(
      `[GET /api/sld/v2/[projectId]] cid=${correlationId}`,
      structuredErrorLog(err),
    )
    return NextResponse.json(
      { error: 'Render failed', correlationId },
      { status: 500 },
    )
  }
}

// ── Phase 7b R1-M3 — runtime narrow on the project row shape ────────────
// Replaces the bare `as Project` cast at the route entry. Asserts the row
// carries the `use_sld_v2` column shape (migration 221) so a future
// `types/database.ts` regeneration that drops the hand-written field
// surfaces immediately instead of silently breaking the per-project flag.
function hasUseSldV2Shape(p: unknown): p is Project {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  if (typeof o.id !== 'string') return false
  return (
    o.use_sld_v2 === undefined ||
    o.use_sld_v2 === null ||
    typeof o.use_sld_v2 === 'boolean'
  )
}
