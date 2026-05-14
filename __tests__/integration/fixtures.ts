// Fixture constants for the integration test suite.
//
// Safe to import from anywhere — no side effects on import. Do NOT add
// side-effectful re-exports to this file (R1 L2 fold).
//
// Every fixture identifier starts with the `e2e_test_` prefix AND
// includes a per-run suffix. The prefix is the grep-able marker that
// scopes orphan-detection + cleanup scripts. The per-run suffix
// eliminates the concurrent-CI-runner race (R1 H1 fold — two runners
// sharing one auth.user would clobber each other's password reset
// mid-run).
//
// Suffix source order: explicit env var (CI plumbs e.g. GITHUB_RUN_ID
// or BUILDKITE_BUILD_NUMBER), then a random 8-char hex per process.

import { randomUUID } from 'node:crypto'

export const E2E_TEST_PREFIX = 'e2e_test_'

const _runSuffix: string =
  process.env.VITEST_INTEGRATION_RUN_ID ??
  process.env.GITHUB_RUN_ID ??
  process.env.BUILDKITE_BUILD_NUMBER ??
  randomUUID().slice(0, 8)

export const RUN_ID = _runSuffix

// Slug + email + project id all carry the suffix so concurrent runs
// don't collide. Cleanup grep stays `LIKE 'e2e\_test\_%' ESCAPE '\\'`
// (matches all suffixes).
export const E2E_INTEGRATION_ORG_SLUG = `e2e_test_integration_org_${_runSuffix}`
export const E2E_INTEGRATION_ORG_NAME = `E2E Test — Integration Org ${_runSuffix}`

export const E2E_INTEGRATION_USER_EMAIL = `e2e_test_integration_${_runSuffix}@gomicrogridenergy.com`
export const E2E_INTEGRATION_USER_NAME = `E2E Test Integration User ${_runSuffix}`

// Password is per-run + fixed-shape. Length is well above Supabase
// minimums; no secrecy value beyond suite isolation.
export const E2E_INTEGRATION_PASSWORD = `IntegrationHarness-2026-${_runSuffix}-Pw!`

// Project id is text PK. Per-run suffix.
export const E2E_INTEGRATION_PROJECT_ID = `e2e_test_integration_proj_${_runSuffix}`
