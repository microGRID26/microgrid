#!/usr/bin/env node
// scripts/generate-codebase-stats.mjs — walks the repo at build time and writes
// lib/infographic/codebase-stats.ts with a typed CODEBASE_STATS constant. Runs:
//   • postinstall (so fresh clones can typecheck)
//   • pre-build  (so Vercel deploys always have current numbers)
//   • pre-dev    (so local dev mirrors prod)
//
// The output file is gitignored — regenerated every run. Never commit it.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
// Generic excludes — applied at every depth. Build artifacts, deps, vendored
// source, and output dirs only. Everything else counts.
const EXCLUDE_DIRS = new Set([
  'node_modules', '.next', '.git', '.expo', 'ios', 'android',
  'build', 'dist', '.vercel', '.turbo', 'coverage', 'out', '.gitnexus',
  'public', 'test-results', 'playwright-report', '.cache',
])

function walk(root, onFile) {
  if (!fs.existsSync(root)) return
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (EXCLUDE_DIRS.has(e.name)) continue
    const p = path.join(root, e.name)
    if (e.isDirectory()) walk(p, onFile)
    else onFile(p)
  }
}

function countLines(file) {
  try {
    const content = fs.readFileSync(file, 'utf8')
    return content.split('\n').length
  } catch {
    return 0
  }
}

// ── 1. LOC buckets across the whole repo ────────────────────────────────────
// Walks the entire repo once and buckets every counted file by category so
// loc_total is the honest "everything Greg built" number, not just the Next.js
// web app. Matches the inclusive count shown to stakeholders earlier.
const WEB_APP_DIRS = new Set(['app', 'lib', 'components', 'types', 'hooks'])
const buckets = {
  web_app:  { loc: 0, files: 0 },  // TS/TSX in app/lib/components/types/hooks
  tests:    { loc: 0, files: 0 },  // TS/TSX in __tests__
  mobile:   { loc: 0, files: 0 },  // TS/TSX in mobile/ (Expo companion)
  scripts:  { loc: 0, files: 0 },  // TS/JS in scripts/
  sql:      { loc: 0, files: 0 },  // .sql in supabase/
  python:   { loc: 0, files: 0 },  // .py anywhere (NetSuite import, drive walkers)
  other_js: { loc: 0, files: 0 },  // TS/TSX/JS/JSX outside the above buckets
}

function relFromRoot(p) {
  return path.relative(ROOT, p)
}

function topDir(rel) {
  const idx = rel.indexOf(path.sep)
  return idx === -1 ? rel : rel.slice(0, idx)
}

walk(ROOT, (p) => {
  const fn = path.basename(p)
  if (fn.endsWith('.tsbuildinfo') || fn === 'next-env.d.ts') return
  if (fn === 'package-lock.json') return

  const rel = relFromRoot(p)
  const top = topDir(rel)
  const ext = path.extname(p).toLowerCase()
  const isTsJs = ['.ts', '.tsx', '.js', '.jsx'].includes(ext)

  if (ext === '.sql') {
    const n = countLines(p)
    buckets.sql.loc += n
    buckets.sql.files += 1
    return
  }
  if (ext === '.py') {
    const n = countLines(p)
    buckets.python.loc += n
    buckets.python.files += 1
    return
  }
  if (ext === '.css') {
    // Small but counted for parity with the full-repo walk.
    const n = countLines(p)
    buckets.other_js.loc += n
    buckets.other_js.files += 1
    return
  }
  if (!isTsJs) return

  const n = countLines(p)
  if (top === '__tests__') {
    buckets.tests.loc += n
    buckets.tests.files += 1
  } else if (top === 'mobile') {
    buckets.mobile.loc += n
    buckets.mobile.files += 1
  } else if (top === 'scripts') {
    buckets.scripts.loc += n
    buckets.scripts.files += 1
  } else if (WEB_APP_DIRS.has(top)) {
    buckets.web_app.loc += n
    buckets.web_app.files += 1
  } else {
    buckets.other_js.loc += n
    buckets.other_js.files += 1
  }
})

const appLoc = buckets.web_app.loc
const appFiles = buckets.web_app.files
const testLoc = buckets.tests.loc
const testFiles = buckets.tests.files
const locGrandTotal =
  buckets.web_app.loc +
  buckets.tests.loc +
  buckets.mobile.loc +
  buckets.scripts.loc +
  buckets.sql.loc +
  buckets.python.loc +
  buckets.other_js.loc

