// Supabase Edge Function: tts-generate (parallel chunked, v7 deployed)
//
// Phase 4 Sprint 0.4 — Atlas-reads-the-concept TTS.
//
// Path Greg's first listen took to get here:
//   v1: initial, hit OpenAI scope error (key was project-scoped, no audio).
//   v2-4: same key swap loop while Greg got billing + scope sorted.
//   v5: debug — surfaced openai_body in response so we could see the real error.
//   v6: chunking (sequential) — OpenAI TTS caps input at 4096 chars; full-page
//       concept reads are 5-8K chars and have to split.
//   v7 (this): parallel chunks via Promise.all so total wall time = slowest
//       chunk (~30s) instead of sum (~60s+). Critical for staying under
//       supabase.functions.invoke client timeouts.
//
// Auth: requires a valid Supabase JWT (authenticated user).
//
// Input (JSON body): { kind: 'concept' | 'flashcard', slug?: string, text?: string, voice?: string }
//   - concept: looks up the concept by `slug` and assembles the full-page read
//     (intro + cfo_explanation + sections + skeptic_qa + where_in_atlas).
//   - flashcard: caller passes `text` directly (term + simple + example).
//   - voice defaults to 'nova' (warm female narrator, OpenAI TTS-HD).
//
// Flow: JWT verify → sha256 cache key on (text + voice + model) → cache hit?
// return URL : split into chunks ≤4000 chars → Promise.all(synth each) →
// concat MP3 bytes → upload to Storage → return public URL.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'tts-cache'
const DEFAULT_VOICE = 'nova'
const MODEL = 'tts-1-hd'
const CHUNK_MAX = 4000

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
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  const paragraphs = text.split(/\n{2,}/)
  let current = ''
  for (const p of paragraphs) {
    if (p.length === 0) continue
    if ((current + (current ? '\n\n' : '') + p).length <= maxLen) {
      current = current ? current + '\n\n' + p : p
      continue
    }
    if (current) { chunks.push(current); current = '' }
    if (p.length <= maxLen) { current = p }
    else {
      const sentences = p.split(/(?<=[.!?])\s+/)
      let sub = ''
      for (const s of sentences) {
        if ((sub + (sub ? ' ' : '') + s).length <= maxLen) {
          sub = sub ? sub + ' ' + s : s
        } else {
          if (sub) chunks.push(sub)
          if (s.length > maxLen) {
            for (let i = 0; i < s.length; i += maxLen) chunks.push(s.slice(i, i + maxLen))
            sub = ''
          } else { sub = s }
        }
      }
      if (sub) current = sub
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function assembleConceptText(c: any): string {
  const parts: string[] = []
  parts.push(c.title + '.')
  if (c.subtitle) parts.push(c.subtitle + '.')
  parts.push('')
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

async function synthChunkImpl(text: string, voice: string, index: number): Promise<{ ok: true; bytes: Uint8Array; index: number } | { ok: false; status: number; body: string; index: number }> {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, voice, input: text, response_format: 'mp3' }),
  })
  if (!r.ok) {
    const body = await r.text()
    return { ok: false, status: r.status, body: body.slice(0, 800), index }
  }
  const bytes = new Uint8Array(await r.arrayBuffer())
  return { ok: true, bytes, index }
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!OPENAI_API_KEY) return jsonResponse({ error: 'openai_key_missing' }, 500)

  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: any
  try { body = await req.json() } catch { return jsonResponse({ error: 'invalid_json' }, 400) }

  const kind = body.kind
  const voice = body.voice ?? DEFAULT_VOICE
  if (kind !== 'concept' && kind !== 'flashcard') return jsonResponse({ error: 'invalid_kind' }, 400)

  let text = ''
  let cacheNamespace = ''
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  if (kind === 'concept') {
    if (!body.slug) return jsonResponse({ error: 'slug_required' }, 400)
    const { data: concept, error: cErr } = await admin
      .from('learn_concepts')
      .select('title, subtitle, intro, cfo_explanation, sections, skeptic_qa, where_in_atlas')
      .eq('slug', body.slug)
      .maybeSingle()
    if (cErr || !concept) return jsonResponse({ error: 'concept_not_found' }, 404)
    text = assembleConceptText(concept)
    cacheNamespace = 'concept/' + body.slug
  } else {
    if (!body.text) return jsonResponse({ error: 'text_required' }, 400)
    text = body.text.trim()
    cacheNamespace = 'flashcard/' + (body.slug ?? 'anon')
  }

  if (text.length === 0) return jsonResponse({ error: 'empty_text' }, 400)
  if (text.length > 50000) return jsonResponse({ error: 'text_too_long', text_length: text.length }, 400)

  const hash = await sha256Hex(text + ':' + voice + ':' + MODEL)
  const objectPath = cacheNamespace + '/' + hash + '.mp3'

  const { data: existing } = await admin.storage.from(BUCKET).list(cacheNamespace, { search: hash, limit: 1 })
  if (existing && existing.length > 0) {
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath)
    return jsonResponse({
      audio_url: pub.publicUrl,
      cache_hit: true,
      duration_estimate_s: Math.round((text.length / 1000) * 11),
      text_length: text.length,
    })
  }

  const chunks = splitIntoChunks(text, CHUNK_MAX)

  // PARALLEL synthesis — Promise.all so total wall time is the slowest chunk,
  // not the sum. Critical for staying under client timeouts.
  const results = await Promise.all(chunks.map((c, i) => synthChunkImpl(c, voice, i)))

  const failed = results.find(r => !r.ok) as { ok: false; status: number; body: string; index: number } | undefined
  if (failed) {
    console.error('[tts-generate] OpenAI chunk error', failed.index, failed.status, failed.body.slice(0, 200))
    return jsonResponse({
      error: 'openai_failed',
      status: failed.status,
      openai_body: failed.body,
      failed_chunk_index: failed.index,
      chunk_count: chunks.length,
      text_length: text.length,
    }, 502)
  }

  const audioParts = results.map(r => (r as { ok: true; bytes: Uint8Array }).bytes)
  const merged = concatBytes(audioParts)

  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, merged, {
    contentType: 'audio/mpeg',
    upsert: true,
  })
  if (upErr) {
    console.error('[tts-generate] storage upload failed', upErr.message)
    return jsonResponse({ error: 'storage_upload_failed', detail: upErr.message }, 500)
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath)
  return jsonResponse({
    audio_url: pub.publicUrl,
    cache_hit: false,
    duration_estimate_s: Math.round((text.length / 1000) * 11),
    text_length: text.length,
    chunk_count: chunks.length,
  })
})
