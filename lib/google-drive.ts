// lib/google-drive.ts — Server-side Google Drive API wrapper
// Uses service account credentials from GOOGLE_CALENDAR_CREDENTIALS env var
// (same service account as lib/google-calendar.ts, different scope).
// Scope: https://www.googleapis.com/auth/drive.readonly
// Service account client_email must be granted Reader access on the Shared
// Drive containing project folders for any of these calls to return data.

interface ServiceAccountCredentials {
  client_email: string
  private_key: string
  token_uri: string
}

interface TokenResponse {
  access_token: string
  expires_in: number
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  parents?: string[]
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

let cachedToken: { token: string; expiresAt: number } | null = null

function getCredentials(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_CALENDAR_CREDENTIALS
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    console.error('[google-drive] Failed to parse GOOGLE_CALENDAR_CREDENTIALS')
    return null
  }
}

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const creds = getCredentials()
  if (!creds) return null

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: creds.client_email,
    scope: DRIVE_SCOPE,
    aud: creds.token_uri,
    iat: now,
    exp: now + 3600,
  }
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsignedToken = `${headerB64}.${payloadB64}`

  const pemContents = creds.private_key
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
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(unsignedToken))
    const sigBytes = new Uint8Array(signature)
    let sigStr = ''
    for (let i = 0; i < sigBytes.length; i++) sigStr += String.fromCharCode(sigBytes[i])
    const signatureB64 = btoa(sigStr).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const jwt = `${unsignedToken}.${signatureB64}`

    const tokenRes = await fetch(creds.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '')
      console.error('[google-drive] Token exchange failed:', tokenRes.status, errText)
      return null
    }
    const tokenData: TokenResponse = await tokenRes.json()
    cachedToken = { token: tokenData.access_token, expiresAt: Date.now() + tokenData.expires_in * 1000 }
    return tokenData.access_token
  } catch (err) {
    console.error('[google-drive] JWT signing/token exchange failed:', err)
    return null
  }
}

const DRIVE_TIMEOUT_MS = 15_000

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  if (!token) throw new Error('google-drive: no access token (check GOOGLE_CALENDAR_CREDENTIALS + Drive scope + Shared Drive grant)')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DRIVE_TIMEOUT_MS)
  try {
    return await fetch(`${DRIVE_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * List immediate children of a Drive folder. Supports Shared Drives.
 * Handles pagination internally. Returns up to `maxResults` files.
 */
export async function listFolderChildren(folderId: string, maxResults = 200): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  const pageSize = Math.min(100, maxResults)

  while (files.length < maxResults) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,size,parents)',
      pageSize: String(pageSize),
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      // corpora=allDrives is REQUIRED for service accounts to see Shared Drive
      // contents. Default is corpora=user which only searches the caller's
      // My Drive — and a service account's My Drive is empty, so listings
      // silently return 0 children without this flag.
      corpora: 'allDrives',
    })
    if (pageToken) params.set('pageToken', pageToken)

    try {
      const res = await driveFetch(`/files?${params.toString()}`)
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error('[google-drive] listFolderChildren failed:', res.status, errText)
        return files
      }
      const data = await res.json() as { files?: DriveFile[]; nextPageToken?: string }
      if (data.files) files.push(...data.files)
      if (!data.nextPageToken) break
      pageToken = data.nextPageToken
    } catch (err) {
      console.error('[google-drive] listFolderChildren threw:', err)
      return files
    }
  }
  return files.slice(0, maxResults)
}

/**
 * Find a named subfolder (exact case-insensitive match) inside a parent folder.
 * Returns the folder id, or null if not found.
 */
export async function findSubfolder(parentFolderId: string, name: string): Promise<string | null> {
  const children = await listFolderChildren(parentFolderId, 100)
  const target = name.trim().toLowerCase()
  for (const child of children) {
    if (child.mimeType === 'application/vnd.google-apps.folder' && child.name.trim().toLowerCase() === target) {
      return child.id
    }
  }
  return null
}

/** Get file metadata (for MIME check / size gate before streaming). */
export async function getFileMetadata(fileId: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,parents',
    supportsAllDrives: 'true',
  })
  try {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}?${params.toString()}`)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[google-drive] getFileMetadata failed:', res.status, errText)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error('[google-drive] getFileMetadata threw:', err)
    return null
  }
}

/** Stream raw file bytes. Caller is responsible for MIME/size checks. */
export async function getFileBytes(fileId: string): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  const meta = await getFileMetadata(fileId)
  if (!meta) return null

  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' })
  try {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}?${params.toString()}`)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[google-drive] getFileBytes failed:', res.status, errText)
      return null
    }
    const bytes = await res.arrayBuffer()
    return { bytes, mimeType: meta.mimeType }
  } catch (err) {
    console.error('[google-drive] getFileBytes threw:', err)
    return null
  }
}
