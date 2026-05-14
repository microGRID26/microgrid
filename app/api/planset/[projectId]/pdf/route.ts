import crypto from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { mergePlansetWithCutSheets, type CutSheetEntry as MergeEntry } from '@/lib/planset/pdf-merge'
import { CUT_SHEETS } from '@/components/planset/SheetCutSheets'

// puppeteer-core + @sparticuz/chromium require the Node runtime.
// Edge would fail at module-load time.
export const runtime = 'nodejs'
// User-scoped PDFs; never cache at the edge.
export const dynamic = 'force-dynamic'
// Chromium cold-start (~3-5s on Vercel) + 10-sheet render + cut-sheet merge.
// Budget conservatively under the lambda max (300s on Pro, 60s the default
// for dynamic routes). 60s gives headroom over the worst observed cold-start
// + render benchmarks for similar-size sheets.
export const maxDuration = 60

// Same allowlist as the v2 SLD route. Planset is engineering output —
// finance/customer/partner roles do not render full plansets.
const INTERNAL_ROLES = new Set(['admin', 'super_admin', 'manager'])

function makeCorrelationId(): string {
  return crypto.randomUUID().slice(0, 8)
}

interface CatchableError {
  name?: string
  code?: unknown
  stack?: string
}

// Never log raw err.message — upstream libs (puppeteer, chromium, pdf-lib)
// can echo project data fragments (customer name, ESID) into error strings.
// Mirrors the structuredErrorLog pattern from the v2 SLD route.
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
 * Map the SheetCutSheets `CUT_SHEETS` constant (which uses `src` paths like
 * "/cut-sheets/duracell-5plus.pdf") to the `filename` shape that
 * mergePlansetWithCutSheets expects (just "duracell-5plus.pdf").
 *
 * Defense in depth: refuse entries whose `src` doesn't start with the expected
 * prefix — those shouldn't exist in source but a future contributor mixing in
 * a remote URL or upload path would otherwise feed it straight to pdf-lib.
 */
function toMergeEntries(): MergeEntry[] {
  return CUT_SHEETS.flatMap((cs) => {
    const prefix = '/cut-sheets/'
    if (!cs.src.startsWith(prefix)) return []
    const filename = cs.src.slice(prefix.length)
    // Block path-traversal at the constant boundary too (pdf-merge has its
    // own guard, but rejecting here is cheaper + clearer).
    if (filename.includes('/') || filename.includes('..')) return []
    return [{ sheetId: cs.sheetId, filename, title: cs.title }]
  })
}

/**
 * Resolve the print URL the headless browser will fetch.
 *
 * R1 H1 fold (2026-05-14): never trust `request.headers.get('host')` —
 * a spoofed Host on a deployment that doesn't canonicalize at the edge
 * would let an authed internal caller redirect puppeteer to attacker.com,
 * which then receives the user's session cookies via `page.setCookie` +
 * `page.goto`. Resolution order:
 *   1. `PLANSET_PDF_ORIGIN` env (operator-controlled, allows staging/CI).
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` or `VERCEL_URL` (Vercel canonical).
 *   3. Local dev only: localhost / 127.0.0.1 (lowercased Host header
 *      with port and the protocol).
 *   4. Else: throw. Production deploy without an env config is fail-loud,
 *      not fail-open.
 */
class PlansetPdfOriginError extends Error {}
function resolveOriginForPrint(request: NextRequest): string {
  const override = process.env.PLANSET_PDF_ORIGIN
  if (override) return override
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercelProd) return `https://${vercelProd}`
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`
  // Dev fallback only. Allow `localhost` or `127.0.0.1` host values (with
  // any port) — anything else means we're running somewhere the origin
  // wasn't explicitly configured and we must NOT trust the host header.
  const rawHost = (request.headers.get('host') ?? '').toLowerCase()
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)
  if (!isLocalHost) {
    throw new PlansetPdfOriginError(
      'no trusted print origin configured — set PLANSET_PDF_ORIGIN or rely on VERCEL_* envs',
    )
  }
  const proto = request.headers.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${rawHost}`
}

/**
 * Filter forwarded cookies to ONLY the Supabase auth set. R1 H2 fold
 * (2026-05-14): forwarding every cookie sent PostHog/Sentry/other-project
 * cookies into the puppeteer browser, which amplified the H1 blast radius
 * and polluted analytics. Supabase's ssr cookies all use the `sb-` prefix.
 */
function filterSupabaseAuthCookies(
  cookies: ReturnType<NextRequest['cookies']['getAll']>,
): typeof cookies {
  return cookies.filter((c) => c.name.startsWith('sb-'))
}

