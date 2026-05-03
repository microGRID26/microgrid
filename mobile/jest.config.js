// Phase 2 of the unified-app plan: regression-pinning baseline. Goal isn't
// 100% coverage — it's catching breakage on load-bearing data fetches in
// lib/api.ts, the auth flow, and push-token registration.
//
// Uses jest-expo preset which handles the RN module mocks (FileSystem,
// SecureStore, etc.) so individual tests don't need to.

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts', '<rootDir>/__tests__/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-native-community|expo-modules-core|@sentry/.*|lucide-react-native)',
  ],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'lib/**/*.tsx',
    '!lib/types.ts',
    '!**/*.d.ts',
  ],
  moduleNameMapper: {
    // Stub binary assets that Jest can't load
    '\\.(png|jpg|jpeg|svg)$': '<rootDir>/__tests__/__mocks__/fileMock.js',
    // Stub Expo's winter runtime polyfills — jest-expo 54's setup.js loads
    // them via `require('expo/src/winter')` and Jest 30's stricter scope
    // check breaks the lazy __ExpoImportMetaRegistry chain. None of those
    // polyfills are needed by unit tests (Node 18+ has URL/structuredClone).
    '^expo/src/winter$': '<rootDir>/__tests__/__mocks__/expoWinter.js',
    '^expo/src/winter/runtime$': '<rootDir>/__tests__/__mocks__/expoWinter.js',
    '^expo/src/winter/runtime\\.native$': '<rootDir>/__tests__/__mocks__/expoWinter.js',
  },
}
