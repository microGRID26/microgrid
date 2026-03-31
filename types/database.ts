export type Stage = 'evaluation' | 'survey' | 'design' | 'permit' | 'install' | 'inspection' | 'complete'

export interface Project {
  id: string
  name: string
  city: string | null
  zip: string | null
  address: string | null
  phone: string | null
  email: string | null
  sale_date: string | null
  stage: Stage
  stage_date: string | null
  pm: string | null
  pm_id: string | null
  disposition: string | null
  contract: number | null
  systemkw: number | null
  financier: string | null
  ahj: string | null
  utility: string | null
  advisor: string | null
  consultant: string | null
  blocker: string | null
  financing_type: string | null
  down_payment: number | null
  tpo_escalator: number | null
  financier_adv_pmt: string | null
  module: string | null
  module_qty: number | null
  inverter: string | null
  inverter_qty: number | null
  battery: string | null
  battery_qty: number | null
  optimizer: string | null
  optimizer_qty: number | null
  meter_location: string | null
  panel_location: string | null
  voltage: string | null
  msp_bus_rating: string | null
  mpu: string | null
  shutdown: string | null
  performance_meter: string | null
  interconnection_breaker: string | null
  main_breaker: string | null
  hoa: string | null
  esid: string | null
  meter_number: string | null
  permit_number: string | null
  utility_app_number: string | null
  permit_fee: number | null
  reinspection_fee: number | null
  city_permit_date: string | null
  utility_permit_date: string | null
  ntp_date: string | null
  survey_scheduled_date: string | null
  survey_date: string | null
  install_scheduled_date: string | null
  install_complete_date: string | null
  city_inspection_date: string | null
  utility_inspection_date: string | null
  pto_date: string | null
  in_service_date: string | null
  site_surveyor: string | null
  consultant_email: string | null
  dealer: string | null
  follow_up_date: string | null
  energy_community: boolean
  org_id: string | null
  created_at: string
}

export interface Note {
  id: string
  project_id: string
  task_id: string | null
  text: string
  time: string
  pm: string | null
  pm_id: string | null
}

export interface TaskState {
  project_id: string
  task_id: string
  status: string
  reason: string | null
  completed_date: string | null
  started_date: string | null
  notes: string | null
  follow_up_date: string | null
}

export interface StageHistory {
  id: string
  project_id: string
  stage: string
  entered: string
}

export interface TaskHistory {
  id: string
  project_id: string
  task_id: string
  status: string
  reason: string | null
  changed_by: string | null
  changed_at: string
}

export interface Crew {
  id: string
  name: string
  warehouse: string | null
  active: string | null
  license_holder: string | null
  electrician: string | null
  solar_lead: string | null
  battery_lead: string | null
  installer1: string | null
  installer2: string | null
  battery_tech1: string | null
  battery_tech2: string | null
  battery_apprentice: string | null
  mpu_electrician: string | null
  org_id: string | null
}

export interface Schedule {
  id: string
  project_id: string
  crew_id: string
  job_type: string
  date: string
  end_date: string | null
  time: string | null
  notes: string | null
  status: string
  pm: string | null
  pm_id: string | null
  arrival_window: string | null
  arrays: number | null
  pitch: string | null
  stories: string | null
  special_equipment: string | null
  electrical_notes: string | null
  wind_speed: string | null
  risk_category: string | null
  travel_adder: string | null
  wifi_info: string | null
  msp_upgrade: string | null
}

export interface ProjectFunding {
  project_id: string
  m1_amount: number | null
  m1_funded_date: string | null
  m1_cb: number | null
  m1_cb_credit: number | null
  m1_notes: string | null
  m1_status: string | null
  m2_amount: number | null
  m2_funded_date: string | null
  m2_cb: number | null
  m2_cb_credit: number | null
  m2_notes: string | null
  m2_status: string | null
  m3_amount: number | null
  m3_funded_date: string | null
  m3_projected: number | null
  m3_notes: string | null
  m3_status: string | null
  nonfunded_code_1: string | null
  nonfunded_code_2: string | null
  nonfunded_code_3: string | null
}

export interface NonfundedCode {
  code: string
  master_code: string
  description: string
  responsible_party: string | null
  reference: string | null
}

export interface ProjectFolder {
  project_id: string
  folder_id: string | null
  folder_url: string | null
}

export interface ServiceCall {
  id: string
  project_id: string
  status: string
  type: string | null
  issue: string | null
  created: string | null
  date: string | null
  resolution: string | null
  pm: string | null
  pm_id: string | null
  priority: string | null
  created_at: string
  sales_rep_id: string | null
  ticket_category: string | null
  project?: { name: string; city: string } | null
}

