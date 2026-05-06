// lib/api/customer-billing.ts — Customer billing data access layer
// Monthly kWh billing at $0.12/kWh, Stripe payment methods, payment history
// Separate from B2B invoices — this is customer-facing billing
//
// ── Stripe customer creation contract (read before adding intake code) ──
// When the Stripe customer-creation flow ships here, every `stripe.customers
// .create()` MUST include both metadata fields:
//
//   await stripe.customers.create({
//     email,
//     metadata: {
//       auth_user_id: <supabase auth user id>,
//       customer_account_id: <customer_accounts.id>,
//     },
//   })
//
// /api/customer/delete-account does a metadata round-trip on every Stripe
// customer.del() — it refuses to delete a Stripe customer whose metadata
// doesn't claim the deleting user. If creation skips the metadata, every
// future right-to-erasure delete will silently log "metadata mismatch" and
// leave the Stripe record live, breaking Apple 5.1.1(v) / GDPR / CCPA.
//
// Migration 230 (#544) also dropped the customer-side INSERT policy on
// customer_payment_methods. Rows are now written by Stripe webhooks
// (service_role) only — no direct customer-app insert path.
//
// Set STRIPE_SECRET_KEY in Vercel envs when this work starts. The delete-
// account route no-ops cleanly until then.

import { db } from '@/lib/db'

// ── Types ───────────────────────────────────────────────────────────────────

export interface BillingStatement {
  id: string
  customer_account_id: string
  project_id: string
  period_start: string
  period_end: string
  kwh_consumed: number
  rate_per_kwh: number
  amount_due: number
  utility_comparison: number | null
  status: BillingStatementStatus
  due_date: string | null
  paid_at: string | null
  stripe_invoice_id: string | null
  org_id: string | null
  created_at: string
  updated_at: string
}

export type BillingStatementStatus = 'pending' | 'paid' | 'overdue' | 'waived'

export interface PaymentMethod {
  id: string
  customer_account_id: string
  stripe_customer_id: string | null
  stripe_payment_method_id: string | null
  card_brand: string | null
  card_last4: string | null
  card_exp_month: number | null
  card_exp_year: number | null
  is_default: boolean
  autopay_enabled: boolean
  created_at: string
}

export interface PaymentRecord {
  id: string
  customer_account_id: string
  statement_id: string | null
  amount: number
  stripe_payment_intent_id: string | null
  status: PaymentStatus
  paid_at: string | null
  created_at: string
}

export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded'

// ── Constants ──────────────────────────────────────────────────────────────

export const BILLING_STATUSES = ['pending', 'paid', 'overdue', 'waived'] as const

export const BILLING_STATUS_LABELS: Record<BillingStatementStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  overdue: 'Overdue',
  waived: 'Waived',
}

export const BILLING_STATUS_BADGE: Record<BillingStatementStatus, string> = {
  pending: 'bg-yellow-900 text-yellow-300',
  paid: 'bg-green-900 text-green-300',
  overdue: 'bg-red-900 text-red-300',
  waived: 'bg-gray-700 text-gray-300',
}

export const PAYMENT_STATUSES = ['pending', 'processing', 'succeeded', 'failed', 'refunded'] as const

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  succeeded: 'Succeeded',
  failed: 'Failed',
  refunded: 'Refunded',
}

export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  pending: 'bg-yellow-900 text-yellow-300',
  processing: 'bg-blue-900 text-blue-300',
  succeeded: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
  refunded: 'bg-gray-700 text-gray-300',
}

// ── Billing Statements ─────────────────────────────────────────────────────

/** Load billing statements for a customer account, ordered by period descending */
export async function loadBillingStatements(accountId: string): Promise<BillingStatement[]> {
  const { data, error } = await db()
    .from('customer_billing_statements')
    .select('*')
    .eq('customer_account_id', accountId)
    .order('period_start', { ascending: false })
    .limit(24)

  if (error) { console.error('[loadBillingStatements]', error.message); return [] }
  return (data ?? []) as BillingStatement[]
}

/** Get the latest pending statement for a customer (current bill) */
export async function getCurrentStatement(accountId: string): Promise<BillingStatement | null> {
  const { data, error } = await db()
    .from('customer_billing_statements')
    .select('*')
    .eq('customer_account_id', accountId)
    .eq('status', 'pending')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) { console.error('[getCurrentStatement]', error.message); return null }
  return data as BillingStatement | null
}

/** Load all statements for a project (CRM view) */
export async function loadProjectBillingStatements(projectId: string): Promise<BillingStatement[]> {
  const { data, error } = await db()
    .from('customer_billing_statements')
    .select('*')
    .eq('project_id', projectId)
    .order('period_start', { ascending: false })
    .limit(24)

  if (error) { console.error('[loadProjectBillingStatements]', error.message); return [] }
  return (data ?? []) as BillingStatement[]
}

// ── Payment Methods ────────────────────────────────────────────────────────

/** Load active payment methods for a customer */
export async function loadPaymentMethods(accountId: string): Promise<PaymentMethod[]> {
  const { data, error } = await db()
    .from('customer_payment_methods')
    .select('*')
    .eq('customer_account_id', accountId)
    .order('is_default', { ascending: false })

  if (error) { console.error('[loadPaymentMethods]', error.message); return [] }
  return (data ?? []) as PaymentMethod[]
}

// ── Payment History ────────────────────────────────────────────────────────

/** Load payment history for a customer account */
export async function loadPaymentHistory(accountId: string): Promise<PaymentRecord[]> {
  const { data, error } = await db()
    .from('customer_payments')
    .select('*')
    .eq('customer_account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) { console.error('[loadPaymentHistory]', error.message); return [] }
  return (data ?? []) as PaymentRecord[]
}

/** Load payments for a specific statement */
export async function loadStatementPayments(statementId: string): Promise<PaymentRecord[]> {
  const { data, error } = await db()
    .from('customer_payments')
    .select('*')
    .eq('statement_id', statementId)
    .order('created_at', { ascending: false })

  if (error) { console.error('[loadStatementPayments]', error.message); return [] }
  return (data ?? []) as PaymentRecord[]
}
