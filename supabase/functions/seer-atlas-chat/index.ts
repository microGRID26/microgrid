// seer-atlas-chat — streaming chat endpoint for Seer's Atlas tab.
//
// Owner-gated via JWT verification + atlas_hq_is_owner check. Enforces a
// per-UTC-day token budget atomically via the seer_atlas_increment_usage RPC
// (mig 316). Forwards to Anthropic Messages API with prompt caching and
// server-side tool execution.
//
// Sub-routes (Phase 3B):
//   POST /         — initial chat turn (legacy default).
//   POST /chat     — initial chat turn (explicit alias).
//   POST /confirm  — Greg's confirmation-chip decision. Atomic-claim a
//                    pending row, run the underlying RPC (or cancel),
//                    persist the paired tool_result block, resume Atlas.
//
// SSE shape: { type: "text" | "tool_use_start" | "tool_result" |
//                    "pending_confirmation" | "done" | "error", ... }

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.95.2?target=deno';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { ATLAS_SYSTEM_PROMPT_STATIC } from './system-prompt.ts';
import {
  ATLAS_TOOL_DEFS,
  CONFIRM_CHIP_TOOLS,
  executeTool,
  executeConfirmedTool,
  cancelConfirmedTool,
  setPendingToolUseId,
  isPendingConfirmation,
  type ToolName,
} from './tools.ts';

const ANTHROPIC_API_KEY = Deno.env.get('SEER_ATLAS_ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

  // Supabase mounts the function at /functions/v1/seer-atlas-chat; the
  // remainder of the URL pathname is the sub-route. Strip everything up to
  // and including the function slug to get the sub-path.
  const url = new URL(req.url);
  const subPath = url.pathname.replace(/^.*\/seer-atlas-chat/, '') || '/';

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  if (subPath === '/' || subPath === '/chat') return handleChat(req, auth);
  if (subPath === '/confirm') return handleConfirm(req, auth);
  return jsonError(404, `unknown sub-path: ${subPath}`);
});

// ── Authn + owner gate ───────────────────────────────────────────────────────

type AuthOk = {
  ok: true;
  userId: string;
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
};
type AuthErr = { ok: false; response: Response };

async function authenticate(req: Request): Promise<AuthOk | AuthErr> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, response: jsonError(401, 'missing auth') };

  // IMPORTANT: 2nd arg must be the publishable anon key, NOT the user's JWT.
  // Supabase Auth requires the `apikey` header to be the project's anon key;
  // the user identity comes from the Authorization header override below.
  // Passing the JWT here gets rejected as "invalid token" at auth.getUser().
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return { ok: false, response: jsonError(401, 'invalid token') };

  // Live signature: atlas_hq_is_owner(p_uid uuid) returns boolean.
  const { data: isOwnerRow, error: ownerErr } = await userClient.rpc('atlas_hq_is_owner', { p_uid: userData.user.id });
  if (ownerErr) return { ok: false, response: jsonError(500, 'owner check failed') };
  if (!isOwnerRow) return { ok: false, response: jsonError(403, 'owner-only') };

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return { ok: true, userId: userData.user.id, userClient, adminClient };
}

// ── POST /chat ───────────────────────────────────────────────────────────────

