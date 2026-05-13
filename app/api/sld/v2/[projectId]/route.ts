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

const INTERNAL_ROLES = new Set(['admin', 'super_admin', 'manager', 'finance'])

/**
 * GET /api/sld/v2/[projectId]
 *
 * Renders the project's SLD via the Phase 5 v2 pipeline (elkjs auto-layout +
 * jsPDF) and streams the PDF as the response body. Internal users only.
 *
 * Feature-flagged: returns 404 unless `?sld=v2` is present in the URL or
 * `SLD_V2_DEFAULT=1` is set in the environment. The 404 is intentional —
 * the route should be invisible to non-opted-in callers until Phase 7
 * cuts PV-5 over.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  // ── Feature flag (intentional 404 when off — route stays invisible) ────
  if (!shouldUseSldV2(request.nextUrl.searchParams)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }

  // ── Auth + role gate (mirrors cost-basis PDF route) ────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('email', user.email)
    .single()
  const role = (userRow as { role: string } | null)?.role
  if (!role || !INTERNAL_ROLES.has(role)) {
    return NextResponse.json({ error: 'Internal users only' }, { status: 403 })
  }

  // ── Rate limit (PDF render is expensive; v2 is iterative-proof territory)
  const { success } = await rateLimit(`sld-v2-pdf:${user.email}`, {
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
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  try {
    const proj = project as Project

    // Phase 6 hardcodes Duracell-hybrid topology defaults. Phase 7 wires the
    // real per-project overrides when the PV-5 sheet migrates.
    const data = buildPlansetData(proj, {
      inverterCount: 2,
      inverterModel: 'Duracell Power Center Max Hybrid 15kW',
      inverterAcPower: 15,
      batteryCount: 16,
      batteriesPerStack: 8,
    })

    // Phase 5 R1-M6 (R3 catch) — only route to v2 when the topology has
    // shipped equipment kinds. Non-Duracell topologies produce an empty
    // graph + warn note today; rendering them yields a broken PDF. Reject
    // with 422 until Phase 7.x fills StringInverter / MicroInverter / EV
    // kinds.
    //
    // Today this gate is a no-op because the buildPlansetData call above
    // hardcodes the Duracell inverter model, so isDuracellHybrid is always
    // true. The gate goes live in Phase 7 when this route reads the real
    // per-project inverter model from the project row. Don't remove it —
    // the dead-code window is exactly until that swap.
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

    const bytes = await renderSldToPdf(graph)

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
    // correlation id; keep the real message in server logs.
    const message = err instanceof Error ? err.message : 'Unknown error'
    const correlationId = Math.random().toString(36).slice(2, 10)
    console.error(`[GET /api/sld/v2/[projectId]] cid=${correlationId}`, message)
    return NextResponse.json(
      { error: 'Render failed', correlationId },
      { status: 500 },
    )
  }
}
