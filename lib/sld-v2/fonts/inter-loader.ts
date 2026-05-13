// Phase 7b — lazy ttf loader for Inter Regular.
//
// SERVER-ONLY. Reads `lib/sld-v2/fonts/Inter-Regular.ttf` from disk and
// returns the contents base64-encoded for jsPDF's `addFileToVFS` +
// `addFont` registration call.
//
// Cached at the module level — first call reads + encodes (~340 KB of
// work), subsequent calls return the cached string. Read failures
// return `null` so the caller can fall back to Helvetica without
// crashing the render.
//
// Provenance: Inter v4.1 release zip (rsms/inter on GitHub),
// `extras/ttf/Inter-Regular.ttf`. SHA-256 captured at vendor time:
//   40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82
// The constant below is verified at runtime on first load — mismatch
// throws, which propagates as a render failure (loud > silent for a
// supply-chain or partial-deploy corruption signal).

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TTF_BASENAME = 'Inter-Regular.ttf'
const VFS_FILENAME = 'Inter-Regular.ttf'
const JSPDF_FONT_NAME = 'Inter'

// Vendored Inter v4.1 Regular ttf. If this constant ever needs to
// change, re-vendor from the upstream release and update both this
// line and the comment block above in the same commit.
const INTER_EXPECTED_SHA256 =
  '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82'

// Sentinel prefix tags the SHA-mismatch error so the loader's catch
// block can re-throw it (loud) while still swallowing benign read
// failures (ENOENT/EACCES) into a Helvetica-fallback warning.
const INTER_SHA_MISMATCH_PREFIX = 'Inter-Regular.ttf SHA-256 mismatch —'

let cached: string | null | undefined = undefined

/**
 * Returns the Inter-Regular.ttf bytes base64-encoded, suitable for
 * `doc.addFileToVFS(VFS_FILENAME, b64)` followed by
 * `doc.addFont(VFS_FILENAME, FONT_NAME, 'normal')`.
 *
 * Returns `null` if the file is missing or unreadable. Caller must
 * gracefully fall back (jsPDF's built-in Helvetica covers the same
 * glyph set for ASCII title-block text).
 */
export async function loadInterTtfBase64(): Promise<string | null> {
  if (cached !== undefined) return cached
  try {
    // Resolve relative to this module's directory so the lookup works
    // under both `next build` (compiled to .next/server/...) and `tsx`
    // (executed in place). The ttf is in the same directory as this
    // loader.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const ttfPath = path.join(here, TTF_BASENAME)
    const buf = await fs.readFile(ttfPath)
    // Verify the vendored ttf against its provenance hash. A mismatch
    // means the file on disk diverged from what Greg vendored — most
    // likely a partial deploy or a tampered checkout. Throw loud so the
    // route returns 500 and the failure shows up immediately; silent
    // fallback would mask a real signal.
    const actualSha = crypto.createHash('sha256').update(buf).digest('hex')
    if (actualSha !== INTER_EXPECTED_SHA256) {
      // Use a distinguishable error message prefix so the catch below
      // can re-throw hash mismatches loud (the entire point of #1023)
      // while still swallowing benign file-read failures into a
      // Helvetica-fallback warning.
      throw new Error(
        `${INTER_SHA_MISMATCH_PREFIX} expected ${INTER_EXPECTED_SHA256}, got ${actualSha}. ` +
        `The ttf on disk diverged from the vendored copy. Re-vendor from rsms/inter or restore the file.`
      )
    }
    cached = buf.toString('base64')
    return cached
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(INTER_SHA_MISMATCH_PREFIX)) {
      // Supply-chain or partial-deploy signal. Re-throw so the route
      // returns 500 and the failure is visible immediately. Do NOT
      // cache so a fixed file on subsequent boot re-verifies cleanly.
      throw err
    }
    // Benign file-read failure (ENOENT, EACCES, etc) — fall back to
    // Helvetica. Cache the null so we don't re-read on every call.
    console.warn(`[sld-v2/inter-loader] Inter ttf load failed; falling back to Helvetica: ${err instanceof Error ? err.message : err}`)
    cached = null
    return null
  }
}

/** jsPDF VFS filename to use when registering Inter. */
export const INTER_VFS_FILENAME = VFS_FILENAME
/** jsPDF font name to use when calling `doc.setFont(...)`. */
export const INTER_FONT_NAME = JSPDF_FONT_NAME
