'use client'

import { useState } from 'react'

type Tab = 'pms' | 'funding' | 'leadership' | 'everyone' | 'admins' | 'whats_new'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pms',        label: 'For PMs'        },
  { id: 'funding',    label: 'For Funding'     },
  { id: 'leadership', label: 'For Leadership'  },
  { id: 'everyone',   label: 'For Everyone'    },
  { id: 'admins',     label: 'For Admins'      },
  { id: 'whats_new',  label: "What's New"      },
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
        Your home base. Shows blocked projects, critical SLA breaches, overdue tasks, and today's schedule.
        Start here every morning — projects are sorted by urgency so the most critical work is always at the top.
      </Card>
      <Card title="My Queue">
        Shows only your active projects with tasks that need action. Each card shows tasks currently Ready to Start
        or In Progress. Work top to bottom — overdue tasks appear in red.
      </Card>
      <Card title="Opening a project panel">
        Click any project row to open its detail panel. The panel loads task state, notes, and all project data
        from the server. Tabs across the top: Tasks, Notes, Info, BOM, Files.
      </Card>

      <SectionHeader title="Tasks" />
      <Card title="How tasks unlock">
        Tasks unlock automatically when their prerequisites are complete. A task showing Not Ready is waiting on
        something else. You cannot change a locked task.
        <Ul items={[
          'Complete prerequisite tasks first',
          'The dependent task will unlock to Ready to Start automatically',
          'You will see this reflected immediately in your queue',
        ]} />
      </Card>
      <Card title="Task statuses">
        Each task moves through these statuses:
        <Ul items={[
          'Not Ready — prerequisites not done yet',
          'Ready to Start — prerequisites done, waiting to begin',
          'In Progress — actively being worked',
          'Pending Resolution — blocked, waiting on external action',
          'Revision Required — needs rework',
          'Complete — done',
        ]} />
      </Card>
      <Card title="Required vs optional tasks">
        Tasks marked (opt) are optional — they do not block stage advancement. Required tasks must all be
        Complete before you can advance to the next stage.
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
        Edit the target, risk, and critical day thresholds for each of the 7 pipeline stages. Changes
        saved here update SLA coloring across all views. Requires the sla_thresholds table in Supabase.
      </Card>
      <Card title="CRM Info">
        Live stats: project count by stage, AHJ count, utility count, user count, crew count, service call
        count. Also shows system info (stack, database, hosting, auth, repo).
      </Card>

      <SectionHeader title="Database" />
      <Card title="Supabase tables">
        <Ul items={[
          'projects — 487 rows, main project table',
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

function WhatsNew() {
  return (
    <div>
      <SectionHeader title="Session 4 — March 2026" />
      <Card title="Admin portal — full build">
        Gear icon (⚙) in the top nav for Greg Kelsch and Heidi Hildreth. Six modules: AHJ Manager,
        Utility Manager, Users, Crews, SLA Thresholds, CRM Info.
      </Card>
      <Card title="AHJ Manager">
        Search, paginate, and edit all 1,633 TX AHJ records. Edit modal with all permit fields and
        portal login credentials with masked password and show/hide toggle.
      </Card>
      <Card title="Utility Manager">
        Search and edit all 203 active utility companies.
      </Card>
      <Card title="Users module">
        Full user CRUD with department, position, admin access, and active status. Avatar color picker.
      </Card>
      <Card title="Crews module">
        View all 5 crews with role-based member display. Edit modal for all 10 crew role fields.
      </Card>
      <Card title="SLA Thresholds">
        Editable target/risk/critical days per stage. Saves to sla_thresholds table in Supabase.
      </Card>
      <Card title="AHJ & Utility autocomplete">
        Typing in the AHJ or Utility field in the project edit panel shows a live dropdown of matching
        records from the database. Select to fill, or type freely for records not in the database.
      </Card>
      <Card title="Export field picker">
        The Export button in Command now opens a modal. Choose exactly which of the 42 fields to include,
        grouped by category. Export respects current PM filter and search.
      </Card>
      <Card title="Help page">
        This page. Accessible via the ? button in every nav.
      </Card>

      <SectionHeader title="Session 3 — Earlier" />
      <Card title="Schedule view">
        Weekly crew job grid with assign modal. Create, edit, and cancel crew job assignments.
      </Card>
      <Card title="Service calls">
        Service call list with status tracking.
      </Card>
      <Card title="Funding milestones">
        M1/M2/M3 table with days waiting and bulk submit.
      </Card>
      <Card title="Project panel — Info tab edit mode">
        Edit all project fields inline. Stage advance with prerequisite checking. AHJ and utility
        info cards auto-load when a matching record is found.
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
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 h-11 flex items-center px-4 gap-1">
        <span className="text-white font-semibold text-sm mr-3">MicroGRID</span>
        {navItems.map(v => (
          <a key={v.label} href={v.href}
            className="text-xs px-3 py-1.5 rounded-md transition-colors text-gray-400 hover:text-white hover:bg-gray-800">
            {v.label}
          </a>
        ))}
        <a href="/admin"
          className="text-xs px-3 py-1.5 rounded-md transition-colors text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-1.5 ml-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Admin
        </a>
        <a href="/help"
          className="text-xs px-3 py-1.5 rounded-md transition-colors bg-gray-800 text-white ml-1 flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Help
        </a>
      </nav>

      {/* Hero */}
      <div className="pt-11">
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
          {tab === 'whats_new'  && <WhatsNew />}
        </div>
      </div>
    </div>
  )
}