async function handleChat(req: Request, auth: AuthOk): Promise<Response> {
  const { userId, adminClient } = auth;

  let body: { message?: string; model?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid json'); }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const model = typeof body.model === 'string' && ALLOWED_MODELS.has(body.model) ? body.model : 'claude-sonnet-4-6';
  if (!message) return jsonError(400, 'message required');
  if (message.length > 8000) return jsonError(400, 'message too long (8000 char cap)');

  // Daily cap check — atomic via seer_atlas_increment_usage(owner_id, 0, 0, true).
  const today = new Date().toISOString().slice(0, 10);
  const { data: preflightRows, error: preflightErr } = await adminClient
    .rpc('seer_atlas_increment_usage', { p_owner_id: userId, p_input: 0, p_output: 0, p_is_preflight: true });
  if (preflightErr) return jsonError(500, 'usage check failed', { detail: preflightErr.message });
  const preflight = Array.isArray(preflightRows) ? preflightRows[0] : preflightRows;
  if (preflight?.cap_exceeded) {
    return jsonError(429, 'daily_cap', { resets_at: `${today}T23:59:59Z`, totals: preflight });
  }

  // Insert user message row + load thread.
  await adminClient.from('seer_atlas_messages').insert({
    owner_id: userId,
    role: 'user',
    content: [{ type: 'text', text: message }],
  });

  const threadRows = await loadThread(adminClient, userId);
  if (!threadRows.ok) return jsonError(500, `thread load failed: ${threadRows.error}`);

  return streamChat({ adminClient, userId, threadRows: threadRows.rows, model, today });
}

// ── POST /confirm ────────────────────────────────────────────────────────────

async function handleConfirm(req: Request, auth: AuthOk): Promise<Response> {
  const { userId, adminClient } = auth;

  let body: { tool_id?: string; decision?: string; model?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid json'); }
  const toolId = typeof body.tool_id === 'string' ? body.tool_id : '';
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const model = typeof body.model === 'string' && ALLOWED_MODELS.has(body.model) ? body.model : 'claude-sonnet-4-6';
  if (!toolId) return jsonError(400, 'tool_id required');
  if (decision !== 'confirm' && decision !== 'cancel') return jsonError(400, 'decision must be "confirm" or "cancel"');

  // ATOMIC CLAIM (C1 fix). The WHERE filter pins:
  //   tool_id = $1       — the specific pending row
  //   user_id = $userId  — H3 defense-in-depth (JWT.sub gate, not just owner)
  //   status  = 'pending' — first-tap wins; replay is handled by re-read below
  //   expires_at > now() — 5-minute TTL per mig 305
  // Target status:
  //   confirm → 'executing' (will transition to 'executed' after RPC runs)
  //   cancel  → 'cancelled' (terminal)
  const targetStatus = decision === 'confirm' ? 'executing' : 'cancelled';
  const { data: claimed, error: claimErr } = await adminClient
    .from('seer_atlas_pending_tools')
    .update({ status: targetStatus, updated_at: new Date().toISOString() })
    .eq('tool_id', toolId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select('tool_id, tool_name, args_json, audit_id, tool_use_id')
    .maybeSingle();
  if (claimErr) return jsonError(500, 'claim failed', { detail: claimErr.message });

  if (!claimed) {
    // No pending row claimed — either replay (executed/cancelled) or expired/missing.
    // R1 H2 fix: do NOT return result_json on the replay branch. The original
    // chat thread already contains the tool_result message; if Greg needs to
    // see the outcome again, he reads the chat. Returning the cached
    // result_json here lets a stolen JWT extract action ids + close-action
    // outcomes via known tool_ids without ever joining the chat thread.
    const { data: existing } = await adminClient
      .from('seer_atlas_pending_tools')
      .select('status, tool_name')
      .eq('tool_id', toolId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!existing) return jsonError(404, 'pending tool not found or not owned');
    if (existing.status === 'executed') {
      return jsonResponse(200, { replay: true, status: 'executed', tool_name: existing.tool_name });
    }
    if (existing.status === 'cancelled') {
      return jsonResponse(200, { replay: true, status: 'cancelled', tool_name: existing.tool_name });
    }
    if (existing.status === 'executing') {
      return jsonResponse(202, { replay: true, status: 'executing', note: 'still in flight' });
    }
    if (existing.status === 'expired') {
      return jsonResponse(410, { error: 'pending tool expired', status: 'expired' });
    }
    return jsonResponse(409, { error: 'pending tool unclaimable', status: existing.status });
  }

  const toolName = claimed.tool_name as string;
  const argsJson = (claimed.args_json ?? {}) as Record<string, unknown>;
  const auditId  = (claimed.audit_id as string | null) ?? null;
  const toolUseId = (claimed.tool_use_id as string | null) ?? null;

  // The assistant's tool_use block must be paired with a matching tool_result
  // block in the next user message, or the next Anthropic call will 400. If
  // tool_use_id is missing (streamChat never patched it — shouldn't happen in
  // practice), the orphan-guard in loadThread strips the assistant turn.
  let toolResultContent: string;
  let isError = false;

  if (decision === 'cancel') {
    await cancelConfirmedTool(adminClient, auditId);
    toolResultContent = JSON.stringify({ cancelled: true, reason: 'user_cancelled' });
    // Finalize pending row already set to 'cancelled' by the atomic claim.
  } else {
    // confirm — run the RPC.
    const { result, outcome } = await executeConfirmedTool(adminClient, userId, auditId, toolName, argsJson);
    isError = !!(result && typeof result === 'object' && 'error' in (result as Record<string, unknown>));
    toolResultContent = JSON.stringify(result);

    // Transition pending row to 'executed' regardless of outcome — store the
    // result envelope (which is an error envelope on failure) so a double-tap
    // returns the same envelope (idempotent failure replay). Keeps the chip
    // path stateless: the surface response is "this tool already ran, here's
    // what happened" rather than "retry?".
    await adminClient
      .from('seer_atlas_pending_tools')
      .update({
        status: 'executed',
        result_json: result,
        updated_at: new Date().toISOString(),
      })
      .eq('tool_id', toolId);
  }

  // Persist the paired tool_result message so Anthropic's protocol invariant
  // is satisfied when we resume the stream.
  if (toolUseId) {
    await adminClient.from('seer_atlas_messages').insert({
      owner_id: userId,
      role: 'tool_result',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: toolResultContent,
        ...(isError ? { is_error: true } : {}),
      }],
    });
  } else {
    // No tool_use_id linkage — log + skip. orphan-guard in loadThread will
    // drop the assistant turn so Anthropic doesn't 400 on resumption.
    console.error('[seer-atlas-chat] /confirm: tool_use_id missing on pending row', toolId);
  }

  // Resume the conversation — load fresh thread (now including the new
  // tool_result row) and stream Atlas's follow-up.
  const today = new Date().toISOString().slice(0, 10);
  const threadRows = await loadThread(adminClient, userId);
  if (!threadRows.ok) return jsonError(500, `thread load failed: ${threadRows.error}`);

  return streamChat({ adminClient, userId, threadRows: threadRows.rows, model, today });
}

// ── Thread loader (shared by /chat + /confirm resume) ────────────────────────

async function loadThread(adminClient: SupabaseClient, userId: string): Promise<
  | { ok: true; rows: Array<{ role: string; content: unknown }> }
  | { ok: false; error: string }
> {
  const { data, error } = await adminClient
    .from('seer_atlas_messages')
    .select('role,content')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: data ?? [] };
}

