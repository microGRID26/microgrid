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
        Shows only your active projects with tasks that need action. Each card shows the next incomplete task,
        any stuck tasks (Pending/Revision), and SLA status. Work top to bottom — blocked projects appear first,
        then critical, then at-risk.
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
        locked task. When all prerequisites are Complete, the task automatically unlocks. The prerequisite
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

      <SectionHeader title="Stage Advancement" />
      <Card title="Advancing a project">
        Open the project panel. The Advance Stage button is in the header. It will tell you which required tasks
        are still incomplete if you try to advance early. Once all required tasks are done, the button turns active.
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
      </Card>
      <Card title="Setting a blocker">
        In the project panel header, click Set Blocker. Describe what's blocking the project. Blocked projects
        appear in red at the top of Command Center. Clear it when resolved.
      </Card>

      <SectionHeader title="Editing a Project" />
      <Card title="Edit mode">
        Click the ✏ Edit button in any project panel header to enter edit mode. All fields in the Info tab
        become editable — including contract amount, system size, financier, equipment, site details, and
        all milestone dates. Click Save Changes when done, or Cancel to discard.
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
      <Card title="Milestone statuses">
        <Ul items={[
          'Pending — not yet eligible',
          'Eligible — ready to submit',
          'Submitted — submitted to financier, awaiting payment',
          'Funded — payment received',
        ]} />
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
        Each PM's active project count, portfolio value, critical/blocked counts, and installs in the
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
      <SectionHeader title="SLA Colors" />
      <Card title="What the colors mean">
        Every project shows a colored badge indicating how long it's been in its current stage:
        <Ul items={[
          'Green — within target days (on track)',
          'Amber — between target and risk threshold (watch this)',
          'Red — past risk threshold (needs attention)',
          'Flashing red — past critical threshold (urgent)',
        ]} />
        SLA thresholds vary by stage — Permitting allows more time than Evaluation, for example.
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

      <SectionHeader title="Navigation" />
      <Card title="Pages at a glance">
        <Ul items={[
          'Command — full portfolio view, sorted by urgency',
          'Queue — your projects only, tasks needing action',
          'Pipeline — Kanban board view by stage',
          'Analytics — charts, leadership dashboard, PM stats',
          'Audit — stuck tasks across all projects',
          'Schedule — weekly crew job grid',
          'Service — service call tickets',
          'Funding — M1/M2/M3 milestone tracker',
          'Admin — AHJ, utilities, users, crews, SLA settings (admins only)',
        ]} />
      </Card>
      <Card title="Searching projects">
        The search bar in the Command nav searches by project name, ID, city, PM, and address in real time.
        The PM filter next to it narrows results to a single PM's portfolio.
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
        Click the gear icon (⚙) in the nav bar. Only Greg Kelsch and Heidi Hildreth have access. Other users
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

      <SectionHeader title="Database" />
      <Card title="Supabase tables">
        <Ul items={[
          'projects — main project table',
          'task_state — per-project task status',
          'notes — project notes/chat',
          'stage_history — stage transition log',
          'project_funding — M1/M2/M3 milestones',
          'project_boms — saved BOMs',
          'project_folders — Google Drive links',
          'service_calls — service tickets',
          'schedule — crew job assignments',
          'crews — 5 crews',
          'ahjs — 1,633 TX AHJs',
          'utilities — 203 utility companies',
          'users — team members',
          'sla_thresholds — editable SLA values',
        ]} />
      </Card>
    </div>
  )
}


// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [tab, setTab] = useState<Tab>('pms')

  const navItems = [
    { label: 'Command',  href: '/command'  },
    { label: 'Queue',    href: '/queue'    },
    { label: 'Pipeline', href: '/pipeline' },
    { label: 'Analytics',href: '/analytics'},
    { label: 'Audit',    href: '/audit'    },
    { label: 'Schedule', href: '/schedule' },
    { label: 'Service',  href: '/service'  },
    { label: 'Funding',  href: '/funding'  },
  ]

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
