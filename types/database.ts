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
  loyalty: string | null
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
  issue_type: string | null
  description: string | null
  created_at: string
  scheduled_date: string | null
  resolved_date: string | null
  pm: string | null
  pm_id: string | null
  priority: string | null
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

export type UserRole = 'super_admin' | 'admin' | 'finance' | 'manager' | 'user'

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
    }
  }
}
