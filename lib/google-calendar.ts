// lib/google-calendar.ts — Server-side Google Calendar API wrapper
// Uses service account credentials from GOOGLE_CALENDAR_CREDENTIALS env var

import { JOB_TYPE_COLOR_ID } from '@/lib/api/calendar'

// ── Types ────────────────────────────────────────────────────────────────────

interface ServiceAccountCredentials {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
  auth_provider_x509_cert_url: string
  client_x509_cert_url: string
}

interface CalendarEvent {
  id?: string
  summary: string
  location?: string
  description?: string
  start: { date?: string; dateTime?: string; timeZone?: string }
  end: { date?: string; dateTime?: string; timeZone?: string }
  colorId?: string
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

// ── Token Cache ──────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCredentials(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_CALENDAR_CREDENTIALS
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    console.error('Failed to parse GOOGLE_CALENDAR_CREDENTIALS')
    return null
  }
}

/** Create a JWT and exchange it for an access token */
async function getAccessToken(): Promise<string | null> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const creds = getCredentials()
  if (!creds) return null

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: creds.token_uri,
    iat: now,
    exp: now + 3600,
  }

  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsignedToken = `${headerB64}.${payloadB64}`

  // Sign the JWT with the private key using Web Crypto API
  const privateKeyPem = creds.private_key
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '')

  try {
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const encoder = new TextEncoder()
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(unsignedToken)
    )

    const sigBytes = new Uint8Array(signature)
    let sigStr = ''
    for (let i = 0; i < sigBytes.length; i++) {
      sigStr += String.fromCharCode(sigBytes[i])
    }
    const signatureB64 = btoa(sigStr)
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    const jwt = `${unsignedToken}.${signatureB64}`

    // Exchange JWT for access token
    const tokenRes = await fetch(creds.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('Token exchange failed:', tokenRes.status, errText)
      return null
    }

    const tokenData: TokenResponse = await tokenRes.json()
    cachedToken = {
      token: tokenData.access_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    }
    return tokenData.access_token
  } catch (err) {
    console.error('JWT signing/token exchange failed:', err)
    return null
  }
}

async function calendarFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  if (!token) throw new Error('No access token available')

  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

// ── Public API ───────────────────────────────────────────────────────────────

export function isGoogleCalendarConfigured(): boolean {
  return !!getCredentials()
}

/** Create a new calendar for a crew. Returns the calendar ID. */
export async function createCalendar(crewName: string): Promise<string | null> {
  try {
    const res = await calendarFetch(`${CALENDAR_API}/calendars`, {
      method: 'POST',
      body: JSON.stringify({
        summary: `MicroGRID - ${crewName}`,
        description: `Crew schedule for ${crewName} — managed by NOVA CRM`,
        timeZone: 'America/Chicago',
      }),
    })
    if (!res.ok) {
      console.error('createCalendar failed:', res.status, await res.text())
      return null
    }
    const data = await res.json()
    return data.id ?? null
  } catch (err) {
    console.error('createCalendar error:', err)
    return null
  }
}

/** Create or update a calendar event. Returns the event ID. */
export async function upsertCalendarEvent(
  calendarId: string,
  eventId: string | null,
  event: {
    title: string
    location?: string | null
    date: string
    endDate?: string | null
    time?: string | null
    description: string
    jobType: string
  }
): Promise<string | null> {
  const colorId = JOB_TYPE_COLOR_ID[event.jobType] ?? '8'

  // Build start/end — use dateTime if time is provided, otherwise all-day
  let start: CalendarEvent['start']
  let end: CalendarEvent['end']

  if (event.time) {
    // Time-specific event
    const startDateTime = `${event.date}T${event.time}:00`
    const endDay = event.endDate ?? event.date
    // Default 2-hour duration for timed events, or use end_date
    const endDateTime = event.endDate
      ? `${endDay}T${event.time}:00`
      : `${event.date}T${String(Math.min(23, parseInt(event.time.split(':')[0]) + 2)).padStart(2, '0')}:${event.time.split(':')[1] ?? '00'}:00`
    start = { dateTime: startDateTime, timeZone: 'America/Chicago' }
    end = { dateTime: endDateTime, timeZone: 'America/Chicago' }
  } else {
    // All-day event
    start = { date: event.date }
    // end date is exclusive in Google Calendar, so add 1 day
    const endDay = event.endDate ?? event.date
    const endDate = new Date(endDay + 'T00:00:00')
    endDate.setDate(endDate.getDate() + 1)
    end = { date: endDate.toISOString().slice(0, 10) }
  }

  const body: CalendarEvent = {
    summary: event.title,
    location: event.location ?? undefined,
    description: event.description,
    start,
    end,
    colorId,
  }

  try {
    if (eventId) {
      // Update existing event
      const res = await calendarFetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        // If 404, event was deleted — create a new one
        if (res.status === 404) {
          return upsertCalendarEvent(calendarId, null, event)
        }
        console.error('updateEvent failed:', res.status, await res.text())
        return null
      }
      const data = await res.json()
      return data.id ?? eventId
    } else {
      // Create new event
      const res = await calendarFetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        console.error('createEvent failed:', res.status, await res.text())
        return null
      }
      const data = await res.json()
      return data.id ?? null
    }
  } catch (err) {
    console.error('upsertCalendarEvent error:', err)
    return null
  }
}

