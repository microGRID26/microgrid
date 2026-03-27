import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'storage-state.json')
const TEST_EMAIL = 'e2e-test@gomicrogridenergy.com'
const TEST_PASSWORD = 'E2E-test-pw-2026!'

export default async function globalSetup() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Ensure test user exists
  const { data: listData } = await supabase.auth.admin.listUsers()
  let testUser = listData?.users?.find((u) => u.email === TEST_EMAIL)

  if (!testUser) {
    console.log('[E2E Setup] Creating test user:', TEST_EMAIL)
    const { data, error } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'E2E Test User' },
    })
    if (error) throw new Error(`Failed to create test user: ${error.message}`)
    testUser = data.user!

    await supabase.from('users').upsert(
      { id: testUser.id, email: TEST_EMAIL, name: 'E2E Test User', role: 'admin', active: true },
      { onConflict: 'id' }
    )
  } else {
    await supabase.auth.admin.updateUserById(testUser.id, { password: TEST_PASSWORD })
  }

  // Sign in to get tokens
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: signInData, error: signInError } =
    await anonClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })

  if (signInError || !signInData.session) {
    throw new Error(`Sign in failed: ${signInError?.message ?? 'no session'}`)
  }

  const session = signInData.session
  const ref = supabaseUrl.match(/https:\/\/(.+?)\.supabase/)?.[1] ?? ''
  const storageKey = `sb-${ref}-auth-token`

  console.log('[E2E Setup] Authenticated as', TEST_EMAIL)

  // Build the session JSON
  const sessionJson = JSON.stringify(session)

  // @supabase/ssr stores the session as base64url-encoded JSON, chunked across cookies
  // But the cookie value itself is the base64url of the ENTIRE session object
  // Let's try URL-encoded JSON directly (some versions use this)
  const encoded = encodeURIComponent(sessionJson)

  // Chunk the encoded value
  const CHUNK_SIZE = 3180
  const chunks: string[] = []
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHUNK_SIZE))
  }

  // Launch browser
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  // Set cookies BEFORE navigating (so they're sent with the first request)
  const cookieEntries = chunks.map((chunk, i) => ({
    name: i === 0 ? storageKey : `${storageKey}.${i}`,
    value: chunk,
    url: 'http://localhost:3000/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }))

  await context.addCookies(cookieEntries)

  // Navigate to login to set localStorage too
  await page.goto('http://localhost:3000/login')
  await page.waitForLoadState('domcontentloaded')

  // Set localStorage with the raw JSON (some Supabase client versions check both)
  await page.evaluate(
    ({ key, val }) => localStorage.setItem(key, val),
    { key: storageKey, val: sessionJson }
  )

  // Now navigate to command to verify
  await page.goto('http://localhost:3000/command')
  await page.waitForTimeout(3000)

  const finalUrl = page.url()
  if (finalUrl.includes('/login')) {
    // Debug: dump what the page sees
    console.warn('[E2E Setup] WARNING: Auth not recognized. Dumping debug info...')
    const cookies = await context.cookies()
    const authCookies = cookies.filter(c => c.name.includes('sb-'))
    console.log(`[E2E Setup] Auth cookies: ${authCookies.length}`)
    authCookies.forEach(c => console.log(`  ${c.name} = ${c.value.slice(0, 30)}...`))

    // Check if there's a server-side middleware redirecting
    const bodyText = await page.textContent('body')
    console.log(`[E2E Setup] Page body: ${bodyText?.slice(0, 200)}`)
  } else {
    console.log('[E2E Setup] Auth verified — loaded /command successfully')
  }

  // Save storage state
  const authDir = path.dirname(STORAGE_STATE_PATH)
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })
  await context.storageState({ path: STORAGE_STATE_PATH })
  console.log('[E2E Setup] Storage state saved')

  await browser.close()
}
