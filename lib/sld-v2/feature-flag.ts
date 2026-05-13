// Feature flag for the sld-v2 SLD pipeline (PDF route + SheetPV5 inline render).
//
// Three opt-in paths, evaluated in this order:
//   1. URL query param `?sld=v2` — per-request opt-in for testing. Wins over
//      everything else (Phase 6 R1-M4: value compare is case-insensitive so
//      `?sld=V2` works too; key is the literal `sld`).
//   2. Env var `SLD_V2_DEFAULT=1` — process-wide default-on (Vercel preview
//      deployments, dev runs, internal staging).
//   3. Per-project `projects.use_sld_v2 boolean` column (Phase 7a, migration
//      221). Production rollout path — flip one project at a time without
//      env-wide blast radius.
//
// When all three are off the v2 route returns 404 (invisible) and SheetPV5
// renders via the v1 inline path. `project` is optional so pre-load callers
// (e.g. the route's auth gate) can short-circuit on URL/env without touching
// the DB.

type SearchParamsLike = URLSearchParams | { get(key: string): string | null }
type ProjectFlagLike = { use_sld_v2?: boolean | null } | null | undefined

export function shouldUseSldV2(
  searchParams: SearchParamsLike,
  project?: ProjectFlagLike,
): boolean {
  const value = (searchParams.get('sld') ?? '').toLowerCase()
  if (value === 'v2') return true
  if (process.env.SLD_V2_DEFAULT === '1') return true
  if (project?.use_sld_v2 === true) return true
  return false
}
