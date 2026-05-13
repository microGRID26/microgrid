import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { loadProjectCostBasis } from '@/lib/cost/api'
import { renderCostBasisPDF } from '@/lib/cost/pdf'
import type { Project } from '@/types/database'

// @react-pdf/renderer requires the node runtime
export const runtime = 'nodejs'

const INTERNAL_ROLES = new Set(['admin', 'super_admin', 'manager', 'finance'])

/**
 * GET /api/projects/[id]/cost-basis/pdf
 *
 * Renders the project's cost reconciliation as a single-page PDF and streams
 * it as the response body. Internal-only — same role gate as the JSON endpoint.
 *
 * Query params:
 *   ?download=1 — force browser to download instead of inline preview
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  // ── Auth + role gate ───────────────────────────────────────────────────
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

  // ── Rate limit (PDF render is expensive) ───────────────────────────────
  const { success } = await rateLimit(`cost-basis-pdf:${user.email}`, {
    windowMs: 60_000,
    max: 10,
    prefix: 'cost-basis',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded (10 PDFs/minute)' }, { status: 429 })
  }

  // ── Load project + cost basis ──────────────────────────────────────────
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
    const { lineItems, summary } = await loadProjectCostBasis(proj)

    const pdfBuffer = await renderCostBasisPDF({
      project: proj,
      lineItems,
      summary,
      generatedAt: new Date(),
    })

    const download = new URL(request.url).searchParams.get('download') === '1'
    const filename = `${proj.id}-cost-basis.pdf`
    const disposition = download ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    // Mirror of the Phase 6 sld-v2 route fix (#998 close-out, 2026-05-13).
    // Never leak internal error messages to the client — they surface
    // library names + state machine that an authenticated internal user
    // could fuzz to enumerate. Opaque message + correlation id; real
    // message stays in server logs.
    const message = err instanceof Error ? err.message : 'Unknown error'
    const correlationId = Math.random().toString(36).slice(2, 10)
    console.error(`[GET /api/projects/[id]/cost-basis/pdf] cid=${correlationId}`, message)
    return NextResponse.json(
      { error: 'Render failed', correlationId },
      { status: 500 },
    )
  }
}
