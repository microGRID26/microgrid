import { defineConfig } from 'vitest/config'
import path from 'path'

// Sister config to vitest.eval.config.ts. Runs the integration test
// subtree — real Supabase client + real PostgREST + real DB. Distinct
// from the default `npm test` suite which mocks @/lib/supabase/* in
// vitest.setup.ts (this config does NOT load that setup, so the mock
// doesn't fire).
//
// Tests under __tests__/integration/ MUST import @supabase/supabase-js
// directly (via __tests__/integration/clients.ts) rather than the
// @/lib/supabase/* aliases — that way even if a future global mock
// expansion catches more paths, the integration suite stays on real
// network.

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['__tests__/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'mobile/**', 'e2e/**', 'evals/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./__tests__/integration/setup.ts'],
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
