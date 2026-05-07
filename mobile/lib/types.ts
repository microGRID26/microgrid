// Shared types for the customer portal — mirrors lib/api/customer-portal.ts

export interface CustomerAccount {
  id: string
  auth_user_id: string | null
  email: string
  name: string
  phone: string | null
  project_id: string
  status: 'invited' | 'active' | 'suspended'
  last_login_at: string | null
  notification_prefs: {
    project_updates: boolean
    schedule_alerts: boolean
    ticket_updates: boolean
    energy_reports: boolean
    promotions: boolean
  }
  /**
   * One-shot tracking for NPS prompts. Keys are milestone identifiers
   * (pto_complete, first_billing_30d, onboarding_complete), values are
   * ISO date strings of when the prompt was shown. Presence of a key
   * means the prompt won't be shown again.
   */
  nps_prompts_shown?: Record<string, string>
  created_at: string
}

export interface CustomerProject {
  id: string
  name: string
  address: string | null
  city: string | null
  zip: string | null
  stage: string
  stage_date: string | null
  sale_date: string | null
  survey_scheduled_date: string | null
  survey_date: string | null
  city_permit_date: string | null
  utility_permit_date: string | null
  install_scheduled_date: string | null
  install_complete_date: string | null
  city_inspection_date: string | null
  utility_inspection_date: string | null
  pto_date: string | null
  in_service_date: string | null
  module: string | null
  module_qty: number | null
  inverter: string | null
  inverter_qty: number | null
  battery: string | null
  battery_qty: number | null
  systemkw: number | null
  financier: string | null
  disposition: string | null
}

export interface StageHistoryEntry {
  id: string
  project_id: string
  stage: string
  entered: string
}

export interface CustomerScheduleEntry {
  id: string
  project_id: string
  job_type: string
  date: string
  end_date: string | null
  time: string | null
  status: string | null
  arrival_window: string | null
}

export interface CustomerTicket {
  id: string
  ticket_number: string
  title: string
  description: string | null
  category: string
  priority: string
  status: string
  created_at: string
  resolved_at: string | null
}

export interface TicketComment {
  id: string
  ticket_id: string
  author: string
  message: string
  image_url?: string | null
  image_path?: string | null
  created_at: string
}

export interface CustomerDocument {
  id: string
  project_id: string
  file_name: string
  file_type: string | null
  file_url: string
  category: string | null
  created_at: string
}

export interface CustomerTaskState {
  task_id: string
  status: string
  completed_date: string | null
  started_date: string | null
}

export interface CustomerReferral {
  id: string
  referrer_id: string
  referrer_project_id: string | null
  referee_name: string
  referee_email: string | null
  referee_phone: string
  status: 'pending' | 'contacted' | 'signed' | 'installed' | 'paid'
  bonus_amount: number
  notes: string | null
  org_id: string | null
  created_at: string
  updated_at: string
}

export interface CustomerWarranty {
  id: string
  project_id: string
  equipment_type: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  quantity: number
  install_date: string | null
  warranty_start_date: string | null
  warranty_end_date: string | null
  warranty_years: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface EnergyStats {
  estimated_monthly_kwh: number
  estimated_annual_kwh: number
  co2_offset_tons: number
  trees_equivalent: number
  cost_savings_monthly: number
}

// ── Customer Billing ──────────────────────────────────────────────────────

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
  status: 'pending' | 'paid' | 'overdue' | 'waived'
  due_date: string | null
  paid_at: string | null
  stripe_invoice_id: string | null
  org_id: string | null
  created_at: string
  updated_at: string
}

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
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded'
  paid_at: string | null
  created_at: string
}

// ── Direct Messages ─────────────────────────────────────────────────────────

export interface CustomerMessage {
  id: string
  project_id: string
  author_type: 'customer' | 'pm' | 'system'
  author_name: string
  message: string
  read_at: string | null
  created_at: string
}

// ── Project Activity Feed ───────────────────────────────────────────────────
// Unified chronological feed assembled from stage_history + schedule + tickets.
// project_files is intentionally excluded until customer RLS lands (see action #607).
// customer_messages is intentionally excluded to avoid duplicating the Messages tab.

export type ActivityKind =
  | 'stage'           // stage transition
  | 'schedule'        // appointment scheduled / changed
  | 'ticket_opened'
  | 'ticket_resolved'

export interface ActivityItem {
  id: string             // unique key — `${kind}:${source_id}` so duplicates collapse
  kind: ActivityKind
  ts: string             // ISO timestamp, sortable
  title: string          // customer-facing headline
  description: string | null
  metadata: {
    stage?: string
    job_type?: string
    status?: string | null
    arrival_window?: string | null
    ticket_number?: string
    ticket_id?: string
    category?: string
  }
}
