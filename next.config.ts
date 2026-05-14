import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Externalize heavy native deps from the Vercel lambda bundle. The
  // chromium binary from @sparticuz/chromium is ~50-60MB and must NOT
  // be bundled by webpack — it's loaded from the runtime filesystem at
  // request time. puppeteer-core depends on chromium; pdf-lib has
  // a CommonJS-only dependency tree (pako). Listing them here keeps
  // them outside the Next 16 client/server bundlers.
  // Closes greg_actions #332 (planset full-PDF server route).
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', 'pdf-lib'],

  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        // CSP: unsafe-inline required for Next.js inline styles; unsafe-eval only in dev (hot reload).
        // Production builds on Vercel set NODE_ENV=production, removing unsafe-eval.
        { key: 'Content-Security-Policy', value: [
          "default-src 'self'",
          `script-src 'self' 'unsafe-inline' https://*.i.posthog.com${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob: https://*.supabase.co https://unpkg.com https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://*.i.posthog.com",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://exp.host https://api.anthropic.com https://api.zippopotam.us https://*.basemaps.cartocdn.com https://*.i.posthog.com https://*.posthog.com",
          "worker-src 'self' blob:",
          "frame-src 'self'",
          "frame-ancestors 'self'",
          "object-src 'none'",
          "base-uri 'self'",
        ].join('; ') },
      ],
    }]
  },
};

export default withSentryConfig(nextConfig, {
  // Suppresses Sentry SDK build logs
  silent: true,
  // Disable source map upload until Sentry org/project/auth token are configured
  sourcemaps: {
    disable: true,
  },
});
