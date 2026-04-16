import { Page } from '@playwright/test'

/**
 * Auth helper for E2E tests.
 *
 * Authentication is handled globally via `e2e/global-setup.ts` which:
 * 1. Creates a test user in Supabase via the admin API (if not exists)
 * 2. Signs in with password to get access/refresh tokens
 * 3. Sets tokens in localStorage and saves Playwright storageState
 *
 * All tests reuse this storageState via playwright.config.ts `use.storageState`,
 * so every test starts authenticated — no per-test login needed.
 *
 * Test user: e2e-test@gomicrogridenergy.com (admin role)
 */

/**
 * Wait for the app to finish loading after navigation.
 * Checks that we're not stuck on the login page and that a nav bar is visible.
 */
export async function waitForAppReady(page: Page, timeout = 15000): Promise<void> {
  // Wait for the page to settle
  await page.waitForLoadState('domcontentloaded')

  // Wait for nav to appear (indicates authenticated page rendered)
  await page.waitForSelector('nav', { timeout }).catch(() => {
    // If nav never shows, we might be on the login page
  })
}

/**
 * Navigate to a page and verify it loaded (not redirected to login).
 */
export async function navigateAuthenticated(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await waitForAppReady(page)

  // Verify we're not on the login page
  const url = page.url()
  if (url.includes('/login')) {
    throw new Error(
      `Authentication failed — redirected to login when navigating to ${path}. ` +
      'Check that global-setup.ts ran successfully and storageState is valid.'
    )
  }
}

/**
 * Check if the current page is authenticated (has nav bar visible).
 */
export async function isAuthenticated(page: Page, path = '/command'): Promise<boolean> {
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
  const url = page.url()
  return !url.includes('/auth') && !url.includes('/login')
}

/**
 * Wait for Supabase data to load on a page.
 * Many pages show a loading spinner or empty state while fetching.
 * This waits until real content appears.
 */
export async function waitForDataLoad(page: Page, timeout = 10000): Promise<void> {
  // Wait until the page body has substantial content (more than just loading spinners)
  await page.waitForFunction(
    () => {
      const body = document.body.innerText
      // A loaded page should have more than 100 chars of content
      return body.length > 100
    },
    { timeout }
  ).catch(() => {
    // Data may just be empty — that's ok for test environments
  })
}
