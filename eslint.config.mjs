import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // All pages use useCallback+useEffect for data fetching on mount.
      // The rule flags async setState as cascading renders, but these are
      // intentional fetch-then-set patterns, not synchronous cascades.
      "react-hooks/set-state-in-effect": "off",
      // Phase 7b — server-only gate on the v2 SLD PDF renderer.
      // renderSldToPdf pulls in jsdom + jsPDF + svg2pdf.js + the native
      // `canvas` package (~5 MB). Importing from a Client Component leaks
      // the chain into the client bundle and crashes at runtime when
      // `window`/`document` are mid-swap under the render mutex. The
      // exemption block below allows the route handler, the verification
      // harnesses, the test file, and the module itself.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/sld-v2/pdf",
              message:
                "renderSldToPdf is server-only. Import it from app/api/sld/v2/[projectId]/route.ts only; importing here drags jsdom + jsPDF + svg2pdf.js + native canvas into the client bundle.",
            },
            {
              name: "./pdf",
              message:
                "renderSldToPdf is server-only. Sibling relative imports from lib/sld-v2/* bypass the absolute-path patterns; use the exempt route handler instead.",
            },
            {
              name: "../pdf",
              message:
                "renderSldToPdf is server-only. Parent relative imports bypass the absolute-path patterns; use the exempt route handler instead.",
            },
          ],
          patterns: [
            {
              group: ["**/lib/sld-v2/pdf", "**/lib/sld-v2/pdf.ts"],
              message:
                "renderSldToPdf is server-only. Import it from app/api/sld/v2/[projectId]/route.ts only; importing here drags jsdom + jsPDF + svg2pdf.js + native canvas into the client bundle.",
            },
          ],
        },
      ],
    },
  },
  // Phase 7b — exemption block for renderSldToPdf legitimate callers.
  // Must come AFTER the rule-setting block so it overrides for matched
  // files. Anything else importing the PDF module fails the build.
  {
    files: [
      "app/api/sld/v2/**/route.ts",
      "lib/sld-v2/pdf.ts",
      "scripts/render-sld-v2-pdf.tsx",
      "scripts/sld-v2-pdf-concurrency-smoke.tsx",
      // Cumulative R1 H2 fix — title-block.test.ts (Phase 7b) and
      // pdf.test.ts both exercise renderSldToPdf via the full pipeline.
      // Test files exempting one but not the other broke `npm run lint`
      // silently. Keep both listed explicitly so future test additions
      // surface the gap as a lint error, not a missing exemption.
      "__tests__/sld-v2/pdf.test.ts",
      "__tests__/sld-v2/title-block.test.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
