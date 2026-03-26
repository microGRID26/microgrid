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
}

export interface Schedule {
  id: string
  project_id: string
  crew_id: string
  job_type: string
  date: string
  time: string | null
  notes: string | null
  status: string
  pm: string | null
  pm_id: string | null
  arrival_window: string | null
  arrays: string | null
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
  project?: { name: string; city: string } | null
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
  last_counted_at: string | null
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
    }
  }
}
