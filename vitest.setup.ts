import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock Supabase client globally
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => mockSupabase,
}))

// Shared mock Supabase instance
export const mockSupabase = createMockSupabase()

export function createMockSupabase() {
  const chainable = () => {
    const chain: any = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      upsert: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      ilike: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      or: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: vi.fn((cb: any) => Promise.resolve({ data: [], error: null }).then(cb)),
      // Allow awaiting the chain directly
      [Symbol.for('nodejs.util.inspect.custom')]: () => 'SupabaseMockChain',
    }
    // Make the chain thenable so `await supabase.from(...).select(...)` works
    const thenableFn = vi.fn(() => chain)
    Object.assign(thenableFn, chain)
    return chain
  }

  return {
    from: vi.fn((_table: string) => chainable()),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getUser: vi.fn((): Promise<{ data: { user: any }; error: any }> => Promise.resolve({ data: { user: { email: 'test@gomicrogridenergy.com', user_metadata: { full_name: 'Test User' } } }, error: null })),
      signInWithOAuth: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      exchangeCodeForSession: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  }
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
// Some test files opt into `node` env (e.g. sld-v2/pdf.test.ts) — guard the
// jsdom-only globals so the setup file imports cleanly under both envs.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: localStorageMock })
}

// Mock URL.createObjectURL / revokeObjectURL (for CSV export)
if (typeof URL !== 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
}