export interface RepLicense {
  id: string
  rep_id: string
  license_type: string
  license_number: string | null
  state: string | null
  issued_date: string | null
  expiry_date: string | null
  status: string
  verified_by: string | null
  verified_at: string | null
  file_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface RepFile {
  id: string
  rep_id: string
  file_type: string
  file_name: string
  file_url: string
  uploaded_by: string | null
  notes: string | null
  created_at: string
}

export interface AHJ {
  id: string
  name: string
  permit_phone: string | null
  permit_website: string | null
  max_duration: number | null
  electric_code: string | null
  permit_notes: string | null
  username: string | null
  password: string | null
}

export interface Utility {
  id: string
  name: string
  phone: string | null
  website: string | null
  notes: string | null
}

export interface HOA {
  id: string
  name: string
  phone: string | null
  website: string | null
  contact_name: string | null
  contact_email: string | null
  notes: string | null
}

export interface Financier {
  id: string
  name: string
  phone: string | null
  website: string | null
  contact_name: string | null
  contact_email: string | null
  notes: string | null
}

export interface TaskReason {
  id: string
  task_id: string
  reason_type: 'pending' | 'revision'
  reason: string
  active: boolean
  sort_order: number
  org_id: string | null
}

export type UserRole = 'super_admin' | 'admin' | 'finance' | 'manager' | 'user' | 'sales'

export interface User {
  id: string
  name: string
  email: string
  department: string | null
  position: string | null
  role: UserRole
  admin: boolean
  super_admin: boolean
  active: boolean
  color: string | null
  crew: string | null
}

export interface AuditLog {
  id: number
  project_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_by_id: string | null
  changed_at: string
}

export interface SLAThreshold {
  stage: string
  target: number
  risk: number
  crit: number
}

export interface ChangeOrder {
  id: number
  project_id: string
  title: string
  status: string
  priority: string
  type: string
  reason: string | null
  origin: string | null
  assigned_to: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  notes: string | null
  design_request_submitted: boolean
  design_in_progress: boolean
  design_pending_approval: boolean
  design_approved: boolean
  design_complete: boolean
  design_signed: boolean
  original_panel_count: number | null
  original_panel_type: string | null
  original_system_size: number | null
  original_panel_size: string | null
  original_kwh_yr: number | null
  original_lease_ppa_price: number | null
  original_lease_ppa_escalator: number | null
  original_loan_amount: number | null
  original_adv_pmt_schedule: string | null
  original_financier_fee: number | null
  original_plan_type: string | null
  new_panel_count: number | null
  new_panel_type: string | null
  new_system_size: number | null
  new_panel_size: string | null
  new_kwh_yr: number | null
  new_lease_ppa_price: number | null
  new_lease_ppa_escalator: number | null
  new_loan_amount: number | null
  new_adv_pmt_schedule: string | null
  new_financier_fee: number | null
  project?: { name: string; city: string; pm: string | null; pm_id: string | null }
}

export interface Feedback {
  id: number
  user_name: string | null
  user_email: string | null
  type: string
  page: string | null
  message: string
  status: string
  admin_notes: string | null
  created_at: string
}

export interface UserSession {
  id: string
  user_id: string
  user_name: string
  user_email: string
  logged_in_at: string
  last_active_at: string
  page: string | null
}

export interface MentionNotification {
  id: string
  project_id: string
  mentioned_user_id: string
  mentioned_by: string
  message: string | null
  read: boolean
  created_at: string
}

export interface ProjectAdder {
  id: string
  project_id: string
  adder_name: string
  price: number
  quantity: number
  total_amount: number
  created_at: string
}

export interface ProjectBom {
  project_id: string
  array_count: number | null
  row_count: number | null
  attachment_count: number | null
  overrides: Record<string, number | undefined> | null
  version: number | null
  created_at: string
}

export interface NotificationRule {
  id: string
  task_id: string
  trigger_status: string
  trigger_reason: string | null
  action_type: string
  action_message: string
  notify_role: string | null
  active: boolean
  created_by: string | null
  org_id: string | null
  created_at: string
}

export interface QueueSection {
  id: string
  label: string
  task_id: string
  match_status: string
  color: string
  icon: string
  sort_order: number
  active: boolean
  org_id: string | null
  created_at: string
}

export interface UserPreference {
  user_id: string
  homepage: string
  default_pm_filter: string | null
  collapsed_sections: Record<string, boolean>
  queue_card_fields: string[]
  export_presets: Record<string, unknown>[]
  created_at: string
  updated_at: string
}

export interface Equipment {
  id: string
  name: string
  manufacturer: string | null
  model: string | null
  category: string
  watts: number | null
  description: string | null
  active: boolean
  sort_order: number
  sourcing: string | null
  raw_price: number | null
  sell_price: number | null
  created_at: string
}

export interface DocumentRequirement {
  id: string
  stage: string
  task_id: string | null
  document_type: string
  folder_name: string | null
  filename_pattern: string | null
  required: boolean
  description: string | null
  sort_order: number
  active: boolean
  org_id: string | null
  created_at: string
}

export interface ProjectDocument {
  id: string
  project_id: string
  requirement_id: string
  file_id: string | null
  status: 'present' | 'missing' | 'pending' | 'verified'
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
}

export interface ProjectFile {
  id: string
  project_id: string
  folder_name: string | null
  file_name: string
  file_id: string
  file_url: string | null
  mime_type: string | null
  file_size: number | null
  created_at: string | null
  updated_at: string | null
  synced_at: string
}

export interface ProjectMaterial {
  id: string
  project_id: string
  equipment_id: string | null
  name: string
  category: string
  quantity: number
  unit: string
  source: string
  vendor: string | null
  status: string
  po_number: string | null
  expected_date: string | null
  delivered_date: string | null
  notes: string | null
  sourcing: string | null
  raw_price: number | null
  sell_price: number | null
  created_at: string
  updated_at: string
}

export interface WarehouseStock {
  id: string
  equipment_id: string | null
  name: string
  category: string
  quantity_on_hand: number
  reorder_point: number
  unit: string
  location: string | null
  barcode: string | null
  last_counted_at: string | null
  org_id: string | null
  sourcing: string | null
  raw_price: number | null
  sell_price: number | null
  updated_at: string
}

export interface WarehouseTransaction {
  id: string
  stock_id: string
  project_id: string | null
  transaction_type: 'checkout' | 'checkin' | 'adjustment' | 'recount'
  quantity: number
  notes: string | null
  performed_by: string | null
  created_at: string
}

export interface PurchaseOrder {
  id: string
  po_number: string
  vendor: string
  project_id: string | null
  status: string
  total_amount: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  confirmed_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  tracking_number: string | null
  expected_delivery: string | null
  delivery_accurate: boolean | null
  delivery_discrepancy: string | null
}

export interface POLineItem {
  id: string
  po_id: string
  material_id: string | null
  equipment_id: string | null
  name: string
  quantity: number
  unit_price: number | null
  total_price: number | null
  notes: string | null
}

export interface EdgeSyncLog {
  id: string
  project_id: string
  event_type: string
  direction: 'outbound' | 'inbound'
  payload: Record<string, unknown> | null
  status: 'sent' | 'delivered' | 'failed'
  response_code: number | null
  error_message: string | null
  created_at: string
}

export interface LegacyProject {
  id: string
  ns_internal_id: string | null
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  lat: number | null
  lon: number | null
  systemkw: number | null
  module: string | null
  module_qty: number | null
  inverter: string | null
  inverter_qty: number | null
  battery: string | null
  battery_qty: number | null
  contract: number | null
  financier: string | null
  financing_type: string | null
  dealer: string | null
  advisor: string | null
  consultant: string | null
  pm: string | null
  sale_date: string | null
  survey_date: string | null
  install_date: string | null
  pto_date: string | null
  in_service_date: string | null
  disposition: string | null
  ahj: string | null
  utility: string | null
  hoa: string | null
  permit_number: string | null
  utility_app_number: string | null
  voltage: string | null
  msp_bus_rating: string | null
  main_breaker: string | null
  stage: string
  stage_date: string | null
  m2_amount: number | null
  m2_funded_date: string | null
  m3_amount: number | null
  m3_funded_date: string | null
}

export interface LegacyNote {
  id: string
  project_id: string
  author: string | null
  message: string | null
  created_at: string
}

export interface WorkOrder {
  id: string
  project_id: string
  wo_number: string
  type: string
  status: string
  assigned_crew: string | null
  assigned_to: string | null
  scheduled_date: string | null
  started_at: string | null
  completed_at: string | null
  priority: string
  description: string | null
  special_instructions: string | null
  customer_signature: boolean
  customer_signed_at: string | null
  materials_used: Record<string, unknown>[]
  time_on_site_minutes: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface WOChecklistItem {
  id: string
  work_order_id: string
  description: string
  completed: boolean
  completed_by: string | null
  completed_at: string | null
  sort_order: number
  notes: string | null
  photo_url: string | null
}

export interface EmailOnboarding {
  id: string
  user_id: string
  user_email: string
  user_name: string | null
  current_day: number
  started_at: string
  last_sent_at: string | null
  paused: boolean
  completed: boolean
}

export interface Vendor {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  category: string | null
  equipment_types: string[] | null
  lead_time_days: number | null
  payment_terms: string | null
  notes: string | null
  active: boolean
  org_id: string | null
  created_at: string
}

export interface CalendarSettingsRow {
  id: string
  crew_id: string
  calendar_id: string | null
  enabled: boolean
  auto_sync: boolean
  last_full_sync: string | null
  created_at: string
}

export interface CalendarSyncRow {
  id: string
  schedule_id: string
  calendar_id: string
  event_id: string
  crew_id: string | null
  last_synced_at: string
  sync_status: 'synced' | 'pending' | 'error'
  error_message: string | null
  created_at: string
}

export type AssignmentType = 'new_design' | 'redesign' | 'review' | 'stamp'
export type AssignmentStatus = 'pending' | 'assigned' | 'in_progress' | 'review' | 'revision_needed' | 'complete' | 'cancelled'

export interface EngineeringAssignment {
  id: string
  project_id: string
  assigned_org: string
  requesting_org: string
  assignment_type: AssignmentType
  status: AssignmentStatus
  priority: string
  assigned_to: string | null
  assigned_at: string | null
  started_at: string | null
  completed_at: string | null
  due_date: string | null
  notes: string | null
  deliverables: Record<string, unknown>[]
  revision_count: number
  created_by: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
}

export type NTPStatusType = 'pending' | 'under_review' | 'approved' | 'rejected' | 'revision_required'

export interface NTPRequest {
  id: string
  project_id: string
  requesting_org: string
  status: NTPStatusType
  submitted_by: string | null
  submitted_by_id: string | null
  reviewed_by: string | null
  reviewed_by_id: string | null
  submitted_at: string
  reviewed_at: string | null
  rejection_reason: string | null
  revision_notes: string | null
  evidence: Record<string, unknown>
  notes: string | null
  created_at: string
  updated_at: string
}

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled'
export type CommissionRateType = 'per_watt' | 'percentage' | 'flat'

export interface CommissionRate {
  id: string
  role_key: string
  label: string
  rate_type: CommissionRateType
  rate: number
  description: string | null
  active: boolean
  sort_order: number
  org_id: string | null
  created_at: string
  updated_at: string
}

export interface CommissionRecord {
  id: string
  project_id: string
  user_id: string | null
  user_name: string | null
  role_key: string
  system_watts: number | null
  rate: number
  adder_revenue: number | null
  referral_count: number
  solar_commission: number
  adder_commission: number
  referral_commission: number
  total_commission: number
  status: CommissionStatus
  milestone: string | null
  paid_at: string | null
  notes: string | null
  admin_notes: string | null
  days_since_sale: number | null
  is_energy_community: boolean
  adder_deduction: number
  org_id: string | null
  created_at: string
  updated_at: string
}

export interface CommissionTier {
  id: string
  rate_id: string
  min_deals: number | null
  max_deals: number | null
  min_watts: number | null
  max_watts: number | null
  rate: number
  label: string | null
  sort_order: number
  created_at: string
}

export interface CommissionGeoModifier {
  id: string
  state: string | null
  city: string | null
  region: string | null
  modifier: number
  label: string | null
  active: boolean
  org_id: string | null
  created_at: string
}

export interface CommissionHierarchy {
  id: string
  user_id: string
  user_name: string | null
  role_key: string
  parent_id: string | null
  team_name: string | null
  active: boolean
  org_id: string | null
  created_at: string
  updated_at: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled' | 'disputed'

export interface Invoice {
  id: string
  invoice_number: string
  project_id: string | null
  from_org: string
  to_org: string
  status: InvoiceStatus
  milestone: string | null
  subtotal: number
  tax: number
  total: number
  due_date: string | null
  sent_at: string | null
  paid_at: string | null
  paid_amount: number | null
  payment_method: string | null
  payment_reference: string | null
  notes: string | null
  created_by: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceLineItem {
  id: string
  invoice_id: string
  description: string
  quantity: number
  unit_price: number
  total: number
  category: string | null
  sort_order: number
  created_at: string
}

export interface InvoiceRule {
  id: string
  name: string
  milestone: string
  from_org_type: string
  to_org_type: string
  line_items: Record<string, unknown>[]
  active: boolean
  created_at: string
  updated_at: string
}

// ── Pay Scales & Sales Teams ────────────────────────────────────────────────

export type RepStatus = 'onboarding' | 'active' | 'inactive' | 'terminated'
export type OnboardingDocStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'uploaded' | 'verified' | 'rejected'

export interface PayScale {
  id: string
  name: string
  description: string | null
  per_watt_rate: number
  adder_percentage: number
  referral_bonus: number
  sort_order: number
  active: boolean
  org_id: string | null
  created_at: string
  updated_at: string
}

export interface PayDistribution {
  id: string
  role_key: string
  label: string
  percentage: number
  sort_order: number
  active: boolean
  org_id: string | null
  created_at: string
}

export interface SalesTeam {
  id: string
  name: string
  vp_user_id: string | null
  vp_name: string | null
  regional_user_id: string | null
  regional_name: string | null
  manager_user_id: string | null
  manager_name: string | null
  assistant_manager_user_id: string | null
  assistant_manager_name: string | null
  stack_per_watt: number
  active: boolean
  org_id: string | null
  created_at: string
  updated_at: string
}

export interface SalesRep {
  id: string
  user_id: string | null
  auth_user_id: string | null
  first_name: string
  last_name: string
  email: string
  phone: string | null
  team_id: string | null
  pay_scale_id: string | null
  role_key: string
  hire_date: string | null
  status: RepStatus
  split_percentage: number
  split_partner_id: string | null
  notes: string | null
  recheck_id: string | null
  blacklisted: boolean
  blacklist_reason: string | null
  org_id: string | null
  created_at: string
  updated_at: string
}

export interface OnboardingRequirement {
  id: string
  name: string
  description: string | null
  required: boolean
  sort_order: number
  active: boolean
  org_id: string | null
  created_at: string
}

export interface OnboardingDocument {
  id: string
  rep_id: string
  requirement_id: string
  status: OnboardingDocStatus
  sent_at: string | null
  viewed_at: string | null
  signed_at: string | null
  uploaded_at: string | null
  verified_at: string | null
  verified_by: string | null
  file_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type AdvanceStatus = 'pending' | 'approved' | 'paid' | 'clawed_back' | 'cancelled'

export interface CommissionConfig {
  id: string
  config_key: string
  value: string
  description: string | null
  org_id: string | null
  updated_at: string
}

export interface CommissionAdvance {
  id: string
  project_id: string
  rep_id: string | null
  rep_name: string | null
  role_key: string
  amount: number
  milestone: string
  status: AdvanceStatus
  self_generated: boolean
  paid_at: string | null
  clawback_date: string | null
  clawback_reason: string | null
  clawed_back_at: string | null
  notes: string | null
  admin_notes: string | null
  org_id: string | null
  created_at: string
  updated_at: string
}

export type OrgType = 'platform' | 'epc' | 'sales' | 'engineering' | 'supply' | 'customer'
export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface Organization {
  id: string
  name: string
  slug: string
  org_type: OrgType
  allowed_domains: string[]
  logo_url: string | null
  settings: Record<string, unknown>
  active: boolean
  created_at: string
  updated_at: string
}

export interface OrgMembership {
  id: string
  user_id: string
  org_id: string
  org_role: OrgRole
  is_default: boolean
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: Project
        Insert: Partial<Project> & { id: string }
        Update: Partial<Project>

      }
      notes: {
        Row: Note
        Insert: Omit<Note, 'id'> & { id?: string }
        Update: Partial<Note>

      }
      task_state: {
        Row: TaskState
        Insert: TaskState
        Update: Partial<TaskState>

      }
      stage_history: {
        Row: StageHistory
        Insert: Omit<StageHistory, 'id'> & { id?: string }
        Update: Partial<StageHistory>

      }
      task_history: {
        Row: TaskHistory
        Insert: Omit<TaskHistory, 'id'> & { id?: string }
        Update: Partial<TaskHistory>

      }
      crews: {
        Row: Crew
        Insert: Omit<Crew, 'id'> & { id?: string }
        Update: Partial<Crew>

      }
      schedule: {
        Row: Schedule
        Insert: Omit<Schedule, 'id'> & { id?: string }
        Update: Partial<Schedule>

      }
      project_funding: {
        Row: ProjectFunding
        Insert: ProjectFunding
        Update: Partial<ProjectFunding>

      }
      project_folders: {
        Row: ProjectFolder
        Insert: ProjectFolder
        Update: Partial<ProjectFolder>

      }
      service_calls: {
        Row: ServiceCall
        Insert: Omit<ServiceCall, 'id'> & { id?: string }
        Update: Partial<ServiceCall>

      }
      ahjs: {
        Row: AHJ
        Insert: Omit<AHJ, 'id'> & { id?: string }
        Update: Partial<AHJ>

      }
      utilities: {
        Row: Utility
        Insert: Omit<Utility, 'id'> & { id?: string }
        Update: Partial<Utility>

      }
      hoas: {
        Row: HOA
        Insert: Omit<HOA, 'id'> & { id?: string }
        Update: Partial<HOA>

      }
      financiers: {
        Row: Financier
        Insert: Omit<Financier, 'id'> & { id?: string }
        Update: Partial<Financier>

      }
      task_reasons: {
        Row: TaskReason
        Insert: Omit<TaskReason, 'id'> & { id?: string }
        Update: Partial<TaskReason>

      }
      users: {
        Row: User
        Insert: Omit<User, 'id'> & { id?: string }
        Update: Partial<User>

      }
      sla_thresholds: {
        Row: SLAThreshold
        Insert: SLAThreshold
        Update: Partial<SLAThreshold>

      }
      nonfunded_codes: {
        Row: NonfundedCode
        Insert: NonfundedCode
        Update: Partial<NonfundedCode>

      }
      audit_log: {
        Row: AuditLog
        Insert: Omit<AuditLog, 'id' | 'changed_at'> & { id?: number; changed_at?: string }
        Update: Partial<AuditLog>

      }
      change_orders: {
        Row: ChangeOrder
        Insert: Omit<ChangeOrder, 'id'> & { id?: number }
        Update: Partial<ChangeOrder>

      }
      feedback: {
        Row: Feedback
        Insert: Omit<Feedback, 'id' | 'status' | 'created_at'> & { id?: number; status?: string; created_at?: string }
        Update: Partial<Feedback>

      }
      user_sessions: {
        Row: UserSession
        Insert: Omit<UserSession, 'id'> & { id?: string }
        Update: Partial<UserSession>

      }
      mention_notifications: {
        Row: MentionNotification
        Insert: Omit<MentionNotification, 'id' | 'read' | 'created_at'> & { id?: string; read?: boolean; created_at?: string }
        Update: Partial<MentionNotification>

      }
      project_adders: {
        Row: ProjectAdder
        Insert: Omit<ProjectAdder, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<ProjectAdder>

      }
      project_boms: {
        Row: ProjectBom
        Insert: ProjectBom
        Update: Partial<ProjectBom>

      }
      notification_rules: {
        Row: NotificationRule
        Insert: Omit<NotificationRule, 'id' | 'active' | 'created_at'> & { id?: string; active?: boolean; created_at?: string }
        Update: Partial<NotificationRule>

      }
      queue_sections: {
        Row: QueueSection
        Insert: Omit<QueueSection, 'id' | 'color' | 'icon' | 'sort_order' | 'active' | 'created_at'> & { id?: string; color?: string; icon?: string; sort_order?: number; active?: boolean; created_at?: string }
        Update: Partial<QueueSection>

      }
      user_preferences: {
        Row: UserPreference
        Insert: Pick<UserPreference, 'user_id'> & Partial<Omit<UserPreference, 'user_id'>>
        Update: Partial<UserPreference>

      }
      equipment: {
        Row: Equipment
        Insert: Omit<Equipment, 'id' | 'active' | 'sort_order' | 'created_at'> & { id?: string; active?: boolean; sort_order?: number; created_at?: string }
        Update: Partial<Equipment>

      }
      document_requirements: {
        Row: DocumentRequirement
        Insert: Omit<DocumentRequirement, 'id' | 'required' | 'sort_order' | 'active' | 'created_at'> & { id?: string; required?: boolean; sort_order?: number; active?: boolean; created_at?: string }
        Update: Partial<DocumentRequirement>

      }
      project_documents: {
        Row: ProjectDocument
        Insert: Omit<ProjectDocument, 'id' | 'status' | 'created_at'> & { id?: string; status?: ProjectDocument['status']; created_at?: string }
        Update: Partial<ProjectDocument>

      }
      project_files: {
        Row: ProjectFile
        Insert: Omit<ProjectFile, 'id' | 'synced_at'> & { id?: string; synced_at?: string }
        Update: Partial<ProjectFile>

      }
      project_materials: {
        Row: ProjectMaterial
        Insert: Omit<ProjectMaterial, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string }
        Update: Partial<ProjectMaterial>

      }
      warehouse_stock: {
        Row: WarehouseStock
        Insert: Omit<WarehouseStock, 'id' | 'updated_at'> & { id?: string; updated_at?: string }
        Update: Partial<WarehouseStock>

      }
      warehouse_transactions: {
        Row: WarehouseTransaction
        Insert: Omit<WarehouseTransaction, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<WarehouseTransaction>

      }
      purchase_orders: {
        Row: PurchaseOrder
        Insert: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string }
        Update: Partial<PurchaseOrder>

      }
      po_line_items: {
        Row: POLineItem
        Insert: Omit<POLineItem, 'id'> & { id?: string }
        Update: Partial<POLineItem>

      }
      edge_sync_log: {
        Row: EdgeSyncLog
        Insert: Omit<EdgeSyncLog, 'id' | 'status' | 'created_at'> & { id?: string; status?: string; created_at?: string }
        Update: Partial<EdgeSyncLog>

      }
      legacy_projects: {
        Row: LegacyProject
        Insert: LegacyProject
        Update: Partial<LegacyProject>

      }
      legacy_notes: {
        Row: LegacyNote
        Insert: Omit<LegacyNote, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<LegacyNote>

      }
      vendors: {
        Row: Vendor
        Insert: Omit<Vendor, 'id' | 'active' | 'created_at'> & { id?: string; active?: boolean; created_at?: string }
        Update: Partial<Vendor>

      }
      email_onboarding: {
        Row: EmailOnboarding
        Insert: Omit<EmailOnboarding, 'id' | 'current_day' | 'paused' | 'completed' | 'started_at'> & { id?: string; current_day?: number; paused?: boolean; completed?: boolean; started_at?: string }
        Update: Partial<EmailOnboarding>

      }
      work_orders: {
        Row: WorkOrder
        Insert: Omit<WorkOrder, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string }
        Update: Partial<WorkOrder>

      }
      wo_checklist_items: {
        Row: WOChecklistItem
        Insert: Omit<WOChecklistItem, 'id' | 'completed' | 'sort_order'> & { id?: string; completed?: boolean; sort_order?: number }
        Update: Partial<WOChecklistItem>

      }
      calendar_settings: {
        Row: CalendarSettingsRow
        Insert: Omit<CalendarSettingsRow, 'id' | 'enabled' | 'auto_sync' | 'created_at'> & { id?: string; enabled?: boolean; auto_sync?: boolean; created_at?: string }
        Update: Partial<CalendarSettingsRow>

      }
      calendar_sync: {
        Row: CalendarSyncRow
        Insert: Omit<CalendarSyncRow, 'id' | 'sync_status' | 'created_at'> & { id?: string; sync_status?: string; created_at?: string }
        Update: Partial<CalendarSyncRow>

      }
      ntp_requests: {
        Row: NTPRequest
        Insert: Omit<NTPRequest, 'id' | 'status' | 'created_at' | 'updated_at'> & { id?: string; status?: NTPStatusType; created_at?: string; updated_at?: string }
        Update: Partial<NTPRequest>

      }
      engineering_assignments: {
        Row: EngineeringAssignment
        Insert: Omit<EngineeringAssignment, 'id' | 'status' | 'revision_count' | 'created_at' | 'updated_at'> & { id?: string; status?: AssignmentStatus; revision_count?: number; created_at?: string; updated_at?: string }
        Update: Partial<EngineeringAssignment>

      }
      organizations: {
        Row: Organization
        Insert: Omit<Organization, 'id' | 'active' | 'created_at' | 'updated_at'> & { id?: string; active?: boolean; created_at?: string; updated_at?: string }
        Update: Partial<Organization>

      }
      org_memberships: {
        Row: OrgMembership
        Insert: Omit<OrgMembership, 'id' | 'is_default' | 'created_at'> & { id?: string; is_default?: boolean; created_at?: string }
        Update: Partial<OrgMembership>

      }
      invoices: {
        Row: Invoice
        Insert: Omit<Invoice, 'id' | 'status' | 'subtotal' | 'tax' | 'total' | 'created_at' | 'updated_at'> & { id?: string; status?: InvoiceStatus; subtotal?: number; tax?: number; total?: number; created_at?: string; updated_at?: string }
        Update: Partial<Invoice>

      }
      invoice_line_items: {
        Row: InvoiceLineItem
        Insert: Omit<InvoiceLineItem, 'id' | 'quantity' | 'unit_price' | 'total' | 'sort_order' | 'created_at'> & { id?: string; quantity?: number; unit_price?: number; total?: number; sort_order?: number; created_at?: string }
        Update: Partial<InvoiceLineItem>

      }
      invoice_rules: {
        Row: InvoiceRule
        Insert: Omit<InvoiceRule, 'id' | 'active' | 'created_at' | 'updated_at'> & { id?: string; active?: boolean; created_at?: string; updated_at?: string }
        Update: Partial<InvoiceRule>

      }
      commission_rates: {
        Row: CommissionRate
        Insert: Omit<CommissionRate, 'id' | 'active' | 'sort_order' | 'created_at' | 'updated_at'> & { id?: string; active?: boolean; sort_order?: number; created_at?: string; updated_at?: string }
        Update: Partial<CommissionRate>

      }
      commission_records: {
        Row: CommissionRecord
        Insert: Omit<CommissionRecord, 'id' | 'referral_count' | 'solar_commission' | 'adder_commission' | 'referral_commission' | 'total_commission' | 'status' | 'created_at' | 'updated_at'> & { id?: string; referral_count?: number; solar_commission?: number; adder_commission?: number; referral_commission?: number; total_commission?: number; status?: CommissionStatus; created_at?: string; updated_at?: string }
        Update: Partial<CommissionRecord>

      }
      commission_tiers: {
        Row: CommissionTier
        Insert: Omit<CommissionTier, 'id' | 'sort_order' | 'created_at'> & { id?: string; sort_order?: number; created_at?: string }
        Update: Partial<CommissionTier>

      }
      commission_geo_modifiers: {
        Row: CommissionGeoModifier
        Insert: Omit<CommissionGeoModifier, 'id' | 'modifier' | 'active' | 'created_at'> & { id?: string; modifier?: number; active?: boolean; created_at?: string }
        Update: Partial<CommissionGeoModifier>

      }
      commission_hierarchy: {
        Row: CommissionHierarchy
        Insert: Omit<CommissionHierarchy, 'id' | 'active' | 'created_at' | 'updated_at'> & { id?: string; active?: boolean; created_at?: string; updated_at?: string }
        Update: Partial<CommissionHierarchy>

      }
      pay_scales: {
        Row: PayScale
        Insert: Omit<PayScale, 'id' | 'adder_percentage' | 'referral_bonus' | 'sort_order' | 'active' | 'created_at' | 'updated_at'> & { id?: string; adder_percentage?: number; referral_bonus?: number; sort_order?: number; active?: boolean; created_at?: string; updated_at?: string }
        Update: Partial<PayScale>

      }
      pay_distribution: {
        Row: PayDistribution
        Insert: Omit<PayDistribution, 'id' | 'sort_order' | 'active' | 'created_at'> & { id?: string; sort_order?: number; active?: boolean; created_at?: string }
        Update: Partial<PayDistribution>

      }
      sales_teams: {
        Row: SalesTeam
        Insert: Omit<SalesTeam, 'id' | 'stack_per_watt' | 'active' | 'created_at' | 'updated_at'> & { id?: string; stack_per_watt?: number; active?: boolean; created_at?: string; updated_at?: string }
        Update: Partial<SalesTeam>

      }
      sales_reps: {
        Row: SalesRep
        Insert: Omit<SalesRep, 'id' | 'role_key' | 'status' | 'split_percentage' | 'created_at' | 'updated_at'> & { id?: string; role_key?: string; status?: RepStatus; split_percentage?: number; created_at?: string; updated_at?: string }
        Update: Partial<SalesRep>

      }
      onboarding_requirements: {
        Row: OnboardingRequirement
        Insert: Omit<OnboardingRequirement, 'id' | 'required' | 'sort_order' | 'active' | 'created_at'> & { id?: string; required?: boolean; sort_order?: number; active?: boolean; created_at?: string }
        Update: Partial<OnboardingRequirement>

      }
      onboarding_documents: {
        Row: OnboardingDocument
        Insert: Omit<OnboardingDocument, 'id' | 'status' | 'created_at' | 'updated_at'> & { id?: string; status?: OnboardingDocStatus; created_at?: string; updated_at?: string }
        Update: Partial<OnboardingDocument>

      }
      commission_config: {
        Row: CommissionConfig
        Insert: Omit<CommissionConfig, 'id' | 'updated_at'> & { id?: string; updated_at?: string }
        Update: Partial<CommissionConfig>

      }
      commission_advances: {
        Row: CommissionAdvance
        Insert: Omit<CommissionAdvance, 'id' | 'status' | 'self_generated' | 'created_at' | 'updated_at'> & { id?: string; status?: AdvanceStatus; self_generated?: boolean; created_at?: string; updated_at?: string }
        Update: Partial<CommissionAdvance>

      }
    }
  }
}
