// ── SINGLE SOURCE OF TRUTH — task definitions, statuses, reasons ─────────────
// Imported by TasksTab, ProjectPanel, and any future component that needs task data.

// ── TASK DEFINITIONS ──────────────────────────────────────────────────────────
export const TASKS: Record<string, { id: string; name: string; pre: string[]; req: boolean }[]> = {
  evaluation: [
    { id: 'welcome',      name: 'Welcome Call',               pre: [],                req: true  },
    { id: 'ia',           name: 'IA Confirmation',            pre: [],                req: true  },
    { id: 'ub',           name: 'UB Confirmation',            pre: [],                req: true  },
    { id: 'sched_survey', name: 'Schedule Site Survey',       pre: [],                req: true  },
    { id: 'ntp',          name: 'NTP Procedure',              pre: [],                req: true  },
  ],
  survey: [
    { id: 'site_survey',  name: 'Site Survey',                pre: ['sched_survey'],  req: true  },
    { id: 'survey_review',name: 'Survey Review',              pre: ['site_survey'],   req: true  },
  ],
  design: [
    { id: 'build_design',    name: 'Build Design',            pre: ['survey_review'], req: true  },
    { id: 'scope',           name: 'Scope of Work',           pre: ['build_design'],  req: true  },
    { id: 'monitoring',      name: 'Monitoring',              pre: ['scope'],         req: true  },
    { id: 'build_eng',       name: 'Build Engineering',       pre: ['scope'],         req: true  },
    { id: 'eng_approval',    name: 'Engineering Approval',    pre: ['build_eng'],     req: true  },
    { id: 'stamps',          name: 'Stamps Required',         pre: [],                req: false },
    { id: 'wp1',             name: 'WP1',                     pre: ['scope'],         req: false },
    { id: 'prod_add',        name: 'Production Addendum',     pre: ['scope'],         req: false },
    { id: 'new_ia',          name: 'Create New IA',           pre: ['scope'],         req: false },
    { id: 'onsite_redesign', name: 'OnSite Redesign',         pre: ['scope'],         req: false },
    { id: 'quote_ext_scope', name: 'Quote — Extended Scope',  pre: ['scope'],         req: false },
  ],
  permit: [
    { id: 'hoa',          name: 'HOA Approval',               pre: ['eng_approval'],  req: true  },
    { id: 'om_review',    name: 'OM Project Review',          pre: ['eng_approval'],  req: true  },
    { id: 'city_permit',  name: 'City Permit Approval',       pre: ['eng_approval'],  req: true  },
    { id: 'util_permit',  name: 'Utility Permit Approval',    pre: ['eng_approval'],  req: true  },
    { id: 'checkpoint1',  name: 'Check Point 1',              pre: ['eng_approval','city_permit','util_permit','ntp'], req: true },
    { id: 'revise_ia',    name: 'Revise IA',                  pre: [],                req: false },
  ],
  install: [
    { id: 'sched_install',name: 'Schedule Installation',      pre: ['checkpoint1'],   req: true  },
    { id: 'inventory',    name: 'Inventory Allocation',       pre: ['sched_install'], req: true  },
    { id: 'install_done', name: 'Installation Complete',      pre: ['sched_install'], req: true  },
    { id: 'elec_redesign',name: 'Electrical Onsite Redesign', pre: [],                req: false },
  ],
  inspection: [
    { id: 'insp_review',  name: 'Inspection Review',          pre: ['install_done'],  req: true  },
    { id: 'sched_city',   name: 'Schedule City Inspection',   pre: ['insp_review'],   req: true  },
    { id: 'sched_util',   name: 'Schedule Utility Inspection',pre: ['insp_review'],   req: true  },
    { id: 'city_insp',    name: 'City Inspection',            pre: ['sched_city'],    req: true  },
    { id: 'util_insp',    name: 'Utility Inspection',         pre: ['sched_util'],    req: true  },
    { id: 'city_upd',     name: 'City Permit Update',         pre: ['insp_review'],   req: false },
    { id: 'util_upd',     name: 'Utility Permit Update',      pre: ['insp_review'],   req: false },
    { id: 'wpi28',        name: 'WPI 2 & 8',                  pre: ['install_done'],  req: false },
  ],
  complete: [
    { id: 'pto',          name: 'Permission to Operate',      pre: ['util_insp'],     req: true  },
    { id: 'in_service',   name: 'In Service',                 pre: ['pto'],           req: true  },
  ],
}