// ── 3. Pages (app/**/page.tsx) ───────────────────────────────────────────────
let pages = 0
walk(path.join(ROOT, 'app'), (p) => { if (p.endsWith('/page.tsx')) pages += 1 })

// ── 4. API route handlers (app/**/route.ts) ──────────────────────────────────
let apiRoutes = 0
walk(path.join(ROOT, 'app'), (p) => { if (p.endsWith('/route.ts')) apiRoutes += 1 })

// ── 5. API modules (lib/api/*.ts, excluding index) ───────────────────────────
let apiModules = 0
let apiExports = 0
const apiDir = path.join(ROOT, 'lib/api')
if (fs.existsSync(apiDir)) {
  for (const f of fs.readdirSync(apiDir)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue
    apiModules += 1
    const content = fs.readFileSync(path.join(apiDir, f), 'utf8')
    // Count `export ` at line start (functions, consts, types)
    const matches = content.match(/^export\s+/gm)
    apiExports += matches ? matches.length : 0
  }
}

// ── 6. Components ────────────────────────────────────────────────────────────
let components = 0
walk(path.join(ROOT, 'components'), (p) => { if (p.endsWith('.tsx')) components += 1 })

// ── 7. Error boundaries (app/**/error.tsx) ───────────────────────────────────
let errorBoundaries = 0
walk(path.join(ROOT, 'app'), (p) => { if (p.endsWith('/error.tsx')) errorBoundaries += 1 })

// ── 8. Migrations ────────────────────────────────────────────────────────────
let migrationFiles = 0
let maxMigrationNumber = 0
walk(path.join(ROOT, 'supabase'), (p) => {
  if (!p.endsWith('.sql')) return
  migrationFiles += 1
  const m = path.basename(p).match(/^(\d{3})-/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n > maxMigrationNumber) maxMigrationNumber = n
  }
})

