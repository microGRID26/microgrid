import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    exclude: ['e2e/**', 'node_modules/**', 'mobile/**', '__tests__/integration/**'],
    css: false,
    alias: {
      '@': path.resolve(__dirname, '.'),
      // 'server-only' is a build-time guard; stub it out in the test environment
      'server-only': path.resolve(__dirname, '__tests__/__mocks__/server-only.ts'),
    },
  },
})
