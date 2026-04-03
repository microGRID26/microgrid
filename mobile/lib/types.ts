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
  notification_prefs: { email_updates: boolean; sms_updates: boolean }
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
  created_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
