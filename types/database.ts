export type Stage = 'evaluation' | 'survey' | 'design' | 'permit' | 'install' | 'inspection' | 'complete'

export interface Project {
  id: string
  name: string
  city: string | null
  address: string | null
  phone: string | null
  email: string | null
  sale_date: string | null
  stage: Stage
  stage_date: string | null
  pm: string | null
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
  created_at: string
}

export interface Note {
  id: string
  project_id: string
  text: string
  time: string
  pm: string | null
}

export interface TaskState {
  project_id: string
  task_id: string
  status: string
  completed_date: string | null
}

export interface StageHistory {
  id: string
  project_id: string
  stage: string
  entered: string
}

export interface Crew {
  id: string
  name: string
  warehouse: string | null
  active: string | null
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
}

export interface ProjectFunding {
  project_id: string
  m1_amount: number | null
  m1_funded_date: string | null
  m1_cb: number | null
  m1_cb_credit: number | null
  m2_amount: number | null
  m2_funded_date: string | null
  m2_cb: number | null
  m2_cb_credit: number | null
  m3_amount: number | null
  m3_funded_date: string | null
  m3_projected: number | null
  nonfunded_code_1: string | null
  nonfunded_code_2: string | null
  nonfunded_code_3: string | null
}

export type Database = {
  public: {
    Tables: {
      projects: { Row: Project; Insert: Partial<Project>; Update: Partial<Project> }
      notes: { Row: Note; Insert: Partial<Note>; Update: Partial<Note> }
      task_state: { Row: TaskState; Insert: Partial<TaskState>; Update: Partial<TaskState> }
      stage_history: { Row: StageHistory; Insert: Partial<StageHistory>; Update: Partial<StageHistory> }
      crews: { Row: Crew; Insert: Partial<Crew>; Update: Partial<Crew> }
      schedule: { Row: Schedule; Insert: Partial<Schedule>; Update: Partial<Schedule> }
      project_funding: { Row: ProjectFunding; Insert: Partial<ProjectFunding>; Update: Partial<ProjectFunding> }
    }
  }
}
