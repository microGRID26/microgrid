// Centralized error/warn logging.
//
// In dev, log to the JS console so RN's red-box / Metro logs surface the
// problem during local development. In production, route to Sentry — the
// device console is unreachable for real customers, and customer-side
// errors should be visible in the dashboard.
//
// Why not just `console.error`: in production builds, console output still
// emits to native logs (Xcode, adb logcat) and to Sentry's auto-captured
// breadcrumbs. Supabase error messages occasionally include row IDs, RLS
// policy names, sometimes user emails. Routing through this helper makes
// the privacy-vs-debuggability boundary explicit and centralized.

import { Sentry } from './sentry'

export function logError(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (__DEV__) {
    console.error(label, message)
    return
  }
  const err = error instanceof Error
    ? error
    : new Error(`${label}: ${message}`)
  Sentry.captureException(err, {
    tags: { logSource: label.replace(/[\[\]]/g, '').slice(0, 64) },
  })
}

export function logWarn(label: string, message: string): void {
  if (__DEV__) {
    console.warn(label, message)
    return
  }
  Sentry.captureMessage(`${label} ${message}`, 'warning')
}
