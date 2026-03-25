# NOVA CRM User Guide

A comprehensive guide for Project Managers and team members at MicroGRID Energy / EDGE.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Navigation](#navigation)
3. [Command Center](#command-center)
4. [My Queue](#my-queue)
5. [Pipeline](#pipeline)
6. [Project Panel](#project-panel)
7. [Task System](#task-system)
8. [Bulk Operations](#bulk-operations)
9. [Schedule](#schedule)
10. [Funding](#funding)
11. [Change Orders](#change-orders)
12. [Service Calls](#service-calls)
13. [Analytics](#analytics)
14. [Audit](#audit)
15. [Audit Trail](#audit-trail)
16. [Admin Portal](#admin-portal)
17. [Document Management](#document-management)
18. [Equipment Catalog](#equipment-catalog)
19. [Inventory Management](#inventory-management)
20. [Redesign Tool](#redesign-tool)
21. [Batch Design](#batch-design)
22. [Crew Mobile View](#crew-mobile-view)
23. [Crew Performance Dashboard](#crew-performance-dashboard)
24. [Planset (Duracell SLD)](#planset-duracell-sld)
25. [Atlas (AI Reports)](#atlas-ai-reports)
26. [Legacy Projects](#legacy-projects)
27. [Help Center](#help-center)
28. [@Mentions and Notifications](#mentions-and-notifications)
29. [Pagination](#pagination)
30. [Mobile Views](#mobile-views)
31. [Tips and Best Practices](#tips-and-best-practices)

---

## Getting Started

### Logging In

1. Navigate to the NOVA CRM URL in your browser.
2. Click **Sign in with Google** on the login page.
3. Use your company Google account (`@gomicrogridenergy.com` or `@energydevelopmentgroup.com`). Legacy `@trismartsolar.com` accounts also work.
4. After authentication, you will be redirected to the Command Center.

If you see an error during login, try clearing your browser cookies and signing in again. If the issue persists, contact your administrator.

### First-Time Setup

- **PM Filter**: On the Queue page, select your name from the PM dropdown. The system remembers your selection for future visits.
- **Browser**: NOVA works best in Chrome, Edge, or Firefox. Use a desktop or laptop for the full experience.

### Your Role

Your account has a role assigned by an administrator:

- **User** -- Standard access. Can create and edit projects, update tasks, add notes.
- **Manager** -- Same as User with additional visibility.
- **Finance** -- Access to funding pages and financial data.
- **Admin** -- Full access including the Admin portal, user management, and crew management.
- **Super Admin** -- Everything Admin can do, plus the ability to delete projects.

---

## Navigation

The navigation bar runs across the top of every page with a two-tier layout:

**Primary links** (always visible):
- **Command** -- SLA dashboard (your home base)
- **Queue** -- PM-filtered project list
- **Pipeline** -- Visual stage grid
- **Schedule** -- Weekly crew calendar
- **Funding** -- Milestone payment tracking
- **Inventory** -- Project materials and purchase orders
- **Analytics** -- Performance metrics and charts

**More dropdown** (click "More" to expand):
- **Service** -- Service call tracking
- **Change Orders** -- HCO/change order workflow
- **Documents** -- Document hub and file browser
- **Atlas** -- AI-powered natural language data queries (Manager+ only)
- **Redesign** -- Equipment calculator and SLD generator
- **Legacy** -- Historical TriSMART project lookup
- **Audit Trail** -- Change log (Admin/Super Admin only)

**Additional links** in the navigation:
- **Admin** (gear icon) -- Visible to Admin and Super Admin roles only
- **Help** (question mark icon) -- In-app help documentation
- **Notification Bell** -- Alerts for items requiring attention
- **Sign Out** -- Logs you out of the system

### Creating a New Project

On pages that support it (Command, Queue, Pipeline), a **+ New Project** button appears in the navigation bar. Click it to open the New Project modal.

---

## Command Center

**URL:** `/command`

The Command Center is your daily home base. It gives you a bird's-eye view of every active project, organized by urgency so you know exactly where to focus your attention.

### Metric Cards

At the top of the page, summary metric cards display counts for each classification. Click any card to jump to and expand that section.

### Project Classifications

Projects are sorted into sections in priority order. Each section is collapsible -- click the section header to expand or collapse it.

#### 1. Overdue Tasks
Projects with tasks that are past their scheduled completion date. These need immediate attention.

#### 2. Blocked
Projects with an active blocker. The blocker reason appears as a badge on the project row. A blocker is automatically set when a task enters "Pending Resolution" status, and automatically cleared when the stuck task is resolved (as long as no other tasks remain stuck).

- **Badge color:** Red background with red text

#### 3. Pending Resolution
Projects that have tasks in "Pending Resolution" status but are not yet at Critical or At Risk SLA levels. These are waiting on external action (customer response, AHJ reply, etc.).

#### 4. Critical (Past SLA)
Projects that have exceeded the critical SLA threshold for their current stage. These are the most time-sensitive active projects.

- **Badge color:** Red background (`bg-red-900 text-red-300`)

#### 5. At Risk
Projects approaching the critical SLA threshold. They have passed the risk threshold but not yet the critical threshold.

- **Badge color:** Amber/orange background (`bg-amber-900 text-amber-300`)

#### 6. Stalled
Projects with acceptable SLA but no movement for 5 or more days. Nothing is technically wrong, but they are not progressing. Check if any action is needed.

#### 7. Aging
Projects with a total cycle time of 90 or more days (measured from sale date). Even if SLA is fine, these have been in the pipeline too long.

#### 8. On Track
Projects with healthy SLA status and no blockers. These are progressing normally.

#### 9. Loyalty
Projects with a "Loyalty" disposition. These are existing customers being managed for additional work.

#### 10. In Service
Projects with an "In Service" disposition. These have completed the pipeline and are in post-installation service mode.

### SLA Badges

Every project row shows an SLA badge indicating how many days the project has been in its current stage:

| Color | Meaning |
|-------|---------|
| Green | On track -- within target SLA |
| Yellow | Warning -- approaching risk threshold |
| Amber/Orange | At risk -- past risk threshold |
| Red | Critical -- past critical SLA threshold |

**Note: SLA indicators are currently paused.** All thresholds are temporarily set to 999 days, so all projects appear as "On Track" for SLA purposes. The original threshold values are preserved and will be re-enabled in a future update.

The original SLA thresholds by stage (currently paused):

| Stage | Target | Risk | Critical |
|-------|--------|------|----------|
| Evaluation | 3 days | 4 days | 6 days |
| Site Survey | 3 days | 5 days | 10 days |
| Design | 3 days | 5 days | 10 days |
| Permitting | 21 days | 30 days | 45 days |
| Installation | 5 days | 7 days | 10 days |
| Inspection | 14 days | 21 days | 30 days |
| Complete | 3 days | 5 days | 7 days |

### Stuck Task Badges

Below each project row, you may see small badges indicating tasks that are stuck:

- **Red badge** -- Task in "Pending Resolution" status, with the reason displayed
- **Amber badge** -- Task in "Revision Required" status, with the reason displayed

### Project Row Information

Each project row in the Command Center shows:

- Project ID (e.g., PROJ-30456)
- Customer name
- City
- PM name
- Current stage
- Contract value
- SLA badge (days in stage with color coding)
- Blocker indicator (if blocked)

### Actions

- **Click any project row** to open the Project Panel with full details
- **Search** using the search bar to filter by name, ID, or city
- **Export** projects to CSV using the export button
- **+ New Project** to create a new project

---

## My Queue

**URL:** `/queue`

The Queue page is your personal worklist. It shows projects filtered to your PM assignment, organized into task-based sections so you can see exactly what needs attention.

### PM Filter

- Use the PM dropdown at the top to select your name
- Your selection is remembered in your browser for future visits
- Select "All PMs" to see every project in the system (useful for managers)

### Queue Sections

Projects are organized into collapsible sections based on their current task state. All sections start collapsed except "Follow-ups Today." Click any section header to expand or collapse it.

#### 1. Follow-ups Today
Projects that have a follow-up date (set on a task or on the project itself) that is today or overdue. Shows the task name and whether the follow-up is due today or how many days overdue it is.

#### 2. City Permit Approval -- Ready to Start
Projects where the City Permit Approval task is ready to be worked (all prerequisites are met). These are permits you need to submit.

#### 3. City Permit -- Submitted, Pending Approval
Projects where the City Permit Approval task is actively being tracked (In Progress, Scheduled, Pending Resolution, or Revision Required). These are permits you are waiting on.

#### 4. Utility Permit -- Submitted, Pending Approval
Same as above, but for the Utility Permit Approval task.

#### 5. Utility Inspection -- Ready to Start
Projects where the Utility Inspection task is ready to be worked.

#### 6. Utility Inspection -- Submitted, Pending Approval
Projects where the Utility Inspection task is actively being tracked.

#### 7. Blocked
Projects with an active blocker. The blocker reason is displayed on the card.

#### 8. Active
All other projects not in a special section and not in the Complete stage.

#### 9. Complete
Projects in the Complete stage of the pipeline.

### What Each Card Shows

Each project card in the Queue displays:

- Project ID and customer name
- Current stage with SLA status dot (colored: green, yellow, amber, or red)
- City
- **Next Task** -- the first incomplete task in the current stage
- **Stuck Tasks** -- any tasks in Pending Resolution or Revision Required, with their reasons
- Contract value
- Blocker status (if applicable)

### Stats Bar

At the top of the Queue, a stats bar shows:

- **Total** -- Number of projects in your queue
- **Blocked** -- Number of blocked projects (red when > 0)
- **Critical** -- Number of projects past critical SLA
- **Portfolio** -- Combined contract value

### Filtering

- **Search bar** -- Type to filter by customer name, project ID, or city
- **Disposition** -- Queue shows active projects plus Loyalty projects. Cancelled and In Service are excluded.

### Daily Workflow

1. Open your Queue each morning
2. Start with **Follow-ups Today** -- these are items you scheduled for follow-up
3. Check **City Permit Ready** -- submit any permits that are ready
4. Review **Blocked** projects -- try to unblock what you can
5. Work through **Active** projects as time allows
6. Click any card to open the Project Panel and take action

---

## Pipeline

**URL:** `/pipeline`

The Pipeline page shows all active projects organized in a visual grid by stage. Each column represents one of the 7 pipeline stages.

### Pipeline Stages

| Stage | Description |
|-------|-------------|
| Evaluation | Initial project setup, welcome call, IA/UB confirmation, NTP |
| Site Survey | Physical site survey and review |
| Design | System design, engineering, and approvals |
| Permitting | HOA, city permit, and utility permit approvals |
| Installation | Scheduling, inventory, and physical installation |
| Inspection | City and utility inspections |
| Complete | PTO and In Service |

### Project Cards

Each card in the pipeline grid shows:

- Customer name
- Project ID
- Contract value
- A colored bar on the left indicating SLA status:
  - Green -- On Track
  - Yellow -- Warning
  - Amber -- At Risk
  - Red -- Critical
- Blocker icon if the project is blocked

### Filters

Use the filter bar at the top to narrow results:

- **PM** -- Filter by project manager
- **Financier** -- Filter by financing company
- **AHJ** -- Filter by Authority Having Jurisdiction (multi-select: pick one or more AHJs)
- **Utility** -- Filter by utility company (multi-select: pick one or more utilities)
- **Search** -- Text search by name, ID, city, or address

### Sorting

Use the sort dropdown to change the order of cards within each column:

- **SLA** (default) -- Most urgent at top
- **Name** -- Alphabetical
- **Contract** -- Highest value first
- **Cycle** -- Longest cycle time first

### Summary

The top bar shows the total number of filtered projects and the combined contract value.

### Excluded Projects

The Pipeline view excludes projects with dispositions of In Service, Loyalty, or Cancelled. These are managed through the Command Center.

---

## Project Panel

The Project Panel is the detailed view for any individual project. Click any project row or card anywhere in the system to open it.

The panel slides in from the right side of the screen as a large modal overlay.

### Panel Header

The header shows:

- Project ID (e.g., PROJ-30456)
- Customer name
- Current stage badge
- Cycle days (total days since sale)
- Contract value
- **Edit** button (pencil icon) -- Toggles inline editing mode
- **Delete** button -- Super Admin only
- **Close** button (X)

### Tab Navigation

Six tabs are available across the top of the panel:

#### 1. Overview (Info Tab)

The Overview tab displays all project information organized into sections:

**Left Column:**

- **Customer** -- Name, address (clickable link to Google Maps), city, phone, email
- **Project** -- Disposition, contract value, system kW, financier, financing type, down payment, TPO escalator, financier advance payment, dealer
- **Equipment** -- Module (model and qty), inverter (model and qty), battery (model and qty), optimizer (model and qty). Equipment fields use autocomplete from a catalog of 2,517 items. System kW is auto-calculated from module wattage and panel count.
- **Site** -- Meter location, panel location, voltage, MSP bus rating, MPU, shutdown type, performance meter, IBC breaker, main breaker, HOA, ESID

**Right Column:**

- **Team** -- PM, advisor, consultant, consultant email, site surveyor
- **Permitting** -- AHJ (with inline phone, website, turnaround time, and notes), utility company (with inline phone, website, and notes), permit number, utility application number, permit fee, city permit date, utility permit date
- **Adders** -- Project adders/extras (e.g., EV charger, critter guard, ground mount) with name, quantity, and price. In edit mode, you can add new adders and delete existing ones.
- **Milestones** -- Sale date, NTP, survey scheduled, survey complete, install scheduled, install complete, city inspection, utility inspection, PTO, in service
- **Stage History** -- Timeline of stage transitions with dates
- **Service Calls** -- Any associated service calls with status badges

**Editing:** Click the pencil icon to enter edit mode. All fields become editable. Click Save to persist changes or Cancel to discard.

#### 2. Tasks Tab

The Tasks tab is the core workflow interface. See the [Task System](#task-system) section below for full details.

#### 3. Notes Tab

- View all timestamped notes for the project, newest first
- Each note shows the author name, date/time, and content
- **Add a note:** Type in the text area at the bottom and click Add Note
- Notes are visible to all team members
- **File links:** Filenames referenced in notes appear as blue clickable links. Clicking a filename searches for it in the project's Google Drive folder. Inline images are excluded from link detection.

#### 4. Files Tab

- Shows the Google Drive folder link for this project
- Click the link to open the project folder in Google Drive
- The folder structure contains 16 subfolders (01 Proposal through 20 Cases)
- Folders are automatically created when a new project is created
- **Document Checklist** -- Shows required documents for the project's current stage with present/missing status indicators (see [Document Management](#document-management) for details)

#### 5. BOM Tab (Bill of Materials)

- Displays the bill of materials for the project
- Shows equipment counts and specifications
- Useful for inventory planning and verification

#### 6. Materials Tab

- Lists all materials required for the project with status tracking (needed, ordered, shipped, delivered, installed)
- **Auto-generate** materials from the project's equipment fields (module, inverter, battery, optimizer)
- **Add items** manually for BOS materials, electrical components, and other supplies
- **Click status badges** to advance materials through the lifecycle
- **Create purchase orders** by selecting materials and entering a vendor name
- See [Inventory Management](#inventory-management) for full details

---

## Task System

The task system is the engine that drives projects through the pipeline. Understanding how it works is essential to using NOVA effectively.

### Pipeline Stages and Their Tasks

Each stage has a defined set of tasks. Some are required (must be completed to advance), and some are optional.

**Evaluation (5 required tasks):**
- Welcome Call
- IA Confirmation
- UB Confirmation
- Schedule Site Survey
- NTP Procedure

**Site Survey (2 required tasks):**
- Site Survey (requires: Schedule Site Survey)
- Survey Review (requires: Site Survey)

**Design (6 required + 6 optional tasks):**
- Build Design (requires: Survey Review) *
- Scope of Work (requires: Build Design) *
- Monitoring (requires: Scope of Work) *
- Build Engineering (requires: Scope of Work) *
- Engineering Approval (requires: Build Engineering) *
- Stamps Required (no prerequisites) -- optional
- WP1 (requires: Scope of Work) -- optional (required for Corpus Christi and Texas City)
- Production Addendum, Create New IA, Reroof Procedure, OnSite Redesign, Quote Extended Scope -- all optional

**Permitting (4 required + 2 optional tasks):**
- HOA Approval (requires: Engineering Approval) *
- OM Project Review (requires: Engineering Approval) *
- City Permit Approval (requires: Engineering Approval) *
- Utility Permit Approval (requires: Engineering Approval) *
- Check Point 1 (requires: Engineering Approval + City Permit + Utility Permit + NTP) *
- Revise IA -- optional

**Installation (3 required + 1 optional tasks):**
- Schedule Installation (requires: Check Point 1) *
- Inventory Allocation (requires: Schedule Installation) *
- Installation Complete (requires: Schedule Installation) *
- Electrical Onsite Redesign -- optional

**Inspection (5 required + 3 optional tasks):**
- Inspection Review (requires: Installation Complete) *
- Schedule City Inspection (requires: Inspection Review) *
- Schedule Utility Inspection (requires: Inspection Review) *
- City Inspection (requires: Schedule City Inspection) *
- Utility Inspection (requires: Schedule Utility Inspection) *
- City Permit Update, Utility Permit Update -- optional
- WPI 2 & 8 (requires: Installation Complete) -- optional (required for Corpus Christi and Texas City)

**Complete (2 required tasks):**
- Permission to Operate (requires: Utility Inspection) *
- In Service (requires: PTO) *

### Task Statuses

Each task can be in one of seven statuses:

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| Not Ready | Dark gray (`bg-gray-800 text-gray-500`) | Prerequisites not done. Task is locked and cannot be changed. |
| Ready To Start | Medium gray (`bg-gray-700 text-gray-200`) | Prerequisites are complete. Task can be started. |
| In Progress | Blue (`bg-blue-900 text-blue-300`) | Task is actively being worked on. |
| Scheduled | Indigo (`bg-indigo-900 text-indigo-300`) | Task has been scheduled for a specific date. |
| Pending Resolution | Red (`bg-red-900 text-red-300`) | Task is blocked, waiting on external action. |
| Revision Required | Amber (`bg-amber-900 text-amber-300`) | Task needs rework. Triggers cascade reset. |
| Complete | Green (`bg-green-900 text-green-300`) | Task is finished. |

### How to Change a Task Status

1. Open the Project Panel and go to the Tasks tab
2. Navigate to the stage containing the task (use the stage pills at the top)
3. Find the task row -- if it shows a dropdown on the right, you can change it
4. Select the new status from the dropdown
5. If selecting Pending Resolution or Revision Required, you will be prompted to select a reason

### Per-Task Notes

Each task has its own notes section. To add a note to a task:

1. Open the Project Panel and go to the Tasks tab
2. Find the task row
3. Click the **chat icon** next to the task name
4. A note input area appears below the task
5. Type your note and press Enter or click Add
6. Notes are timestamped with your name and visible to all team members
7. Per-task notes are separate from the project-level Notes tab

Use task notes for task-specific updates like "Submitted permit application ref #12345" or "Customer called, will sign by Friday."

### Follow-Up Dates

You can set a follow-up date on any task to remind yourself to check back:

1. Open the Project Panel and go to the Tasks tab
2. Find the task row
3. Click the **calendar icon** next to the task
4. Select a follow-up date
5. On the follow-up date, the project will appear in your Queue's "Follow-ups Today" section

Follow-up dates are especially useful for tasks in Pending Resolution where you are waiting on an external party and want to check back on a specific date.

### Prerequisites and Unlocking

- Tasks with unmet prerequisites are shown as dimmed/locked with "Not Ready" status
- You cannot change a locked task
- When all prerequisite tasks are marked Complete, the dependent task **automatically unlocks to "Ready To Start"** -- you do not need to manually change it
- This auto-unlock works across stage boundaries (e.g., completing Engineering Approval in Design automatically unlocks HOA Approval, OM Review, City Permit, and Utility Permit in Permitting)
- Prerequisites flow across stages (e.g., Engineering Approval in Design requires Build Engineering)

### AHJ-Conditional Requirements

Some tasks are normally optional but become required depending on the project's AHJ (Authority Having Jurisdiction):

- **WP1** and **WPI 2 & 8** are **required** for projects in **Corpus Christi** and **Texas City**
- For all other AHJs, these tasks remain optional

When a task is conditionally required, it is marked with a green asterisk (*) just like other required tasks, and it must be completed before the stage can advance.

### Required vs Optional Tasks

- Required tasks are marked with a green asterisk (*)
- Optional tasks are marked with "(opt)"
- Only required tasks must be Complete for the project to advance to the next stage
- Optional tasks do not block stage advancement

### Automations

When you change a task status, several automations may fire automatically:

#### Auto-Populate Dates
When certain tasks are marked Complete, the system automatically sets the corresponding project date field:

| Task | Date Field Set |
|------|---------------|
| NTP Procedure | NTP Date |
| Schedule Site Survey | Survey Scheduled Date |
| Site Survey | Survey Complete Date |
| City Permit Approval | City Permit Date |
| Utility Permit Approval | Utility Permit Date |
| Schedule Installation | Install Scheduled Date |
| Installation Complete | Install Complete Date |
| City Inspection | City Inspection Date |
| Utility Inspection | Utility Inspection Date |
| Permission to Operate | PTO Date |
| In Service | In Service Date |

#### Auto-Advance Stage
When all required tasks in a stage are marked Complete, the project automatically advances to the next pipeline stage. A stage history record is created.

#### Auto-Detect Blockers
When a task is set to "Pending Resolution," the project's blocker field is automatically set to the task's reason (prefixed with a pause icon). When the stuck task is resolved, the blocker is automatically cleared -- but only if no other tasks remain stuck.

#### Funding Milestone Triggers
- When "Installation Complete" is marked Complete, the M2 milestone becomes Eligible
- When "Permission to Operate" is marked Complete, the M3 milestone becomes Eligible
- If no funding record exists, one is automatically created

#### Task Duration Tracking
- When a task moves to "In Progress," its start date is automatically recorded
- When it is later marked Complete, the duration is calculated

#### Revision Cascade
When a task is set to "Revision Required," all downstream tasks within the same stage that depend on it (directly or transitively) are reset to "Not Ready." Before this happens, a confirmation dialog appears showing which tasks will be affected. The corresponding auto-populated dates are also cleared.

#### Auto-Set In Service Disposition
When the "In Service" task is completed, the project's disposition is automatically set to "In Service."

#### Auto-Unlock Dependent Tasks
When a task is marked Complete, any tasks whose prerequisites are now all met are automatically set to "Ready To Start." This works across stage boundaries -- for example, completing Engineering Approval in the Design stage will automatically unlock HOA Approval, OM Review, City Permit Approval, and Utility Permit Approval in the Permitting stage. You do not need to manually change dependent tasks to Ready To Start.

### Task History

Click the arrow icon next to any task to expand its history. The history shows every status change with:

- Date and time
- Previous status and new status
- Reason (if applicable)
- Who made the change
- "(cascade)" marker if the change was triggered by a revision cascade

### Reason Selection

When setting a task to Pending Resolution or Revision Required, you must select a reason:

- **Pending Resolution reasons** are specific to each task (e.g., "Customer Unresponsive" for Welcome Call, "Missing Attic Pics" for Survey Review)
- **Revision Required reasons** are specific to each stage
- If no predefined reasons exist for a task, a free-text input appears instead

---

## Bulk Operations

The Pipeline and Queue pages support multi-select for performing bulk actions on multiple projects at once.

### Enabling Selection Mode

1. Click the **Select** toggle in the top bar to enter selection mode
2. Checkboxes appear on each project card or row
3. Check individual projects, or use **Select All** to select everything visible
4. A floating action bar appears at the bottom of the screen showing the count of selected projects

### Available Bulk Actions

| Action | Pipeline | Queue | Description |
|--------|----------|-------|-------------|
| Reassign PM | Yes | Yes | Change the assigned PM for all selected projects at once |
| Advance Stage | Yes | No | Move all selected projects to the next pipeline stage |
| Set Blocker | Yes | Yes | Apply the same blocker text to all selected projects |
| Change Disposition | Yes | Yes | Set disposition (Sale, Loyalty, Cancelled) on all selected projects |
| Set Follow-up Date | No | Yes | Set a follow-up date on all selected projects |

### How It Works

1. Toggle **Select** mode on
2. Check the projects you want to act on
3. Click the desired action button in the floating bar
4. A confirmation dialog appears showing the action and how many projects will be affected
5. Confirm to apply the change to all selected projects
6. The floating bar clears and selection mode remains active for further operations

### Tips

- Use search and filters first to narrow results, then select and act on the filtered set
- Select All only selects projects visible after filtering
- Click the **Select** toggle again to exit selection mode and hide checkboxes

---

## Schedule

**URL:** `/schedule`

The Schedule page is a weekly calendar view for managing crew assignments across all job types.

### Calendar Layout

- Columns represent days of the week (Monday through Saturday)
- Rows represent crews
- Each cell can contain one or more scheduled jobs

### Job Types and Colors

| Job Type | Color |
|----------|-------|
| Site Survey | Blue |
| Installation | Green |
| Inspection | Amber |
| Service Call | Pink |

### Job Status Indicators

Each scheduled job shows a status dot:

| Status | Dot Color |
|--------|-----------|
| Complete | Green |
| Scheduled | Blue |
| In Progress | Amber |
| Cancelled | Gray |

### Week Navigation

- Use the left/right arrows to move between weeks
- Click "Today" to return to the current week
- The date range for the current view is displayed in the header

### Filters

- **Warehouse** -- Filter crews by warehouse location
- **Job Type** -- Show only specific job types (survey, install, inspection, service)
- **Show Cancelled** -- Toggle to show or hide cancelled jobs
- **Search** -- Filter by customer name or project ID

### Scheduling a Job

1. Click an empty cell in the calendar (intersection of a crew and a date)
2. The Schedule Assign modal opens
3. Select the project (search by name or ID)
4. Choose the job type
5. Optionally set a start time
6. Click Schedule

### Job Brief

Click any scheduled job on the calendar to open the Job Brief panel, which shows:

- Customer name and address
- Job type and status
- Crew assignment
- Date and time
- Link to open the full Project Panel

---

## Funding

**URL:** `/funding`

The Funding page tracks three payment milestones for each project. This is where the finance team manages payment processing.

### Milestones

| Milestone | Description | Eligibility |
|-----------|-------------|-------------|
| M1 (Advance) | Initial advance payment | Always eligible once project exists |
| M2 (Install) | Post-installation payment | Eligible when Installation Complete task is done |
| M3 (PTO) | Post-PTO payment | Eligible when PTO task is done |

### Status Meanings

Each milestone can have a status:

- **Eligible** -- The milestone criteria have been met, payment can be submitted
- **Submitted** -- Payment has been submitted for processing
- **Funded** -- Payment has been received
- **Rejected** -- Payment was rejected (needs investigation)
- **Non-funded (NF)** -- Not eligible for funding, with an NF code explaining why

### NF Codes

Non-funded codes explain why a milestone cannot be funded. These are set per milestone and help track common funding issues.

### Viewing and Editing

- Click any cell to edit it inline (amount, date, status, notes)
- Use the milestone tabs (M1, M2, M3) to focus on a specific milestone
- Filter by status: All, Eligible, Funded, Non-funded, Submitted, Rejected
- Sort by various criteria including amount, date, or status

### Key Information per Row

Each row shows:

- Project ID and customer name
- PM
- Financier
- Contract value
- For the selected milestone: Amount, funded date, status, and notes
- NF code (if applicable)

### Accessing Projects

Click any project row to open the full Project Panel for that project.

---

## Change Orders

**URL:** `/change-orders`

The Change Orders page manages HCO (Home Change Order) and other change orders through a structured 6-step workflow.

### Change Order Types

- **HCO Change Order** -- Standard home change order
- **Addendum** -- Contract addendum
- **Cancellation** -- Project cancellation order
- **Other** -- Any other type

### Statuses

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| Open | Red | Newly created, needs attention |
| In Progress | Blue | Being actively worked |
| Waiting On Signature | Amber | Document sent, awaiting signature |
| Complete | Green | Fully processed |
| Cancelled | Gray | No longer needed |

### Priority Levels

| Priority | Badge Color |
|----------|-------------|
| High | Red |
| Medium | Amber |
| Low | Gray |

### 6-Step Workflow

Each change order tracks progress through 6 design workflow steps:

1. **Design Request Submitted (HCO)** -- Initial request has been submitted
2. **Design In Progress** -- Design team is working on changes
3. **Design Pending Approval (HCO)** -- Design submitted for approval
4. **Design Approved (HCO)** -- Design has been approved
5. **Design Complete** -- Design work is finished
6. **Design Complete and Signed (HCO)** -- Final signed documents received

Each step shows as a checkbox. A progress indicator shows how many steps are complete (e.g., "3/6").

### Design Comparison

Change orders can track before/after values for:

- KWH/Year
- Panel count
- Panel size
- Panel type
- System size (kW)

### Creating a Change Order

1. Click the **+ New** button
2. Select the project
3. Choose the type, reason, origin, and priority
4. Add any notes
5. Click Create

### Managing Change Orders

- Click any change order row to expand its details
- Update workflow steps by checking the boxes
- Add timestamped notes
- Change status, priority, or assignment
- View the design comparison (original vs new values)

### Reasons

- Production Adjustment
- Customer Request
- Engineering Audit
- Panel Upgrade
- Battery Add
- System Downsize
- Financier Change
- Other

### Origins

- Internal Audit
- Customer Request
- EC Request
- Engineering
- Finance
- Other

---

## Service Calls

**URL:** `/service`

The Service page tracks post-installation service calls for projects that need field attention. 922 service cases have been imported from NetSuite.

### Service Call Statuses

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| Open | Red | New service call, needs attention |
| Scheduled | Blue | Service visit has been scheduled |
| In Progress | Amber | Technician is working on it |
| Closed | Green | Issue resolved |

### Viewing Service Calls

- Service calls are listed in reverse chronological order (newest first)
- Each row shows: status badge, project ID, customer name, issue type, description, and creation date
- Filter by status using the dropdown
- Search by customer name or project ID

### Accessing the Project

Click any service call row to load and open the full Project Panel for the associated project. Service calls also appear on the project's Overview tab under the "Service Calls" section.

---

## Analytics

**URL:** `/analytics`

The Analytics page provides performance metrics and visual insights across the entire portfolio.

### Period Selection

Choose the time period for metrics using the dropdown:

- Week to Date
- This Month
- This Quarter
- This Year
- Last 7 Days
- Last 30 Days
- Last 90 Days

### Tabs

The Analytics page has 6 tabs:

#### Leadership Tab

High-level executive metrics for the selected time period:

- Sales count and contract value
- Install completions count and value
- M2 and M3 funded counts and dollar amounts
- Portfolio overview: active projects, forecast at 30/60/90 days
- Monthly install trend: 6-month bar chart showing install count and value per month
- Active projects by financier: bar chart with count and portfolio value

#### Pipeline Health Tab

Stage-by-stage breakdown of the active portfolio:

- Stage distribution: bar chart showing project count and contract value per stage
- 90-day forecast: projects expected to complete within 30, 31-60, and 61-90 days
- SLA health: count of projects in Critical, At Risk, and On Track status
- Blocked/Aging: count of blocked projects and projects with 90+ or 120+ day cycle times

#### By PM Tab

Per-PM performance table:

- Active project count per PM
- Blocked project count (highlighted in red when > 0)
- Portfolio value
- Installs completed in the selected period
- Sorted by active project count (highest first)

#### Funding Tab

Funding analytics across the portfolio:

- Total outstanding amount (ready to submit + submitted)
- M2 funded count with percentage and unfunded remainder
- M3 funded count with percentage and unfunded remainder
- Average days from install completion to M2 funding
- Average days from PTO to M3 funding
- Funded amount by financier: bar chart ranked by total amount
- Nonfunded code frequency: top 15 most common NF codes with counts

#### Cycle Times Tab

Time-based performance metrics:

- Average days in each pipeline stage (bar chart)
- Median sale-to-install cycle time (completed projects only)
- Median sale-to-PTO cycle time (completed projects only)
- Cycle time histogram: active projects bucketed by age (0-60, 61-90, 91-120, 120+ days)
- Top 10 longest active projects (by cycle days since sale)
- Where projects get stuck: blocked count by stage

#### Dealers Tab

Dealer and sales team performance:

- Projects by dealer: count, total portfolio value, and average system kW
- Projects by consultant: count with bar chart
- Projects by advisor: count with bar chart

### Metric Cards

Key numbers are displayed as large metric cards at the top of each tab:

- Large number with a label
- Optional subtitle with additional context
- Color coding: green for positive metrics, red for concerns

---

## Audit

**URL:** `/audit`

The Audit page helps identify task compliance issues across the portfolio. It surfaces projects where tasks are stuck, incomplete, or missing.

### Audit Filters

| Filter | What It Shows |
|--------|--------------|
| Stuck | Projects with tasks in Pending Resolution or Revision Required |
| Active | Projects with tasks in progress |
| Incomplete | Projects with incomplete required tasks |
| Missing | Projects with no task state records at all |

### Information Per Row

Each project row shows:

- Project ID and customer name
- PM
- Current stage
- Contract value
- SLA status
- Count of problematic tasks
- Task status badges

### Sorting Options

- **Count** -- Most stuck/problematic tasks first
- **Contract** -- Highest value projects first
- **SLA** -- Most urgent SLA status first
- **Name** -- Alphabetical

### Additional Filters

- **PM** -- Filter by project manager
- **Stage** -- Filter by pipeline stage
- **Search** -- Text search

### Excluded Projects

The Audit page excludes Cancelled and In Service projects. Loyalty projects are included because PMs still actively manage them.

---

## Audit Trail

**URL:** `/audit-trail`

The Audit Trail page provides a detailed log of every project field change made in the system. This page is restricted to Admin and Super Admin roles and is accessible via the navigation bar.

### What It Shows

Every time a project field is edited, the system records:

- **Project** -- Which project was changed (ID and name)
- **Field** -- Which field was modified
- **Old Value** -- The previous value
- **New Value** -- The updated value
- **Changed By** -- Who made the change
- **Date/Time** -- When the change was made

### Filtering

Use the filter bar to narrow results:

- **Date Range** -- Filter changes to a specific time window
- **Project** -- Search for changes on a specific project by name or ID
- **Field** -- Filter to a specific field (e.g., "stage", "pm", "blocker")
- **User** -- Filter by who made the change

### Sorting

Click any column header to sort the table by that column. Click again to reverse the sort direction.

### Opening a Project

Click any project in the audit trail to open the full Project Panel for that project.

---

## Admin Portal

**URL:** `/admin`

The Admin portal is restricted to users with Admin or Super Admin roles. It provides management tools for system configuration. The portal is organized into modular sections, each accessible from the sidebar navigation.

### User Management

- View all registered users
- Change user roles (User, Manager, Finance, Admin, Super Admin)
- Activate or deactivate users
- Set user departments and positions
- Assign user colors (for calendar display)

#### Role Badges

| Role | Badge Color |
|------|-------------|
| Super Admin | Red |
| Admin | Amber |
| Finance | Blue |
| Manager | Purple |
| User | Gray |

### Crew Management

Manage installation and service crews:

- Create new crews
- Set crew members: License Holder, Electrician, Solar Lead, Battery Lead, Installers (2), Battery Techs (2), Battery Apprentice, MPU Electrician
- Assign warehouse location
- Activate or deactivate crews

Note: The crew "active" field is stored as a text string ("TRUE"/"FALSE"), not a checkbox.

### AHJ Management

Manage Authority Having Jurisdiction records:

- Name
- Permit phone number
- Permit website URL
- Maximum permit turnaround duration (days)
- Electric code reference
- Permit notes
- Login credentials (username/password for online portals)

AHJ data appears automatically in the Project Panel when a project has an AHJ assigned, showing the phone number, website link, turnaround time, and notes inline.

### Utility Management

Manage utility company records:

- Name
- Phone number
- Website URL
- Notes

Like AHJ data, utility information appears inline in the Project Panel.

### SLA Thresholds

Configure the SLA timing thresholds for each pipeline stage:

- **Target** -- Number of days considered "on time"
- **Risk** -- Number of days triggering "at risk" status
- **Critical** -- Number of days triggering "critical" status

Changes here affect the color coding across the entire system (Command Center, Queue, Pipeline, Audit).

### Feedback Management

View and manage user-submitted feedback:

- See all feedback entries with type (Bug, Feature Request, Improvement, Question)
- Update feedback status (New, Reviewing, In Progress, Addressed, Won't Fix)
- Add admin notes
- View which page the feedback was submitted from

### Financier Management

Manage the list of financing companies available in the system:

- Add, edit, and deactivate financiers
- Financier names appear in the project Info tab as an autocomplete dropdown
- Seeded with 10 default financiers (Cash, EDGE, Mosaic, Sungage, GoodLeap, Dividend, Sunrun, Tesla, Sunnova, Loanpal)

### Task Reasons Configuration

Configure the reasons available when setting a task to Pending Resolution or Revision Required:

- Reasons are stored in the database per task (replacing previously hardcoded values)
- Toggle reasons active or inactive without deleting them
- Set sort order to control the order reasons appear in dropdowns

### Notification Rules

Create rules that fire automatically when a task reaches a specific status and reason:

- Define the trigger: task + status + reason combination
- Define the action: auto-create a note on the project or notify a specific role
- Replaces the previously hardcoded Permit Drop Off notification

### Queue Section Configuration

Configure the sections that appear on the Queue page:

- Add, reorder, and disable sections
- Each section maps a task ID and status to a labeled collapsible section
- Changes take effect immediately for all users

### User Preferences

Per-user settings stored in the database:

- Default homepage and PM filter
- Collapsed section state on the Queue page
- Queue card display field preferences
- CSV export presets

### Session Tracking

View active and recent user sessions:

- User name and email
- Login time
- Last active time
- Current page
- Computed session duration

Sessions are tracked automatically with a 60-second heartbeat.

---

## Document Management

**URL:** `/documents`

The Document Management system tracks project files synced from Google Drive and monitors document completeness across the portfolio.

### Documents Hub

The main `/documents` page is a file browser that lets you search across all project files stored in Google Drive:

- **Search** -- Type a filename, project ID, or folder name to find files across all projects
- **File details** -- Each result shows the filename, project ID, folder, file type, size, and date
- **Click to open** -- Click the file link to open it directly in Google Drive
- **Pagination** -- Results are paginated at 50 files per page

### Document Checklist (Files Tab)

In the Project Panel's Files tab, a **Document Checklist** shows the required documents for the project's current pipeline stage:

- Each document requirement shows a status indicator: present (green check), missing (red X), pending, or verified
- Requirements are configured per stage by administrators (e.g., "Signed Contract" in Evaluation, "Permit Application" in Permitting)
- 23 document requirements are defined across all 7 pipeline stages

### Missing Documents Report

**URL:** `/documents/missing`

The Missing Documents report identifies projects that are lacking required documents for their current stage:

- Filter by pipeline stage to focus on specific stages
- Each row shows the project, its stage, and which required documents are missing
- Useful for quality control and ensuring projects have all necessary paperwork before advancing

### NetSuite Historical Comments

Task notes may include historical comments imported from NetSuite, identified by an `[NS]` prefix. Over 127,000 action comments were imported from NetSuite workflow records, providing historical context for project activities such as permit submissions, inspection results, and status changes. These comments appear alongside regular notes in per-task note panels on the Tasks tab.

---

## Equipment Catalog

NOVA includes a centralized equipment catalog with 2,517 items across 8 categories: modules (solar panels), inverters, batteries, optimizers, racking, electrical components, adders, and other. The catalog serves as the single source of truth for equipment specifications used throughout the system.

### Autocomplete in Project Panel

When editing a project's Equipment section in the Info tab, the module, inverter, battery, and optimizer fields use **autocomplete dropdowns** powered by the equipment catalog. The autocomplete is debounced (waits briefly after you stop typing) to avoid excessive lookups:

1. Open the Project Panel and click Edit
2. In the Equipment section, start typing a manufacturer or model name (e.g., "Duracell" or "IQ8")
3. A dropdown appears below the field showing matching equipment from the catalog, searched across name, manufacturer, and description fields
4. Use arrow keys to navigate the dropdown, or click an item to select it
5. The selected item's full name populates the field. A clear button (X) appears to reset the selection
6. Click outside the dropdown to dismiss it without selecting
7. Recently used equipment items may appear at the top of results for faster selection

The autocomplete searches across the `name`, `manufacturer`, and `description` fields simultaneously, so you can search by any identifying detail. Results are limited to 20 matches and sorted by sort order then name.

### Auto-Calculate System kW

When both the module model and panel count are set on a project, the system automatically calculates the `system_kw` field:

- The calculation uses the module's wattage from the equipment catalog multiplied by the panel count, divided by 1000 to convert watts to kilowatts
- The result is displayed in the Project section of the Info tab
- This eliminates manual entry errors and keeps system size consistent with equipment specs
- If the module is changed to a different wattage panel, the system kW updates automatically on save
- Clearing the module field does not reset system kW (the last calculated value is preserved)

### Equipment Manager (Admin)

Administrators can manage the equipment catalog from the Admin portal (`components/admin/EquipmentManager.tsx`). The Equipment Manager provides full CRUD operations:

- **Search** -- Find equipment by manufacturer, model name, or description. Search uses partial matching across multiple fields
- **Filter by category** -- Show only a specific category: module, inverter, battery, optimizer, racking, electrical, adder, or other
- **Add new equipment** -- Click the Add button to create a new item. Required fields: category, name. Optional: manufacturer, model, wattage/capacity, description. New items default to active
- **Edit existing** -- Click any equipment row to open the edit form. Update category, manufacturer, model, wattage, description, or sort order
- **Deactivate** -- Toggle equipment active/inactive without deleting. Inactive items are hidden from autocomplete dropdowns in the project panel but remain in the database for historical reference. The admin view shows both active and inactive items
- **Sort order** -- Set a numeric sort order to control the position of items within their category in dropdown lists. Lower numbers appear first

### Adding Custom Equipment

If a project uses equipment not in the catalog, an admin should add it through the Equipment Manager before assigning it to projects. This ensures the wattage and specifications are available for auto-calculations. Steps:

1. Go to Admin portal and open Equipment Manager
2. Click Add and fill in category, name (typically "Manufacturer Model"), wattage, and description
3. Save the new item -- it immediately becomes available in autocomplete dropdowns across all projects

The equipment table is stored in Supabase with the schema defined in migration `024-equipment.sql`. Import scripts (`scripts/import-equipment.ts`, `scripts/upload-equipment.ts`) were used to seed the initial 2,517 items from manufacturer data.

---

## Inventory Management

**URL:** `/inventory`

The Inventory system tracks project materials and purchase orders across the full lifecycle from "needed" through "installed." It consists of a Materials tab in each project panel and a dedicated Inventory page for cross-project visibility.

### Materials Tab (Project Panel)

The Materials tab appears in the Project Panel alongside Tasks, Notes, Info, BOM, and Files. It shows all materials required for a specific project.

#### Auto-Generate Materials

Click the **Auto-generate** button to create material entries from the project's equipment fields (module, inverter, battery, optimizer). The system:

1. Reads the project's equipment model names and quantities
2. Checks for existing materials to avoid duplicates (matched by category + name)
3. Creates new material entries with status "needed" and default source (dropship for modules/inverters/batteries, TBD for optimizers)
4. Links entries to the equipment catalog when a matching item exists

#### Adding Materials Manually

Click **Add Item** to open the add form. Fields include:

- **Item Name** (required) -- e.g., "MC4 Connectors", "Conduit 1-inch"
- **Category** -- module, inverter, battery, optimizer, racking, electrical, or other
- **Quantity** and **Unit** (each, ft, box, roll)
- **Source** -- dropship, warehouse, or TBD
- **Vendor** (optional)

New items are created with status "needed."

#### Status Tracking

Each material has a status that progresses through five stages:

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| needed | Gray | Material identified but not yet ordered |
| ordered | Blue | Purchase order placed |
| shipped | Amber | In transit from vendor |
| delivered | Green | Received on site or at warehouse |
| installed | Emerald | Physically installed on the project |

**Click any status badge** to advance to the next status in the cycle. When a material reaches "delivered," today's date is automatically set as the delivered date.

#### Expanded Detail View

Click any material row to expand its detail panel. From here you can edit:

- Vendor
- PO Number
- Expected Date
- Delivered Date
- Notes

Click **Save** to persist changes, or **Remove** to delete the material.

#### Creating Purchase Orders from Materials

1. Use the checkboxes on the left side of each material row to select items
2. A **Create PO** button appears showing the count of selected items
3. Click it to open the PO creation form
4. Enter the vendor name (required)
5. Click **Create PO** -- a PO number is auto-generated (format: PO-YYYYMMDD-NNN)
6. All selected materials are automatically updated with the PO number and set to "ordered" status

### Inventory Page

The `/inventory` page provides a cross-project view with three tabs:

#### 1. Project Materials Tab

A table showing all materials across all projects with:

- **Summary cards** at the top showing counts per status (needed, ordered, shipped, delivered)
- **Filters**: status dropdown, category dropdown, source dropdown
- **Search**: by project name/ID, item name, or vendor
- **Sortable columns**: click Project, Item, Category, Qty, Status, or Expected headers to sort
- **Pagination**: 50 items per page

Each row shows the project ID and name, material item, category badge, quantity, source, vendor, status badge, and expected date.

#### 2. Purchase Orders Tab

A list of all purchase orders with:

- **Summary cards** showing counts per PO status (draft, submitted, confirmed, shipped, delivered)
- **Filters**: status dropdown, search by PO number/vendor/project
- **Expandable detail**: click any PO row to see:
  - **Status timeline** showing progression through draft, submitted, confirmed, shipped, delivered
  - Dates: created, submitted, tracking number, expected delivery
  - **Line items table**: item name, quantity, unit price, total price, notes
  - **Notes** field
  - **Action buttons**: "Advance to [next status]" and "Cancel PO"

**PO Status Lifecycle:**

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| draft | Gray | Created, not yet sent to vendor |
| submitted | Blue | Sent to vendor |
| confirmed | Indigo | Vendor acknowledged, order confirmed |
| shipped | Amber | Items shipped, may include tracking number |
| delivered | Green | All items received |
| cancelled | Red | PO cancelled |

When a PO is advanced to "delivered," all linked project materials are automatically updated to "delivered" status with today's date.

#### 3. Warehouse Tab

The Warehouse tab manages BOS (Balance of System) stock levels for items stored in the physical warehouse. It provides real-time quantity tracking, check-out/check-in workflows, physical count adjustments, and low stock alerts.

##### Adding Stock Items

Click the **+** button to add a new warehouse stock item. Fields include:

- **Name** (required) -- e.g., "MC4 Connectors", "Junction Box 6x6"
- **Category** -- module, inverter, battery, optimizer, racking, electrical, or other
- **Quantity on Hand** -- current count in the warehouse
- **Reorder Point** -- threshold below which a low stock alert triggers
- **Unit** -- each, ft, box, roll, etc.
- **Location** -- shelf, bin, or bay identifier (optional)

##### Checking Out Stock for a Project

1. Click the **down-arrow** (check out) button on any stock item
2. Search for and select the target project
3. Enter the quantity to pull
4. Add optional notes (e.g., "for roof replacement")
5. Click **Check Out**

This action:
- Decrements the warehouse quantity on hand
- Creates a transaction record (type: checkout)
- Automatically adds a material entry to the project (source: warehouse, status: delivered, with today's date)

The system prevents checking out more than the available quantity.

##### Checking In Returns

1. Click the **up-arrow** (check in) button on any stock item
2. Enter the quantity being returned
3. Add optional notes
4. Click **Check In**

This increments the warehouse quantity and creates a check-in transaction record.

##### Physical Count Adjustments

1. Click the **sliders** (adjust) button on any stock item
2. Enter the actual counted quantity
3. Add optional notes (e.g., "quarterly physical count")
4. Click **Adjust**

This sets the quantity to the new value, records the difference as an adjustment transaction, and updates the "last counted" timestamp.

##### Transaction History

Click the **clock** (history) button on any stock item to see its complete transaction log. Each entry shows:

- **Type** -- color-coded badge: checkout (red), checkin (green), adjustment (blue)
- **Quantity** -- positive for additions, negative for removals
- **Project** -- linked project ID (for checkouts)
- **Performed By** -- who made the change
- **Date** -- when the transaction occurred

##### Low Stock Alerts

Items where the quantity on hand is at or below the reorder point are highlighted with an amber warning icon. A low stock alert banner also appears at the top of the Inventory page (on the Materials and PO tabs) with a count of items below reorder point. Clicking the banner switches to the Warehouse tab.

##### Search and Filter

- **Search** -- filter by item name
- **Category dropdown** -- filter by equipment category

### Navigation

Inventory is accessible from the **primary navigation bar** (alongside Command, Queue, Pipeline, etc.).

---

## Redesign Tool

**URL:** `/redesign`

The Redesign tool is a calculator for planning system redesigns and generating Single Line Diagrams (SLDs).

### Equipment Calculator

Enter existing and target system specifications:

**Existing System:**
- Project name and address
- Panel model, wattage, count, and electrical specs (Voc, Vmp, Isc, Imp)
- Inverter model, count, and AC power rating
- Battery model, count, and capacity
- Racking type
- Roof face details (count, panel count per face, azimuth, tilt, area)

**Target System:**
- New panel model and specs
- New inverter model and specs (including MPPT details)
- New battery model and specs
- String configuration parameters

### Calculations

The tool calculates:

- String sizing (panels per string, strings per MPPT)
- Voltage compatibility checks
- Current compatibility checks
- System size comparison (existing vs proposed)
- Production estimates

### SLD Generation

After configuring the system, click **Generate SLD** to create a Single Line Diagram:

- Downloads as a DXF file (compatible with AutoCAD and other CAD software)
- Includes equipment specifications, string configurations, and electrical details
- Shows utility connection, inverter, panel arrays, and battery configuration

### Batch Processing

A batch processor button in the header allows processing multiple redesigns at once. See the dedicated [Batch Design](#batch-design) section below.

---

## Batch Design

**URL:** `/batch`

The Batch Design page allows processing multiple system redesigns at once, rather than configuring one project at a time in the Redesign tool.

### How It Works

1. Add projects to the batch by clicking **Add Project** -- enter project details (name, address, existing equipment specs, roof face configurations) or upload a data file
2. Configure **target system** settings that will apply to all projects in the batch: new panel model and specs, inverter model and MPPT configuration, battery specs, and string parameters
3. Click **Process All** to run calculations across every project in the batch
4. Review results for each project: string configurations, panel-fit estimates per roof face, voltage/current compatibility, system size comparison, and engineering notes/warnings
5. Download results or export individual project SLD data

### Input Fields Per Project

- Project name and address
- Existing panel model, wattage, count, and electrical specs (Voc, Vmp, Isc, Imp)
- Inverter model, count, and AC power rating
- Battery model, count, and capacity
- Racking type and roof face details (panel count, azimuth, tilt, area per face)

### Calculated Output

For each project, the batch processor calculates:

- Corrected Voc (cold temperature factor)
- Maximum and minimum modules per string
- Recommended string size and total string inputs
- Panel-fit estimates per roof face (old count vs new count)
- New vs old system DC/AC power and storage totals
- Engineering notes and compatibility warnings

---

## Crew Mobile View

**URL:** `/crew`

The Crew page is a mobile-optimized daily job view designed for field crews to use on phones and tablets while on-site.

### What It Shows

- Scheduled jobs for the current week, grouped by date (Today, Tomorrow, then day names)
- Each job card displays: job type badge (Survey/Install/Inspection/Service with color coding), status dot (Complete/Scheduled/In Progress/Cancelled), customer name, address (clickable link to Google Maps), phone (tap to call), email (tap to email), system specs (kW, modules, inverter, battery), and crew assignment
- Job details include PM name, consultant, advisor, and any special notes

### Navigation

- Week navigation arrows to view previous or upcoming weeks
- Jobs are loaded via `useSupabaseQuery` for the schedule table, filtered by date range
- Project details are merged from the projects table for customer and equipment info
- Crew names are resolved from the crews table

### Mobile Optimization

- Large tap targets for phone numbers and addresses
- Simplified layout optimized for small screens
- No editing capability -- this is a read-only reference view for crews in the field

---

## Crew Performance Dashboard

**URL:** `/dashboard`

The Dashboard page provides a personal performance overview for the logged-in PM. It automatically filters to the current user's projects.

### Metrics Displayed

- **Active projects** count (excluding Cancelled and In Service)
- **Pipeline projects** count (also excluding Loyalty and Complete)
- **Blocked** count with percentage
- **Critical SLA** count
- **Portfolio value** (total contract value)
- **Upcoming schedule** for the next 7 days (surveys, installs, inspections, service calls with crew assignments)

### Data Sources

- Projects filtered by `pm_id` matching the current user
- Task states for stuck task analysis
- Schedule entries for the next 7 days
- Active crews for crew name resolution

---

## Planset (Duracell SLD)

**URL:** `/planset`

The Planset page is a specialized Single Line Diagram (SLD) generator for Duracell equipment configurations. It renders a complete engineering planset as SVG sheets directly in the browser.

### Current Configuration

The page is currently hardcoded for a reference project (PROJ-29857) with Duracell Power Center Max Hybrid 15kW inverters, AMP 410W panels, and Duracell 5kWh LFP batteries. It demonstrates the full SLD layout including:

- Equipment specifications and nameplate data
- String configurations across multiple MPPT inputs and roof faces
- Utility connection details (meter, ESID, utility company)
- Contractor information (MicroGRID Energy license and contact details)
- Existing system details (for redesign/expansion projects)

### Usage

This page serves as a template and proof-of-concept for automated SLD generation. The SVG rendering uses the `calculateSldLayout` helper from `lib/sld-layout.ts` and the `SldRenderer` component.

---

## Atlas (AI Reports)

**URL:** `/reports`
**Access:** Manager, Finance, Admin, and Super Admin roles

Atlas is NOVA's AI-powered natural language query interface, branded as "Atlas" in the UI. Instead of building filters, writing SQL, or exporting spreadsheets to answer questions, type a question in plain English and get results instantly. Atlas uses Claude Sonnet to interpret your question, build a database query, execute it, and present the results in a sortable table.

### How to Use

1. Navigate to **Atlas** from the "More" dropdown in the navigation bar
2. Type a question in the input field at the bottom, or click one of the **starter prompts** to get started quickly
3. Atlas analyzes your question, generates a query plan, executes it against the database, and displays results in a sortable table
4. Click any column header to sort the results ascending or descending
5. Click a project ID in the results to open the full Project Panel for that project
6. After each result, Atlas may suggest a **follow-up question** -- click it to send it automatically, or type your own follow-up

### Starter Prompts

When you first open Atlas, clickable starter prompts appear to help you get started:

- "Show me all blocked projects with their blocker reasons"
- "Which projects have been in permitting the longest?"
- "List installs scheduled for this week"
- "Show funding status for all eligible M2 milestones"

Click any starter prompt to immediately run that query.

### Example Questions

Atlas can answer a wide range of questions about your project data:

**Portfolio overview:**
- "How many active projects do we have by stage?"
- "What is the total contract value by financier?"
- "Which PMs have the most projects?"

**Finding specific projects:**
- "Show me all blocked projects"
- "Which permit stage projects have been stuck more than 30 days?"
- "What projects are missing a survey date?"
- "List projects in Corpus Christi"

**Scheduling and operations:**
- "Show me installs scheduled this month"
- "Which projects have overdue follow-up dates?"
- "List all service calls with Open status"

**Funding and financial:**
- "List projects by financier with contract values"
- "Show all M2 eligible milestones with amounts"
- "Which projects have been funded this month?"

### Exporting Results to CSV

Click the **Export CSV** link below any results table to download the data as a CSV file. The export includes all columns and rows from the current result set, formatted for immediate use in Excel or Google Sheets. This is useful for:

- Creating ad-hoc reports for leadership
- Sharing data with external partners
- Further analysis in spreadsheet tools
- Archiving query results

### Follow-Up Questions

After displaying results, Atlas often suggests a relevant follow-up question based on the data returned. Click the suggestion to automatically send it as your next query. You can also type your own follow-up -- Atlas remembers the full conversation context within the current session, so you can refine or drill deeper without restating the original question. For example:

1. "Show me all blocked projects" -- returns 8 projects
2. "Which of those are in the permit stage?" -- Atlas filters the previous results
3. "What are their blocker reasons?" -- Atlas adds detail to the narrowed set

### Limits

- **25 queries per day** per user (tracked via the `user_sessions` table, persistent across Vercel instances)
- **10 queries per minute** burst limit
- **500 rows maximum** per result set
- Available tables: projects, project_funding, task_state, notes, schedule, service_calls, change_orders
- Client-side date filters (`daysAgo_gt`, `daysAgo_lt`) enable relative date queries like "stuck more than 30 days"

### Technical Details

Atlas uses the Anthropic API (Claude Sonnet model) for query generation. The API route at `/api/reports/chat` validates the generated query plan before execution, only allowing reads against whitelisted tables. Database queries use the `SUPABASE_SECRET_KEY` (service role key) for read-only access. Both `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY` environment variables must be configured; the endpoint returns 503 if either is missing.

---

## Legacy Projects

**URL:** `/legacy`

The Legacy Projects page is a read-only archive of 14,705 historical TriSMART "In Service" projects imported from NetSuite. These projects have completed the installation pipeline and are no longer actively managed. The Legacy page provides lookup access for customer calls, warranty questions, service history, and historical reference.

### Accessing Legacy Projects

Legacy Projects is accessible from the navigation bar. It is completely separate from the active CRM -- legacy projects do not appear in Pipeline, Queue, Command Center, or any other active views.

### Searching

Use the search bar at the top to find projects. Search works across multiple fields:

- Customer name
- Phone number
- Email address
- Street address
- City
- Project ID (PROJ-XXXXX format)

### Sortable Table

The results table displays key project information with sortable columns. Click any column header to sort ascending/descending.

### Detail Panel

Click any project row to open a detail panel on the right side. The panel is organized into sections:

- **Customer** -- Name, address, city, state, zip, phone, email
- **System** -- System kW, panel count, panel type, inverter type, battery info, MSP bus rating
- **Financial** -- Contract amount, financier, financing type, down payment
- **Dates** -- Sale date, install complete, PTO date, in service date, and other milestone dates
- **Permit** -- AHJ, utility, permit numbers, permit fees
- **Funding** -- M2/M3 amounts and funded dates (from 12,054 merged funding records)
- **Notes** -- Full BluChat communication history with original authors and timestamps

### Legacy Notes

Each legacy project includes its historical BluChat communication messages -- over 150,000 messages across 8,299 projects. Notes display the original author name, timestamp, and full message text.

New notes can be added by any team member: type in the note field at the top of the Notes section and press Enter or click Add. New notes are timestamped with your name automatically.

### When to Use Legacy vs Active

- **Legacy** (`/legacy`) -- Look up historical TriSMART projects, customer call history, warranty questions, service records
- **Active** (Pipeline/Queue/Command) -- Manage current MicroGRID projects through the installation pipeline
- Legacy projects are completely separate and do not impact any active CRM metrics or views

---

## Help Center

**URL:** `/help`

The Help Center is a topic-based knowledge base with 52 topics organized across 12 categories:

- **Getting Started** -- Login, navigation, project overview, roles
- **Daily Workflow** -- Command Center, Queue, Pipeline, task management, bulk operations
- **Project Management** -- Project panel, tasks, stages, dispositions, adders, equipment, follow-ups, project creation
- **Notes & Communication** -- Project notes, task notes, @mentions, file references
- **Financial** -- Funding milestones, NF codes, permit fees, change order costs
- **Inventory & Materials** -- Materials tab, purchase orders, warehouse stock, equipment catalog
- **Schedule & Crews** -- Crew calendar, job assignments, crew management
- **Change Orders** -- HCO workflow, 6-step design process, change order management
- **Reports & Analytics** -- Analytics tabs, Atlas AI reports, audit page
- **Administration** -- User management, system configuration, AHJ/utilities, notification rules
- **System Features** -- Search, CSV export, feedback, session tracking, error handling
- **Design Tools** -- Redesign calculator, SLD generator, batch processing

### Layout and Navigation

The Help Center uses a sidebar + content layout:

- **Search bar** at the top filters topics by title, description, and keywords (debounced 200ms)
- **Sidebar** lists all 12 categories with topic counts; click to scroll to a category section. Collapsible on mobile.
- **"What's New" section** in the sidebar highlights recently added features (Inventory, Atlas, Equipment Catalog, Legacy Projects, Document Management)
- **Accordion topics** expand/collapse on click, showing detailed content with step-by-step instructions
- **"Try it" links** on topics navigate directly to the relevant page
- **Related topics** at the bottom of each expanded topic link to cross-referenced content
- **Deep linking** via URL hash (e.g., `/help#materials-tab`) scrolls to and opens a specific topic on page load

### Feedback Button

A floating feedback button appears in the bottom-right corner of every page. Click it to submit feedback:

1. Select the type: Bug, Feature Request, Improvement, or Question
2. Type your message
3. Click Submit

Your name, email, and current page are automatically captured. The admin team reviews all feedback through the Admin portal.

---

## @Mentions and Notifications

NOVA includes an @mention system for tagging team members in project notes. This makes it easy to loop in other PMs, leadership, or the design team on specific projects.

### How to Mention Someone

1. Open the Project Panel and go to the Notes tab (or a per-task notes area)
2. Type `@` in the note input
3. An autocomplete dropdown appears showing active team members
4. Select a name from the dropdown to insert the mention
5. Submit the note as usual

### How Mentions Appear

Mentioned names render as green highlighted text in the note, making them easy to spot at a glance.

### Notifications

When you are mentioned in a note:

- A notification appears on the **bell icon** in the top navigation bar
- The bell shows an unread count badge when you have new mentions
- Click the bell to see all your notifications with the project name and note context
- Notifications are marked as read when you view them -- read state syncs to the database, so notifications stay dismissed across devices and sessions

### When to Use @Mentions

- Loop in another PM when a project needs their input
- Tag leadership to flag an issue or escalation
- Notify the design team about a change order or revision
- Alert the funding team when a milestone needs attention

### Database

Mention notifications are stored in the `mention_notifications` table. Migration: `supabase/015-mentions.sql`. Each notification records the note, the mentioned user, who made the mention, and the project.

---

## Pagination

Some pages with large datasets include page controls at the bottom:

- **Service** -- Paginates service call records
- **Audit** -- Paginates task compliance results
- **Audit Trail** -- Paginates change log entries

Pages without pagination (Pipeline, Command, Queue, Funding) load and display all matching projects at once. Use search and filters on these pages to narrow results.

---

## Mobile Views

NOVA includes two mobile-first pages designed for use on phones and tablets. These views have no desktop navigation bar and use large touch targets, simplified layouts, and sticky headers.

### Leadership Dashboard

**URL:** `/mobile/leadership`

**Access:** Managers, Admins, and Super Admins only. Users without Manager+ role see an "Access Restricted" screen.

The Leadership Dashboard provides a high-level snapshot of portfolio health, optimized for quick checks from a phone.

#### Metrics Displayed

- **Active Projects** -- count of all non-complete projects (excludes Cancelled, In Service, Loyalty)
- **Portfolio Value** -- total contract value of active projects, shown in compact format ($1.2M)
- **Installs This Month** -- projects with an install completion date in the current calendar month
- **Blocked** -- count of projects with a non-null blocker (highlighted red when > 0)
- **M2 Funded This Month** -- count and dollar amount of M2 milestones funded this month
- **M3 Funded This Month** -- count and dollar amount of M3 milestones funded this month

#### Pipeline Snapshot

A horizontal bar chart showing project counts by pipeline stage (Evaluation through Complete), color-coded per stage.

#### PM Performance

A ranked list of PMs showing active project count and blocked count per PM, with mini progress bars.

#### Quick Stats

- **Avg Sale-to-Install** -- average days from sale date to install complete date across all completed installs
- **Projects > 90 Cycle Days** -- count of active projects exceeding 90 cycle days (highlighted amber when > 0)

#### Auto-Refresh

Data refreshes automatically every 5 minutes. Tap the refresh icon in the header to refresh manually. The "Updated" timestamp shows when data was last loaded.

#### How to Access

Navigate to `/mobile/leadership` directly in your mobile browser, or bookmark it for quick access. The back arrow in the header returns to the Command Center. A link to the full Analytics dashboard appears at the bottom of the page.

### Field Operator View

**URL:** `/mobile/field`

The Field page is a mobile-first daily job view for field operators (installers, surveyors, inspectors). Unlike the read-only Crew page (`/crew`), the Field page allows operators to update job status and complete tasks directly from the field.

#### Today's Jobs

The main view shows all scheduled jobs for today (excluding cancelled), sorted by status priority:
1. **In Progress** jobs appear first
2. **Scheduled** jobs appear next
3. **Complete** jobs appear last

Within each status group, jobs are sorted by scheduled time.

#### Job Cards

Each job card displays:
- **Job type badge** -- color-coded (Survey = blue, Install = green, Inspection = amber, Service = purple)
- **Status indicator** -- dot with label (Scheduled, In Progress, Complete)
- **Scheduled time** (if set)
- **Customer name** and address
- **Crew assignment**

#### Quick Actions

Each job card has a bottom action bar with three buttons:
- **Call** -- tap to call the customer's phone number
- **Navigate** -- tap to open the address in Google Maps
- **Notes** -- tap to open the project detail view

#### Status Progression

Jobs that are not complete or cancelled show action buttons:
- **Start Job** -- moves a Scheduled job to In Progress
- **Mark Job Complete** -- moves an In Progress job to Complete
- **Mark Task Complete** -- for install, survey, and inspection jobs, also marks the corresponding NOVA task as Complete (with task history logging and auto-populated project dates)

#### Project Search

A search bar at the top lets operators look up any project by name, ID, or address. Search results appear in a dropdown; tapping a result opens the project detail modal.

#### Project Detail Modal

Tapping a job card or search result opens a full-screen project detail view showing:
- **Customer section** -- name, ID, phone (tap to call), email (tap to email), address (tap for Maps)
- **System section** -- system size in kW, panel model and quantity
- **Status section** -- current pipeline stage, days in stage, blocker (if any)
- **Key Dates** -- survey date, install date, PTO date
- **Add Note** -- text input to submit a note directly to the project

#### Realtime Updates

The page subscribes to realtime changes on the schedule table, so if a dispatcher adds or modifies a job, the field view updates automatically without manual refresh. A manual refresh button is also available.

---

## Tips and Best Practices

### Daily PM Workflow

1. **Start at Command Center** -- Check your Overdue, Blocked, and Critical sections first
2. **Switch to Queue** -- Work through your projects top to bottom
3. **Update tasks as you go** -- Keeping task statuses current triggers automations and keeps SLA accurate
4. **Add notes** -- Document customer interactions, decisions, and blockers in the Notes tab
5. **Check Schedule** -- Verify upcoming surveys, installs, and inspections

### Keeping SLA Healthy

- Update task statuses promptly when work is done
- When a task is genuinely blocked, set it to "Pending Resolution" with the right reason -- this sets the blocker automatically so leadership can see it
- When a task needs rework, use "Revision Required" -- be aware this will cascade-reset downstream tasks
- Avoid leaving tasks in "In Progress" for extended periods; if work stops, move back to Ready To Start or set to Pending Resolution

### Search Tips

- Search works across customer name, project ID, and city on most pages
- Type at least 2 characters to see results
- AHJ and Utility searches in the project panel and new project modal use autocomplete -- type to see suggestions from the database

### Creating Projects

When creating a new project:

- Fill in all required fields (marked with red asterisk): Customer Name, Address, Phone, Email, Dealer, and Financier
- The system automatically generates the next available project ID
- A Google Drive folder structure is automatically created with 16 subfolders
- Initial evaluation tasks are automatically set to "Ready To Start"
- A stage history entry is created

### Exporting Data

- Use the Export button on the Command Center to download project data as CSV
- A field picker lets you choose which columns to include
- The export includes all projects matching your current filters

### Understanding Dispositions

| Disposition | Meaning | Where It Appears |
|-------------|---------|-----------------|
| Sale (or null) | Active project in the pipeline | Command, Queue, Pipeline, Analytics, Funding, Audit |
| Loyalty | Existing customer, additional work | Command (separate section), Queue, Audit |
| In Service | Completed, post-installation | Command (separate section) |
| Cancelled | No longer active | Excluded from all active views |

### Disposition Workflow

Dispositions follow a specific progression -- you cannot skip steps:

```
Sale --> Loyalty --> Cancelled
```

- From **Sale**, you can only move to **Loyalty** (not directly to Cancelled)
- From **Loyalty**, you can move to **Sale** (reactivate) or **Cancelled**
- From **In Service**, you can only move back to **Sale**
- From **Cancelled**, you can only move back to **Loyalty** (reactivate)

This ensures projects go through the Loyalty step before cancellation, giving the team a chance to retain the customer.

### PM Assignment

The PM field is a dropdown populated from active users in the system. When you change a PM:

- Select the new PM name from the dropdown in the project's Info tab (edit mode)
- Both the display name and the PM's user ID are saved
- The project will immediately appear in the new PM's Queue

### Color Reference

Throughout the system, colors have consistent meanings:

- **Green** -- On track, complete, healthy
- **Blue** -- In progress, active work
- **Amber/Yellow** -- At risk, needs attention, warning
- **Red** -- Critical, blocked, overdue, needs immediate action
- **Indigo** -- Scheduled
- **Gray** -- Not ready, inactive, or neutral
- **Pink** -- Service calls

### Common Task Status Flows

A typical task progresses through statuses in this order:

```
Not Ready --> Ready To Start --> In Progress --> Complete
```

If something goes wrong:

```
In Progress --> Pending Resolution --> (resolved) --> In Progress --> Complete
```

If rework is needed:

```
Complete --> Revision Required --> (reworked) --> In Progress --> Complete
```

### Keyboard and Browser Tips

- Use your browser's back button to return to the previous page
- Bookmark your most-used pages for quick access
- The system updates in real time -- if another team member makes changes, you will see them without refreshing
- If the page feels slow, try refreshing your browser

---

## Glossary

| Term | Definition |
|------|-----------|
| AHJ | Authority Having Jurisdiction -- the local government body that approves building permits |
| BOM | Bill of Materials -- list of equipment needed for a project |
| Cycle Days | Total number of days from sale date to today |
| ESID | Electric Service Identifier -- unique ID for the electrical service point |
| HCO | Home Change Order |
| IA | Interconnection Agreement |
| IBC | Interconnection Breaker |
| MPU | Main Panel Upgrade |
| MSP | Main Service Panel |
| NTP | Notice to Proceed |
| PTO | Permission to Operate -- utility approval to turn on the solar system |
| RLS | Row-Level Security -- database security that controls who can see/edit what data |
| SLA | Service Level Agreement -- time targets for how long a project should spend in each stage |
| SLD | Single Line Diagram -- electrical schematic of the solar system |
| TPO | Third Party Ownership (Lease or PPA) |
| UB | Utility Bill |
| VPP | Virtual Power Plant |
| WPI | Windstorm Product Installation -- Texas certification requirement |

---

## Technical Architecture

### API Layer

NOVA uses a centralized API layer for all data operations. When you interact with the system -- updating a task, adding a note, or saving project details -- those operations go through a set of dedicated functions that handle communication with the database. This means consistent behavior and error handling across every page.

### Error Handling

If something goes wrong while using NOVA, you will see a "Something went wrong" screen instead of a broken page. From this screen:

- Click **Try Again** to reload the page and recover
- If the issue persists, click **Report Issue** to submit a bug report through the feedback system -- your name, email, and the page you were on are captured automatically
- The admin team is notified of all reported issues through the Admin portal's Feedback Manager

Errors are isolated to individual pages -- if one page encounters a problem, the rest of the application continues working normally.