// ── AHJ-CONDITIONAL REQUIREMENTS ─────────────────────────────────────────────
// Tasks that are normally optional but required for specific AHJs
export const AHJ_REQUIRED_TASKS: Record<string, string[]> = {
  'wp1': ['Corpus Christi', 'Texas City'],
  'wpi28': ['Corpus Christi', 'Texas City'],
}

export function isTaskRequired(task: { id: string; req: boolean }, ahj: string | null): boolean {
  if (task.req) return true
  const ahjs = AHJ_REQUIRED_TASKS[task.id]
  if (!ahjs || !ahj) return false
  const ahjLower = ahj.toLowerCase()
  return ahjs.some(a => ahjLower === a.toLowerCase() || ahjLower.startsWith(a.toLowerCase() + ' '))
}

// ── TASK STATUSES ─────────────────────────────────────────────────────────────
export const TASK_STATUSES = ['Not Ready','Ready To Start','In Progress','Scheduled','Pending Resolution','Revision Required','Complete'] as const

export const STATUS_STYLE: Record<string, string> = {
  'Complete':           'bg-green-900 text-green-300',
  'In Progress':        'bg-blue-900 text-blue-300',
  'Scheduled':          'bg-indigo-900 text-indigo-300',
  'Pending Resolution': 'bg-red-900 text-red-300',
  'Revision Required':  'bg-amber-900 text-amber-300',
  'Ready To Start':     'bg-gray-700 text-gray-200',
  'Not Ready':          'bg-gray-800 text-gray-500',
}

