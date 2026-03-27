import { Resend } from 'resend'

let _resend: Resend | null = null

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const resend = getResend()
  if (!resend) {
    console.log('[email] RESEND_API_KEY not set, skipping')
    return true
  }
  try {
    await resend.emails.send({
      from: 'MicroGRID <nova@gomicrogridenergy.com>',
      to,
      subject,
      html,
    })
    return true
  } catch (err) {
    console.error('[email] send failed:', err)
    return false
  }
}
