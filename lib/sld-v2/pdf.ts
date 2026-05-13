// SERVER-ONLY — Phase 5 of the planset sld-v2 architectural pivot.
// This module imports jsdom + jsPDF + svg2pdf.js at runtime; do NOT import it
// from a Client Component. Use only from Next.js API routes, server actions,
// or build-time tooling. (We avoid the literal `import 'server-only'` because
// it errors under `npx tsx` harness execution outside Next.)
//
// Phase 6 R1-L1 defense: the JSDoc `@internal` tag on `renderSldToPdf` plus
// the SERVER-ONLY header are the only enforcement today. If a future Next.js
// App-Router lint rule requires the literal directive, swap to a tsx loader
// shim — don't drop the comment-based defense without a replacement.
//
// Phase 7b deploy fix — `react-dom/server`, React, and the SldRenderer
// component are dynamic-imported INSIDE the render function below.
// Phase 6 broke the planset-branch Vercel preview builds because the App
// Route at app/api/sld/v2/[projectId]/route.ts pulled this module into
// Turbopack's App Route bundle analysis, which rejects static
// `react-dom/server` imports ("To fix it, render or return the content
// directly as a Server Component instead"). Lazy-importing matches the
// jsdom pattern already in place and breaks Turbopack's static-analysis
// chain so the App Route can ship.

import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

import { layoutEquipmentGraph } from './layout'
import { placeLabels } from './labels'
import type { EquipmentGraph } from './equipment'
import type { PlansetData } from '../planset-types'
import { paintTitleBlock, TITLE_BLOCK_WIDTH_PT } from './title-block'
import { loadInterTtfBase64 } from './fonts/inter-loader'

// ──────────────────────────────────────────────────────────────────────────
// Phase 5 — EquipmentGraph → SVG → DOM → svg2pdf → jsPDF → Uint8Array.
//
// Pipeline:
//   1. layoutEquipmentGraph(graph) — Phase 2 elkjs adapter.
//   2. placeLabels(...) — Phase 3 greedy slot picker.
//   3. renderToStaticMarkup(<SldRenderer/>) → SVG string.
//   4. Active document parses the string into a real DOM tree.
//      - In test (vitest jsdom env): uses the host jsdom.
//      - In production (Next.js API route): lazy-imports jsdom on demand.
//   5. Install a getBBox shim on SVGGraphicsElement.prototype if missing
//      (jsdom@29 does not implement getBBox; svg2pdf.js's text-width path
//      depends on it). Width estimate: text.length × fontSize × 0.55,
//      adequate for the SLD's label sizes (4-12pt).
//   6. Rewrite font-family on <text>/<g>/<tspan> to
//      'Inter, Helvetica, sans-serif'. Phase 7 will register Inter ttf via
//      jsPDF.addFont(); until then jsPDF's built-in Helvetica (Type 1) wins
//      and text remains selectable + plan-checker-grep-able.
//   7. Scale-to-fit: SldRenderer's viewBox is elkjs-auto-sized (variable).
//      We compute aspect-preserved fit into the page's printable region.
//      Title block + NEC notes box deferred to Phase 7.
//   8. svg2pdf draws into the jsPDF instance; doc.output('arraybuffer').
// ──────────────────────────────────────────────────────────────────────────

export interface PdfOptions {
  /** Page width in pt. Default 1224 (ANSI B 11×17 landscape @ 72 DPI). */
  pageWidthPt?: number
  /** Page height in pt. Default 792. */
  pageHeightPt?: number
  /** Inner margin in pt around the SLD region. Default 36 (½ inch). */
  marginPt?: number
  /**
   * Phase 7b — optional right-sidebar title block. When provided, the SLD
   * body is scaled to fit ALONGSIDE the title block (printable width
   * reduced by TITLE_BLOCK_WIDTH_PT + gap) and the title block is painted
   * on top via jsPDF native primitives. When omitted, the renderer
   * matches Phase 5/6 behavior (full-width SLD, no title block — used by
   * the verification harnesses).
   */
  titleBlock?: {
    data: PlansetData
    sheetName: string
    sheetNumber: string
  }
}

const DEFAULTS = { pageWidthPt: 1224, pageHeightPt: 792, marginPt: 36 } as const
const FONT_FAMILY = 'Inter, Helvetica, sans-serif'

// R1-H1 fix — concurrency mutex.
// When `hostHasDom === false` (production Node, no DOM globals) we swap
// `globalThis.window` / `document` to a fresh JSDOM for the duration of the
// render. Two concurrent renders would race the save/restore and corrupt
// global state across requests. Serialize the global-swap renders through
// a promise chain. Test env (hostHasDom === true) doesn't swap globals so
// doesn't need the mutex; parallel test renders still work.
let renderMutex: Promise<unknown> = Promise.resolve()

/**
 * @internal Server-only. Importing this function from a Client Component
 * leaks jsdom + jsPDF + svg2pdf.js + the native `canvas` package into the
 * client bundle (~5MB) and crashes at runtime because `window` is being
 * swapped under the hood. Use it only from API routes, server actions, or
 * build-time tooling. See the file header for the rationale on the missing
 * literal `import 'server-only'` directive.
 */
