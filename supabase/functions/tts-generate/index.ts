// Supabase Edge Function: tts-generate
//
// Phase 4 Sprint 0.4 — Atlas-reads-the-concept TTS.
//
// Auth: requires a valid Supabase JWT (authenticated user). Anonymous calls
//   are rejected. Service-role calls allowed for admin retry tooling.
//
// Input (JSON body): { kind: 'concept' | 'flashcard', slug?: string, text?: string, voice?: string }
//   - concept: looks up the concept by `slug` and assembles the full-page
//     read (intro + cfo_explanation + sections + skeptic_qa + where_in_atlas).
//   - flashcard: caller passes the `text` directly (term + simple + example
//     joined client-side). Slug is the flashcard id for cache keying.
//   - voice defaults to 'nova' (warm female narrator, OpenAI TTS-HD).
//
// Flow:
//   1. Verify JWT (Supabase auth).
//   2. Compute deterministic cache key: sha256(text + ':' + voice).
//   3. If cache hit in Storage bucket tts-cache → return public URL.
//   4. Else call OpenAI TTS-HD with `nova` voice, MP3 output.
//   5. Upload to Storage at cache key, return public URL.
//
// Cost discipline: cache is content-addressed so identical text reuses the
// audio across users and re-reads. ~$8.50 first-pass for all 36 concepts;
// ~$0/month for replays. Storage charge is ~$0.006/month for all audio.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'tts-cache'
const DEFAULT_VOICE = 'nova'
const MODEL = 'tts-1-hd'

type TtsRequest = {
  kind: 'concept' | 'flashcard'
  slug?: string
  text?: string
  voice?: string
}

type TtsResponse = {
  audio_url: string
  cache_hit: boolean
  duration_estimate_s: number
  text_length: number
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function assembleConceptText(c: {
  title: string
  subtitle: string
  intro: string
  cfo_explanation: string
  sections: Array<{ heading: string; body: string }>
  skeptic_qa: Array<{ q?: string; question?: string; a?: string; answer?: string }>
  where_in_atlas: Array<{ title: string; detail: string }>
}): string {
  // Read order: title → subtitle → intro → CFO → each section → Q&As → atlas
  // tiebacks. Light prosaic glue between blocks so the read flows.
  const parts: string[] = []
  parts.push(c.title + '.')
  if (c.subtitle) parts.push(c.subtitle + '.')
  parts.push('')  // pause
  parts.push(c.intro)
  parts.push('')
  parts.push('In plain English, for a non-engineer audience.')
  parts.push(c.cfo_explanation)
  parts.push('')
  for (const s of c.sections ?? []) {
    parts.push(s.heading + '.')
    parts.push(s.body)
    parts.push('')
  }
  if ((c.skeptic_qa ?? []).length > 0) {
    parts.push('Common skepticism, answered.')
    for (const qa of c.skeptic_qa) {
      const q = qa.q ?? qa.question ?? ''
      const a = qa.a ?? qa.answer ?? ''
      parts.push('Question. ' + q)
      parts.push(a)
      parts.push('')
    }
  }
  if ((c.where_in_atlas ?? []).length > 0) {
    parts.push('Where this shows up in your stack.')
    for (const w of c.where_in_atlas) {
      parts.push(w.title + '.')
      parts.push(w.detail)
      parts.push('')
    }
  }
  return parts.join('\n').trim()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!OPENAI_API_KEY) return jsonResponse({ error: 'openai_key_missing' }, 500)

  // Auth check via Supabase JWT.
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return jsonResponse({ error: 'unauthorized' }, 401)

  // Parse body.
  let body: TtsRequest
  try { body = await req.json() } catch { return jsonResponse({ error: 'invalid_json' }, 400) }

  const kind = body.kind
  const voice = body.voice ?? DEFAULT_VOICE
  if (kind !== 'concept' && kind !== 'flashcard') {
    return jsonResponse({ error: 'invalid_kind' }, 400)
  }

  // Resolve text.
  let text = ''
  let cacheNamespace = ''
  if (kind === 'concept') {
    if (!body.slug) return jsonResponse({ error: 'slug_required' }, 400)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data: concept, error: cErr } = await admin
      .from('learn_concepts')
      .select('title, subtitle, intro, cfo_explanation, sections, skeptic_qa, where_in_atlas')
      .eq('slug', body.slug)
      .maybeSingle()
    if (cErr || !concept) return jsonResponse({ error: 'concept_not_found' }, 404)
    text = assembleConceptText(concept as Parameters<typeof assembleConceptText>[0])
    cacheNamespace = 'concept/' + body.slug
  } else {
    if (!body.text) return jsonResponse({ error: 'text_required' }, 400)
    text = body.text.trim()
    cacheNamespace = 'flashcard/' + (body.slug ?? 'anon')
  }

  if (text.length === 0) return jsonResponse({ error: 'empty_text' }, 400)
  if (text.length > 50000) return jsonResponse({ error: 'text_too_long' }, 400)

  // Content-addressed cache key.
  const hash = await sha256Hex(text + ':' + voice + ':' + MODEL)
  const objectPath = cacheNamespace + '/' + hash + '.mp3'

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Cache check.
  const { data: existing } = await admin.storage.from(BUCKET).list(cacheNamespace, {
    search: hash,
    limit: 1,
  })
  if (existing && existing.length > 0) {
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath)
    return jsonResponse({
      audio_url: pub.publicUrl,
      cache_hit: true,
      duration_estimate_s: Math.round((text.length / 1000) * 11),  // ~11 sec per 1000 chars at nova HD
      text_length: text.length,
    } as TtsResponse)
  }

  // Cache miss — call OpenAI TTS.
  const oaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice,
      input: text,
      response_format: 'mp3',
    }),
  })

  if (!oaiRes.ok) {
    const errText = await oaiRes.text()
    console.error('[tts-generate] OpenAI error', oaiRes.status, errText.slice(0, 200))
    return jsonResponse({ error: 'openai_failed', status: oaiRes.status }, 502)
  }

  const audioBytes = new Uint8Array(await oaiRes.arrayBuffer())

  // Upload to Storage.
  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, audioBytes, {
    contentType: 'audio/mpeg',
    upsert: true,
  })
  if (upErr) {
    console.error('[tts-generate] storage upload failed', upErr.message)
    return jsonResponse({ error: 'storage_upload_failed' }, 500)
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath)
  return jsonResponse({
    audio_url: pub.publicUrl,
    cache_hit: false,
    duration_estimate_s: Math.round((text.length / 1000) * 11),
    text_length: text.length,
  } as TtsResponse)
})
