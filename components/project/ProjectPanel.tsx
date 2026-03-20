'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt$, fmtDate, daysAgo, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import type { Project, Note } from '@/types/database'
import { BomTab } from './BomTab'
import { TasksTab } from './TasksTab'
import { NotesTab } from './NotesTab'
import { InfoTab } from './InfoTab'

// ── TASK DEFINITIONS ──────────────────────────────────────────────────────────
const TASKS: Record<string, { id: string; name: string; pre: string[]; req: boolean }[]> = {
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
    { id: 'stamps',          name: 'Stamps Required',         pre: ['eng_approval'],  req: false },
    { id: 'wp1',             name: 'WP1',                     pre: ['scope'],         req: false },
    { id: 'prod_add',        name: 'Production Addendum',     pre: ['scope'],         req: false },
    { id: 'new_ia',          name: 'Create New IA',           pre: ['scope'],         req: false },
    { id: 'reroof',          name: 'Reroof Procedure',        pre: ['scope'],         req: false },
    { id: 'onsite_redesign', name: 'OnSite Redesign',         pre: ['scope'],         req: false },
    { id: 'quote_ext_scope', name: 'Quote — Extended Scope',  pre: ['scope'],         req: false },
  ],
  permit: [
    { id: 'hoa',          name: 'HOA Approval',               pre: ['eng_approval'],  req: true  },
    { id: 'om_review',    name: 'OM Project Review',          pre: ['eng_approval'],  req: true  },
    { id: 'city_permit',  name: 'City Permit Approval',       pre: ['eng_approval'],  req: true  },
    { id: 'util_permit',  name: 'Utility Permit Approval',    pre: ['eng_approval'],  req: true  },
    { id: 'checkpoint1',  name: 'Check Point 1',              pre: ['city_permit','util_permit','ntp'], req: false },
    { id: 'revise_ia',    name: 'Revise IA',                  pre: [],                req: false },
  ],
  install: [
    { id: 'sched_install',name: 'Schedule Installation',      pre: ['om_review'],     req: true  },
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

// ── TASK STATUSES ─────────────────────────────────────────────────────────────
const TASK_STATUSES = ['Not Ready','Ready To Start','In Progress','Scheduled','Pending Resolution','Revision Required','Complete']

const STATUS_STYLE: Record<string, string> = {
  'Complete':           'bg-green-900 text-green-300',
  'In Progress':        'bg-blue-900 text-blue-300',
  'Scheduled':          'bg-indigo-900 text-indigo-300',
  'Pending Resolution': 'bg-red-900 text-red-300',
  'Revision Required':  'bg-amber-900 text-amber-300',
  'Ready To Start':     'bg-gray-700 text-gray-200',
  'Not Ready':          'bg-gray-800 text-gray-500',
}

// ── PENDING RESOLUTION REASONS — keyed by task ID ────────────────────────────
const PENDING_REASONS: Record<string, string[]> = {
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
  util_insp: ['Escalated to Customer Service','Pending Customer Signature','Pending Install','Pending Meter Set'],
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

// ── REVISION REQUIRED REASONS — keyed by stage ───────────────────────────────
const REVISION_REASONS: Record<string, string[]> = {
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

// ── FLAT TASK NAME LOOKUP — used by history view ──────────────────────────────
// Built once at module level (not per render) for scale
const ALL_TASKS_MAP: Record<string, string> = {}
Object.values(TASKS).flat().forEach(t => { ALL_TASKS_MAP[t.id] = t.name })

// ── HELPERS ───────────────────────────────────────────────────────────────────
function Row({ label, value, small }: { label: string; value?: string | null; small?: boolean }) {
  if (!value) return null
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <span className={`text-gray-200 text-xs break-words ${small ? 'text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function EditRow({ label, field, value, draft, editing, onChange, small, type = 'text' }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  small?: boolean
  type?: 'text' | 'date' | 'number'
}) {
  const current = field in draft ? draft[field] : value
  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className={`text-gray-200 text-xs break-words ${small ? 'text-xs' : ''}`}>
          {type === 'date' && value ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : value}
        </span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <input
        type={type}
        value={current ?? ''}
        onChange={e => onChange((d: any) => ({ ...d, [field]: e.target.value || null }))}
        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
      />
    </div>
  )
}

function SelectEditRow({ label, field, value, draft, editing, onChange, options }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  options: string[]
}) {
  const current = field in draft ? draft[field] : value
  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className="text-gray-200 text-xs">{value}</span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <select
        value={current ?? ''}
        onChange={e => onChange((d: any) => ({ ...d, [field]: e.target.value || null }))}
        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
      >
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function AutocompleteRow({ label, field, value, draft, editing, onChange, table, searchCol = 'name', onClickValue }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  table: 'ahjs' | 'utilities'
  searchCol?: string
  onClickValue?: () => void
}) {
  const supabase = createClient()
  const current = field in draft ? draft[field] : value
  const [query, setQuery] = useState(current ?? '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(current ?? '') }, [current])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    if (!focused || query.length < 2) { setSuggestions([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      const { data } = await (supabase as any).from(table).select(searchCol).ilike(searchCol, `%${query}%`).order(searchCol).limit(8)
      const names = (data ?? []).map((r: any) => r[searchCol])
      setSuggestions(names)
      setOpen(names.length > 0)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, focused])

  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        {onClickValue ? (
          <button onClick={onClickValue} className="text-green-400 hover:text-green-300 text-xs break-words text-left hover:underline cursor-pointer">
            {value}
          </button>
        ) : (
          <span className="text-gray-200 text-xs break-words">{value}</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2 py-0.5 items-start" ref={ref}>
      <span className="text-gray-500 text-xs w-28 flex-shrink-0 mt-1">{label}</span>
      <div className="flex-1 relative">
        <input
          type="text"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={e => {
            setQuery(e.target.value)
            onChange((d: any) => ({ ...d, [field]: e.target.value || null }))
          }}
          className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
          placeholder={`Search ${label}…`}
        />
        {open && suggestions.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-gray-800 border border-gray-600 rounded-md shadow-xl overflow-hidden max-h-48 overflow-y-auto">
            {suggestions.map(s => (
              <button key={s} type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                onMouseDown={() => {
                  setQuery(s)
                  onChange((d: any) => ({ ...d, [field]: s }))
                  setOpen(false)
                }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 pb-1 border-b border-gray-800">{title}</div>
      {children}
    </div>
  )
}

function TaskRow({ task, status, reason, pendingReasons, revisionReasons, locked, onStatusChange, onReasonChange }: {
  task: { id: string; name: string; req: boolean }
  status: string
  reason: string
  pendingReasons: string[]
  revisionReasons: string[]
  locked: boolean
  onStatusChange: (taskId: string, status: string) => void
  onReasonChange: (taskId: string, reason: string) => void
}) {
  const showReason = status === 'Pending Resolution' || status === 'Revision Required'
  const reasonOptions = status === 'Pending Resolution' ? pendingReasons : revisionReasons

  return (
    <div className={`py-1.5 px-2 rounded-lg mb-1 ${status === 'Complete' ? 'opacity-50' : ''} ${locked ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          status === 'Complete'           ? 'bg-green-500'  :
          status === 'Pending Resolution' ? 'bg-red-500'    :
          status === 'Revision Required'  ? 'bg-amber-500'  :
          status === 'In Progress'        ? 'bg-blue-500'   :
          status === 'Scheduled'          ? 'bg-indigo-400' :
          status === 'Ready To Start'     ? 'bg-gray-400'   : 'bg-gray-700'
        }`} />
        <span className={`flex-1 text-xs ${task.req ? 'text-white' : 'text-gray-400'}`}>
          {task.name}{!task.req && <span className="text-gray-600 ml-1">(opt)</span>}
        </span>
        <select
          value={status}
          disabled={locked}
          onChange={e => onStatusChange(task.id, e.target.value)}
          className={`text-xs rounded px-1.5 py-0.5 border-0 cursor-pointer ${STATUS_STYLE[status] ?? 'bg-gray-800 text-gray-400'}`}
        >
          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Reason dropdown — shown when Pending Resolution or Revision Required */}
      {showReason && reasonOptions.length > 0 && (
        <div className="mt-1.5 ml-4 flex items-center gap-2">
          <span className="text-xs text-gray-500 flex-shrink-0 w-10">Reason</span>
          <select
            value={reason}
            onChange={e => onReasonChange(task.id, e.target.value)}
            className={`flex-1 text-xs rounded px-2 py-0.5 border-0 cursor-pointer ${
              status === 'Pending Resolution' ? 'bg-red-950 text-red-300' : 'bg-amber-950 text-amber-300'
            }`}
          >
            <option value="">Select reason...</option>
            {reasonOptions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {/* Show saved reason as dim context when status is something else */}
      {!showReason && reason && (
        <div className="mt-0.5 ml-4 text-xs text-gray-600 italic">{reason}</div>
      )}
    </div>
  )
}

// ── STAGE ADVANCE LOGIC ───────────────────────────────────────────────────────
function canAdvance(stage: string, taskStates: Record<string, string>): { ok: boolean; missing: string[] } {
  const tasks = (TASKS[stage] ?? []).filter(t => t.req)
  const missing = tasks.filter(t => taskStates[t.id] !== 'Complete').map(t => t.name)
  return { ok: missing.length === 0, missing }
}

// ── MAIN PANEL ────────────────────────────────────────────────────────────────
interface ProjectPanelProps {
  project: Project
  onClose: () => void
  onProjectUpdated: () => void
}

export function ProjectPanel({ project: initialProject, onClose, onProjectUpdated }: ProjectPanelProps) {
  const supabase = createClient()
  const { user: currentUser } = useCurrentUser()
  const [project, setProject] = useState<Project>(initialProject)
  const [tab, setTab] = useState<'tasks' | 'notes' | 'info' | 'bom' | 'files'>('tasks')
  const [taskStates, setTaskStates] = useState<Record<string, string>>({})
  const [taskReasons, setTaskReasons] = useState<Record<string, string>>({})
  const [taskStatesRaw, setTaskStatesRaw] = useState<{task_id: string; status: string; reason?: string; completed_date?: string | null}[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [folderUrl, setFolderUrl] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [blockerInput, setBlockerInput] = useState('')
  const [showBlockerForm, setShowBlockerForm] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editDraft, setEditDraft] = useState<Partial<Project>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [taskView, setTaskView] = useState<'current' | 'all' | 'history'>('current')
  const [ahjInfo, setAhjInfo] = useState<any>(null)
  const [utilityInfo, setUtilityInfo] = useState<any>(null)
  const [ahjEdit, setAhjEdit] = useState<any>(null)
  const [utilEdit, setUtilEdit] = useState<any>(null)
  const [refSaving, setRefSaving] = useState(false)
  const [serviceCalls, setServiceCalls] = useState<any[]>([])
  const [stageHistory, setStageHistory] = useState<any[]>([])
  // ── task_history — lazy-loaded only when user opens the History view ─────────
  const [taskHistory, setTaskHistory] = useState<any[]>([])
  const [taskHistoryLoaded, setTaskHistoryLoaded] = useState(false)

  const pid = project.id
  const stageTasks = TASKS[project.stage] ?? []
  const stageIdx = STAGE_ORDER.indexOf(project.stage)
  const nextStage = STAGE_ORDER[stageIdx + 1] ?? null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const loadTasks = useCallback(async () => {
    const { data } = await supabase.from('task_state').select('task_id, status, reason, completed_date').eq('project_id', pid)
    if (data) {
      const statusMap: Record<string, string> = {}
      const reasonMap: Record<string, string> = {}
      data.forEach((t: any) => {
        statusMap[t.task_id] = t.status
        if (t.reason) reasonMap[t.task_id] = t.reason
      })
      setTaskStates(statusMap)
      setTaskReasons(reasonMap)
      setTaskStatesRaw(data)
    }
  }, [pid])

  const loadNotes = useCallback(async () => {
    const { data } = await supabase.from('notes').select('*').eq('project_id', pid).order('time', { ascending: false })
    if (data) setNotes(data as Note[])
  }, [pid])

  const loadStageHistory = useCallback(async () => {
    const { data } = await (supabase as any).from('stage_history').select('*').eq('project_id', pid).order('entered', { ascending: false })
    if (data) setStageHistory(data)
  }, [pid])

  // Lazy — only called when user navigates to History view
  // Indexes on project_id + changed_at keep this fast at 20k+ projects
  const loadTaskHistory = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('task_history')
      .select('task_id, status, reason, changed_by, changed_at')
      .eq('project_id', pid)
      .order('changed_at', { ascending: false })
      .limit(200)
    if (data) {
      setTaskHistory(data)
      setTaskHistoryLoaded(true)
    }
  }, [pid])

  const loadServiceCalls = useCallback(async () => {
    const { data } = await (supabase as any).from('service_calls').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(5)
    if (data) setServiceCalls(data)
  }, [pid])

  const loadAhjUtil = useCallback(async () => {
    if (project.ahj) {
      const { data } = await (supabase as any).from('ahjs').select('permit_phone,permit_website,max_duration,electric_code,permit_notes').ilike('name', `%${project.ahj}%`).limit(1).maybeSingle()
      setAhjInfo(data ?? null)
    }
    if (project.utility) {
      const { data } = await (supabase as any).from('utilities').select('phone,website,notes').ilike('name', `%${project.utility}%`).limit(1).maybeSingle()
      setUtilityInfo(data ?? null)
    }
  }, [pid, project.ahj, project.utility])

  const openAhjEdit = async () => {
    if (!project.ahj) return
    const { data } = await (supabase as any).from('ahjs').select('*').ilike('name', `%${project.ahj}%`).limit(1).maybeSingle()
    if (data) setAhjEdit({ ...data })
  }

  const saveAhjEdit = async () => {
    if (!ahjEdit) return
    setRefSaving(true)
    await (supabase as any).from('ahjs').update({
      permit_phone: ahjEdit.permit_phone,
      permit_website: ahjEdit.permit_website,
      max_duration: ahjEdit.max_duration,
      electric_code: ahjEdit.electric_code,
      permit_notes: ahjEdit.permit_notes,
    }).eq('id', ahjEdit.id)
    setRefSaving(false)
    setAhjEdit(null)
    loadAhjUtil()
  }

  const openUtilEdit = async () => {
    if (!project.utility) return
    const { data } = await (supabase as any).from('utilities').select('*').ilike('name', `%${project.utility}%`).limit(1).maybeSingle()
    if (data) setUtilEdit({ ...data })
  }

  const saveUtilEdit = async () => {
    if (!utilEdit) return
    setRefSaving(true)
    await (supabase as any).from('utilities').update({
      phone: utilEdit.phone,
      website: utilEdit.website,
      notes: utilEdit.notes,
    }).eq('id', utilEdit.id)
    setRefSaving(false)
    setUtilEdit(null)
    loadAhjUtil()
  }

  const loadFolder = useCallback(async () => {
    const { data } = await (supabase as any).from('project_folders').select('folder_url').eq('project_id', pid).maybeSingle()
    setFolderUrl(data?.folder_url ?? null)
  }, [pid])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ''))
  }, [])

  useEffect(() => {
    setProject(initialProject)
    setBlockerInput(initialProject.blocker ?? '')
    // Fetch full project data (parent pages may pass trimmed columns from optimized queries)
    supabase.from('projects').select('*').eq('id', initialProject.id).single().then(({ data }) => {
      if (data) {
        setProject(data as Project)
        setBlockerInput((data as Project).blocker ?? '')
      }
    })
  }, [initialProject.id])

  useEffect(() => {
    setAhjInfo(null)
    setUtilityInfo(null)
    // Reset history cache when project changes
    setTaskHistory([])
    setTaskHistoryLoaded(false)
    loadTasks()
    loadNotes()
    loadFolder()
    loadAhjUtil()
    loadServiceCalls()
    loadStageHistory()
  }, [initialProject.id])

  // Lazy-load task history — only when the user navigates to History view
  useEffect(() => {
    if (taskView === 'history' && !taskHistoryLoaded) {
      loadTaskHistory()
    }
  }, [taskView, taskHistoryLoaded, loadTaskHistory])

  async function updateTaskStatus(taskId: string, status: string) {
    setTaskStates(prev => ({ ...prev, [taskId]: status }))
    const needsReason = status === 'Pending Resolution' || status === 'Revision Required'
    if (!needsReason) {
      setTaskReasons(prev => { const n = { ...prev }; delete n[taskId]; return n })
    }
    await (supabase as any).from('task_state').upsert({
      project_id: pid,
      task_id: taskId,
      status,
      reason: needsReason ? (taskReasons[taskId] ?? null) : null,
      completed_date: status === 'Complete' ? new Date().toISOString().slice(0, 10) : null,
    }, { onConflict: 'project_id,task_id' })

    // Fire-and-forget revision trail insert — no await, zero user-facing latency
    const changedBy = currentUser?.name
      ?? userEmail.split('@')[0]
      ?? 'unknown'
    void (supabase as any).from('task_history').insert({
      project_id: pid,
      task_id: taskId,
      status,
      reason: needsReason ? (taskReasons[taskId] ?? null) : null,
      changed_by: changedBy,
      pm_id: currentUser?.id ?? null,
    })
    // Invalidate cache so History view reloads fresh on next open
    setTaskHistoryLoaded(false)

    // Auto-flip disposition when In Service task status changes
    if (taskId === 'in_service') {
      if (status === 'Complete') {
        await (supabase as any).from('projects').update({ disposition: 'In Service' }).eq('id', pid)
        setProject(p => ({ ...p, disposition: 'In Service' }))
        onProjectUpdated()
        showToast('Project marked In Service ✓')
      } else if (project.disposition === 'In Service') {
        // Revert only if disposition was auto-set — don't clobber manual overrides
        await (supabase as any).from('projects').update({ disposition: 'Sale' }).eq('id', pid)
        setProject(p => ({ ...p, disposition: 'Sale' }))
        onProjectUpdated()
        showToast('Disposition reverted to Sale')
      }
    }
  }

  async function updateTaskReason(taskId: string, reason: string) {
    setTaskReasons(prev => ({ ...prev, [taskId]: reason }))
    await (supabase as any).from('task_state').upsert({
      project_id: pid,
      task_id: taskId,
      status: taskStates[taskId] ?? 'Not Ready',
      reason: reason || null,
    }, { onConflict: 'project_id,task_id' })

    // Fire-and-forget — log reason changes to history too
    const changedBy = currentUser?.name
      ?? userEmail.split('@')[0]
      ?? 'unknown'
    void (supabase as any).from('task_history').insert({
      project_id: pid,
      task_id: taskId,
      status: taskStates[taskId] ?? 'Not Ready',
      reason: reason || null,
      changed_by: changedBy,
      pm_id: currentUser?.id ?? null,
    })
    setTaskHistoryLoaded(false)
  }

  function isLocked(task: { pre: string[] }): boolean {
    return task.pre.some(preId => taskStates[preId] !== 'Complete')
  }

  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    const pm = currentUser?.name ?? userEmail.split('@')[0] ?? 'PM'
    await (supabase as any).from('notes').insert({
      project_id: pid, text: newNote.trim(),
      time: new Date().toISOString(), pm,
      pm_id: currentUser?.id ?? null,
    })
    setNewNote('')
    await loadNotes()
    setSaving(false)
    showToast('Note added')
  }

  async function setBlocker() {
    const text = blockerInput.trim()
    await (supabase as any).from('projects').update({ blocker: text || null }).eq('id', pid)
    setProject(p => ({ ...p, blocker: text || null }))
    setShowBlockerForm(false)
    onProjectUpdated()
    showToast(text ? 'Blocker set' : 'Blocker cleared')
  }

  async function saveEdits() {
    setEditSaving(true)
    await (supabase as any).from('projects').update(editDraft).eq('id', pid)

    // Audit log: record each changed field
    const auditEntries = Object.entries(editDraft)
      .filter(([key, val]) => String(val ?? '') !== String((project as any)[key] ?? ''))
      .map(([key, val]) => ({
        project_id: pid,
        field: key,
        old_value: (project as any)[key] != null ? String((project as any)[key]) : null,
        new_value: val != null ? String(val) : null,
        changed_by: currentUser?.name ?? null,
        changed_by_id: currentUser?.id ?? null,
      }))
    if (auditEntries.length > 0) {
      void (supabase as any).from('audit_log').insert(auditEntries)
    }

    setProject(p => ({ ...p, ...editDraft }))
    setEditMode(false)
    setEditDraft({})
    setEditSaving(false)
    onProjectUpdated()
    showToast('Project updated')
  }

  function startEdit() {
    setEditDraft({
      name: project.name, city: project.city, address: project.address,
      phone: project.phone, email: project.email,
      contract: project.contract, systemkw: project.systemkw,
      financier: project.financier, financing_type: project.financing_type,
      down_payment: project.down_payment, tpo_escalator: project.tpo_escalator,
      financier_adv_pmt: project.financier_adv_pmt, disposition: project.disposition,
      dealer: project.dealer, module: project.module, module_qty: project.module_qty,
      inverter: project.inverter, inverter_qty: project.inverter_qty,
      battery: project.battery, battery_qty: project.battery_qty,
      optimizer: project.optimizer, optimizer_qty: project.optimizer_qty,
      meter_location: project.meter_location, panel_location: project.panel_location,
      voltage: project.voltage, msp_bus_rating: project.msp_bus_rating,
      mpu: project.mpu, shutdown: project.shutdown,
      performance_meter: project.performance_meter,
      interconnection_breaker: project.interconnection_breaker,
      main_breaker: project.main_breaker, hoa: project.hoa, esid: project.esid,
      pm: project.pm, advisor: project.advisor, consultant: project.consultant,
      consultant_email: project.consultant_email, site_surveyor: project.site_surveyor,
      ahj: project.ahj, utility: project.utility,
      permit_number: project.permit_number, utility_app_number: project.utility_app_number,
      permit_fee: project.permit_fee,
      city_permit_date: project.city_permit_date, utility_permit_date: project.utility_permit_date,
      sale_date: project.sale_date, ntp_date: project.ntp_date,
      survey_scheduled_date: project.survey_scheduled_date, survey_date: project.survey_date,
      install_scheduled_date: project.install_scheduled_date, install_complete_date: project.install_complete_date,
      city_inspection_date: project.city_inspection_date, utility_inspection_date: project.utility_inspection_date,
      pto_date: project.pto_date, in_service_date: project.in_service_date,
    })
    setEditMode(true)
    setTab('info')
  }

  async function advanceStage() {
    if (!nextStage) return
    const { ok, missing } = canAdvance(project.stage, taskStates)
    if (!ok) {
      showToast(`Complete required tasks first: ${missing.slice(0,2).join(', ')}${missing.length > 2 ? '...' : ''}`)
      return
    }
    setAdvancing(true)
    const today = new Date().toISOString().slice(0, 10)
    await (supabase as any).from('projects').update({ stage: nextStage, stage_date: today }).eq('id', pid)
    await (supabase as any).from('stage_history').insert({ project_id: pid, stage: nextStage, entered: today })
    void (supabase as any).from('audit_log').insert({
      project_id: pid, field: 'stage',
      old_value: project.stage, new_value: nextStage,
      changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
    })
    setProject(p => ({ ...p, stage: nextStage as Project['stage'], stage_date: today }))
    setAdvancing(false)
    onProjectUpdated()
    showToast(`Moved to ${STAGE_LABELS[nextStage]}`)
  }

  const stuckCount = stageTasks.filter(t => {
    const s = taskStates[t.id] ?? 'Not Ready'
    return s === 'Pending Resolution' || s === 'Revision Required'
  }).length

  const days = daysAgo(project.stage_date)
  const cycle = daysAgo(project.sale_date) || days
  const advance = canAdvance(project.stage, taskStates)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-4xl bg-gray-900 flex flex-col shadow-2xl overflow-hidden">

        {toast && (
          <div className="absolute top-4 right-4 bg-gray-700 text-white text-xs px-4 py-2 rounded-lg shadow-lg z-10">
            {toast}
          </div>
        )}

        {/* Header */}
        <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{project.name}</h2>
              <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>{project.id}</span>
                <span>·</span><span>{project.city}</span>
                <span>·</span><span className="text-green-400">{STAGE_LABELS[project.stage]}</span>
                <span>·</span><span>{days}d in stage</span>
                <span>·</span><span>{cycle}d total</span>
                <span>·</span><span>{project.pm}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl ml-4 flex-shrink-0">×</button>
          </div>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {!showBlockerForm ? (
              <button onClick={() => setShowBlockerForm(true)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  project.blocker ? 'bg-red-900 text-red-300 hover:bg-red-800' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}>
                {project.blocker ? `🚫 ${project.blocker}` : '+ Set Blocker'}
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <input autoFocus value={blockerInput}
                  onChange={e => setBlockerInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') setBlocker(); if (e.key === 'Escape') setShowBlockerForm(false) }}
                  placeholder="Describe the blocker..."
                  className="flex-1 bg-gray-800 text-white text-xs rounded-lg px-3 py-1.5 border border-gray-600 focus:border-red-500 focus:outline-none"
                />
                <button onClick={setBlocker} className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg">Save</button>
                {project.blocker && (
                  <button onClick={() => { setBlockerInput(''); setBlocker() }} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">Clear</button>
                )}
                <button onClick={() => setShowBlockerForm(false)} className="text-xs text-gray-500 hover:text-white px-2">Cancel</button>
              </div>
            )}
            {!showBlockerForm && !editMode && (currentUser?.isManager || currentUser?.id === project.pm_id) && (
              <button onClick={startEdit} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                ✏ Edit
              </button>
            )}
            {editMode && (
              <div className="flex items-center gap-2">
                <button onClick={saveEdits} disabled={editSaving}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors">
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
                <button onClick={() => { setEditMode(false); setEditDraft({}) }}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-400 hover:text-white transition-colors">
                  Cancel
                </button>
              </div>
            )}
            {nextStage && !showBlockerForm && (
              <button onClick={advanceStage} disabled={advancing}
                title={!advance.ok ? `Complete required tasks: ${advance.missing.join(', ')}` : ''}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  advance.ok ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}>
                {advancing ? 'Moving...' : `→ ${STAGE_LABELS[nextStage]}`}
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {currentUser?.isAdmin && (
              project.disposition === 'Cancelled' ? (
                <button
                  onClick={async () => {
                    if (!confirm('Reactivate this project? It will return to the active pipeline.')) return
                    await (supabase as any).from('projects').update({ disposition: 'Sale' }).eq('id', project.id)
                    setProject(p => ({ ...p, disposition: 'Sale' }))
                    if (onProjectUpdated) onProjectUpdated()
                  }}
                  className="text-[10px] px-2 py-1 rounded text-green-400 hover:bg-green-900/30 transition-colors"
                >
                  Reactivate
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!confirm(`Cancel ${project.name}? It will be removed from the active pipeline.`)) return
                    await (supabase as any).from('projects').update({ disposition: 'Cancelled' }).eq('id', project.id)
                    setProject(p => ({ ...p, disposition: 'Cancelled' }))
                    if (onProjectUpdated) onProjectUpdated()
                  }}
                  className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-amber-400 hover:bg-amber-900/20 transition-colors"
                >
                  Cancel Project
                </button>
              )
            )}
              {currentUser?.isSuperAdmin && (
                <button
                  onClick={async () => {
                    if (!confirm(`DELETE ${project.name} (${project.id})? This cannot be undone.`)) return
                    if (!confirm('Are you absolutely sure? All project data will be permanently deleted.')) return
                    await supabase.from('task_state').delete().eq('project_id', project.id)
                    await supabase.from('notes').delete().eq('project_id', project.id)
                    await (supabase as any).from('stage_history').delete().eq('project_id', project.id)
                    await (supabase as any).from('task_history').delete().eq('project_id', project.id)
                    await (supabase as any).from('schedule').delete().eq('project_id', project.id)
                    await (supabase as any).from('service_calls').delete().eq('project_id', project.id)
                    await (supabase as any).from('project_funding').delete().eq('project_id', project.id)
                    await (supabase as any).from('project_folders').delete().eq('project_id', project.id)
                    await supabase.from('projects').delete().eq('id', project.id)
                    onClose()
                    if (onProjectUpdated) onProjectUpdated()
                  }}
                  className="text-[10px] px-2 py-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                  title="Super admin only — permanently delete project and all related data"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 flex-shrink-0 bg-gray-950">
          {([
            { id: 'tasks', label: `Tasks${stuckCount ? ` (${stuckCount} stuck)` : ''}`, stuck: stuckCount > 0 },
            { id: 'notes', label: `Notes${notes.length ? ` (${notes.length})` : ''}`, stuck: false },
            { id: 'info',  label: 'Info', stuck: false },
            { id: 'bom',   label: 'BOM', stuck: false },
            { id: 'files', label: 'Files', stuck: false },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t.id ? 'border-b-2 border-green-400 text-green-400' :
                t.stuck ? 'text-red-400 hover:text-red-300' : 'text-gray-400 hover:text-white'
              }`}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* TASKS */}
          {tab === 'tasks' && (
            <TasksTab
              project={project}
              taskStates={taskStates}
              taskReasons={taskReasons}
              taskStatesRaw={taskStatesRaw}
              taskHistory={taskHistory}
              taskHistoryLoaded={taskHistoryLoaded}
              taskView={taskView}
              setTaskView={setTaskView}
              updateTaskStatus={updateTaskStatus}
              updateTaskReason={updateTaskReason}
            />
          )}


          {/* NOTES */}
          {tab === 'notes' && (
            <NotesTab notes={notes} newNote={newNote} setNewNote={setNewNote} addNote={addNote} saving={saving} />
          )}

          {/* INFO */}
          {tab === 'info' && (
            <InfoTab
              project={project}
              editMode={editMode}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              ahjInfo={ahjInfo}
              utilityInfo={utilityInfo}
              openAhjEdit={openAhjEdit}
              openUtilEdit={openUtilEdit}
              stageHistory={stageHistory}
              serviceCalls={serviceCalls}
            />
          )}

          {/* BOM */}
          {tab === 'bom' && <BomTab project={project} />}

          {/* FILES */}
          {tab === 'files' && (
            <div className="flex-1 flex items-center justify-center">
              {folderUrl ? (
                <a href={folderUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-6 py-4 transition-colors">
                  <img src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" alt="Drive" className="w-8 h-8" />
                  <span className="text-sm font-semibold text-white">Open in Google Drive ↗</span>
                </a>
              ) : (
                <div className="text-gray-500 text-sm text-center">
                  <div className="text-2xl mb-2">📁</div>
                  No Drive folder linked to this project.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AHJ Edit Popup */}
      {ahjEdit && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setAhjEdit(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Edit AHJ — {ahjEdit.name}</h3>
              <button onClick={() => setAhjEdit(null)} className="text-gray-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Permit Phone</label>
                <input value={ahjEdit.permit_phone ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, permit_phone: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Permit Website</label>
                <input value={ahjEdit.permit_website ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, permit_website: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Max Duration (days)</label>
                  <input type="number" value={ahjEdit.max_duration ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, max_duration: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Electric Code</label>
                  <input value={ahjEdit.electric_code ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, electric_code: e.target.value || null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Permit Notes</label>
                <textarea rows={3} value={ahjEdit.permit_notes ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, permit_notes: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setAhjEdit(null)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <button onClick={saveAhjEdit} disabled={refSaving}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50">
                {refSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Utility Edit Popup */}
      {utilEdit && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setUtilEdit(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Edit Utility — {utilEdit.name}</h3>
              <button onClick={() => setUtilEdit(null)} className="text-gray-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Phone</label>
                <input value={utilEdit.phone ?? ''} onChange={e => setUtilEdit((d: any) => ({ ...d, phone: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Website</label>
                <input value={utilEdit.website ?? ''} onChange={e => setUtilEdit((d: any) => ({ ...d, website: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <textarea rows={3} value={utilEdit.notes ?? ''} onChange={e => setUtilEdit((d: any) => ({ ...d, notes: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setUtilEdit(null)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <button onClick={saveUtilEdit} disabled={refSaving}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50">
                {refSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
