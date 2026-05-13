// Phase 7b — lazy ttf loader for Inter Regular + Inter Bold.
//
// SERVER-ONLY. Reads `lib/sld-v2/fonts/Inter-{Regular,Bold}.ttf` from disk
// and returns the contents base64-encoded for jsPDF's `addFileToVFS` +
// `addFont` registration calls.
//
// Cached at the module level — first call reads + encodes (~340–410 KB of
// work per file), subsequent calls return the cached string. Read failures
// return `null` so the caller can fall back to Helvetica without crashing
// the render.
//
// Provenance: Inter v4.1 release zip (rsms/inter on GitHub),
// `extras/ttf/Inter-Regular.ttf` and `extras/ttf/Inter-Bold.ttf`.
// SHA-256 captured at vendor time:
//   Regular: 40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82
//   Bold:    288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f
// Constants below are verified at runtime on first load — mismatch throws,
// which propagates as a render failure (loud > silent for a supply-chain
// or partial-deploy corruption signal).

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface FontSpec {
  basename: string
  vfsFilename: string
  jspdfStyle: 'normal' | 'bold'
  expectedSha256: string
  mismatchPrefix: string
}

// Vendored Inter v4.1. If a constant ever needs to change, re-vendor from
// the upstream release and update both the constant and the comment block
// above in the same commit.
const INTER_REGULAR: FontSpec = {
  basename: 'Inter-Regular.ttf',
  vfsFilename: 'Inter-Regular.ttf',
  jspdfStyle: 'normal',
  expectedSha256: '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82',
  mismatchPrefix: 'Inter-Regular.ttf SHA-256 mismatch —',
}

const INTER_BOLD: FontSpec = {
  basename: 'Inter-Bold.ttf',
  vfsFilename: 'Inter-Bold.ttf',
  jspdfStyle: 'bold',
  expectedSha256: '288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f',
  mismatchPrefix: 'Inter-Bold.ttf SHA-256 mismatch —',
}

const JSPDF_FONT_NAME = 'Inter'

let cachedRegular: string | null | undefined = undefined
let cachedBold: string | null | undefined = undefined

async function loadTtf(spec: FontSpec): Promise<string | null> {
  try {
    // Resolve relative to this module's directory so the lookup works
    // under both `next build` (compiled to .next/server/...) and `tsx`
    // (executed in place). The ttf is in the same directory as this loader.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const ttfPath = path.join(here, spec.basename)
    const buf = await fs.readFile(ttfPath)
    // Verify the vendored ttf against its provenance hash. A mismatch
    // means the file on disk diverged from what Greg vendored — most
    // likely a partial deploy or a tampered checkout. Throw loud so the
    // route returns 500 and the failure shows up immediately; silent
    // fallback would mask a real signal.
    const actualSha = crypto.createHash('sha256').update(buf).digest('hex')
    if (actualSha !== spec.expectedSha256) {
      throw new Error(
        `${spec.mismatchPrefix} expected ${spec.expectedSha256}, got ${actualSha}. ` +
        `The ttf on disk diverged from the vendored copy. Re-vendor from rsms/inter or restore the file.`
      )
    }
    return buf.toString('base64')
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(spec.mismatchPrefix)) {
      // Supply-chain or partial-deploy signal. Re-throw so the route
      // returns 500 and the failure is visible immediately. Do NOT
      // cache so a fixed file on subsequent boot re-verifies cleanly.
      throw err
    }
    // Benign file-read failure (ENOENT, EACCES, etc) — fall back to
    // Helvetica.
    //
    // Cumulative R1 M5 — do NOT cache the failure. A partial Vercel deploy
    // that lost the ttf would silently fall back to Helvetica for the
    // entire dyno lifetime with a single log line. Every request re-attempts
    // the read and emits a fresh warn. The 340–410 KB read overhead is
    // acceptable for the visibility — and once the file is restored, the
    // next call caches successfully.
    console.warn(`[sld-v2/inter-loader] ${spec.basename} load failed; falling back to Helvetica: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/**
 * Returns the Inter-Regular.ttf bytes base64-encoded, suitable for
 * `doc.addFileToVFS(VFS_FILENAME, b64)` followed by
 * `doc.addFont(VFS_FILENAME, INTER_FONT_NAME, 'normal')`.
 *
 * Returns `null` if the file is missing or unreadable. Caller must
 * gracefully fall back (jsPDF's built-in Helvetica covers ASCII title-
 * block text via the WinAnsi sanitizer in `title-block.ts`).
 */
export async function loadInterTtfBase64(): Promise<string | null> {
  if (cachedRegular !== undefined) return cachedRegular
  const b64 = await loadTtf(INTER_REGULAR)
  cachedRegular = b64
  return b64
}

/**
 * Returns the Inter-Bold.ttf bytes base64-encoded, suitable for
 * `doc.addFileToVFS('Inter-Bold.ttf', b64)` followed by
 * `doc.addFont('Inter-Bold.ttf', INTER_FONT_NAME, 'bold')`.
 *
 * Returns `null` if the file is missing or unreadable. Caller treats
 * a missing Bold variant the same as a missing Regular: skip the entire
 * Inter registration and fall back to Helvetica for both SLD body and
 * title block (atomic guarantee so jsPDF never tries to render a missing
 * bold variant).
 */
export async function loadInterBoldTtfBase64(): Promise<string | null> {
  if (cachedBold !== undefined) return cachedBold
  const b64 = await loadTtf(INTER_BOLD)
  cachedBold = b64
  return b64
}

/** jsPDF VFS filename for Inter Regular. */
export const INTER_VFS_FILENAME = INTER_REGULAR.vfsFilename
/** jsPDF VFS filename for Inter Bold. */
export const INTER_BOLD_VFS_FILENAME = INTER_BOLD.vfsFilename
/** jsPDF font family name shared by both variants. */
export const INTER_FONT_NAME = JSPDF_FONT_NAME

/**
 * Test-only escape hatch — resets the module-level caches so a vitest
 * spec can re-run the loader after stubbing the filesystem or hash.
 * Not exported via the public surface; the test file imports this
 * symbol via the bare module specifier.
 */
export function __resetInterLoaderCacheForTests(): void {
  cachedRegular = undefined
  cachedBold = undefined
}
