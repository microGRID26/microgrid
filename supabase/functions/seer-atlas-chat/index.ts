// seer-atlas-chat — streaming chat endpoint for Seer's Atlas tab.
//
// Owner-gated via JWT verification + atlas_hq_is_owner check. Enforces a
// per-UTC-day token budget atomically via the seer_atlas_increment_usage RPC
// (mig 316). Forwards to Anthropic Messages API with prompt caching and
// server-side tool execution.
//
// Request body: { message: string, model: string }
// Response: SSE stream of { type: "text" | "tool_use_start" | "tool_result" | "done" | "error", ... }

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.95.2?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { ATLAS_SYSTEM_PROMPT_STATIC } from './system-prompt.ts';
import { ATLAS_TOOL_DEFS, executeTool, type ToolName } from './tools.ts';

const ANTHROPIC_API_KEY = Deno.env.get('SEER_ATLAS_ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Daily cap values live in migration 316 (seer_atlas_increment_usage) — the
// RPC enforces them atomically. Keep these here as documentation only; do NOT
// re-read them in the edge function. Single source of truth = the DB.
const DAILY_INPUT_CAP_DOC = 500_000;
const DAILY_OUTPUT_CAP_DOC = 100_000;

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders });

  // 1. Authn — JWT must be present.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonError(401, 'missing auth');
  }

  const userClient = createClient(SUPABASE_URL, authHeader.slice(7), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return jsonError(401, 'invalid token');

  // 2. Owner gate — only Greg can use Atlas.
  // Live signature: atlas_hq_is_owner(p_uid uuid) returns boolean. NOT `p_user_id`.
  const { data: isOwnerRow, error: ownerErr } = await userClient.rpc('atlas_hq_is_owner', { p_uid: userData.user.id });
  if (ownerErr) return jsonError(500, 'owner check failed');
  if (!isOwnerRow) return jsonError(403, 'owner-only');

  // 3. Parse body.
  let body: { message?: string; model?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid json'); }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const model = typeof body.model === 'string' && ALLOWED_MODELS.has(body.model) ? body.model : 'claude-sonnet-4-6';
  if (!message) return jsonError(400, 'message required');
  if (message.length > 8000) return jsonError(400, 'message too long (8000 char cap)');

  // 4. Daily cap check — atomic via seer_atlas_increment_usage(owner_id, 0, 0, true).
  // Caller contract:
  //   pre-flight call:  (owner_id, 0, 0, true)  → ticks request_count, returns totals.
  //   post-flight call: (owner_id, input, output, false) → adds the real usage.
  // Cap-exceeded check runs in the same statement that increments — no TOCTOU
  // window. RPC is service_role-only (mig 316), so the call goes through
  // adminClient with an explicit p_owner_id (verified upstream by
  // atlas_hq_is_owner against the JWT).
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);

  const { data: preflightRows, error: preflightErr } = await adminClient
    .rpc('seer_atlas_increment_usage', { p_owner_id: userData.user.id, p_input: 0, p_output: 0, p_is_preflight: true });
  if (preflightErr) return jsonError(500, 'usage check failed', { detail: preflightErr.message });
  const preflight = Array.isArray(preflightRows) ? preflightRows[0] : preflightRows;
  if (preflight?.cap_exceeded) {
    return jsonError(429, 'daily_cap', { resets_at: `${today}T23:59:59Z`, totals: preflight });
  }

  // 5. Insert user message row + load thread.
  await adminClient.from('seer_atlas_messages').insert({
    owner_id: userData.user.id,
    role: 'user',
    content: [{ type: 'text', text: message }],
  });

  const { data: threadRows, error: threadErr } = await adminClient
    .from('seer_atlas_messages')
    .select('role,content')
    .eq('owner_id', userData.user.id)
    .order('created_at', { ascending: true })
    .limit(200);
  if (threadErr) return jsonError(500, `thread load failed: ${threadErr.message}`);

  return streamChat({
    adminClient,
    userId: userData.user.id,
    threadRows: threadRows ?? [],
    model,
    today,
  });
});

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function streamChat(args: {
  adminClient: any; // SupabaseClient — schema generics flap between v2 minor versions; widen here.
  userId: string;
  threadRows: Array<{ role: string; content: unknown }>;
  model: string;
  today: string;
}): Response {
  const { adminClient, userId, threadRows, model, today } = args;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const systemPromptDate = `\n\n# Today\n\nToday's date is ${today}.`;

  // Convert DB rows → Anthropic Messages format.
  // Roles in DB:
  //   'user'        → Anthropic user (text)
  //   'assistant'   → Anthropic assistant (text + tool_use blocks)
  //   'tool_result' → Anthropic user (tool_result blocks)
  //   'tool_use'    → NEVER written (lives inside the assistant row); if found,
  //                   ignore — it's stale data from an earlier shape.
  // ORPHAN GUARD: if a prior request died between the assistant insert and the
  // tool_result insert, we'd have an unpaired tool_use block. Anthropic 400s
  // if any assistant message has tool_use blocks without a matching tool_result
  // in the IMMEDIATELY following user message. Scan the whole thread (not just
  // the tail) — mid-thread orphans persist after the user retries.
  type Block = { type: string; [k: string]: unknown };
  const isBlockArr = (c: unknown): c is Block[] => Array.isArray(c);
  const hasToolUse = (c: unknown) => isBlockArr(c) && c.some((b) => b.type === 'tool_use');

  const cleanedRows = [...threadRows];
  for (let i = cleanedRows.length - 1; i >= 0; i--) {
    const row = cleanedRows[i];
    if (row.role !== 'assistant') continue;
    if (!hasToolUse(row.content)) continue;
    const next = cleanedRows[i + 1];
    if (!next || next.role !== 'tool_result') {
      cleanedRows.splice(i, 1);
    }
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const row of cleanedRows) {
    if (row.role === 'tool_use') continue;
    if (row.role === 'user' || row.role === 'tool_result') {
      messages.push({ role: 'user', content: row.content });
    } else {
      messages.push({ role: 'assistant', content: row.content });
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      // Token accounting:
      //   message_start.message.usage.input_tokens          = cache-miss inputs
      //   message_start.message.usage.cache_creation_input_tokens
      //   message_start.message.usage.cache_read_input_tokens
      //   message_delta.usage.output_tokens                  = CUMULATIVE total at this delta (not a delta)
      // Sum input + cache_creation + cache_read across ITERATIONS (each
      // Anthropic call is a fresh message_start); take the LAST output_tokens
      // per iteration; sum across iterations.
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let usageRecorded = false;

      try {
        let currentAssistantBlocks: unknown[] = [];

        for (let iteration = 0; iteration < 8; iteration++) {
          const response = await anthropic.messages.create({
            model,
            max_tokens: 4096,
            system: [
              { type: 'text', text: ATLAS_SYSTEM_PROMPT_STATIC, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: systemPromptDate },
            ],
            tools: ATLAS_TOOL_DEFS as any,
            messages: messages as any,
            stream: true,
          });

          currentAssistantBlocks = [];
          let currentTextBlock = '';
          let currentToolUse: { id: string; name: string; input: string } | null = null;
          let stopReason: string | null = null;
          let iterationOutputTokens = 0;

          for await (const event of response as any) {
            if (event.type === 'message_start') {
              const u = event.message.usage || {};
              totalInputTokens += (u.input_tokens || 0)
                + (u.cache_creation_input_tokens || 0)
                + (u.cache_read_input_tokens || 0);
              iterationOutputTokens = u.output_tokens || 0;
            } else if (event.type === 'content_block_start') {
              if (event.content_block.type === 'text') {
                currentTextBlock = '';
              } else if (event.content_block.type === 'tool_use') {
                currentToolUse = { id: event.content_block.id, name: event.content_block.name, input: '' };
                send({ type: 'tool_use_start', name: event.content_block.name });
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                currentTextBlock += event.delta.text;
                send({ type: 'text', text: event.delta.text });
              } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.input += event.delta.partial_json;
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolUse) {
                let parsedInput: Record<string, unknown> = {};
                try { parsedInput = JSON.parse(currentToolUse.input || '{}'); } catch { parsedInput = {}; }
                currentAssistantBlocks.push({ type: 'tool_use', id: currentToolUse.id, name: currentToolUse.name, input: parsedInput });
                currentToolUse = null;
              } else if (currentTextBlock) {
                currentAssistantBlocks.push({ type: 'text', text: currentTextBlock });
                currentTextBlock = '';
              }
            } else if (event.type === 'message_delta') {
              iterationOutputTokens = event.usage?.output_tokens ?? iterationOutputTokens;
              stopReason = event.delta?.stop_reason || null;
            }
          }

          totalOutputTokens += iterationOutputTokens;

          await adminClient.from('seer_atlas_messages').insert({
            owner_id: userId,
            role: 'assistant',
            content: currentAssistantBlocks,
            model,
          });
          messages.push({ role: 'assistant', content: currentAssistantBlocks });

          if (stopReason !== 'tool_use') break;

          const toolResultBlocks: unknown[] = [];
          for (const block of currentAssistantBlocks) {
            const b = block as { type: string; id?: string; name?: string; input?: Record<string, unknown> };
            if (b.type !== 'tool_use' || !b.name) continue;
            const result = await executeTool(adminClient as any, b.name as ToolName, b.input || {});
            const resultJson = JSON.stringify(result);
            const isError = !!(result && typeof result === 'object' && 'error' in (result as Record<string, unknown>));
            send({ type: 'tool_result', name: b.name, length: resultJson.length, error: isError });
            const tr: Record<string, unknown> = { type: 'tool_result', tool_use_id: b.id, content: resultJson };
            if (isError) tr.is_error = true;
            toolResultBlocks.push(tr);
          }

          if (toolResultBlocks.length > 0) {
            await adminClient.from('seer_atlas_messages').insert({
              owner_id: userId,
              role: 'tool_result',
              content: toolResultBlocks,
            });
            messages.push({ role: 'user', content: toolResultBlocks });
          }
        }

        // Loop exhaustion detection: if the last assistant turn ended on a
        // tool_use block, we hit the 8-iteration cap without converging.
        const lastTurnIsToolUseStop =
          currentAssistantBlocks.length > 0 &&
          (currentAssistantBlocks[currentAssistantBlocks.length - 1] as { type?: string })?.type === 'tool_use';
        if (lastTurnIsToolUseStop) {
          send({ type: 'error', message: 'tool-use loop exceeded 8 iterations; cancelling stream' });
        } else {
          send({ type: 'done', input_tokens: totalInputTokens, output_tokens: totalOutputTokens });
        }
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        // Record real usage in `finally` so a mid-stream exception still
        // accounts the Anthropic tokens that were already consumed. Guard
        // against double-write via the `usageRecorded` flag.
        if (!usageRecorded && (totalInputTokens > 0 || totalOutputTokens > 0)) {
          usageRecorded = true;
          try {
            const { error: incErr } = await adminClient.rpc('seer_atlas_increment_usage', {
              p_owner_id: userId,
              p_input: totalInputTokens,
              p_output: totalOutputTokens,
              p_is_preflight: false,
            });
            if (incErr) console.error('[seer-atlas-chat] increment_usage failed', incErr);
          } catch (recErr) {
            console.error('[seer-atlas-chat] increment_usage threw', recErr);
          }
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