// ── PENDING RESOLUTION REASONS — keyed by task ID ────────────────────────────
// NOTE: These are fallback values. The app loads reasons from the `task_reasons`
// database table when available (see TasksTab.tsx). Edit reasons via Admin > Reasons Manager.
export const PENDING_REASONS: Record<string, string[]> = {
  welcome: [
    'Credit Declined','Customer Unresponsive','EC Has Not Completed the Lead',
    'H/O Requested Another Time','IA Not Signed','Invalid ACH Information',
    'LA Not Signed','Need to Change Lenders','No Lender Yet',
    'Pending Cancellation','Welcome Checklist/Call Not Completed',
  ],
  ia: [
    'Incorrect Adders','Incorrect Email','Incorrect Name','Incorrect Phone',
    'Incorrect Price','Incorrect Site Address','Incorrect System Data',
    'Missing Adder','Missing Document','Missing Information','Missing Promise','Not Signed',
  ],
  ub: [
    'Document Not Found','Missing Account #','Missing Customer Name','Missing ESID',
    'Missing Meter #','Missing Service Address','Missing Utility Company Name',
    'Not Current','Not Readable',
  ],
  sched_survey: ['Awaiting Customer Reply','Customer Wants to Wait','Scheduling Conflict'],
  ntp: [
    'IA Resign','Missing Utility Bill','Need ACH Information','Need Drivers License / ID',
    'Need Income Verification','Need Property Ownership','NTP Not Granted',
    'NTP Requires Other','Pending HCO','Pending NCCO',
    'Requires Shade Study and Plan Set','Title Stip',
  ],
  site_survey: [
    'Customer Requested','Invalid ACH Information','Requires Secondary Site Survey',
    'Rescheduled','Structural/Electrical Incomplete',
  ],
  survey_review: [
    'Extended Scope of Work - Asbestos','Extended Scope of Work - Electrical',
    'Extended Scope of Work - Structural','Missing Attic Pics','Missing Documents',
    'Missing Drone Pics','Missing Electrical Pics','Missing Roof Pics',
    'MPU Review','Pending DQ','Requires Secondary Site Survey',
    'Roof Review Needed','Utility Bill Rejection','Waiting for AHJ/Utility',
  ],
  build_design: [
    'Extended Scope of Work - Asbestos','Extended Scope of Work - Electrical',
    'Extended Scope of Work - Structural','Missing Adder','MPU Review','Pending DQ',
    'Requires Missing Document Upload','Requires Photo Re-upload',
    'Requires Secondary Site Survey','Requires Table Discussion','Utility Bill Rejection',
  ],
  scope: [
    'Extended Scope of Work - Electrical','Extended Scope of Work - Structural',
    'Pending Approval','Requires Missing Document Upload','Requires Photo Re-upload',
    'Requires Secondary Site Survey','Requires Table Discussion','Reroof Required',
  ],
  build_eng: [
    'Battery Review','Escalated','ESID #','Extended Scope of Work - Electrical',
    'Extended Scope of Work - Structural','Internal Battery Check',
    'Utility Bill Rejection','Waiting for Confirmation',
  ],
  eng_approval: [
    'Battery Review','Extended Scope of Work - Electrical','Extended Scope of Work - Structural',
    'Internal Battery Checking','Missing Document','Missing Photos',
    'Pending Cancellation','Pending DQ','Sent for Stamps','Stamps Required',
  ],
  stamps: [
    'Electrical DQ','Missing Document','Pending EC or Homeowner',
    'Pending Site Survey Photos','Pending Stamps','Structural DQ',
  ],
  prod_add: ['Production Addendum Sent'],
  new_ia:   ['Awaiting Customer Reply','Awaiting Dealer Reply','IA Not Signed'],
  reroof:   ['Awaiting Change Order','Awaiting Discovery','Getting Estimate','Locating Vendor','Onboarding Vendor'],
  onsite_redesign: ['Awaiting Customer Reply','Missing Signature'],
  hoa: [
    'Awaiting Application Receipt Confirmation','Awaiting Customer Reply',
    'Awaiting EC Reply','Awaiting HOA Prep Completion','Awaiting HOA Reply',
    'City Permit Required','Engineering Stamp Required','Fee Receipt Confirmation Required',
    'Fee Required','HOA Denial Attention Required','HOA Escalation',
    'Legal Escalation Required','Lot Survey with Panel Placement Required',
    'Missing Neighbor Signatures','More Information Required by HOA',
    'Need 10% Design/Letter','Need Customer to Submit to HOA',
    'PV Watts/NREL Calculations Required','Specific HOA Document Required',
  ],
  city_permit: [
    'City Registration Need/Sent/Pending','Customer Requesting Design Change',
    'EC/Customer Concerns','Licensing/Compliance','Objection Letter',
    'Open Permits/Pending Inspection','Pending Cancellation','Pending Customer Signature',
    'Pending Deed/Proof of Ownership','Pending Engineer Stamped Plans',
    'Pending Engineering Revision','Pending HOA Approval',
    'Pending Homeowner Authorization/Action','Pending Utility Approval First',
    'Pending WPI Documents','Permit Drop Off/Pickup',
    'Previous Unpaid Permits','Unpaid Property Taxes',
  ],
  util_permit: [
    'Customer Authorization','Customer Requesting Design Change','Duplicate Under Review',
    'EC/Customer Concerns','Licensing/Compliance','Missing Site Survey Photos',
    'Open Permits/Pending Inspection','Pending Cancellation','Pending City Registration',
    'Pending City Reply','Pending CPS Signed Documents','Pending Customer Signature',
    'Pending Deed/Proof of Ownership','Pending Engineer Stamped Plans',
    'Pending Engineering Revision','Pending HOA Approval',
    'Pending ICA and PTO for Existing System','Pending Proof of Insurance',
    'Pending Utility Approval (No Objection Letter)','Pending Utility Availability',
    'Pending Utility Bill/Account Information','Pending Utility Reply',
    'Pending WPI Documents','Permit Drop Off/Pick-Up','Previous Unpaid Permits',
  ],
  checkpoint1: [
    'Asbestos Removal/Restoration','Awaiting Field Ops',
    'Contract Issue - Addendum Not Signed','Contract Issue - Agreements Mismatch',
    'Contract Issue - Unsigned Docs','Credit Expired','Engineering/IA Mismatch',
    'Homeowner Request Wait or Cancel','Inventory - Battery Shortage',
    'Inventory - Inverter Shortage','Inventory - Module Shortage',
    'Inventory - Racking Shortage','Legal','Need Design Revision',
    'Need Engineering Revision','Need HOA Approval','Need New IA','Need Reroof',
    'NTP Not Granted','Pending HCO','Pending NCCO','Pending Paykeeper Deposit',
    'Pending Permit Approval per Requirement','Pending Reroof Cure',
    'Pending Roof Completion','Pending Utility Outage',
    'Production Addendum Required','Reroof Discovered',
  ],
  sched_install: [
    'Awaiting Customer Reply','Crew Availability','Customer Wants to Wait',
    'Pending Cancellation','Pending Equipment','Pending Permit Approval',
  ],
  inventory:    ['Equipment Ordered','Equipment Shortage','Inventory Ordered','Inventory Shortage'],
  insp_review: [
    'City Permit Approval Pending','City Permit Update Needed','Design Update Needed',
    'Engineering Update Needed','Gen 2 Duracell','Legal',
    'Pending Solrite Subcontractor Completion','Pending Sonnen Battery Commissioning',
    'Service Needed','Utility Permit Approval Pending','Utility Permit Update Needed',
  ],
  sched_city: [
    'Awaiting City Reply','Awaiting Customer Reply','Customer Escalation',
    'Install is Incomplete','Legal','Licensing/Compliance','Pending Cancellation',
    'Pending City Availability','Pending Crew Availability','Pending Engineering',
    'Pending Homeowner Availability','Pending Inspection Corrections',
    'Pending Permit Approval','Pending Permit Revision','Pending Post Install Letter',
    'Pending QC','Pending Service','Pending WPI8',
  ],
  sched_util: [
    'Awaiting City Reply','Awaiting Customer Reply','Awaiting Utility Reply',
    'Install is Incomplete','Legal','Licensing/Compliance','Pending Cancellation',
    'Pending City Approval First','Pending Crew Availability','Pending Customer Signature',
    'Pending Engineering','Pending Homeowner Availability','Pending Inspection Corrections',
    'Pending Permit Approval','Pending QC','Pending Service',
    'Pending SunRaise Release','Pending Utility Approval','Pending Utility Availability',
  ],
  city_insp: [
    'Awaiting City Reply','Escalated to Customer Service',
    'Inspection Report Requested','Pending Install','Pending Utility Approval First',
  ],
  util_insp: ['Escalated to Customer Service','Pending Customer Signature','Pending Host Availability','Pending Install','Pending Meter Set'],
  city_upd: [
    'Licensing/Compliance','Need City Registration','Need Customer Signature',
    'Need Deed/Proof of Ownership','Need Engineer Stamped Plans','Need Engineering Revision',
    'Need HOA Approval','Need WPI Documents','Objection Letter',
    'Open Permits/Pending Inspection','Pending Utility Approval',
    'Permit Drop Off/Pickup','Possible Dispositions','Previous Unpaid Permits',
  ],
  util_upd: ['Need Customer Signature','Need Proof of Insurance','Pending Transformer Upgrade','Transformer Upgrade Review'],
  pto:       ['Pending PTO Issuance'],
  in_service: [
    'Abnormal Grid','Awaiting Customer Reply','Awaiting RMA',
    'Awaiting System Update To Take Effect','Battery Issues','CT Issues',
    'Gateway/DTU Not Reporting','Meter Set','Production Issue/MNR','System Activation Incomplete',
  ],
}

