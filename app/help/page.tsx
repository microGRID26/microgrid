'use client'

import { Nav } from '@/components/Nav'

import { useState } from 'react'

type Tab = 'pms' | 'funding' | 'leadership' | 'everyone' | 'admins'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pms',        label: 'For PMs'        },
  { id: 'funding',    label: 'For Funding'     },
  { id: 'leadership', label: 'For Leadership'  },
  { id: 'everyone',   label: 'For Everyone'    },
  { id: 'admins',     label: 'For Admins'      },
]

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-5 py-4 mb-3">
      <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
      <div className="text-sm text-gray-400 leading-relaxed">{children}</div>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-6 mb-3 px-1">{title}</div>
  )
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="text-gray-600 mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

// ── TAB CONTENT ───────────────────────────────────────────────────────────────

function ForPMs() {
  return (
    <div>
      <SectionHeader title="Daily Workflow" />
      <Card title="Command Center">
        Your home base. Projects are grouped by urgency into collapsible sections: Overdue Tasks, Blocked,
        Pending Resolution, Critical (past SLA), At Risk, Stalled (no movement 5+ days), Aging (90+ day cycle),
        On Track, Loyalty, and In Service. Metric cards at the top show counts — click any card to expand that
        section. All sections start collapsed; expand the ones you need. Stuck task badges (red for Pending
        Resolution, amber for Revision Required) appear inline below each project row.
      </Card>
      <Card title="My Queue">
        Your daily worklist, organized into collapsible task-based sections. Select your name from the PM dropdown (top right) to see only your projects. Sections include:
        <Ul items={[
          'Follow-ups Today — projects with task follow-up dates due today or overdue',
          'City Permit Ready — projects where City Permit Approval is Ready To Start',
          'City Permit Submitted — permits in progress, waiting for approval',
          'Utility Permit Submitted — utility permits in progress',
          'Utility Inspection Ready — ready to schedule utility inspection',
          'Utility Inspection Submitted — inspections in progress',
          'Blocked — projects with a blocker set',
          'Active — everything else',
          'Complete — finished projects',
        ]} />
        <div className="mt-2">Click any section header to expand/collapse. All sections start collapsed except Follow-ups Today.</div>
      </Card>
      <Card title="Opening a project panel">
        Click any project row to open its detail panel. The panel loads task state, notes, and all project data
        from the server. Tabs across the top: Tasks, Notes, Info, BOM, Files.
      </Card>

      <SectionHeader title="Task System" />

      {/* ── Stage Navigation mockup ──────────────────────────────── */}
      <Card title="Stage navigation">
        The Tasks tab opens with stage pills across the top. Each pill shows a completion fraction. A green dot marks the current stage. Click any pill to view that stage.
        <div className="mt-3 flex flex-wrap gap-1">
          <span className="text-xs px-2.5 py-1.5 rounded-md bg-gray-800 text-gray-400">Evaluation <span className="text-green-400 text-[10px]">5/5</span></span>
          <span className="text-xs px-2.5 py-1.5 rounded-md bg-gray-800 text-gray-400">Site Survey <span className="text-green-400 text-[10px]">2/2</span></span>
          <span className="text-xs px-2.5 py-1.5 rounded-md bg-gray-700 text-white ring-1 ring-gray-600 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Design <span className="text-red-400 text-[10px]">6/12</span></span>
          <span className="text-xs px-2.5 py-1.5 rounded-md bg-gray-800 text-gray-400">Permitting <span className="text-gray-500 text-[10px]">0/6</span></span>
          <span className="text-xs px-2.5 py-1.5 rounded-md bg-gray-800 text-gray-400">Installation <span className="text-gray-500 text-[10px]">0/4</span></span>
          <span className="text-xs px-2.5 py-1.5 rounded-md bg-gray-800 text-gray-400">Inspection <span className="text-gray-500 text-[10px]">0/8</span></span>
          <span className="text-xs px-2.5 py-1.5 rounded-md bg-gray-800 text-gray-400">Complete <span className="text-gray-500 text-[10px]">0/2</span></span>
        </div>
      </Card>

      {/* ── Stage Progress Header mockup ─────────────────────────── */}
      <Card title="Stage progress header">
        Below the pills, the header shows stage name, days in stage (color-coded to SLA), stuck count, and a progress bar.
        <div className="mt-3 bg-gray-800/50 rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white uppercase tracking-wider">Design</span>
            <span className="text-[10px] bg-green-900 text-green-300 px-1.5 py-0.5 rounded font-medium uppercase">Current</span>
            <span className="text-xs text-green-400">3d in stage</span>
            <span className="text-xs text-red-400 font-medium">1 stuck</span>
            <span className="text-xs text-gray-500 ml-auto">50%</span>
          </div>
          <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-blue-500" style={{ width: '50%' }} />
          </div>
        </div>
      </Card>

      {/* ── Task Table mockup ────────────────────────────────────── */}
      <Card title="Task table layout">
        Each task is a row. Required tasks show *, optional show (opt). Status dropdown on the right. Color-coded left borders.
        <div className="mt-3 border border-gray-700 rounded-lg overflow-hidden text-xs">
          {/* Complete row */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 border-l-2 border-l-green-500 bg-green-950/20">
            <span className="text-green-500 font-bold w-3 text-center">*</span>
            <span className="w-4 text-center text-gray-500">▸</span>
            <span className="flex-1 text-gray-100">Build Design</span>
            <span className="text-[10px] text-gray-500">Mar 5</span>
            <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete</span>
          </div>
          {/* In Progress row */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 border-l-2 border-l-blue-500 bg-blue-950/10">
            <span className="text-green-500 font-bold w-3 text-center">*</span>
            <span className="w-4 text-center text-gray-500">▸</span>
            <span className="flex-1 text-gray-100">Scope of Work</span>
            <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">In Progress</span>
          </div>
          {/* Pending Resolution row */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 border-l-2 border-l-red-500 bg-red-950/20">
            <span className="text-green-500 font-bold w-3 text-center">*</span>
            <span className="w-4 text-center text-gray-500">▸</span>
            <span className="flex-1 text-gray-100">Build Engineering</span>
            <span className="text-[10px] bg-amber-900/60 text-amber-400 px-1.5 py-0.5 rounded font-medium">2 rev</span>
            <span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded">Pending Resolution</span>
          </div>
          {/* Reason sub-row */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 pl-10 bg-red-950/10">
            <span className="text-[10px] text-gray-500">Reason</span>
            <span className="bg-red-950 text-red-300 px-1.5 py-0.5 rounded text-[11px]">MPU Review</span>
          </div>
          {/* Revision Required row */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 border-l-2 border-l-amber-500 bg-amber-950/20">
            <span className="text-green-500 font-bold w-3 text-center">*</span>
            <span className="w-4" />
            <span className="flex-1 text-gray-100">Engineering Approval</span>
            <span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded">Revision Required</span>
          </div>
          {/* Locked row */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 border-l-2 border-l-transparent opacity-40">
            <span className="w-3" />
            <span className="w-4" />
            <span className="flex-1 text-gray-400">Stamps Required <span className="text-gray-600">(opt)</span></span>
            <span className="bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">Not Ready</span>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-gray-600">Locked tasks (dimmed) cannot be changed until prerequisites are complete.</div>
      </Card>

      {/* ── Row Color Legend ──────────────────────────────────────── */}
      <Card title="Row color coding">
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="flex items-center gap-2"><span className="w-16 h-5 rounded border-l-2 border-l-green-500 bg-green-950/20" /><span>Complete</span></div>
          <div className="flex items-center gap-2"><span className="w-16 h-5 rounded border-l-2 border-l-red-500 bg-red-950/20" /><span>Pending Resolution — waiting on external action</span></div>
          <div className="flex items-center gap-2"><span className="w-16 h-5 rounded border-l-2 border-l-amber-500 bg-amber-950/20" /><span>Revision Required — needs rework</span></div>
          <div className="flex items-center gap-2"><span className="w-16 h-5 rounded border-l-2 border-l-blue-500 bg-blue-950/10" /><span>In Progress</span></div>
          <div className="flex items-center gap-2"><span className="w-16 h-5 rounded border-l-2 border-l-indigo-400" /><span>Scheduled</span></div>
          <div className="flex items-center gap-2"><span className="w-16 h-5 rounded border-l-2 border-l-transparent bg-gray-800" /><span>Not Ready / Ready To Start</span></div>
        </div>
      </Card>

      {/* ── Status Legend ─────────────────────────────────────────── */}
      <Card title="Task statuses">
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="flex items-center gap-2"><span className="bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">Not Ready</span><span className="text-gray-400">— prerequisites not done (task is locked)</span></div>
          <div className="flex items-center gap-2"><span className="bg-gray-700 text-gray-200 px-1.5 py-0.5 rounded">Ready To Start</span><span className="text-gray-400">— prerequisites done, waiting to begin</span></div>
          <div className="flex items-center gap-2"><span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">In Progress</span><span className="text-gray-400">— actively being worked</span></div>
          <div className="flex items-center gap-2"><span className="bg-indigo-900 text-indigo-300 px-1.5 py-0.5 rounded">Scheduled</span><span className="text-gray-400">— work scheduled for a specific date</span></div>
          <div className="flex items-center gap-2"><span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded">Pending Resolution</span><span className="text-gray-400">— blocked, waiting on external action</span></div>
          <div className="flex items-center gap-2"><span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded">Revision Required</span><span className="text-gray-400">— needs rework (triggers cascade)</span></div>
          <div className="flex items-center gap-2"><span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete</span><span className="text-gray-400">— done</span></div>
        </div>
      </Card>

      <Card title="How tasks unlock (prerequisites)">
        Tasks with a lock icon are waiting on prerequisite tasks to be completed first. You cannot change a
        locked task. When all prerequisites are Complete, the task automatically unlocks and is set to <span className="bg-gray-700 text-gray-200 px-1 py-0.5 rounded text-[10px]">Ready To Start</span>. The prerequisite
        chain flows within and across stages — for example, Engineering Approval requires Build Engineering,
        which requires Scope of Work.
      </Card>

      <Card title="Required vs optional tasks">
        Tasks marked with <span className="text-green-500 font-bold">*</span> are required — they must all be
        Complete before you can advance to the next stage. Tasks marked <span className="text-gray-500">(opt)</span> are
        optional and do not block stage advancement.
      </Card>

      <Card title="Reasons (Pending Resolution & Revision Required)">
        When you set a task to Pending Resolution or Revision Required, a reason dropdown appears below the row.
        Select the specific reason — this is visible across the system (Command Center, Queue, Audit page).
        Some tasks without predefined reasons show a free-text input instead.
      </Card>

      {/* ── Cascade Confirmation mockup ──────────────────────────── */}
      <Card title="Revision Required — cascade reset">
        When you set a task to Revision Required, the system checks for downstream tasks that have been worked on.
        A confirmation dialog appears:
        <div className="mt-3 bg-gray-800 border border-gray-700 rounded-xl p-4 max-w-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-400 text-lg">↩</span>
            <span className="text-sm font-semibold text-white">Revision Required</span>
          </div>
          <p className="text-xs text-gray-300 mb-3">
            Setting <span className="text-white font-medium">Build Design</span> to Revision Required
            will reset 3 downstream tasks to Not Ready:
          </p>
          <div className="bg-gray-900 rounded-lg p-2 mb-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-200">Scope of Work</span>
              <span className="text-[10px] bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete → Not Ready</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-200">Build Engineering</span>
              <span className="text-[10px] bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">In Progress → Not Ready</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-200">Engineering Approval</span>
              <span className="text-[10px] bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete → Not Ready</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <span className="px-3 py-1.5 text-xs text-gray-400 border border-gray-700 rounded-md">Cancel</span>
            <span className="px-3 py-1.5 text-xs bg-amber-700 text-white rounded-md font-medium">Reset 3 tasks & continue</span>
          </div>
        </div>
        <Ul items={[
          'Cascade only resets tasks within the same stage',
          'Only tasks not already "Not Ready" are listed',
          'Cancel aborts the revision entirely',
          'All resets logged to task history with (cascade) marker',
        ]} />
      </Card>

      {/* ── Inline History mockup ────────────────────────────────── */}
      <Card title="Inline task history">
        Click the ▸ arrow next to any task to expand its history. Shows every status change with date, time, status, reason, and who.
        <div className="mt-3 bg-gray-800 rounded-lg p-3 text-[11px]">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">History (4)</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-gray-600 w-14">Mar 18</span>
              <span className="text-gray-600 w-12">2:30 PM</span>
              <span className="bg-red-900 text-red-300 px-1 py-0.5 rounded">Pending Resolution</span>
              <span className="text-red-400">MPU Review</span>
              <span className="text-gray-600 ml-auto">Greg K</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600 w-14">Mar 15</span>
              <span className="text-gray-600 w-12">9:15 AM</span>
              <span className="bg-amber-900 text-amber-300 px-1 py-0.5 rounded">Revision Required</span>
              <span className="text-amber-400">Panel Count Change</span>
              <span className="text-gray-600 ml-auto">Jen H</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600 w-14">Mar 10</span>
              <span className="text-gray-600 w-12">4:00 PM</span>
              <span className="bg-green-900 text-green-300 px-1 py-0.5 rounded">Complete</span>
              <span className="text-gray-600 ml-auto">Jen H</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600 w-14">Mar 8</span>
              <span className="text-gray-600 w-12">11:20 AM</span>
              <span className="bg-blue-900 text-blue-300 px-1 py-0.5 rounded">In Progress</span>
              <span className="text-gray-600 ml-auto">Jen H</span>
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500">The <span className="bg-amber-900/60 text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-medium">2 rev</span> badge shows at a glance how many revisions a task has had.</div>
      </Card>

      <Card title="Full History view">
        Toggle from Stage View to Full History at the top of the Tasks tab. Shows a chronological log of all
        task changes across all stages, most recent first. Each entry shows stage label, task name, status badge,
        reason, who changed it, and when.
      </Card>

      <SectionHeader title="Task Notes & Follow-ups" />
      <Card title="Per-task notes">
        Each task has its own notes section — separate from the main project notes. Click the
        <span className="inline-flex items-center mx-1 text-gray-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></span>
        icon next to any task name to expand the notes panel. Notes are timestamped with the author name, so you
        can see who said what and when — just like project-level notes but organized by task. The icon turns green
        when a task has notes, with a count badge.
      </Card>
      <Card title="Task follow-up dates">
        Inside the task notes panel, you can set a <span className="text-white font-medium">follow-up date</span> for
        any task. This date appears in the Queue page under &quot;Follow-ups Today&quot; when it&apos;s due. Use this to
        remind yourself to check on a permit status, call a customer back, or follow up with an inspector.
        When a follow-up is overdue, it shows a yellow indicator on the task row even when the notes panel is collapsed.
      </Card>

      <SectionHeader title="Disposition Workflow" />
      <Card title="Sale → Loyalty → Cancelled">
        Projects follow a controlled disposition flow to ensure retention is attempted before cancellation:
        <Ul items={[
          'Sale — active project (default)',
          'Loyalty — customer is at risk of cancelling, retention efforts underway',
          'Cancelled — customer has been lost (only available after Loyalty)',
          'In Service — project is live and operational',
        ]} />
        <div className="mt-2">You <span className="text-white font-medium">cannot skip from Sale directly to Cancelled</span>. The project must go through Loyalty first so the team has a chance to retain the customer. A confirmation dialog appears when cancelling.</div>
      </Card>

      <SectionHeader title="Change Orders" />
      <Card title="What are change orders?">
        When a system design changes after the initial proposal (usually panel count reduction during engineering),
        a Homeowner Change Order (HCO) is required. This happens on almost every job — the proposal maxes out
        the roof, then engineering right-sizes it. The Change Orders page tracks these through a 6-step workflow
        with automatic status progression.
      </Card>

      <Card title="Creating a change order">
        Click <span className="text-xs px-2 py-0.5 rounded bg-green-700 text-white font-medium">+ New Change Order</span> on
        the Change Orders page. Search for the project — original design values auto-populate:
        <div className="mt-2 bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-400 space-y-0.5">
          <div>Panel Count: <span className="text-gray-200">48</span></div>
          <div>Panel Type: <span className="text-gray-200">HY-DH108P8-405B</span></div>
          <div>System Size: <span className="text-gray-200">19.44 kW</span></div>
        </div>
        <div className="mt-2 text-sm text-gray-400">Set the type, reason, origin, priority, and assignment. The title auto-fills as &quot;Change Order - [Project Name]&quot;.</div>
      </Card>

      <Card title="Change order statuses">
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="flex items-center gap-2"><span className="bg-red-900 text-red-300 px-2 py-0.5 rounded-full">Open</span><span className="text-gray-400">— newly created, not started</span></div>
          <div className="flex items-center gap-2"><span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">In Progress</span><span className="text-gray-400">— auto-set when first workflow step is checked</span></div>
          <div className="flex items-center gap-2"><span className="bg-amber-900 text-amber-300 px-2 py-0.5 rounded-full">Waiting On Signature</span><span className="text-gray-400">— design done, waiting for homeowner to sign</span></div>
          <div className="flex items-center gap-2"><span className="bg-green-900 text-green-300 px-2 py-0.5 rounded-full">Complete</span><span className="text-gray-400">— auto-set when all 6 workflow steps are done</span></div>
          <div className="flex items-center gap-2"><span className="bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Cancelled</span><span className="text-gray-400">— change order was abandoned</span></div>
        </div>
      </Card>

      {/* ── Workflow mockup ───────────────────────────────────────── */}
      <Card title="Workflow steps & automation">
        Each change order has a 6-step design workflow. Check steps off as they complete — saves immediately.
        <div className="mt-3 bg-gray-800/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Design Workflow</span>
            <span className="text-xs text-gray-500">4/6 steps</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-3">
            <div className="h-full rounded-full bg-green-600" style={{ width: '67%' }} />
          </div>
          <div className="space-y-1">
            {[
              { label: '1. Design Request Submitted (HCO)', done: true },
              { label: '2. Design In Progress', done: true },
              { label: '3. Design Pending Approval (HCO)', done: true },
              { label: '4. Design Approved (HCO)', done: true },
              { label: '5. Design Complete', done: false },
              { label: '6. Design Complete and Signed (HCO)', done: false },
            ].map(s => (
              <div key={s.label} className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg ${s.done ? 'bg-green-900/20' : ''}`}>
                <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${s.done ? 'bg-green-600 border-green-600' : 'border-gray-600'}`}>
                  {s.done && <span className="text-white text-[10px]">✓</span>}
                </div>
                <span className={`text-xs ${s.done ? 'text-green-300 line-through' : 'text-gray-300'}`}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 text-sm text-gray-400">
          <strong className="text-gray-300">Automations:</strong>
        </div>
        <Ul items={[
          'Checking the first step on an Open change order auto-sets status to In Progress',
          'Checking all 6 steps auto-sets status to Complete',
          'You can still manually change the status at any time (e.g., to set Waiting On Signature)',
        ]} />
      </Card>

      {/* ── Design Comparison mockup ─────────────────────────────── */}
      <Card title="Design comparison">
        The detail panel shows original vs new design values. Edit new values inline — changed values highlight green.
        <div className="mt-3 bg-gray-900 rounded-lg border border-gray-800 overflow-hidden text-xs">
          <div className="grid grid-cols-3 gap-0 px-3 py-2 bg-gray-800/50 border-b border-gray-800">
            <span className="text-gray-500 font-medium">Field</span>
            <span className="text-gray-500 font-medium text-center">Original</span>
            <span className="text-gray-500 font-medium text-center">New</span>
          </div>
          <div className="grid grid-cols-3 gap-0 px-3 py-1.5 border-b border-gray-800/50">
            <span className="text-gray-400">Panel Count</span>
            <span className="text-gray-300 text-center">48</span>
            <span className="text-green-400 font-medium text-center">42</span>
          </div>
          <div className="grid grid-cols-3 gap-0 px-3 py-1.5 border-b border-gray-800/50">
            <span className="text-gray-400">Panel Type</span>
            <span className="text-gray-300 text-center">HY-DH108P8-405B</span>
            <span className="text-gray-400 text-center">-</span>
          </div>
          <div className="grid grid-cols-3 gap-0 px-3 py-1.5 border-b border-gray-800/50">
            <span className="text-gray-400">System Size (kW)</span>
            <span className="text-gray-300 text-center">19.44</span>
            <span className="text-green-400 font-medium text-center">17.01</span>
          </div>
          <div className="grid grid-cols-3 gap-0 px-3 py-1.5">
            <span className="text-gray-400">KWH/YR</span>
            <span className="text-gray-300 text-center">23,953</span>
            <span className="text-green-400 font-medium text-center">22,346</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500">Click any New value to edit it. Changes save when you click away or press Enter.</div>
      </Card>

      <Card title="Design notes">
        Add timestamped notes to track communication. Each note records your name, date, and time automatically.
        Notes stack newest-first, like a log:
        <div className="mt-2 bg-gray-800 rounded-lg px-3 py-2 text-xs">
          <div className="text-gray-300 leading-relaxed">3/20/26 9:15 AM Greg Kelsch - Sent text to rep for an update on getting the HCO signed</div>
          <div className="text-gray-300 leading-relaxed mt-2">3/18/26 2:30 PM Jen Harper - EC is working with customer to get AC relocated</div>
          <div className="text-gray-300 leading-relaxed mt-2">3/15/26 11:00 AM Greg Kelsch - HCO sent to customer for signature</div>
        </div>
      </Card>

      <Card title="Working a change order">
        Click any row in the queue to open the detail panel. From there you can:
        <Ul items={[
          'Change status, priority, type, reason, origin, and assignment via dropdowns',
          'Check off workflow steps (auto-advances status)',
          'Enter new design values — changed values highlight green',
          'Add timestamped notes to track communication',
          'Click the project name to open its full project panel',
        ]} />
      </Card>

      <Card title="Change orders in the project panel">
        When you open any project panel, the header shows an amber badge (e.g., <span className="text-amber-400">&quot;2 Change Orders&quot;</span>) if
        there are active change orders. Click it to jump to the Change Orders page filtered to that project.
      </Card>

      {/* ── Automations Section ──────────────────────────────────── */}
      <SectionHeader title="Automations" />
      <Card title="How automations work">
        The system automates repetitive bookkeeping so you can focus on moving projects forward. Here is the automation chain:
        <div className="mt-3 bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="bg-green-900 text-green-300 px-2 py-1 rounded font-medium">Task Complete</span>
            <span className="text-gray-500">→</span>
            <span className="bg-blue-900 text-blue-300 px-2 py-1 rounded font-medium">Date Populated</span>
            <span className="text-gray-500">→</span>
            <span className="bg-amber-900 text-amber-300 px-2 py-1 rounded font-medium">Funding Eligible</span>
            <span className="text-gray-500">→</span>
            <span className="bg-green-900 text-green-300 px-2 py-1 rounded font-medium">Stage Advanced</span>
          </div>
        </div>
      </Card>

      <Card title="Auto-populate project dates">
        Completing specific tasks auto-fills the matching project date field. 11 mappings total:
        <div className="mt-3 border border-gray-700 rounded-lg overflow-hidden text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800/50">
            <span className="w-1/2 text-gray-500 font-medium">Task Completed</span>
            <span className="w-1/2 text-gray-500 font-medium">Date Auto-Filled</span>
          </div>
          {[
            ['Site Survey Complete', 'survey_date'],
            ['Install Complete', 'install_complete_date'],
            ['PTO Received', 'pto_date'],
            ['City Inspection Pass', 'city_inspection_date'],
            ['Utility Inspection Pass', 'utility_inspection_date'],
            ['HOA Approval', 'hoa_approved_date'],
            ['City Permit Approved', 'permit_approved_date'],
            ['Utility Permit Approved', 'utility_approved_date'],
          ].map(([task, field]) => (
            <div key={task} className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50">
              <span className="w-1/2 text-gray-300">{task}</span>
              <span className="w-1/2 text-green-400 font-mono text-[11px]">{field}</span>
            </div>
          ))}
          <div className="px-3 py-1.5 text-gray-500 text-[11px]">+ 3 more mappings</div>
        </div>
      </Card>

      <Card title="Auto-advance stage">
        When the last required task in a stage is marked Complete, the project automatically advances to the
        next pipeline stage. No manual intervention needed. The stage transition is logged in stage_history.
      </Card>

      <Card title="Auto-detect and clear blockers">
        <div className="mt-2 space-y-2 text-xs">
          <div className="flex items-start gap-2">
            <span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded flex-shrink-0">Pending Resolution</span>
            <span className="text-gray-400">When a task enters Pending Resolution, the project blocker is automatically set to the task reason.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded flex-shrink-0">Resolved</span>
            <span className="text-gray-400">When the stuck task is resolved, the blocker auto-clears (only if it was auto-set, not manually set).</span>
          </div>
        </div>
      </Card>

      <Card title="Funding milestone triggers">
        <div className="mt-2 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Install Complete</span>
            <span className="text-gray-500">→</span>
            <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">M2 Eligible</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded">PTO Received</span>
            <span className="text-gray-500">→</span>
            <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">M3 Eligible</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500">These trigger automatically when the corresponding task is marked Complete. The funding team sees them immediately on the Funding page.</div>
      </Card>

      <Card title="Task duration tracking">
        When a task moves to In Progress, its started_date is automatically set. When it reaches Complete, the
        duration is calculated and displayed as a blue badge on the task row:
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete</span>
          <span className="bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">3d 4h</span>
          <span className="text-gray-500">— time from In Progress to Complete</span>
        </div>
      </Card>

      <SectionHeader title="Stage Advancement" />
      <Card title="Advancing a project">
        Open the project panel. The Advance Stage button is in the header. It will tell you which required tasks
        are still incomplete if you try to advance early. Once all required tasks are done, the button turns active.
        <div className="mt-3 space-y-2">
          {/* Ready to advance */}
          <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-sm font-medium text-white">PROJ-30245 — Johnson Residence</span>
            <span className="ml-auto text-xs px-3 py-1.5 rounded-md bg-green-700 text-white font-medium cursor-pointer">→ Site Survey</span>
          </div>
          {/* Not ready */}
          <div className="bg-gray-800 rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white">PROJ-30198 — Martinez Solar</span>
              <span className="ml-auto text-xs px-3 py-1.5 rounded-md bg-gray-700 text-gray-500 font-medium cursor-not-allowed">→ Site Survey</span>
            </div>
            <div className="mt-2 text-[11px] text-amber-400">Complete required tasks first: Welcome Call, NTP Procedure</div>
          </div>
        </div>
      </Card>
      <Card title="Pipeline stages">
        <Ul items={[
          'Evaluation — welcome call, IA/UB confirmation, schedule survey, NTP',
          'Site Survey — site survey completed and reviewed',
          'Design — engineering, stamps, scope of work',
          'Permitting — HOA, city permit, utility permit',
          'Installation — schedule, inventory, install complete',
          'Inspection — city and utility inspections',
          'Complete — PTO and in-service',
        ]} />
      </Card>

      <SectionHeader title="Notes" />
      <Card title="Adding notes">
        Open any project → Notes tab. Type in the box at the bottom and press Add Note. Notes are timestamped
        and show your name. Notes are visible to the whole team.
        <div className="mt-3 bg-gray-800 rounded-lg p-3 space-y-3">
          {/* Note input */}
          <div className="flex gap-2">
            <div className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-500">Type a note...</div>
            <span className="px-3 py-2 bg-green-700 text-white text-xs rounded-md font-medium">Add Note</span>
          </div>
          {/* Example notes */}
          <div className="space-y-2 text-xs">
            <div className="bg-gray-900 rounded-md px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-500 text-[10px]">Mar 20, 2026 2:15 PM</span>
                <span className="text-gray-400 text-[10px]">Greg Kelsch</span>
              </div>
              <div className="text-gray-300">Spoke with homeowner — confirmed install date for Thursday. Gate code is 4521.</div>
            </div>
            <div className="bg-gray-900 rounded-md px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-500 text-[10px]">Mar 19, 2026 10:30 AM</span>
                <span className="text-gray-400 text-[10px]">Jen Harper</span>
              </div>
              <div className="text-gray-300">Engineering revision submitted. Waiting on updated stamps.</div>
            </div>
            <div className="bg-gray-900 rounded-md px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-500 text-[10px]">Mar 18, 2026 4:00 PM</span>
                <span className="text-gray-400 text-[10px]">Greg Kelsch</span>
              </div>
              <div className="text-gray-300">MPU required per utility. Electrician scheduled for Monday.</div>
            </div>
          </div>
        </div>
      </Card>
      <Card title="Setting a blocker">
        In the project panel header, click Set Blocker. Describe what&apos;s blocking the project. Blocked projects
        appear in red at the top of Command Center. Clear it when resolved.
        <div className="mt-3 space-y-2">
          {/* No blocker state */}
          <div className="bg-gray-800 rounded-lg px-4 py-2.5 flex items-center gap-3 text-xs">
            <span className="text-gray-400">No blocker set</span>
            <span className="ml-auto px-2.5 py-1 border border-red-800 text-red-400 rounded-md cursor-pointer">Set Blocker</span>
          </div>
          {/* Has blocker state */}
          <div className="bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-2.5 flex items-center gap-3 text-xs">
            <span className="text-red-400 font-medium">Blocker:</span>
            <span className="text-red-300">Waiting on MPU inspection — utility requires panel upgrade</span>
            <span className="ml-auto px-2.5 py-1 border border-gray-700 text-gray-400 rounded-md cursor-pointer">Clear</span>
          </div>
        </div>
      </Card>

      <SectionHeader title="Editing a Project" />
      <Card title="Edit mode">
        Click the Edit button in any project panel header to enter edit mode. All fields in the Info tab
        become editable — including contract amount, system size, financier, equipment, site details, and
        all milestone dates. Click Save Changes when done, or Cancel to discard.
        <div className="mt-3 bg-gray-800 rounded-lg p-4 space-y-3">
          {/* Button bar */}
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-blue-700 text-white text-xs rounded-md font-medium">Save Changes</span>
            <span className="px-3 py-1.5 border border-gray-700 text-gray-400 text-xs rounded-md">Cancel</span>
          </div>
          {/* Editable fields mockup */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="w-28 text-gray-500">Name</span>
              <div className="flex-1 bg-gray-900 border border-blue-700 rounded-md px-2.5 py-1.5 text-gray-200">Johnson Residence</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 text-gray-500">Contract</span>
              <div className="flex-1 bg-gray-900 border border-blue-700 rounded-md px-2.5 py-1.5 text-gray-200">$48,500.00</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 text-gray-500">PM</span>
              <div className="flex-1 bg-gray-900 border border-blue-700 rounded-md px-2.5 py-1.5 text-gray-200">Greg Kelsch</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 text-gray-500">System Size</span>
              <div className="flex-1 bg-gray-900 border border-blue-700 rounded-md px-2.5 py-1.5 text-gray-200">12.8 kW</div>
            </div>
          </div>
          <div className="text-[10px] text-gray-600">Blue borders indicate editable fields. All changes are saved together when you click Save Changes.</div>
        </div>
      </Card>
    </div>
  )
}

function ForFunding() {
  return (
    <div>
      <SectionHeader title="Funding View" />
      <Card title="Funding milestones">
        The Funding page shows M1, M2, and M3 milestones for all active projects. Each row shows the project,
        milestone amounts, current status, and days waiting.
        {/* Milestone table mockup */}
        <div className="mt-3 border border-gray-700 rounded-lg overflow-hidden text-xs">
          <div className="grid grid-cols-7 gap-0 px-3 py-2 bg-gray-800/50 border-b border-gray-700">
            <span className="col-span-2 text-gray-500 font-medium">Project</span>
            <span className="text-gray-500 font-medium text-center">M1 Status</span>
            <span className="text-gray-500 font-medium text-center">M1 Amt</span>
            <span className="text-gray-500 font-medium text-center">M2 Status</span>
            <span className="text-gray-500 font-medium text-center">M3 Status</span>
            <span className="text-gray-500 font-medium text-center">Days</span>
          </div>
          <div className="grid grid-cols-7 gap-0 px-3 py-2 border-b border-gray-800/50 items-center">
            <span className="col-span-2 text-gray-200">Johnson Residence</span>
            <span className="text-center"><span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-[10px]">Funded</span></span>
            <span className="text-gray-300 text-center">$9,700</span>
            <span className="text-center"><span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">Eligible</span></span>
            <span className="text-center"><span className="bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded text-[10px]">Not Submitted</span></span>
            <span className="text-amber-400 text-center">12d</span>
          </div>
          <div className="grid grid-cols-7 gap-0 px-3 py-2 items-center">
            <span className="col-span-2 text-gray-200">Martinez Solar</span>
            <span className="text-center"><span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-[10px]">Funded</span></span>
            <span className="text-gray-300 text-center">$12,100</span>
            <span className="text-center"><span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">Submitted</span></span>
            <span className="text-center"><span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">Eligible</span></span>
            <span className="text-red-400 text-center">28d</span>
          </div>
        </div>
      </Card>

      <Card title="Milestone status badges">
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="flex items-center gap-2"><span className="bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Not Submitted</span><span className="text-gray-400">— not yet eligible for funding</span></div>
          <div className="flex items-center gap-2"><span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded">Eligible</span><span className="text-gray-400">— ready to submit to financier</span></div>
          <div className="flex items-center gap-2"><span className="bg-amber-900 text-amber-300 px-2 py-0.5 rounded">Submitted</span><span className="text-gray-400">— submitted, awaiting payment</span></div>
          <div className="flex items-center gap-2"><span className="bg-green-900 text-green-300 px-2 py-0.5 rounded">Funded</span><span className="text-gray-400">— payment received</span></div>
        </div>
      </Card>

      <Card title="Automation callout">
        <div className="mt-2 bg-blue-950/30 border border-blue-900/50 rounded-lg px-4 py-3 text-xs">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-blue-400 font-semibold">Automatic Triggers</span>
          </div>
          <div className="space-y-1.5 text-gray-300">
            <div className="flex items-center gap-2">
              <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-[10px]">Install Complete task done</span>
              <span className="text-gray-500">→</span>
              <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">M2 auto-sets to Eligible</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-[10px]">PTO task done</span>
              <span className="text-gray-500">→</span>
              <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">M3 auto-sets to Eligible</span>
            </div>
          </div>
          <div className="mt-2 text-gray-500">No manual action needed — milestones become Eligible the moment the PM completes the task.</div>
        </div>
      </Card>

      <Card title="M1 — Advance">
        Paid at or near the sale. Typically funded by the financier shortly after NTP is confirmed.
      </Card>
      <Card title="M2 — Substantial Completion">
        Funded when installation is complete. Typically 65% of contract value for most financiers.
      </Card>
      <Card title="M3 — Final">
        Funded after PTO and in-service. Typically 35% of contract value.
      </Card>
      <Card title="Bulk submit">
        Use the checkboxes on the Funding page to select multiple milestones and submit them together.
        This updates all selected milestones to Submitted status at once.
      </Card>
      <Card title="Days waiting">
        The Days Waiting column shows how long a milestone has been in Eligible or Submitted status.
        High numbers here indicate follow-up is needed with the financier.
      </Card>
    </div>
  )
}

function ForLeadership() {
  return (
    <div>
      <SectionHeader title="Analytics — Leadership Dashboard" />
      <Card title="Period selector">
        The Leadership tab in Analytics has a period selector at the top. Choose from Week to Date, This Month,
        This Quarter, This Year, Last 7/30/90 Days, Last Week, or Last Month.
      </Card>
      <Card title="Revenue recognized">
        Counts contract value for projects where install complete date falls within the selected period.
        This is when MicroGRID recognizes revenue.
      </Card>
      <Card title="M2 and M3 funded">
        Shows actual funded amounts (or estimated at 65%/35% of contract if no amount recorded) for
        milestones funded within the period.
      </Card>
      <Card title="Pending funding">
        Total contract value of projects in Eligible or Submitted status that have not yet been funded.
        Split by M2 and M3.
      </Card>
      <Card title="90-day forecast">
        Active projects bucketed by estimated days to installation based on current stage and historical
        stage duration data.
      </Card>
      <Card title="Monthly trend">
        Last 6 months of install completions by count and contract value. Green bars show completed months.
      </Card>
      <Card title="PM breakdown">
        Each PM&apos;s active project count, portfolio value, critical/blocked counts, and installs in the
        selected period.
      </Card>
      <Card title="Revenue by Dealer">
        Below the PM breakdown, a table shows all dealers ranked by total portfolio value with install
        count for the selected period.
      </Card>

      <SectionHeader title="Portfolio Overview" />
      <Card title="Pipeline Health tab">
        Shows stage distribution, average days per stage, and bottleneck identification across all active projects.
      </Card>
      <Card title="SLA performance">
        The Analytics page tracks what percentage of projects are within SLA target, at risk, and critical
        across all stages.
      </Card>
    </div>
  )
}

function ForEveryone() {
  return (
    <div>
      {/* Getting Started guide */}
      <SectionHeader title="Getting Started" />
      <Card title="Your first day">
        <div className="mt-2 bg-gray-800/50 rounded-lg p-4">
          <div className="space-y-3 text-xs">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-700 text-white flex items-center justify-center font-bold flex-shrink-0">1</span>
              <div>
                <span className="text-white font-medium">Go to Command</span>
                <p className="text-gray-400 mt-0.5">This is your home base. You will see all active projects grouped by urgency.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-700 text-white flex items-center justify-center font-bold flex-shrink-0">2</span>
              <div>
                <span className="text-white font-medium">Open a project</span>
                <p className="text-gray-400 mt-0.5">Click any project row to open its detail panel. Browse the tabs: Tasks, Notes, Info, BOM, Files.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-700 text-white flex items-center justify-center font-bold flex-shrink-0">3</span>
              <div>
                <span className="text-white font-medium">Check the Tasks tab</span>
                <p className="text-gray-400 mt-0.5">See where the project stands. Click stage pills to navigate. Update task statuses as work progresses.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-700 text-white flex items-center justify-center font-bold flex-shrink-0">4</span>
              <div>
                <span className="text-white font-medium">Use My Queue for daily work</span>
                <p className="text-gray-400 mt-0.5">Queue shows only your projects, sorted by what needs attention first.</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <SectionHeader title="SLA Colors" />
      <Card title="What the colors mean">
        Every project shows a colored badge indicating how long it&apos;s been in its current stage:
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-green-900 text-green-300 font-medium">2d</span>
            <span className="text-gray-400">Green — within target days (on track)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-amber-900 text-amber-300 font-medium">5d</span>
            <span className="text-gray-400">Amber — between target and risk threshold (watch this)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-red-900 text-red-300 font-medium">12d</span>
            <span className="text-gray-400">Red — past risk threshold (needs attention)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-red-900 text-red-300 font-medium animate-pulse">21d</span>
            <span className="text-gray-400">Flashing red — past critical threshold (urgent)</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500">SLA thresholds vary by stage — Permitting allows more time than Evaluation, for example.</div>
      </Card>
      <Card title="SLA thresholds by stage">
        <Ul items={[
          'Evaluation — target 3d, risk 4d, critical 6d',
          'Site Survey — target 3d, risk 5d, critical 10d',
          'Design — target 3d, risk 5d, critical 10d',
          'Permitting — target 21d, risk 30d, critical 45d',
          'Installation — target 5d, risk 7d, critical 10d',
          'Inspection — target 14d, risk 21d, critical 30d',
          'Complete — target 3d, risk 5d, critical 7d',
        ]} />
      </Card>

      <SectionHeader title="Command Center Sections" />
      <Card title="Section headers">
        Command Center groups projects by urgency. Click any metric card to expand/collapse that section.
        <div className="mt-3 space-y-1.5 text-xs">
          {[
            { label: 'Overdue Tasks', color: 'bg-red-900 text-red-300', count: 3 },
            { label: 'Blocked', color: 'bg-red-900 text-red-300', count: 8 },
            { label: 'Pending Resolution', color: 'bg-red-900/80 text-red-300', count: 12 },
            { label: 'Critical', color: 'bg-red-900 text-red-300', count: 15 },
            { label: 'At Risk', color: 'bg-amber-900 text-amber-300', count: 22 },
            { label: 'Stalled', color: 'bg-gray-700 text-gray-300', count: 7 },
            { label: 'Aging', color: 'bg-gray-700 text-gray-300', count: 4 },
            { label: 'On Track', color: 'bg-green-900 text-green-300', count: 187 },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 bg-gray-800 rounded-md px-3 py-2">
              <span className={`px-2 py-0.5 rounded font-medium ${s.color}`}>{s.count}</span>
              <span className="text-gray-200">{s.label}</span>
              <span className="text-gray-600 ml-auto">click to expand</span>
            </div>
          ))}
        </div>
      </Card>

      <SectionHeader title="Feedback" />
      <Card title="Submitting feedback">
        A floating feedback button appears on every page in the bottom-right corner. Click it to submit bugs,
        feature requests, improvements, or questions. Your name, email, and current page are auto-captured.
        <div className="mt-3 flex items-end justify-end">
          <div className="bg-green-700 text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg cursor-pointer">
            Feedback
          </div>
        </div>
        <div className="mt-3 bg-gray-800 border border-gray-700 rounded-lg p-4 max-w-xs ml-auto">
          <div className="text-sm font-semibold text-white mb-2">Send Feedback</div>
          <div className="space-y-2 text-xs">
            <div className="flex gap-1.5">
              {['Bug', 'Feature', 'Improvement', 'Question'].map(t => (
                <span key={t} className={`px-2 py-1 rounded-md border cursor-pointer ${t === 'Bug' ? 'border-green-600 bg-green-900/30 text-green-300' : 'border-gray-700 text-gray-500'}`}>{t}</span>
              ))}
            </div>
            <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-gray-500 h-16">Describe the issue...</div>
            <div className="flex justify-end">
              <span className="px-3 py-1.5 bg-green-700 text-white rounded-md font-medium">Submit</span>
            </div>
          </div>
        </div>
      </Card>

      <SectionHeader title="Navigation" />
      <Card title="Pages at a glance">
        <Ul items={[
          'Command — full portfolio view, sorted by urgency',
          'Queue — your projects only, tasks needing action',
          'Pipeline — Kanban board view by stage',
          'Analytics — charts, leadership dashboard, PM stats',
          'Schedule — weekly crew job grid with Job Brief panel',
          'Service — service call tickets',
          'Funding — M1/M2/M3 milestone tracker',
          'Change Orders — HCO/change order queue with workflow tracking',
          'Admin — AHJ, utilities, users, crews, SLA, audit trail, task audit, feedback (admins only)',
          'Crew (/crew) — mobile-optimized daily job view for field crews',
        ]} />
      </Card>
      <Card title="Searching projects">
        The search bar in the Command nav searches by project name, ID, city, PM, and address in real time.
        The PM filter next to it narrows results to a single PM&apos;s portfolio.
      </Card>
      <Card title="Exporting to CSV">
        Click the Export button in the Command nav. A modal lets you choose exactly which fields to include
        before downloading. The export respects your current PM filter and search.
      </Card>
      <Card title="Project IDs">
        All projects are numbered PROJ-XXXXX, continuing from NetSuite. New projects auto-generate the next
        available ID. The highest current ID is around PROJ-30312.
      </Card>
    </div>
  )
}

function ForAdmins() {
  return (
    <div>
      <SectionHeader title="Admin Portal" />
      <Card title="Accessing admin">
        Click the gear icon in the nav bar. Only Greg Kelsch and Heidi Hildreth have access. Other users
        see an access denied screen.
      </Card>
      <Card title="AHJ Manager">
        Search, paginate (25 per page), and edit all 1,633 Texas AHJ records. Fields: name, permit phone,
        permit website, max duration, electric code, permit notes, portal username and password (masked with
        show/hide toggle). Click any row to open the edit modal.
      </Card>
      <Card title="Utility Manager">
        Search and edit all 203 utility company records. Fields: name, phone, website, notes.
        Clicking a website link opens it in a new tab without opening the edit modal.
      </Card>
      <Card title="Users">
        Full CRUD for team members. Fields: name, email, department, position, admin access, active status,
        avatar color. Use the Add User button to create new accounts. Admin checkbox grants access to this portal.
      </Card>
      <Card title="Crews">
        View and edit all 5 crews (HOU1, HOU2, HOU3, DFW1, DFW2). Each crew card shows all assigned role
        fields. Click Edit to update crew name, warehouse, active status, and all 10 member role fields
        (License Holder, Electrician, Solar Lead, Battery Lead, Installer 1 & 2, Battery Tech 1 & 2,
        Battery Apprentice, MPU Electrician).
      </Card>
      <Card title="SLA Thresholds">
        Edit the target, risk, and critical day thresholds for each of the 7 pipeline stages. Saves to
        the sla_thresholds table in Supabase. Note: the live app currently uses the values from this table
        as reference — the centralized thresholds in code are kept in sync manually.
      </Card>
      <Card title="CRM Info">
        Live stats: project count by stage, AHJ count, utility count, user count, crew count, service call
        count. Also shows system info (stack, database, hosting, auth, repo).
      </Card>

      <SectionHeader title="Audit Trail" />
      <Card title="Session tracking">
        Every user login is tracked with login time, duration, and current page. The admin portal Audit Trail
        module shows a Sessions tab with all active and past sessions, filterable by user.
      </Card>
      <Card title="Change log">
        All project field changes are recorded with the old value, new value, who made the change, and when.
        The Changes tab in the Audit Trail module lets you search by project or user and see a full history
        of every edit.
      </Card>

      <SectionHeader title="Feedback Manager" />
      <Card title="Managing feedback">
        The admin portal includes a Feedback Manager that shows all submitted feedback. Filter by type
        (Bug, Feature, Improvement, Question) and status (Open, In Progress, Resolved, Closed). Add admin
        notes to track follow-up. Each entry shows the submitter, page, timestamp, and full description.
      </Card>

      <SectionHeader title="Database" />
      <Card title="Supabase tables">
        <Ul items={[
          'projects — main project table',
          'task_state — per-project task status',
          'task_history — task change audit trail',
          'notes — project notes/chat',
          'stage_history — stage transition log',
          'project_funding — M1/M2/M3 milestones',
          'project_boms — saved BOMs',
          'project_folders — Google Drive links',
          'change_orders — HCO/change order records',
          'service_calls — service tickets',
          'schedule — crew job assignments',
          'crews — 5 crews',
          'ahjs — 1,633 TX AHJs',
          'utilities — 203 utility companies',
          'users — team members',
          'sla_thresholds — editable SLA values',
          'feedback — user-submitted feedback',
          'user_sessions — login/session tracking',
        ]} />
      </Card>
    </div>
  )
}


// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [tab, setTab] = useState<Tab>('pms')

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav active="Help" />

      {/* Hero */}
      <div>
        <div className="bg-green-700 px-8 py-8">
          <h1 className="text-2xl font-bold text-white">MicroGRID CRM — Help</h1>
          <p className="text-green-100 text-sm mt-1">Documentation and guides for every role</p>
        </div>

        {/* Tab bar */}
        <div className="bg-gray-900 border-b border-gray-800 px-8 sticky top-11 z-40">
          <div className="flex gap-0">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`text-sm px-5 py-3.5 border-b-2 transition-colors font-medium ${
                  tab === t.id
                    ? 'border-green-400 text-green-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-3xl mx-auto px-8 py-6 pb-16">
          {tab === 'pms'        && <ForPMs />}
          {tab === 'funding'    && <ForFunding />}
          {tab === 'leadership' && <ForLeadership />}
          {tab === 'everyone'   && <ForEveryone />}
          {tab === 'admins'     && <ForAdmins />}
        </div>
      </div>
    </div>
  )
}