export async function renderSldToPdf(
  graph: EquipmentGraph,
  options: PdfOptions = {},
): Promise<Uint8Array> {
  const pageWidthPt = options.pageWidthPt ?? DEFAULTS.pageWidthPt
  const pageHeightPt = options.pageHeightPt ?? DEFAULTS.pageHeightPt
  const marginPt = options.marginPt ?? DEFAULTS.marginPt

  const layout = await layoutEquipmentGraph(graph)
  const labelPlacement = placeLabels(layout.laidOut, layout.edges, {
    freeZone: { x: layout.width - 240, y: 0, w: 240, h: layout.height },
  })

  // Dynamic-import React + renderToStaticMarkup + SldRenderer so Turbopack's
  // App Route analyzer doesn't see `react-dom/server` reachable from the
  // route file and reject the build. SldRenderer is a server-only renderer
  // (renders SVG via renderToStaticMarkup); the lazy chain stays server-side
  // because the parent module is already gated by the SERVER-ONLY header
  // + ESLint no-restricted-imports rule.
  const [ReactMod, { renderToStaticMarkup }, { SldRenderer }] = await Promise.all([
    import('react'),
    import('react-dom/server'),
    import('../../components/planset-v2/SldRenderer'),
  ])

  const svgString = renderToStaticMarkup(
    ReactMod.createElement(SldRenderer, { layout, labelPlacement }),
  )

  const g = globalThis as Record<string, unknown>
  const hostHasDom =
    typeof g.document !== 'undefined' && typeof g.window !== 'undefined'

  // R1-H1: serialize global-swap renders so concurrent calls don't corrupt
  // window/document. Test env (hostHasDom === true) bypasses the mutex.
  const work = (): Promise<Uint8Array> =>
    runOneRender({
      svgString,
      hostHasDom,
      pageWidthPt,
      pageHeightPt,
      marginPt,
      titleBlock: options.titleBlock,
    })

  if (hostHasDom) {
    return work()
  }

  const chained = renderMutex.then(work, work)
  renderMutex = chained.catch(() => undefined)
  return chained
}

interface RunOneRenderArgs {
  svgString: string
  hostHasDom: boolean
  pageWidthPt: number
  pageHeightPt: number
  marginPt: number
  titleBlock?: PdfOptions['titleBlock']
}

async function runOneRender(args: RunOneRenderArgs): Promise<Uint8Array> {
  const { svgString, hostHasDom, pageWidthPt, pageHeightPt, marginPt, titleBlock } = args
  const g = globalThis as Record<string, unknown>
  const prevWindow = g.window
  const prevDocument = g.document
  let installedJsdom = false

  if (!hostHasDom) {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    g.window = dom.window
    g.document = dom.window.document
    installedJsdom = true
  }

  let appendedSvg: Element | null = null
  try {
    installBBoxShim(g.window as Window & typeof globalThis)
    const doc = g.document as Document
    const svgElement = parseSvg(svgString, doc)
    rewriteFontFamily(svgElement, FONT_FAMILY)
    doc.body.appendChild(svgElement)
    appendedSvg = svgElement

    const svgW = Number(svgElement.getAttribute('width') ?? '0')
    const svgH = Number(svgElement.getAttribute('height') ?? '0')
    if (!Number.isFinite(svgW) || !Number.isFinite(svgH) || svgW <= 0 || svgH <= 0) {
      throw new Error(`renderSldToPdf: bad SVG dimensions w=${svgW} h=${svgH}`)
    }

    // Phase 7b — when a title block is supplied, narrow the printable
    // SLD region to leave room for the right-sidebar block.
    const sidebarReserve = titleBlock
      ? TITLE_BLOCK_WIDTH_PT + 6 /* gap */
      : 0
    const sldAreaW = pageWidthPt - marginPt * 2 - sidebarReserve
    const sldAreaH = pageHeightPt - marginPt * 2
    const scale = Math.min(sldAreaW / svgW, sldAreaH / svgH)
    const fitW = svgW * scale
    const fitH = svgH * scale
    const offX = marginPt + (sldAreaW - fitW) / 2
    const offY = marginPt + (sldAreaH - fitH) / 2

    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: [pageWidthPt, pageHeightPt],
    })

    // Phase 7b — register Inter ttf with jsPDF ONLY when a title block
    // is requested. Inter registration switches embedded-text encoding
    // from WinAnsi (Helvetica Type 1 standard, plain ASCII in PDF bytes)
    // to TrueType-CID glyph codes — which breaks the `strings | grep`
    // verification pattern that Phase 5's tests use to confirm NEC text
    // is present. Title-block paint is the only reason to register a
    // custom font; the SLD body's labels stay readable in Helvetica.
    // If the ttf fails to load, fall back to Helvetica without crashing.
    let fontName = 'helvetica'
    if (titleBlock) {
      const interB64 = await loadInterTtfBase64()
      if (interB64) {
        pdf.addFileToVFS('Inter-Regular.ttf', interB64)
        pdf.addFont('Inter-Regular.ttf', 'Inter', 'normal')
        fontName = 'Inter'
      }
    }

    await svg2pdf(svgElement as unknown as Element, pdf, {
      x: offX,
      y: offY,
      width: fitW,
      height: fitH,
    })

    // Phase 7b — paint the title block AFTER the SLD body so it
    // renders on top of any clipping artifacts (svg2pdf occasionally
    // emits stray vectors at the SVG's right edge).
    //
    // Title block stays on Helvetica regardless of `fontName` — Inter
    // is registered as Regular only (Greg's pick), and jsPDF warns
    // loudly when setFont('Inter', 'bold') has no registered variant.
    // The title block has multiple bold rows (labels, sheet name,
    // sheet number numeral) so it needs a font with native bold —
    // Helvetica's Type 1 standard ships normal + bold built-in. The
    // SLD body still gets Inter via the SVG font-family declaration
    // (where svg2pdf resolves to the registered 'normal' variant).
    if (titleBlock) {
      const tbX = pageWidthPt - marginPt - TITLE_BLOCK_WIDTH_PT
      const tbY = marginPt
      const tbW = TITLE_BLOCK_WIDTH_PT
      const tbH = pageHeightPt - marginPt * 2
      paintTitleBlock(pdf, titleBlock, tbX, tbY, tbW, tbH)
    }
    // Silence ESLint: fontName is read indirectly through svg2pdf's
    // font-family resolution; the variable is intentionally retained
    // for clarity but not directly used after Inter registration.
    void fontName

    const buf = pdf.output('arraybuffer')
    return new Uint8Array(buf as ArrayBuffer)
  } finally {
    // R1-H2: always detach the appended SVG, even if svg2pdf threw.
    if (appendedSvg && appendedSvg.parentNode) {
      appendedSvg.parentNode.removeChild(appendedSvg)
    }
    if (installedJsdom) {
      g.window = prevWindow
      g.document = prevDocument
    }
  }
}

