// lib/partner-api/pii.ts — Customer-PII redaction.
//
// Partners whose key has customer_pii_scope=true see full customer contact
// info. All other keys get email + phone redacted before we serialize. Street
// address stays (required for stamp drawings); name stays (required for
// labeling + deliverables).
//
// Walks deep on nested objects + arrays. partner_documents is a JSONB array
// of doc objects with `metadata: Record<string, unknown>`; if a server-side
// ingestion ever writes a customer email/phone into doc metadata, that PII
// would leak via GET /leads/:id without scope. Audit-rotation 2026-05-02
// (#474 M2) flagged this. Recursive walk covers it without route-level work.

const PII_KEYS = new Set([
  // Bare names
  'email', 'phone', 'mobile', 'cell', 'fax', 'sms',
  // Phone variants — partner ingestions often use these in metadata blobs
  'phone_home', 'phone_mobile', 'phone_work', 'phone_number',
  'home_phone', 'work_phone', 'cell_phone', 'mobile_phone',
  'contact_phone', 'customer_phone', 'primary_phone',
  // Email variants
  'email_primary', 'email_secondary', 'email_address',
  'contact_email', 'customer_email', 'primary_email',
])

// Hard cap on recursion depth. Real partner-API response shapes top out at
// depth 3-4 today (project → partner_documents[N] → metadata.{k:v}). 32 leaves
// 10x headroom for future schema growth without burning stack.
const MAX_REDACT_DEPTH = 32

/** Recursively redact customer PII on a row. Walks nested objects + arrays;
 *  any key (at any depth) matching PII_KEYS is set to null. */
export function redactCustomerFields<T extends Record<string, unknown>>(
  row: T,
  hasPiiScope: boolean,
): T {
  if (hasPiiScope) return row
  return redactNode(row, 0) as T
}

function redactNode(node: unknown, depth: number): unknown {
  // R1 MEDIUM: fail closed past the depth cap. Returning the raw subtree would
  // silently leak any PII that happens to live below; null is safe and
  // detectable. The cap is generous (32) so this almost never fires in
  // practice, but if it does we want absence-of-data, not data-bypassed-redact.
  if (depth > MAX_REDACT_DEPTH) return null
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map((item) => redactNode(item, depth + 1))
  }
  const src = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(src)) {
    if (PII_KEYS.has(key.toLowerCase())) {
      out[key] = null
    } else {
      out[key] = redactNode(src[key], depth + 1)
    }
  }
  return out
}