/** Delete a calendar event */
export async function deleteCalendarEvent(calendarId: string, eventId: string): Promise<boolean> {
  try {
    const res = await calendarFetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    })
    // 204 = success, 410 = already gone
    return res.ok || res.status === 410
  } catch (err) {
    console.error('deleteCalendarEvent error:', err)
    return false
  }
}

/** List events from a calendar within a date range */
export async function listCalendarEvents(
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  try {
    const params = new URLSearchParams({
      timeMin: `${timeMin}T00:00:00Z`,
      timeMax: `${timeMax}T23:59:59Z`,
      maxResults: '500',
      singleEvents: 'true',
      orderBy: 'startTime',
    })
    const res = await calendarFetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
    if (!res.ok) {
      console.error('listEvents failed:', res.status, await res.text())
      return []
    }
    const data = await res.json()
    return data.items ?? []
  } catch (err) {
    console.error('listCalendarEvents error:', err)
    return []
  }
}

/** Set up a webhook watch on a calendar for push notifications */
export async function watchCalendar(
  calendarId: string,
  webhookUrl: string,
  channelId: string,
  token: string
): Promise<{ resourceId: string; expiration: string } | null> {
  try {
    const res = await calendarFetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST',
      body: JSON.stringify({
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token,
        params: {
          ttl: '604800', // 7 days
        },
      }),
    })
    if (!res.ok) {
      console.error('watchCalendar failed:', res.status, await res.text())
      return null
    }
    const data = await res.json()
    return {
      resourceId: data.resourceId,
      expiration: data.expiration,
    }
  } catch (err) {
    console.error('watchCalendar error:', err)
    return null
  }
}

/** Stop a watch channel */
export async function stopWatch(channelId: string, resourceId: string): Promise<boolean> {
  try {
    const res = await calendarFetch(`${CALENDAR_API}/channels/stop`, {
      method: 'POST',
      body: JSON.stringify({ id: channelId, resourceId }),
    })
    return res.ok
  } catch (err) {
    console.error('stopWatch error:', err)
    return false
  }
}

// ── Job type labels for event formatting ─────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  survey: 'SURVEY',
  install: 'INSTALL',
  inspection: 'INSPECTION',
  service: 'SERVICE',
}

/** Build a calendar event title from schedule data */
export function buildEventTitle(jobType: string, projectName: string, projectId: string): string {
  const label = JOB_LABELS[jobType] ?? jobType.toUpperCase()
  return `[${label}] ${projectName} - ${projectId}`
}

/** Build event description with link back to CRM */
export function buildEventDescription(opts: {
  jobType: string
  crewName: string
  notes: string | null
  projectId: string
  appUrl?: string
}): string {
  const appUrl = opts.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://nova.gomicrogridenergy.com'
  const lines = [
    `Job Type: ${JOB_LABELS[opts.jobType] ?? opts.jobType}`,
    `Crew: ${opts.crewName}`,
  ]
  if (opts.notes) lines.push(`Notes: ${opts.notes}`)
  lines.push('')
  lines.push(`NOVA CRM: ${appUrl}/pipeline?open=${opts.projectId}&tab=info`)
  return lines.join('\n')
}