// ── Error helpers ────────────────────────────────────────────────────────────

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── streamChat ───────────────────────────────────────────────────────────────

function streamChat(args: {
  adminClient: SupabaseClient;
  userId: string;
  threadRows: Array<{ role: string; content: unknown }>;
  model: string;
  today: string;
}): Response {
  const { adminClient, userId, threadRows, model, today } = args;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const systemPromptDate = `\n\n# Today\n\nToday's date is ${today}.`;

  // Convert DB rows → Anthropic Messages format. Orphan guard: if a prior
  // request died between assistant insert and tool_result insert, strip the
  // unpaired assistant turn (Anthropic 400s on dangling tool_use). For
  // Phase 3B, a confirm-chip pending row that's still 'pending' also leaves
  // an unpaired tool_use; the orphan-guard handles that the same way until
  // /confirm writes the paired tool_result.
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

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let usageRecorded = false;

      try {
        let currentAssistantBlocks: unknown[] = [];
        let pendingConfirmationFired = false;

        outer: for (let iteration = 0; iteration < 8; iteration++) {
          const response = await anthropic.messages.create({
            model,
            max_tokens: 4096,
            system: [
              { type: 'text', text: ATLAS_SYSTEM_PROMPT_STATIC, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: systemPromptDate },
            ],
            tools: ATLAS_TOOL_DEFS as any,
            // R1 H1 fix: parallel tool_use blocks where one is a confirm-chip
            // tool would persist orphan tool_use blocks (the confirm-chip
            // breaks out of the loop before processing siblings), wedging the
            // thread permanently on resumption. disable_parallel_tool_use
            // forces Atlas to issue at most one tool_use per assistant turn.
            tool_choice: { type: 'auto', disable_parallel_tool_use: true },
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
            if (b.type !== 'tool_use' || !b.name || !b.id) continue;
            const result = await executeTool(adminClient, b.name as ToolName, b.input || {}, userId);

            // Phase 3B: detect pending_confirmation sentinel. If found, patch
            // the pending row with the Anthropic tool_use_id, emit SSE event,
            // skip tool_result persistence (the orphan tool_use stays until
            // /confirm writes the paired tool_result), end iteration.
            if (isPendingConfirmation(result)) {
              const p = result.__pending_confirmation;
              await setPendingToolUseId(adminClient, p.tool_id, b.id);
              send({
                type: 'pending_confirmation',
                tool_id: p.tool_id,
                tool_name: p.tool_name,
                summary: p.summary,
              });
              // Do NOT push a tool_result block for this tool. Exit both the
              // block loop (via toolResultBlocks staying empty) and the outer
              // iteration loop (we're waiting for Greg's chip tap).
              send({ type: 'done', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, pending: true });
              pendingConfirmationFired = true;
              break outer;
            }

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
        // tool_use block AND we didn't break out via pending_confirmation,
        // we hit the 8-iteration cap without converging.
        const lastTurnIsToolUseStop =
          currentAssistantBlocks.length > 0 &&
          (currentAssistantBlocks[currentAssistantBlocks.length - 1] as { type?: string })?.type === 'tool_use';
        if (pendingConfirmationFired) {
          // Already sent `done` with pending:true above. No-op.
        } else if (lastTurnIsToolUseStop) {
          send({ type: 'error', message: 'tool-use loop exceeded 8 iterations; cancelling stream' });
        } else {
          const finalText = (currentAssistantBlocks as { type?: string; text?: string }[])
            .filter((b) => b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text as string)
            .join('');
          send({ type: 'done', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, final_text: finalText });
        }
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
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
