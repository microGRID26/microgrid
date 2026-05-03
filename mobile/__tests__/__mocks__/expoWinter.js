// Stub for `expo/src/winter` and its runtime variants.
//
// jest-expo 54's preset (node_modules/jest-expo/src/preset/setup.js) does
// `require('expo/src/winter')` to install Expo's runtime polyfills (URL,
// URLSearchParams, FormData patch, structuredClone, __ExpoImportMetaRegistry).
// Under Jest 30 the lazy-require chain for __ExpoImportMetaRegistry trips
// jest-runtime's scope check and the whole suite fails to load.
//
// None of the polyfills installed by `expo/src/winter` are needed by our
// unit tests:
// - URL / URLSearchParams already exist in Node 18+
// - structuredClone exists in Node 17+
// - FormData is mocked per-test where used
// - __ExpoImportMetaRegistry is only consumed by `import.meta` syntax
//   (we don't use it)
//
// Stubbing here keeps the preset working without forking jest-expo.

globalThis.__ExpoImportMetaRegistry = globalThis.__ExpoImportMetaRegistry ?? {
  url: 'jest://test',
  resolve: () => 'jest://test',
}

module.exports = {}
