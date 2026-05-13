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

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TTF_BASENAME = 'Inter-Regular.ttf'
const VFS_FILENAME = 'Inter-Regular.ttf'
const JSPDF_FONT_NAME = 'Inter'

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
    cached = buf.toString('base64')
    return cached
  } catch (err) {
    // Don't crash the render — Helvetica fallback is acceptable.
    console.warn(`[sld-v2/inter-loader] Inter ttf load failed; falling back to Helvetica: ${err instanceof Error ? err.message : err}`)
    cached = null
    return null
  }
}

/** jsPDF VFS filename to use when registering Inter. */
export const INTER_VFS_FILENAME = VFS_FILENAME
/** jsPDF font name to use when calling `doc.setFont(...)`. */
export const INTER_FONT_NAME = JSPDF_FONT_NAME
