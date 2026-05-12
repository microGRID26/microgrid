// tools.ts — Anthropic tool schemas + server-side executors for the
// four read-only tools Atlas can call from the chat surface. Each executor
// runs against the Supabase service_role (the edge function's upstream
// JWT verify already confirmed owner status).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const ATLAS_TOOL_DEFS = [
  {
    name: 'list_recent_recaps',
    description: 'List Greg\'s most recent session recaps. Use for "what did we ship", "what happened this week", project recall questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How many days back to look. Default 7.', default: 7 },
        project: { type: 'string', description: 'Optional project name filter (e.g. "MicroGRID", "Seer", "SPARK"). Omit for all projects.' },
      },
    },
  },
  {
    name: 'list_open_actions',
    description: 'List Greg\'s open action queue items (greg_actions). Use for "what\'s on my plate", "what\'s blocking me", priority questions.',
    input_schema: {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'question'], description: 'Optional priority filter.' },
      },
    },
  },
  {
    name: 'list_open_assumptions',
    description: 'List open assumptions Greg may want to confirm. Use when he asks about pending assumptions on a project.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Optional project filter.' },
        tag: { type: 'string', description: 'Optional tag filter (e.g. "paul-relevant", "rls", "invoicing").' },
      },
    },
  },
  {
    name: 'search_concepts',
    description: 'Full-text search across Seer\'s learn_concepts curriculum. Use for Seer-internal questions about specific concepts.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g. "transformers", "tool use").' },
      },
      required: ['query'],
    },
  },
] as const;

export type ToolName = typeof ATLAS_TOOL_DEFS[number]['name'];

// SECURITY NOTE: every tool below is called with the SERVICE_ROLE supabase client
// (see index.ts step 4). The target tables (greg_actions, atlas_session_recaps,
// atlas_assumptions, learn_concepts) all have `deny_all` RLS policies on
// {anon,authenticated} — service_role bypasses RLS only because
// `relforcerowsecurity=false` on these tables. If a future hardening sweep flips
// `force row level security` on any of them, the tools will silently return
// zero rows. Task 11 R1 audit must include a smoke test that confirms each
// of the four tables returns >0 rows via service_role.
//
// Live column names (verified 2026-05-12 via information_schema):
//   greg_actions:        id, priority, title, body_md, source_session, added_at, status, project, tags
//   atlas_assumptions:   id, project, assumption_text, context_md, tags, status, logged_at
//   atlas_session_recaps:headline, synopsis_md, commit_shas, project, created_at
//   learn_concepts:      slug, title, subtitle, summary, intro, category — NO `fts` column

// Escape PostgREST `.or(...)` user input. Strips chars that would break the filter
// grammar or change semantics: comma (filter separator), paren (filter group),
// asterisk (wildcard), dot (operator separator). Keeps the query useful for ilike.
function sanitizeForPostgrestOr(q: string): string {
  return q.replace(/[,()*.]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function executeTool(
  supabase: SupabaseClient,
  name: ToolName,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    if (name === 'list_recent_recaps') {
      const days = typeof input.days === 'number' ? input.days : 7;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from('atlas_session_recaps')
        .select('headline,synopsis_md,commit_shas,project,created_at')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(20);
      if (typeof input.project === 'string' && input.project.length) {
        q = q.eq('project', input.project);
      }
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }

    if (name === 'list_open_actions') {
      let q = supabase
        .from('greg_actions')
        .select('id,priority,title,body_md,source_session,added_at,status,project,tags')
        .eq('status', 'open')
        .order('priority', { ascending: true })
        .order('added_at', { ascending: false })
        .limit(30);
      if (typeof input.priority === 'string') q = q.eq('priority', input.priority);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }

    if (name === 'list_open_assumptions') {
      let q = supabase
        .from('atlas_assumptions')
        .select('id,project,assumption_text,context_md,tags,status,logged_at')
        .eq('status', 'open')
        .order('logged_at', { ascending: false })
        .limit(40);
      if (typeof input.project === 'string') q = q.eq('project', input.project);
      if (typeof input.tag === 'string') q = q.contains('tags', [input.tag]);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }

    if (name === 'search_concepts') {
      const raw = typeof input.query === 'string' ? input.query : '';
      const query = sanitizeForPostgrestOr(raw);
      if (!query) return { error: 'query is required' };
      // learn_concepts has no `fts` column — ilike fallback against title /
      // subtitle / summary / intro / slug is the Phase 1 contract. A future
      // migration can add a tsvector; revisit search_concepts then.
      const pattern = `%${query}%`;
      const { data, error } = await supabase
        .from('learn_concepts')
        .select('slug,title,subtitle,summary,intro')
        .or(
          `title.ilike.${pattern},` +
          `subtitle.ilike.${pattern},` +
          `summary.ilike.${pattern},` +
          `intro.ilike.${pattern},` +
          `slug.ilike.${pattern}`,
        )
        .limit(10);
      if (error) return { error: error.message };
      return data;
    }

    return { error: `unknown tool: ${name}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
