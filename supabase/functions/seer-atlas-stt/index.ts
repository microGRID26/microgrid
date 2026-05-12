// seer-atlas-stt — push-to-talk speech-to-text for Seer's Atlas tab.
//
// Owner-gated via JWT verification + atlas_hq_is_owner. Hardened against
// abuse (size cap, MIME sniff, timeout, daily request counter). Forwards
// audio to OpenAI Whisper, returns { transcript, duration_ms }.
//
// Request: multipart/form-data with field `audio: <Blob>` (m4a/mp3/wav/webm).
// Response: { transcript: string, duration_ms: number } (transcript capped at 4000 chars).
//
// Handler order (CORS first to keep preflight clean even on rejects):
//   1. CORS preflight (OPTIONS → 200)
//   2. Content-Length pre-parse rejection (>25MB → 413)
//   3. JWT verify (401)
//   4. atlas_hq_is_owner gate (403)
//   5. STT request counter check-then-increment (429 on cap)
//   6. Parse multipart formData
//   7. Magic-byte sniff first 12 bytes (400 on MIME lie)
//   8. Whisper fetch w/ AbortSignal.timeout(90s)
//   9. Cap transcript at 4000 chars; construct response

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_BODY_BYTES = 26_214_400; // 25 MiB
const TRANSCRIPT_CHAR_CAP = 4000;
const WHISPER_TIMEOUT_MS = 90_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Magic-byte signatures for accepted Whisper formats.
// Refs:
//   m4a:  bytes 4..8 = "ftyp" (any brand)
//   mp3:  bytes 0..3 = "ID3" or 0xFFFB / 0xFFF3 / 0xFFF2
//   wav:  bytes 0..4 = "RIFF"; bytes 8..12 = "WAVE"
//   webm: bytes 0..4 = 0x1A 0x45 0xDF 0xA3
function sniffAudioMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // m4a (and aac in mp4 container)
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'audio/m4a';
  // mp3 ID3 tag
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  // mp3 raw frame
  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return 'audio/mpeg';
  // wav (RIFF...WAVE)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return 'audio/wav';
  // webm
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return 'audio/webm';
  return null;
}

Deno.serve(async (req) => {
  // 1. CORS preflight FIRST (returns 200 + headers even on otherwise-bad requests).
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method not allowed');

  // 2. Content-Length pre-parse rejection.
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) return jsonError(413, 'audio_too_large');

  // 3. JWT verify. anon-key in 2nd arg, JWT via Authorization header override.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonError(401, 'missing auth');

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return jsonError(401, 'invalid token');

  // 4. Owner gate. atlas_hq_is_owner(p_uid uuid) — service_role context needed since
  //    function GRANT is service_role-only (mirror Phase 1 chat fn).
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: isOwnerRow, error: ownerErr } = await adminClient
    .rpc('atlas_hq_is_owner', { p_uid: userData.user.id });
  if (ownerErr) return jsonError(500, 'owner check failed');
  if (!isOwnerRow) return jsonError(403, 'owner-only');

  // 5. STT request counter — check-then-increment, never ticks on rejected.
  //    Cap is 500/day per mig 317.
  const { data: counterRows, error: counterErr } = await adminClient
    .rpc('seer_atlas_increment_stt_requests', { p_uid: userData.user.id });
  if (counterErr) return jsonError(500, 'counter check failed');
  const counter = Array.isArray(counterRows) ? counterRows[0] : counterRows;
  if (counter?.cap_exceeded) {
    return jsonError(429, 'daily_stt_cap', { request_count_today: counter.request_count_today });
  }

  // 6. Parse multipart.
  let formData: FormData;
  try { formData = await req.formData(); } catch { return jsonError(400, 'invalid multipart'); }

  const audio = formData.get('audio');
  if (!(audio instanceof File) && !(audio instanceof Blob)) {
    return jsonError(400, 'audio_field_missing');
  }
  if (audio.size === 0) return jsonError(400, 'audio_empty');
  if (audio.size > MAX_BODY_BYTES) return jsonError(413, 'audio_too_large');

  // 7. Magic-byte sniff.
  const head = new Uint8Array(await audio.slice(0, 12).arrayBuffer());
  const sniffed = sniffAudioMime(head);
  if (!sniffed) return jsonError(400, 'audio_format_unsupported');

  // 8. Whisper fetch with timeout. multipart form with file + model.
  const whisperForm = new FormData();
  // Whisper accepts the file part with any filename; extension hint helps.
  const ext = sniffed === 'audio/mpeg' ? 'mp3'
    : sniffed === 'audio/wav' ? 'wav'
    : sniffed === 'audio/webm' ? 'webm' : 'm4a';
  whisperForm.append('file', audio, `audio.${ext}`);
  whisperForm.append('model', 'whisper-1');

  const startedAt = Date.now();
  let whisperResp: Response;
  try {
    whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: whisperForm,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
  } catch (e) {
    const isTimeout = (e as Error).name === 'TimeoutError';
    return jsonError(isTimeout ? 504 : 502, isTimeout ? 'whisper_timeout' : 'whisper_unreachable');
  }

  if (!whisperResp.ok) {
    // Server-side log only (NO body echo to client, S3 fix).
    const body = await whisperResp.text().catch(() => '');
    console.error('[seer-atlas-stt] whisper non-OK', whisperResp.status, body.slice(0, 800));
    return jsonError(502, 'whisper_error', { whisper_status: whisperResp.status });
  }

  const whisperJson = await whisperResp.json().catch(() => null) as { text?: string } | null;
  const rawTranscript = typeof whisperJson?.text === 'string' ? whisperJson.text.trim() : '';

  // 9. Cap transcript; construct response shape (not Whisper-forward).
  const transcript = rawTranscript.length > TRANSCRIPT_CHAR_CAP
    ? rawTranscript.slice(0, TRANSCRIPT_CHAR_CAP)
    : rawTranscript;

  return new Response(JSON.stringify({
    transcript,
    duration_ms: Date.now() - startedAt,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