// ── REVISION REQUIRED REASONS — keyed by stage ───────────────────────────
// NOTE: These are fallback values. The app loads reasons from the `task_reasons`
// database table when available (see TasksTab.tsx). Edit reasons via Admin > Reasons Manager.────
export const REVISION_REASONS: Record<string, string[]> = {
  evaluation: [
    'Incorrect Customer Info','Need ACH Information','Need Drivers License / ID',
    'Need Income Verification','Need New IA','Need New Loan Doc',
    'Need Property Ownership','Plan Revision','PPW Too High',
    'Rejected - Other','Updated Shade Study Required',
  ],
  survey: [
    'Animals Present','Customer Postponed','Customer Request to Cancel',
    'Missing Attic Pics','Missing Drone Pics','Missing Electrical Pics',
    'Missing Roof Pics','Missing Site Pics','Need Equipment',
    'No Access to Attic','No Access to Site','Reroof Procedure',
  ],
  design: [
    'AHJ Correction','Attachment Change','Battery Addition','Confirmed DQ',
    'Customer Request','Electrical Corrections','Engineering Audit',
    'HOA Request','Layout Change','Lender Request','Missing Stamps/Letters',
    'Need New IA DS','New Electrical Notes','Panel Count Change','Panel Type Change',
    'Production Addendum Required','Reengineer – Customer Request',
    'Requested Cancel','Supply Chain Issues','Utility Correction','Windspeed Change',
  ],
  permit: [
    'City Permit Revision','CP1 - Need Reroof','Incorrect / Missing Data on Plans',
    'Incorrect / Missing PV Labels','Incorrect Adders','Incorrect Email',
    'Incorrect Name','Incorrect Permit Submitted','Incorrect Phone','Incorrect Price',
    'Incorrect Site Address','Incorrect System Data','Incorrect or No Setbacks',
    'Loan Doc Not Signed','Missing Adder','Missing Wind Cert Docs (WPI1/8)',
    'Need Engineering Revision','Need New CPS Form','Need New IA','New NTP Required',
    'Pending City Approval','Pending Stipulations','Plan Revision',
    'Production Addendum Required','Reroof Discovered',
    'Updated Shade Study Required','Utility Permit Revision','Workflow Cancelled',
  ],
  install: [
    'AHJ Denied','City No-Show','Correction Needed (Specify in Comments)',
    'Crew Not Available/Call-In','Customer Canceled','Customer Reschedule',
    'Customer Unresponsive / Not Available','Disconnect/Reconnect',
    'HOA Denied','Incident','Inspection Delay','Missing Material','Missing Photos',
    'Need Reroof','OSR Required','Pending Battery Completion',
    'Ran Out of Daylight','System Commissioning Error',
    'TriSMART Reschedule','Utility No-Show','Waiting for HOA Approval','Weather',
  ],
  inspection: [
    'AHJ Reschedule / Cancel','Battery Corrections Needed','City No-Show',
    'Conduit Strapping','Correction Needed (Specify in Comments)',
    'Crew Not Available / Call-In','Customer Canceled',
    'Customer Issue (Previous Work / Existing Issue)','Customer Reschedule',
    'Customer Unresponsive / Not Available','Electrical Wall Install Error',
    'Grounding, Electrical Wall','Grounding, Roof',
    'Incorrect / Missing Data on Plans','Incorrect / Missing PV Labels',
    'Incorrect Equipment Installed','Incorrect Permit Submitted',
    'Incorrect or No Setbacks','Install Not Matching Plans',
    'LST/IPC Interconnection Not to Code','Microinverter(s) Not Reporting',
    'Missing Barriers','Missing Documents on Site','Missing Equipment',
    'Missing Homeowner / Gate Locked','Missing Host','Missing Material',
    'Missing Photos','Missing Smoke Detectors','Missing Wind Cert Docs (WPI1/8)',
    'New AHJ Requirement','Not Scheduled with AHJ','OSR Required',
    'Pending Battery Completion','Ran Out of Daylight',
    'Rejected - Need Engineer Stamped Plans','Rough Inspection Required',
    'System Commissioning Error','Trench','TriSMART Rescheduled',
    'Utility No-Show','Weather','Wire Management','Workmanship',
  ],
  complete: ['Need PTO Letter','Needs to Reschedule','Tech Required'],
}

