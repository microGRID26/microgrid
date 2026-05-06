/**
 * In-app Atlas scope guard.
 *
 * Greg's CIO Atlas (Claude Code) is the full Atlas — answers about the
 * codebase, infra, harness, etc. The IN-APP Atlas served via /api/atlas/*
 * to Heidi/Mark/sales/employees is a SUBSET. It answers domain + workflow
 * + project-data questions only. Engineering meta is refused here so the
 * surface stays predictable for non-engineers and the system internals
 * don't leak through cute prompt phrasings.
 *
 * Usage: every /api/atlas/* route runs `checkScope(question)` BEFORE
 * doing any retrieval / LLM call. If the helper returns a refusal,
 * return it directly to the client.
 */

const OUT_OF_SCOPE = [
  // Database / infra
  /\bsupabase\b/i,
  /\bpostgres(ql)?\b/i,
  /\bsql\b/i,
  /\bdatabase\b/i,
  /\bschema\b/i,
  /\brls\b/i,
  /\brow.level.security\b/i,
  /\bvercel\b/i,
  /\bgithub\b/i,
  /\bdeploy(ment|s)?\b/i,
  /\bmigrations?\b/i,
  /\bbranches?\b/i,
  /\bcommits?\b/i,
  /\bpull request(s)?\b/i,

  // AI / harness
  /\bclaude\b/i,
  /\banthropic\b/i,
  /\bopen(ai|-ai)\b/i,
  /\bgpt[- ]?\d?\b/i,
  /\bllm\b/i,
  /\bharness\b/i,
  /\bmcp\b/i,
  /\bsubagents?\b/i,
  /\bsystem prompt\b/i,
  /\byour (model|prompt|system)\b/i,
  /\bwhich model\b/i,
  /\bhow (do|does) (you|atlas) work\b/i,
  /\bwhat (model|llm|ai) (are you|is this|powers)\b/i,
  /\bjailbreak\b/i,

  // Atlas-as-product internals
  /\batlas hq\b/i,
  /\baction queue\b/i,
  /\brecaps?\b/i,
  /\bgreg.?actions?\b/i,
  /\bhooks?\.py\b/i,
  /\bclaude.?code\b/i,
] as const

const REFUSAL =
  "I'm your MicroGRID assistant — I help with projects, sales, and install workflow. " +
  "I can't answer questions about our infrastructure, code, or AI tooling."

export interface ScopeCheck {
  inScope: boolean
  refusal?: string
  matchedPattern?: string
}

export function checkScope(question: string): ScopeCheck {
  for (const pat of OUT_OF_SCOPE) {
    if (pat.test(question)) {
      return { inScope: false, refusal: REFUSAL, matchedPattern: pat.source }
    }
  }
  return { inScope: true }
}