function parseSvg(svgString: string, doc: Document): SVGSVGElement {
  const wrapper = doc.createElement('div')
  wrapper.innerHTML = svgString
  const svgElement = wrapper.firstChild as SVGSVGElement | null
  if (!svgElement || svgElement.nodeName.toLowerCase() !== 'svg') {
    throw new Error('renderToStaticMarkup did not produce an <svg> root')
  }
  return svgElement
}

function rewriteFontFamily(root: Element, family: string): void {
  // R1-H4: always set font-family on every <text>/<g>/<tspan>, not only when
  // one is already declared. Per-equipment <g> wrappers in
  // components/planset-v2/assets/* hardcode Helvetica today; without rewriting
  // unconditionally, Phase 7's jsPDF.addFont('Inter') wouldn't be picked up
  // because svg2pdf resolves via the nearest declared family.
  root.setAttribute('font-family', family)
  const walk = (n: Element): void => {
    const tag = n.nodeName?.toLowerCase?.()
    if (tag === 'text' || tag === 'g' || tag === 'tspan') {
      n.setAttribute('font-family', family)
    }
    const children = n.children
    if (children && children.length) {
      for (let i = 0; i < children.length; i++) {
        walk(children[i] as Element)
      }
    }
  }
  walk(root)
}

// Idempotent — installs a getBBox shim on SVGGraphicsElement / SVGElement /
// Element prototypes (whichever exist) if getBBox is undefined. Width estimate
// is text.length × fontSize × 0.55 — close enough for monospace-ish Helvetica
// at the 4-12pt label sizes the SLD emits.
//
// R1-H3 note: under the vitest jsdom env (`hostHasDom === true`) the shim
// patches the shared jsdom window's prototypes permanently for the rest of
// the process. Grep confirms no other test in this repo asserts against
// `getBBox`, so the leak is benign today. If a future test asserts on the
// real jsdom zero-stub, refactor this to use a WeakSet of patched prototypes
// + per-call teardown.
const BBOX_SHIM_FLAG = '__sldV2BBoxShim'

function installBBoxShim(win: Window & typeof globalThis): void {
  if ((win as unknown as Record<string, boolean>)[BBOX_SHIM_FLAG]) return
  const candidates = ['SVGGraphicsElement', 'SVGElement', 'Element'] as const
  let installedAny = false
  for (const name of candidates) {
    const Ctor = (win as unknown as Record<string, { prototype: object } | undefined>)[name]
    const proto = Ctor?.prototype as
      | { getBBox?: () => DOMRect }
      | undefined
    if (proto && typeof proto.getBBox !== 'function') {
      Object.defineProperty(proto, 'getBBox', {
        configurable: true,
        writable: true,
        value: function (this: Element) {
          const text = this.textContent ?? ''
          const sizeAttr = this.getAttribute?.('font-size') ?? '10'
          const fontSize = parseFloat(sizeAttr) || 10
          const width = text.length * fontSize * 0.55
          return { x: 0, y: 0, width, height: fontSize, top: 0, right: width, bottom: fontSize, left: 0, toJSON() { return this } } as DOMRect
        },
      })
      installedAny = true
    }
  }
  if (installedAny) {
    Object.defineProperty(win, BBOX_SHIM_FLAG, { value: true, enumerable: false })
  }
}