// ── DERIVED LOOKUPS — built once at module load ─────────────────────────────

// Flat task name lookup: taskId → taskName
export const ALL_TASKS_MAP: Record<string, string> = {}
Object.values(TASKS).flat().forEach(t => { ALL_TASKS_MAP[t.id] = t.name })

// Flat task lookup with stage: taskId → { ...task, stage }
export const ALL_TASKS_FLAT: Record<string, { id: string; name: string; pre: string[]; req: boolean; stage: string }> = {}
for (const [stage, tasks] of Object.entries(TASKS)) {
  for (const t of tasks) ALL_TASKS_FLAT[t.id] = { ...t, stage }
}

// Task to stage mapping: taskId → stageId
export const TASK_TO_STAGE: Record<string, string> = {}
for (const [stage, tasks] of Object.entries(TASKS)) {
  for (const t of tasks) TASK_TO_STAGE[t.id] = stage
}

// Validate no cycles in prerequisite chains at module load
;(function validateNoCycles() {
  const allTasks = Object.values(TASKS).flat()
  const taskMap = new Map(allTasks.map(t => [t.id, t]))

  function hasCycle(startId: string, visited: Set<string>, path: string[]): boolean {
    if (visited.has(startId)) {
      console.error('Task prerequisite cycle detected:', [...path, startId].join(' → '))
      return true
    }
    visited.add(startId)
    path.push(startId)
    const task = taskMap.get(startId)
    if (task) {
      for (const preId of task.pre) {
        if (hasCycle(preId, new Set(visited), [...path])) return true
      }
    }
    return false
  }

  for (const t of allTasks) {
    hasCycle(t.id, new Set(), [])
  }
})()