/**
 * GET /api/planset/[projectId]/pdf
 *
 * Server-side planset PDF render via puppeteer-core + @sparticuz/chromium.
 * Closes greg_actions #332. Replaces the client-side window.print() flow at
 * app/planset/page.tsx:347 — that path persists for the in-app preview but
 * never produced a PDF that could be merged with stamped cut sheets.
 *
 * Auth: cookie-based session via @supabase/ssr (mirrors the v2 SLD route).
 *       INTERNAL_ROLES = {admin, super_admin, manager} only.
 * Rate: 10/min keyed on user.id (lower than the v2 SLD route's 20/min
 *       because chromium cold-start makes this 5-10x more expensive per
 *       request).
 * Out:  application/pdf — full planset (10+ rendered sheets) followed by
 *       the static cut-sheet PDFs from public/cut-sheets/.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  // ── Auth + role gate ────────────────────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = (userRow as { role: string } | null)?.role
  if (!role || !INTERNAL_ROLES.has(role)) {
    return NextResponse.json({ error: 'Internal users only' }, { status: 403 })
  }

  // ── Rate limit (chromium cold start is expensive) ───────────────────────
  const { success } = await rateLimit(`planset-pdf:${user.id}`, {
    windowMs: 60_000,
    max: 10,
    prefix: 'planset-pdf',
  })
  if (!success) {
    // R1 M1 fold (2026-05-14): warn-log so abuse surfaces in monitoring.
    // user.id is fine to log (it's the canonical join key elsewhere); never
    // log the email or the JWT.
    console.warn(`[GET /api/planset/${projectId}/pdf] rate-limit 429 user=${user.id}`)
    return NextResponse.json({ error: 'Rate limit exceeded (10 PDFs/minute)' }, { status: 429 })
  }

  // ── Load project (RLS-scoped via the user's session) ────────────────────
  // Defensive ordering: load BEFORE launching chromium so a missing project
  // returns 404 without paying the cold-start cost.
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()
  if (projectErr || !project) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }

  // ── Launch chromium + render the planset page ───────────────────────────
  // Dynamic imports keep these heavy modules out of the route's cold-start
  // path for the early-return branches above.
  const cid = makeCorrelationId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null
  try {
    const puppeteer = await import('puppeteer-core')
    const chromiumMod = await import('@sparticuz/chromium')
    const chromium = chromiumMod.default
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1632, height: 1056 }, // 17 x 11 at 96 DPI
      executablePath: await chromium.executablePath(),
      headless: true,
    })
    const page = await browser.newPage()

    // Forward ONLY the Supabase auth cookies so the print page sees the
    // same auth that this route handler did. R1 H2 fold: filter to `sb-`
    // prefix so PostHog/Sentry/other-project cookies don't get re-issued
    // inside chromium (would pollute analytics + amplify H1 if H1 ever
    // regressed). The CSRF surface for the route is the INTERNAL_ROLES
    // gate above — non-authed callers never reach this code.
    const origin = resolveOriginForPrint(request)
    const originHost = new URL(origin).hostname
    const incomingCookies = filterSupabaseAuthCookies(request.cookies.getAll()).map((c) => ({
      name: c.name,
      value: c.value,
      domain: originHost,
      path: '/',
      // mark secure on https; chrome accepts insecure on localhost regardless
      secure: origin.startsWith('https://'),
      httpOnly: true,
      sameSite: 'Lax' as const,
    }))
    if (incomingCookies.length > 0) {
      await page.setCookie(...incomingCookies)
      // R1 M2 fold: assert at least one Supabase auth cookie round-tripped
      // into the puppeteer browser. If the cookie shape ever changes (e.g.
      // Supabase migrates to Partitioned/CHIPS) `setCookie` would silently
      // drop them and the puppeteer-rendered planset would render as a
      // logged-out user → empty RLS view → blank PDF handed to an AHJ.
      // Fail loud here instead.
      const installed = await page.cookies(origin)
      const hasAuth = installed.some((c: { name: string }) => c.name.startsWith('sb-'))
      if (!hasAuth) {
        throw new Error(
          'sb-* auth cookies did not round-trip into puppeteer — cookie shape regression?',
        )
      }
    }

    const printUrl = `${origin}/planset?project=${encodeURIComponent(projectId)}&print=1`
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 45_000 })

    // Force the print-media stylesheet (PRINT_CSS hides nav + banners).
    await page.emulateMediaType('print')

    const plansetPdfBytes = await page.pdf({
      width: '17in',
      height: '11in',
      margin: { top: '0.25in', right: '0.25in', bottom: '0.25in', left: '0.25in' },
      printBackground: true,
      preferCSSPageSize: true,
    })

    // ── Merge with cut sheets ────────────────────────────────────────────
    const mergeResult = await mergePlansetWithCutSheets(
      plansetPdfBytes,
      toMergeEntries(),
    )
    if (mergeResult.skipped.length > 0) {
      console.warn(
        `[GET /api/planset/${projectId}/pdf] cid=${cid} cut sheets skipped:`,
        mergeResult.skipped,
      )
    }

    // R1 L1 fold: dropped X-Planset-PDF-Merged header. Cut-sheet filenames
    // are static constants today so it leaked nothing, but if anyone wires
    // user-controlled uploads into CUT_SHEETS the header becomes a
    // reflection sink. Use the correlation id + the server warn-log if a
    // merge skip needs debugging.
    return new NextResponse(mergeResult.bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${projectId}-planset.pdf"`,
        'Cache-Control': 'no-store',
        'X-Planset-PDF-Correlation-Id': cid,
      },
    })
  } catch (err) {
    console.error(
      `[GET /api/planset/${projectId}/pdf] cid=${cid} render failed`,
      structuredErrorLog(err),
    )
    return NextResponse.json(
      { error: 'Render failed', correlationId: cid },
      { status: 500 },
    )
  } finally {
    // Always close the browser. Leaking a chromium process = leaked file
    // descriptors + ~150MB resident memory; on Vercel the lambda gets
    // recycled but the leak surface across warm-restarts is real.
    if (browser) {
      try {
        await browser.close()
      } catch {
        // Already-closed or crashed — nothing actionable.
      }
    }
  }
}
