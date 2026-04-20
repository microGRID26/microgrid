import type { ComponentType } from 'react'

/** Roles that can see a topic. If omitted, all roles can see it. */
export type HelpRole = 'pm' | 'field' | 'sales' | 'funding' | 'admin' | 'all'

export interface HelpTopicData {
  id: string
  title: string
  description: string
  category: string
  keywords: string[]
  /** Restrict visibility to specific roles. Omit or include 'all' to show to everyone. */
  roles?: HelpRole[]
  tryItLink?: string
  relatedTopics?: string[]
  content: ComponentType
}

export const CATEGORIES = [
  'Getting Started',
  'Daily Workflow',
  'Project Management',
  'Notes & Communication',
  'Financial',
  'Inventory & Materials',
  'Schedule & Crews',
  'Change Orders',
  'Reports & Analytics',
  'Administration',
  'System Features',
  'Design Tools',
]

export const WHATS_NEW = [
  { date: 'Apr 2026', title: 'Chain Invoicing (DSE → NewCo → EPC → EDGE)', topicId: 'chain-invoicing' },
  { date: 'Apr 2026', title: 'Cost Basis & Reconciliation Tab', topicId: 'cost-basis-tab' },
  { date: 'Apr 2026', title: 'Per-Project Invoices Tab', topicId: 'invoice-management' },
  { date: 'Apr 2026', title: 'Create Invoice from Project Details', topicId: 'invoice-management' },
  { date: 'Apr 2026', title: 'Milestone Auto-Invoicing (PDF + Email)', topicId: 'invoice-management' },
  { date: 'Apr 2026', title: 'Same-Day Clearing & Profit Auto-Transfer', topicId: 'invoice-management' },
  { date: 'Apr 2026', title: 'Ask Atlas Widget (in-app Q&A)', topicId: 'ask-atlas-widget' },
  { date: 'Apr 2026', title: 'Dealer Relationships & EPC Underwriting Fees', topicId: 'admin-portal' },
  { date: 'Apr 2026', title: 'Workmanship Warranty Chargebacks', topicId: 'warranty-tracking' },
  { date: 'Apr 2026', title: 'Warranty Claims EPC Filter', topicId: 'warranty-tracking' },
  { date: 'Apr 2026', title: 'Global Search Includes Cancelled Projects', topicId: 'search-and-filter' },
  { date: 'Apr 2026', title: 'Stamp-Worthy Planset PDFs (Rush Engineering)', topicId: 'engineering-assignments' },
  { date: 'Apr 2026', title: 'Drive Auto-Pull of Site Photos', topicId: 'document-management' },
  { date: 'Apr 2026', title: 'Rush Engineering Partner API', topicId: 'admin-portal' },
  { date: 'Apr 2026', title: 'Customer Portal (Web)', topicId: 'getting-started' },
  { date: 'Apr 2026', title: 'Native Mobile App (iOS & Android)', topicId: 'getting-started' },
  { date: 'Apr 2026', title: 'Atlas AI for Customers', topicId: 'atlas-reports' },
  { date: 'Apr 2026', title: 'Ticket Photo Attachments', topicId: 'ticketing-overview' },
  { date: 'Apr 2026', title: 'Rep Scorecard & Team Analytics', topicId: 'sales-teams' },
  { date: 'Apr 2026', title: 'Rep Notes Log', topicId: 'sales-teams' },
  { date: 'Apr 2026', title: 'Ticket Sales Rep Filter', topicId: 'ticketing-overview' },
  { date: 'Mar 2026', title: 'Ticketing System', topicId: 'ticketing-overview' },
  { date: 'Mar 2026', title: 'Compliance Tab', topicId: 'ticketing-overview' },
  { date: 'Mar 2026', title: 'EC/Non-EC Commissions & M1 Advances', topicId: 'ec-commissions' },
  { date: 'Mar 2026', title: 'Sales Teams & Pay Scales', topicId: 'sales-teams' },
  { date: 'Mar 2026', title: 'Rep Onboarding', topicId: 'rep-onboarding' },
  { date: 'Mar 2026', title: 'Rush Auto-Routing', topicId: 'engineering-assignments' },
  { date: 'Mar 2026', title: 'Invoice Rule Templates', topicId: 'invoice-management' },
  { date: 'Mar 2026', title: 'Earnings Dashboard & Leaderboard', topicId: 'earnings-dashboard' },
  { date: 'Mar 2026', title: 'Commission Calculator', topicId: 'commission-calculator' },
  { date: 'Mar 2026', title: 'Engineering Assignments', topicId: 'engineering-assignments' },
  { date: 'Mar 2026', title: 'Invoices', topicId: 'invoice-management' },
  { date: 'Mar 2026', title: 'Organization Switching', topicId: 'org-switcher' },
  { date: 'Mar 2026', title: 'NTP Workflow', topicId: 'ntp-workflow' },
  { date: 'Mar 2026', title: 'Manager+ Access Controls', topicId: 'permission-matrix' },
  { date: 'Mar 2026', title: 'Nav Reorganization', topicId: 'navigating-app' },
  { date: 'Mar 2026', title: 'Permit Portal', topicId: 'permit-portal' },
  { date: 'Mar 2026', title: 'Feature Flags', topicId: 'feature-flags' },
  { date: 'Mar 2026', title: 'System Page', topicId: 'system-page' },
  { date: 'Mar 2026', title: 'Google Calendar Sync', topicId: 'calendar-sync' },
  { date: 'Mar 2026', title: 'Fleet Management', topicId: 'fleet-management' },
  { date: 'Mar 2026', title: 'Custom Fields', topicId: 'custom-fields' },
  { date: 'Mar 2026', title: 'Warranty Tracking', topicId: 'warranty-tracking' },
  { date: 'Mar 2026', title: 'Barcode Scanning', topicId: 'barcode-scanning' },
  { date: 'Mar 2026', title: 'Inventory Management', topicId: 'materials-tab' },
  { date: 'Mar 2026', title: 'Atlas AI Reports', topicId: 'atlas-reports' },
  { date: 'Mar 2026', title: 'Equipment Catalog', topicId: 'equipment-catalog' },
  { date: 'Mar 2026', title: 'Legacy Projects', topicId: 'legacy-projects' },
  { date: 'Mar 2026', title: 'Document Management', topicId: 'document-management' },
]
