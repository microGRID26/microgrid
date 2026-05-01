/**
 * POST /api/planset/save-overrides
 *
 * Persists planset generator state (polygon edits, OverridesPanel changes,
 * image URLs) to projects.planset_overrides JSONB. Read on next /planset
 * load so designers don't lose work across sessions.
 *
 * Closes greg_actions #446 — without persistence the polygon-based site plan
 * (PV-3) can't be used for shipping plansets because Patricia / Tyson / etc
 * lose their polygon edits on every page reload.
 *
 * Body: { project_id: string, payload: PlansetOverridesPayload }
 *
 * Auth: Supabase server client (RLS gates the projects UPDATE — internal
 * writers only). Rate-limited per user.
 *
 * Payload size cap: 200 KB. A planset with all 4 image URLs + 12 strings +
 * 6 roof faces (each polygon ~20 points) sits well under 5 KB; 200 KB is
 * generous headroom that still kills runaway abuse before it reaches the DB.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

const MAX_PAYLOAD_BYTES = 200_000
const MAX_POLY_POINTS = 200            // realistic upper bound for a single roof face polygon
const MAX_ROOF_FACES = 32              // 32 separate roof planes is well past Tyson-rebuild scope
const MAX_STRINGS = 64                 // Duracell hybrid maxes out at ~24 strings; 64 is generous
const MAX_EQUIPMENT_PHOTOS = 4         // PV-7 has 4 slots; UI hardcoded
const MAX_URL_LEN = 4096               // even data URLs cap here; real URLs stay well under
const MAX_OVERRIDE_KEYS = 100          // PlansetOverrides has ~80 keys today; 100 is generous headroom
const MAX_OVERRIDE_VALUE_LEN = 8192    // string-typed override fields (model names, AHJ etc) cap here

// Allowed image URL schemes. Tighter than 'any same-origin path' so a
// malicious PM can't store '/api/admin/secret' as an image URL and exfil
// content into a print window. Restrict to known proxy / public origins.
const ALLOWED_IMG_PATH_PREFIXES = ['/api/planset/drive-image/', '/uploads/']
const ALLOWED_IMG_REMOTE_PREFIXES = ['http://', 'https://', 'blob:', 'data:image/']

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}
function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 10_000
}
function isCoord(n: unknown): n is number {
  // Polygon coords are normalized to [0, 1] roof-plan space; allow a small
  // out-of-bounds margin for in-progress edits but reject NaN / Infinity / wild magnitudes.
  return isFiniteNum(n) && n >= -0.5 && n <= 1.5
}
function isImageUrlOrNull(v: unknown): v is string | null {
  if (v === null) return true
  if (typeof v !== 'string') return false
  if (v.length > MAX_URL_LEN) return false
  if (ALLOWED_IMG_REMOTE_PREFIXES.some(p => v.startsWith(p))) return true
  if (ALLOWED_IMG_PATH_PREFIXES.some(p => v.startsWith(p))) return true
  return false
}

// Recursive shape sanity for an arbitrary `overrides` value. Doesn't enforce
// a schema (PlansetOverrides has ~80 keys and grows; mirroring the interface
// in a Set is brittle — see #446 R3 audit). Instead caps depth, key count,
// and string length so a malicious internal writer can't dump megabytes of
// nested junk into the JSONB column. The top-level 200KB byte cap already
// catches blatant abuse; this is defense-in-depth on shape.
function isSafeOverridesShape(v: unknown, depth = 0): { ok: true } | { ok: false; error: string } {
  if (depth > 4) return { ok: false, error: 'overrides nested too deep' }
  if (v === null || typeof v === 'boolean' || typeof v === 'number') {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      return { ok: false, error: 'override numeric value must be finite' }
    }
    return { ok: true }
  }
  if (typeof v === 'string') {
    if (v.length > MAX_OVERRIDE_VALUE_LEN) {
      return { ok: false, error: 'override string value too long' }
    }
    return { ok: true }
  }
  if (Array.isArray(v)) {
    if (v.length > 1000) return { ok: false, error: 'override array too long' }
    for (const it of v) {
      const r = isSafeOverridesShape(it, depth + 1)
      if (!r.ok) return r
    }
    return { ok: true }
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as object)
    if (keys.length > MAX_OVERRIDE_KEYS) {
      return { ok: false, error: 'overrides has too many keys' }
    }
    for (const k of keys) {
      // Block prototype-pollution-shaped keys at the JSONB level (see audit).
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        return { ok: false, error: `disallowed override key: ${k}` }
      }
      const r = isSafeOverridesShape((v as Record<string, unknown>)[k], depth + 1)
      if (!r.ok) return r
    }
    return { ok: true }
  }
  return { ok: false, error: 'unsupported override value type' }
}

function validatePayload(p: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof p !== 'object' || p === null) return { ok: false, error: 'payload must be an object' }
  const pp = p as Record<string, unknown>

  // Top-level keys: only the four documented branches allowed.
  const ALLOWED_TOP = new Set(['overrides', 'strings', 'roofFaces', 'images'])
  for (const k of Object.keys(pp)) {
    if (!ALLOWED_TOP.has(k)) return { ok: false, error: `unknown payload key: ${k}` }
  }

  if (pp.overrides !== undefined) {
    if (typeof pp.overrides !== 'object' || pp.overrides === null || Array.isArray(pp.overrides)) {
      return { ok: false, error: 'overrides must be an object' }
    }
    // Don't whitelist keys against PlansetOverrides — that interface has ~80
    // keys and grows whenever a sheet adds a configurable field; a static
    // Set drifts and silently breaks legitimate edits (R3 audit High-1
    // caught this re-introducing the exact #446 regression). Instead
    // enforce a SHAPE check: bounded depth, key count, string length, and
    // block prototype-pollution-shaped keys.
    const r = isSafeOverridesShape(pp.overrides)
    if (!r.ok) return r
  }

  if (pp.strings !== undefined) {
    if (!Array.isArray(pp.strings)) return { ok: false, error: 'strings must be an array' }
    if (pp.strings.length > MAX_STRINGS) return { ok: false, error: 'too many strings' }
    for (const s of pp.strings) {
      if (typeof s !== 'object' || s === null) return { ok: false, error: 'string entry malformed' }
      const sr = s as Record<string, unknown>
      // string.id is a positive integer index used as a React key; tighten
      // from "any finite number" to "non-negative integer". R2 audit Low-1 fix.
      if (!isPositiveInt(sr.id) || !isPositiveInt(sr.mppt) || !isPositiveInt(sr.modules) || !isPositiveInt(sr.roofFace)) {
        return { ok: false, error: 'string fields must be non-negative integers' }
      }
    }
  }

  if (pp.roofFaces !== undefined) {
    if (!Array.isArray(pp.roofFaces)) return { ok: false, error: 'roofFaces must be an array' }
    if (pp.roofFaces.length > MAX_ROOF_FACES) return { ok: false, error: 'too many roof faces' }
    for (const rf of pp.roofFaces) {
      if (typeof rf !== 'object' || rf === null) return { ok: false, error: 'roof face malformed' }
      const r = rf as Record<string, unknown>
      if (!isPositiveInt(r.id) || !isFiniteNum(r.tilt) || !isFiniteNum(r.azimuth) || !isPositiveInt(r.modules)) {
        return { ok: false, error: 'roof face numeric fields invalid' }
      }
      if (!Array.isArray(r.polygon)) return { ok: false, error: 'roof face polygon missing' }
      if (r.polygon.length > MAX_POLY_POINTS) return { ok: false, error: 'polygon has too many points' }
      for (const pt of r.polygon) {
        if (!Array.isArray(pt) || pt.length !== 2 || !isCoord(pt[0]) || !isCoord(pt[1])) {
          return { ok: false, error: 'polygon point out of range' }
        }
      }
    }
  }

  if (pp.images !== undefined) {
    if (typeof pp.images !== 'object' || pp.images === null || Array.isArray(pp.images)) {
      return { ok: false, error: 'images must be an object' }
    }
    const im = pp.images as Record<string, unknown>
    const ALLOWED_IMG_KEYS = new Set(['sitePlanImageUrl', 'roofPlanImageUrl', 'aerialPhotoUrl', 'housePhotoUrl', 'equipmentPhotos'])
    for (const k of Object.keys(im)) {
      if (!ALLOWED_IMG_KEYS.has(k)) return { ok: false, error: `unknown images key: ${k}` }
    }
    for (const k of ['sitePlanImageUrl', 'roofPlanImageUrl', 'aerialPhotoUrl', 'housePhotoUrl']) {
      if (im[k] !== undefined && !isImageUrlOrNull(im[k])) {
        return { ok: false, error: `images.${k} must be a safe URL or null` }
      }
    }
    if (im.equipmentPhotos !== undefined) {
      if (!Array.isArray(im.equipmentPhotos)) return { ok: false, error: 'equipmentPhotos must be an array' }
      if (im.equipmentPhotos.length > MAX_EQUIPMENT_PHOTOS) return { ok: false, error: 'too many equipment photos' }
      for (const p of im.equipmentPhotos) {
        if (!isImageUrlOrNull(p)) return { ok: false, error: 'equipmentPhotos entries must be safe URLs or null' }
      }
    }
  }

  return { ok: true }
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Debounced save can fire ~once per edit. 60/min/user is a comfortable
  // ceiling that covers heavy polygon-drawing sessions while still capping
  // a runaway client at 1 write/sec.
  const { success } = await rateLimit(`planset-save-overrides:${user.email}`, {
    windowMs: 60_000, max: 60, prefix: 'planset-save-overrides',
  })
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { project_id, payload } = body as { project_id?: unknown; payload?: unknown }
  if (typeof project_id !== 'string' || !project_id) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 })
  }
  if (typeof payload !== 'object' || payload === null) {
    return NextResponse.json({ error: 'payload required' }, { status: 400 })
  }

  // Size guard before round-tripping the JSON to Postgres. JSON.stringify
  // on a polygon-heavy payload is fast (microseconds) — cheaper than the
  // RLS-gated UPDATE that would otherwise burn DB time on a malformed payload.
  const serialized = JSON.stringify(payload)
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  // ── Server-side schema validation ─────────────────────────────────────
  // R1 audit High-1 fix: don't trust the client-shaped payload. Validate
  // before persisting so a malicious internal writer can't inject garbage
  // that crashes the next render. Hand-rolled (no Zod dep) — narrow shape,
  // small validator. Keep in sync with PlansetOverridesPayload in
  // types/database.ts and the runtime types in lib/planset-types.ts.
  const validation = validatePayload(payload)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  // R2 audit High-1 fix: tighten beyond RLS. The projects_update_v2 policy
  // lets any manager in the org UPDATE any project in the org — a manager
  // could blow away another PM's polygons. Three branches:
  //   • Caller IS the project's PM → allow.
  //   • Caller is admin / super_admin → allow.
  //   • Project has NO assigned PM (legacy: 67% of MG rows have NULL pm_id
  //     as of 2026-05-01) → allow any manager-or-better in the org. Without
  //     this branch the new gate locks designers out of every legacy
  //     project, defeating the whole point of #446.
  // Manager-tier writes on a project that DOES have a different pm_id are
  // still blocked here; admins are the override path for those.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectsAny = supabase.from('projects') as any
  const { data: existing, error: fetchErr } = await projectsAny
    .select('pm_id')
    .eq('id', project_id)
    .maybeSingle()
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const userId = user.id
  const isPm = existing.pm_id === userId
  const noPmAssigned = existing.pm_id === null || existing.pm_id === undefined
  if (!isPm) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usersAny = supabase.from('users') as any
    const { data: me } = await usersAny.select('role').eq('id', userId).maybeSingle()
    const role = me?.role as string | undefined
    const isAdmin = role === 'admin' || role === 'super_admin'
    const isManagerTier = isAdmin || role === 'manager'
    const allowed = isAdmin || (noPmAssigned && isManagerTier)
    if (!allowed) {
      // Don't distinguish "not your project" from "doesn't exist" to avoid
      // letting non-owner internals enumerate projects by id.
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
  }

  const nowIso = new Date().toISOString()
  const { error, count } = await projectsAny
    .update({
      planset_overrides: payload,
      planset_overrides_updated_by: userId,
      planset_overrides_updated_at: nowIso,
    })
    .eq('id', project_id)
    .select('id', { count: 'exact', head: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!count) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
