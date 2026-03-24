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
8. [Schedule](#schedule)
9. [Funding](#funding)
10. [Change Orders](#change-orders)
11. [Service Calls](#service-calls)
12. [Analytics](#analytics)
13. [Audit](#audit)
14. [Admin Portal](#admin-portal)
15. [Redesign Tool](#redesign-tool)
16. [Help Center](#help-center)
17. [Tips and Best Practices](#tips-and-best-practices)

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

The navigation bar runs across the top of every page. It includes links to all major sections:

- **Command** -- SLA dashboard (your home base)
- **Queue** -- PM-filtered project list
- **Pipeline** -- Visual stage grid
- **Analytics** -- Performance metrics and charts
- **Schedule** -- Weekly crew calendar
- **Service** -- Service call tracking
- **Funding** -- Milestone payment tracking
- **Change Orders** -- HCO/change order workflow
- **Redesign** -- Equipment calculator and SLD generator

Additional links in the navigation:

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
- **AHJ** -- Filter by Authority Having Jurisdiction
- **Search** -- Text search by name, ID, or city

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

Five tabs are available across the top of the panel:

#### 1. Overview (Info Tab)

The Overview tab displays all project information organized into sections:

**Left Column:**

- **Customer** -- Name, address (clickable link to Google Maps), city, phone, email
- **Project** -- Disposition, contract value, system kW, financier, financing type, down payment, TPO escalator, financier advance payment, dealer
- **Equipment** -- Module (model and qty), inverter (model and qty), battery (model and qty), optimizer (model and qty)
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

#### 5. BOM Tab (Bill of Materials)

- Displays the bill of materials for the project
- Shows equipment counts and specifications
- Useful for inventory planning and verification

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

#### Leadership Tab

High-level metrics for management:

- Total active projects and pipeline value
- Projects completed in period
- Revenue funded
- Stage distribution with mini bar charts
- Blocked and at-risk counts

#### Pipeline Tab

Stage-by-stage breakdown:

- Project count per stage
- Contract value per stage
- SLA compliance rates
- Average days in each stage

#### PM Tab

Per-PM performance metrics:

- Project count and value by PM
- Completion rates
- SLA compliance
- Blocked project counts

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

## Admin Portal

**URL:** `/admin`

The Admin portal is restricted to users with Admin or Super Admin roles. It provides management tools for system configuration.

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

### Session Tracking

View active and recent user sessions:

- User name and email
- Login time
- Last active time
- Current page
- Computed session duration

Sessions are tracked automatically with a 60-second heartbeat.

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

A batch processor button in the header allows processing multiple redesigns at once.

---

## Help Center

**URL:** `/help`

The in-app Help Center provides documentation organized by role:

- **For PMs** -- Daily workflow, task system details, stage navigation, status meanings
- **For Funding** -- Milestone management, eligibility rules, NF codes
- **For Leadership** -- Analytics interpretation, SLA overview, portfolio health
- **For Everyone** -- General navigation, project panel usage, common workflows
- **For Admins** -- User management, system configuration, data management

The Help Center includes interactive mockups showing exactly what each UI element looks like and what it means.

### Feedback Button

A floating feedback button appears in the bottom-right corner of every page. Click it to submit feedback:

1. Select the type: Bug, Feature Request, Improvement, or Question
2. Type your message
3. Click Submit

Your name, email, and current page are automatically captured. The admin team reviews all feedback through the Admin portal.

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
