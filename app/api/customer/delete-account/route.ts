import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/customer/delete-account
 *
 * Customer-initiated account deletion. Required by Apple App Store guideline 5.1.1(v):
 * any app supporting account creation must support in-app account deletion.
 *
 * Auth: Supabase session — cookie-based (web) or Bearer token (mobile).
 *
 * Behavior:
 * 1. Validates the caller is signed in
 * 2. Resolves the customer's customer_accounts row (auth_user_id, name, project_id)
 * 3. Collects storage paths to clean up: ticket-attachments via ticket_comments
 *    (matching the 223+224 trigger's scope) + customer-feedback via
 *    customer_feedback_attachments
 * 4. Deletes the customer_accounts row by auth_user_id
 *    → BEFORE DELETE trigger (migration 223+224) scrubs PII text fields in
 *      customer_messages, ticket_comments, tickets (retained for warranty/legal)
 *    → FK CASCADE removes: customer_feedback, customer_feedback_attachments
 *      (other "cascade" tables in the prior comment didn't actually cascade —
 *      tracked as #507)
 * 5. Removes the collected storage objects (best-effort; orphan files become
 *    a janitor concern, never block the response — customer's DB rows are
 *    already gone). Closes #491's storage-side complement (#505).
 * 6. Deletes the auth.users row via admin API
 * 7. Returns 200
 *
 * Does NOT touch: projects, work_orders, contracts, or any underlying solar
 * installation business records. customer_messages / tickets / ticket_comments
 * are retained but their PII text fields are scrubbed in-place by the
 * customer_accounts BEFORE DELETE trigger. Disclosed in /privacy. Apple's
 * 5.1.1(v) explicitly permits retention for legitimate operational and legal
 * reasons; the scrub closes the GDPR/CCPA right-to-erasure gap on PII text.
 *
 * Rate limited: 3 attempts per hour per user (prevents loops + abuse).
 */
export async function POST(request: NextRequest) {
  // ── Auth (cookie OR Bearer token) ──────────────────────────────────────
  const bearerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  const cookieStore = await cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    },
  )

  let user = null
  if (bearerToken) {
    const { data } = await supabaseAuth.auth.getUser(bearerToken)
    user = data?.user ?? null
  } else {
    const { data } = await supabaseAuth.auth.getUser()
    user = data?.user ?? null
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  const { success: withinLimit } = await rateLimit(`delete-account:${user.id}`, {
    windowMs: 60 * 60_000, // 1 hour
    max: 3,
    prefix: 'delete-account',
  })
  if (!withinLimit) {
    return NextResponse.json(
      { error: 'Too many delete attempts. Please contact support.' },
      { status: 429 },
    )
  }

  // ── Service role client (bypasses RLS, has auth.admin) ─────────────────
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('[delete-account] SUPABASE_SECRET_KEY not configured')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  // ── Resolve the account so we can scope storage cleanup ────────────────
  // Need (name, project_id) to match the BEFORE DELETE trigger's scrub
  // scope on ticket_comments. If the account doesn't exist (already
  // deleted by a prior call or admin tooling), proceed straight to the
  // auth.users delete — the trigger has no work to do and storage may
  // already be orphaned.
  const { data: account } = await admin
    .from('customer_accounts')
    .select('id, name, project_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // ── Collect storage paths BEFORE the delete fires the scrub trigger ────
  // The trigger nulls ticket_comments.image_path when it scrubs, so we
  // have to read these before the cascade. customer_feedback_attachments
  // get cascade-deleted on customer_accounts delete; we read the file
  // paths first because the rows are gone post-cascade.
  let ticketImagePaths: string[] = []
  let feedbackFilePaths: string[] = []

  if (account) {
    // ticket-attachments — match the trigger's exact scope:
    //   is_internal=false AND
    //   (author_id = auth_user_id OR (author_id IS NULL AND author = name AND ticket.project_id = OLD.project_id))
    // Two-step on the legacy branch (NOT PostgREST embedded filter):
    // first resolve ticket_ids in this customer's project, then filter
    // comments by `ticket_id IN (...)`. The embedded-filter shape can
    // (in some PostgREST versions) leak comments from sibling projects
    // when only the embedded resource is filtered but the parent row
    // isn't constrained — that's a cross-tenant wipe vector. Two-step
    // sidesteps the question entirely.
    const projectTicketsRes = await admin
      .from('tickets')
      .select('id')
      .eq('project_id', account.project_id)
    const projectTicketIds = ((projectTicketsRes.data ?? []) as Array<{ id: string }>).map((t) => t.id)

    const byAuthorIdReq = admin
      .from('ticket_comments')
      .select('image_path')
      .eq('is_internal', false)
      .eq('author_id', user.id)
      .not('image_path', 'is', null)

    const byNameLegacyReq = projectTicketIds.length > 0
      ? admin
          .from('ticket_comments')
          .select('image_path')
          .eq('is_internal', false)
          .is('author_id', null)
          .eq('author', account.name)
          .in('ticket_id', projectTicketIds)
          .not('image_path', 'is', null)
      : Promise.resolve({ data: [] as Array<{ image_path: string | null }> })

    const [byAuthorId, byNameLegacy] = await Promise.all([byAuthorIdReq, byNameLegacyReq])

    const set = new Set<string>()
    for (const row of (byAuthorId.data ?? []) as Array<{ image_path: string | null }>) {
      if (row.image_path) set.add(row.image_path)
    }
    for (const row of (byNameLegacy.data ?? []) as Array<{ image_path: string | null }>) {
      if (row.image_path) set.add(row.image_path)
    }
    ticketImagePaths = [...set]

    // customer-feedback — file_path on attachments belonging to feedback
    // rows owned by this customer. customer_account_id is the canonical
    // FK to customer_accounts.id (submitted_by_user_id has no FK declared
    // and is sparsely populated; not a reliable scoping key).
    const { data: feedbackRows } = await admin
      .from('customer_feedback')
      .select('id')
      .eq('customer_account_id', account.id)
    const feedbackIds = (feedbackRows ?? []).map((r) => (r as { id: string }).id)
    if (feedbackIds.length > 0) {
      const { data: attachmentRows } = await admin
        .from('customer_feedback_attachments')
        .select('file_path')
        .in('feedback_id', feedbackIds)
        .not('file_path', 'is', null)
      feedbackFilePaths = ((attachmentRows ?? []) as Array<{ file_path: string | null }>)
        .map((r) => r.file_path)
        .filter((p): p is string => !!p)
    }
  }

  // ── Delete customer_accounts row (BEFORE DELETE trigger scrubs PII; ───
  //    FK CASCADE removes feedback rows; storage objects are now orphans)
  const { error: deleteAccountError } = await admin
    .from('customer_accounts')
    .delete()
    .eq('auth_user_id', user.id)

  if (deleteAccountError) {
    console.error('[delete-account] customer_accounts delete failed:', deleteAccountError.message)
    return NextResponse.json({ error: 'Failed to delete account data' }, { status: 500 })
  }

  // ── Storage cleanup (best-effort; never blocks response) ──────────────
  // The DB rows pointing at these objects are already gone (or scrubbed
  // for ticket_comments). If storage.remove fails for any reason —
  // network, partial failure, RLS — the file becomes an orphan that a
  // future janitor cron can sweep. Customer's right-to-erasure on the
  // immediately-visible surfaces is satisfied.
  if (ticketImagePaths.length > 0) {
    const { error: rmErr } = await admin.storage
      .from('ticket-attachments')
      .remove(ticketImagePaths)
    if (rmErr) {
      console.error('[delete-account] ticket-attachments cleanup failed:', rmErr.message, 'paths:', ticketImagePaths.length)
    }
  }
  if (feedbackFilePaths.length > 0) {
    const { error: rmErr } = await admin.storage
      .from('customer-feedback')
      .remove(feedbackFilePaths)
    if (rmErr) {
      console.error('[delete-account] customer-feedback cleanup failed:', rmErr.message, 'paths:', feedbackFilePaths.length)
    }
  }

  // ── Delete auth.users row ──────────────────────────────────────────────
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteUserError) {
    console.error('[delete-account] auth.users delete failed:', deleteUserError.message)
    // Customer data is already gone — return success so the user isn't stuck.
    // Any orphaned auth.users row can be cleaned up manually.
    return NextResponse.json({
      ok: true,
      warning: 'Account data deleted; auth removal pending',
    })
  }

  return NextResponse.json({ ok: true })
}