// ── 9. Test count — vitest for accuracy (skip with STATS_SKIP_VITEST=1) ──────
// `postinstall` + `prebuild` run full vitest (~10s, accurate).
// `predev` sets STATS_SKIP_VITEST=1 to keep iteration fast (heuristic, ~200ms).
let testCount = 0
let testCountSource = 'heuristic'
const skipVitest = process.env.STATS_SKIP_VITEST === '1'
if (!skipVitest) {
  try {
    const out = execSync('npx vitest run --reporter=json --silent', {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 180_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Vitest's JSON reporter emits a single object at the end. Find the last `{...}`.
    const match = out.match(/\{[\s\S]*\}\s*$/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (typeof parsed.numTotalTests === 'number' && parsed.numTotalTests > 0) {
        testCount = parsed.numTotalTests
        testCountSource = 'vitest'
      }
    }
  } catch (err) {
    console.warn(`[generate-codebase-stats] vitest failed (${err.message}); falling back to heuristic`)
  }
}
if (testCount === 0) {
  // Heuristic: count `test(` / `it(` call sites line-anchored. Undercounts
  // slightly (~8%) but works without running the suite.
  const pattern = /^\s*(test|it)(\.\w+)*\s*\(/gm
  let total = 0
  walk(path.join(ROOT, '__tests__'), (p) => {
    if (!/\.(test|spec)\.(ts|tsx)$/.test(p)) return
    const content = fs.readFileSync(p, 'utf8')
    const matches = content.match(pattern)
    total += matches ? matches.length : 0
  })
  testCount = total
  testCountSource = 'heuristic'
}

// ── 10. Emit the generated file ──────────────────────────────────────────────
const stats = {
  // Loc_total is the inclusive "everything Greg built" number — web app +
  // tests + mobile companion + scripts + SQL migrations + Python data tools.
  // Matches the earlier manual count shown to Greg.
  loc_total: locGrandTotal,
  loc_web_app: appLoc,
  loc_tests: testLoc,
  loc_mobile: buckets.mobile.loc,
  loc_scripts: buckets.scripts.loc,
  loc_sql: buckets.sql.loc,
  loc_python: buckets.python.loc,
  loc_other: buckets.other_js.loc,
  // File counts
  source_files: appFiles + testFiles + buckets.mobile.files + buckets.scripts.files + buckets.other_js.files + buckets.sql.files + buckets.python.files,
  app_source_files: appFiles,
  test_files: testFiles,
  mobile_files: buckets.mobile.files,
  python_files: buckets.python.files,
  pages,
  api_routes: apiRoutes,
  api_modules: apiModules,
  api_exports: apiExports,
  components,
  error_boundaries: errorBoundaries,
  migration_files: migrationFiles,
  max_migration_number: maxMigrationNumber,
  test_count: testCount,
  test_count_source: testCountSource,
  generated_at: new Date().toISOString(),
}

const outDir = path.join(ROOT, 'lib/infographic')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

// Single-line `//` comments only — block comments are a foot-gun because glob
// patterns like `app/**` close JSDoc blocks early (see feedback memory
// `feedback_jsdoc_block_comment_trap.md`). Keep every doc comment as `//`.
const content = `// AUTO-GENERATED by scripts/generate-codebase-stats.mjs — DO NOT EDIT.
// Regenerated on every postinstall / dev / build. Gitignored.
// If you see stale numbers, run \`npm run generate-stats\`.

export interface CodebaseStats {
  // Inclusive "everything built for MicroGRID" line count —
  // web app + tests + mobile companion + scripts + SQL migrations + Python tools.
  loc_total: number
  // TS/TSX lines in app + lib + components + types + hooks (the Next.js web app only).
  loc_web_app: number
  // TS/TSX lines under the tests directory.
  loc_tests: number
  // TS/TSX lines in the mobile companion Expo app (the mobile root dir).
  loc_mobile: number
  // TS/JS lines in scripts (data tools, migrations, one-shot utilities).
  loc_scripts: number
  // SQL lines across all migration files.
  loc_sql: number
  // Python lines (NetSuite import, SharePoint audit, drive walkers, etc.).
  loc_python: number
  // Everything else TS/JS that does not fit above (root configs, e2e, etc.).
  loc_other: number
  // Total files counted across every bucket.
  source_files: number
  // Web app source file count only.
  app_source_files: number
  // Count of .test.ts and .test.tsx files under the tests directory.
  test_files: number
  // Count of TS/TSX files in the mobile companion app.
  mobile_files: number
  // Count of .py files anywhere in the repo.
  python_files: number
  // Count of page.tsx files anywhere under app (Next.js App Router pages).
  pages: number
  // Count of route.ts handlers anywhere under app (Next.js API routes).
  api_routes: number
  // Count of .ts modules in lib/api (excludes index.ts).
  api_modules: number
  // Total \`export\` declarations across lib/api modules.
  api_exports: number
  // Count of .tsx files anywhere under components.
  components: number
  // Count of error.tsx boundaries anywhere under app.
  error_boundaries: number
  // Count of .sql files anywhere under supabase.
  migration_files: number
  // Highest numbered migration — e.g. 107 for 107-warranty-claims-funding-deductions.sql.
  max_migration_number: number
  // Test count from vitest JSON reporter, or heuristic grep fallback.
  test_count: number
  // 'vitest' if the suite was run successfully at generate time, 'heuristic' otherwise.
  test_count_source: 'vitest' | 'heuristic'
  // ISO timestamp of when this file was last generated.
  generated_at: string
}

export const CODEBASE_STATS: CodebaseStats = ${JSON.stringify(stats, null, 2)}
`

fs.writeFileSync(path.join(outDir, 'codebase-stats.ts'), content)
console.log(`[generate-codebase-stats] wrote lib/infographic/codebase-stats.ts`)
console.log(`  loc_total=${stats.loc_total.toLocaleString()}  (web=${stats.loc_web_app.toLocaleString()} tests=${stats.loc_tests.toLocaleString()} mobile=${stats.loc_mobile.toLocaleString()} scripts=${stats.loc_scripts.toLocaleString()} sql=${stats.loc_sql.toLocaleString()} py=${stats.loc_python.toLocaleString()} other=${stats.loc_other.toLocaleString()})`)
console.log(`  pages=${stats.pages}  components=${stats.components}  api_modules=${stats.api_modules}  api_exports=${stats.api_exports}`)
console.log(`  tests=${stats.test_count} (${stats.test_count_source})  migrations=${stats.migration_files} (max #${stats.max_migration_number})`)
