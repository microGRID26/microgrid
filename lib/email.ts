import { Resend } from 'resend'

let _resend: Resend | null = null

function getResend(): Resend | null {
  const key = (process.env.RESEND_API_KEY ?? '').trim()
  if (!key) return null
  if (!_resend) _resend = new Resend(key)
  return _resend
}

export type EmailResult = 'sent' | 'skipped_dev' | 'failed'

/**
 * Returns the actual outcome so callers can record audit truth — the legacy boolean
 * shape returned `true` even when the API key was missing in production, which made
 * audit logs lie. Use this for any path that records a `notified_at` timestamp.
 */
export async function sendEmailDetailed(to: string, subject: string, html: string): Promise<EmailResult> {
  const resend = getResend()
  if (!resend) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[email] RESEND_API_KEY missing in production — returning failed')
      return 'failed'
    }
    console.log('[email] RESEND_API_KEY not set, skipping (dev/test)')
    return 'skipped_dev'
  }
  try {
    await resend.emails.send({
      from: (process.env.RESEND_FROM_EMAIL ?? 'MicroGRID <nova@gomicrogridenergy.com>').trim(),
      to,
      subject,
      html,
    })
    return 'sent'
  } catch (err) {
    console.error('[email] send failed:', err)
    return 'failed'
  }
}

/** Back-compat boolean shim. Kept so legacy callers compile; new code should use
 *  `sendEmailDetailed` so the audit log can distinguish skipped from sent. */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const r = await sendEmailDetailed(to, subject, html)
  return r === 'sent' || r === 'skipped_dev'
}