// ── CASCADE HELPER ──────────────────────────────────────────────────────────
// Find same-stage downstream dependents (BFS through prereq chain)
export function getSameStageDownstream(taskId: string): string[] {
  const task = ALL_TASKS_FLAT[taskId]
  if (!task) return []
  const stage = task.stage
  const stageTasks = TASKS[stage] ?? []
  const downstream: string[] = []
  const queue = [taskId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const t of stageTasks) {
      if (!visited.has(t.id) && t.id !== taskId && t.pre.includes(current)) {
        visited.add(t.id)
        downstream.push(t.id)
        queue.push(t.id)
      }
    }
  }
  return downstream
}

// ── TASK → PROJECT DATE FIELD MAPPING ───────────────────────────────────────
// When a task is marked Complete, auto-set the corresponding project date field.
// Only tasks with a clear 1:1 date mapping are included.
export const TASK_DATE_FIELDS: Record<string, string> = {
  // Evaluation
  ntp:            'ntp_date',
  // Survey
  sched_survey:   'survey_scheduled_date',
  site_survey:    'survey_date',
  // Permit
  city_permit:    'city_permit_date',
  util_permit:    'utility_permit_date',
  // Install
  sched_install:  'install_scheduled_date',
  install_done:   'install_complete_date',
  // Inspection
  city_insp:      'city_inspection_date',
  util_insp:      'utility_inspection_date',
  // Complete
  pto:            'pto_date',
  in_service:     'in_service_date',
}
