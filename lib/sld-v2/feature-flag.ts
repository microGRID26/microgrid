// Phase 6 — feature flag for the sld-v2 PDF route.
//
// Two read paths today:
//   1. URL query param `?sld=v2` — per-request opt-in for testing.
//   2. Env var `SLD_V2_DEFAULT=1` — process-wide default-on (Vercel preview
//      deployments, dev runs, internal staging).
//
// Phase 7 may promote this to a third arg (per-project boolean column) when
// the v2 path is rolled out per-project. Until then, flag-off is the safe
// default and the v2 route returns 404 when off (invisible).

type SearchParamsLike = URLSearchParams | { get(key: string): string | null }

// R1-M4 — the URL query-param key is case-sensitive (URLSearchParams), but
// the *value* compare is case-insensitive so `?sld=V2` and `?sld=v2` both
// flip the flag on. Documented for Phase 7 callers.
export function shouldUseSldV2(searchParams: SearchParamsLike): boolean {
  const value = (searchParams.get('sld') ?? '').toLowerCase()
  if (value === 'v2') return true
  if (process.env.SLD_V2_DEFAULT === '1') return true
  return false
}
