'use client'

export function ReleaseNotes() {
  const sectionCls = "text-xs font-bold text-gray-500 uppercase tracking-widest mt-6 mb-3 px-1"
  const cardCls = "bg-gray-900 border border-gray-800 rounded-lg px-5 py-4 mb-3"
  const titleCls = "text-sm font-semibold text-white mb-1"
  const bodyCls = "text-sm text-gray-400 leading-relaxed"
  const bullet = (items: string[]) => (
    <ul className="mt-2 space-y-1">
      {items.map((item, i) => <li key={i} className="flex items-start gap-2"><span className="text-gray-600 mt-0.5">-</span><span>{item}</span></li>)}
    </ul>
  )

  return (
    <div className="max-w-3xl">
      <h2 className="text-base font-semibold text-white mb-1">Release Notes</h2>
      <p className="text-xs text-gray-500 mb-4">Internal version history for MicroGRID CRM</p>

      <div className={sectionCls}>Session 10 (cont.) - March 21, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Schedule System Overhaul</div>
        <div className={bodyCls}>
          {bullet([
            'Job Brief panel — click any job card to see full project details, customer info, system specs, install details',
            'Install Details fields — arrival window, arrays, pitch, stories, special equipment, MSP upgrade, WiFi, electrical notes, wind speed, risk category, travel adder',
            'Crew mobile app at /crew — touch-friendly cards, tappable phone/map links, status actions',
            'Status badges on job cards (green=complete, blue=scheduled, amber=in progress)',
            'PM auto-populated on new schedule entries from project data',
            'Search added to schedule page (filter by project name/ID)',
            'Realtime subscription for schedule changes',
            'Cancelled jobs hidden by default with toggle',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Schedule ↔ Task Integration</div>
        <div className={bodyCls}>
          {bullet([
            'Crew marks job complete → auto-completes corresponding task (install_done, site_survey, city_insp)',
            'Task completion triggers full automation chain: date populated → funding eligible → stage advance',
            'Creating schedule entry auto-marks scheduling task as "Scheduled"',
            'Quick Schedule button in ProjectPanel Tasks tab for schedulable tasks (Ready To Start)',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Mobile Optimization</div>
        <div className={bodyCls}>
          {bullet([
            'Hamburger menu for mobile nav (11 links collapsed into drawer)',
            'Scroll lock on all modals/panels (prevents background scroll on touch)',
            'ProjectPanel full-screen on mobile',
            'Task dropdowns larger touch targets on mobile (44px+)',
            'Feedback button icon-only on mobile',
            'Clickable addresses (Google Maps links) on Job Brief, crew page, Info tab',
            'Dark background on html/body (fixes white flash on mobile Safari)',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Performance & Cleanup</div>
        <div className={bodyCls}>
          {bullet([
            'ProjectPanel queries parallelized via Promise.all (7 queries run simultaneously)',
            'Command Center memoized: useMemo on taskMapAll, filtered, sections, pms, totalContract',
            'Permission matrix added to Admin portal (read-only role vs feature reference)',
            'Session tracking fixed — localStorage fallback prevents duplicate sessions on mobile',
            'Nav streamlined: Audit and Crew removed from main nav (9 links), accessible via Admin sidebar and direct URL',
          ])}
        </div>
      </div>

      <div className={sectionCls}>Session 10 - March 20, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Task System Overhaul</div>
        <div className={bodyCls}>
          Complete rewrite of the Tasks tab in ProjectPanel.
          {bullet([
            'Stage navigation pills — click any stage to view its tasks with completion fractions (e.g., "Design 6/12")',
            'Table layout with color-coded rows: green (complete), red (pending), amber (revision), blue (in progress)',
            'Inline task history — click ▸ to expand any task and see its full revision trail',
            'Duration tracking — blue badges show days from started to completed',
            'Revision cascade — setting a task to Revision Required auto-resets downstream tasks with confirmation dialog',
            'Free-text reason input for tasks without predefined reason dropdowns',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Automation Engine</div>
        <div className={bodyCls}>
          11 automations now fire when task statuses change:
          {bullet([
            'Auto-populate project dates — 11 task-to-date mappings (survey_date, install_complete_date, pto_date, etc.)',
            'Auto-advance stage — completing last required task auto-advances to next stage',
            'Auto-detect blockers — Pending Resolution auto-sets project blocker with ⏸ prefix',
            'Auto-clear blockers — resolving stuck task auto-clears blocker if no other tasks stuck',
            'Funding milestone triggers — Installation Complete → M2 Eligible, PTO → M3 Eligible',
            'Task duration tracking — started_date auto-set when task moves to In Progress',
            'Cascade date clearing — revision cascade also clears corresponding project dates',
            'Auto-set In Service disposition when In Service task completed',
            'Task history logging — all status/reason changes recorded to task_history table',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Change Order Queue (New Page)</div>
        <div className={bodyCls}>
          Full change order management system at /change-orders, modeled after NetSuite Cases.
          {bullet([
            'Queue table with status/PM/search filters and realtime subscription',
            'Detail panel with editable status, priority, type, reason, origin, assignment',
            '6-step design workflow with auto-status (Open → In Progress → Complete)',
            'Design comparison table — original vs new values with green diff highlighting',
            'Chronological timestamped notes with user name',
            'Project integration — badge in ProjectPanel header links to filtered change orders',
            'Clickable project names in queue table open ProjectPanel directly',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Google Drive Integration</div>
        <div className={bodyCls}>
          New projects auto-create folder structure in MicroGRID Projects shared drive via Google Apps Script.
          16 subfolders created automatically (01 Proposal through 20 Cases).
          Drive link saved to project_folders table and accessible from Files tab.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Feedback System</div>
        <div className={bodyCls}>
          Floating feedback button on every page. Users submit bugs, feature requests, improvements, or questions.
          Auto-captures user name, email, and current page. Admin portal feedback manager with clickable type/status
          filter badges, admin notes, and super-admin delete.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Audit Trail</div>
        <div className={bodyCls}>
          Session tracking — automatic login detection with 60-second heartbeat showing current page and duration.
          Change log — all project field changes with old/new values, who changed it, and when.
          Project deletions now logged to audit trail before cascade delete.
          Admin portal Audit Trail module with Sessions and Changes tabs.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Command Center Updates</div>
        <div className={bodyCls}>
          {bullet([
            'New "Pending Resolution" section between Blocked and Critical (orange)',
            'Pending metric card in top bar',
            'All sections start collapsed — click metric cards to expand',
            'Cancelled projects filtered from active pipeline sections',
            'Overlapping section membership bug fixed (pending excludes crit/risk)',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Infrastructure & Code Quality</div>
        <div className={bodyCls}>
          {bullet([
            'Shared task constants extracted to lib/tasks.ts — single source of truth, eliminates duplication',
            'Task history logging fixed — pm_id column bug was silently failing all inserts',
            'All fire-and-forget DB inserts (void) converted to awaited with error logging',
            'Audit log inserts converted from void to awaited',
            'Help page updated with interactive visual mockups for all sections',
            'Project creation form: state dropdown (defaults TX), phone type=tel, zip maxLength=5',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Security & Permissions</div>
        <div className={bodyCls}>
          {bullet([
            'All authenticated users can now create and edit projects (not just admins)',
            'Feedback RLS fix — insert uses SECURITY DEFINER function to bypass RLS',
            'Session tracking auth fallback fix — handles edge case when session not yet available',
            'Phone/email validation on project create and edit forms',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Platform-Wide Fixes</div>
        <div className={bodyCls}>
          {bullet([
            'Pipeline Cancelled filtering — cancelled projects properly excluded from active pipeline',
            'escapeIlike() applied to all Supabase .ilike() search queries across all pages',
            'fmtDate() used consistently across all date displays for uniform formatting',
            'Cycle detection added to task prerequisite graph — prevents circular dependencies',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Audit Fixes — 6 Critical/High</div>
        <div className={bodyCls}>
          {bullet([
            'Task history pm_id column bug — was silently failing all task_history inserts',
            'Fire-and-forget DB inserts converted to awaited with error logging',
            'Audit log inserts converted from void to awaited',
            'Pending Resolution section excludes projects already in Critical/At Risk',
            'Stage advance prerequisite check hardened',
            'Cascade reset clears corresponding auto-populated project dates',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Audit Fixes — 4 Medium</div>
        <div className={bodyCls}>
          {bullet([
            'State dropdown added to new project form (defaults to TX)',
            'Phone field uses type=tel, zip code has maxLength=5',
            'Free-text reason input for tasks without predefined reason lists',
            'Overlapping section membership bug fixed in Command Center',
          ])}
        </div>
      </div>

      <div className={sectionCls}>Session 9 - March 19, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Roles System — 5-Level Permissions</div>
        <div className={bodyCls}>
          Replaced admin/super_admin booleans with a single role column: Super Admin, Admin, Finance, Manager, User. useCurrentUser hook returns computed permission helpers. Admin nav link hidden for non-admin roles. Users module shows role dropdown with color-coded badges. Migration backfills existing users from old booleans.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Bug Fixes - 11 issues resolved</div>
        <div className={bodyCls}>
          {bullet([
            'Funding pending amount now sums all milestones (was only counting M3)',
            'Pipeline and Service search no longer overrides dropdown filters',
            'Auth callback redirects to login on failure instead of blank page',
            'cycleDays falls back to stage_date when sale_date is null',
            'Pipeline cycle sort now descending (oldest first) to match other sorts',
            'ProjectPanel AHJ/Utility refreshes when switching between projects',
            'NewProjectModal stage history insert now checks for errors',
            'Funding days waiting handles malformed dates (no more NaN)',
            'Schedule conflict check re-runs when switching create/edit mode',
            'Middleware cookie errors no longer crash with 500',
            'ProjectPanel fetches full project on open (fixes missing fields)',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Security - RLS + Role-Based Permissions</div>
        <div className={bodyCls}>
          Row-level security enabled on all tables. PMs can only edit their own projects.
          Admins have full write access. Super admin role added for destructive operations (delete).
          User auto-provisioning on first Google login. Name cascade trigger keeps PM field in sync.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Performance Audit</div>
        <div className={bodyCls}>
          All 8 pages optimized: select(*) replaced with explicit columns (10-13 vs 50+).
          Schedule page now filters by visible week instead of loading entire history.
          Service and Schedule pages use nested joins instead of loading all projects for name lookup.
          Queue removed redundant PM query. Analytics filters In Service at DB level.
          Database indexes added on stage, disposition, financier, schedule date, service call status.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Funding Page Overhaul</div>
        <div className={bodyCls}>
          Complete rewrite for Taylor Pratt. One row per project with M1/M2/M3 side by side.
          Inline editing for amount, funded date, status, and notes. Searchable nonfunded code picker
          with all 218 codes from the master list. Per-milestone status tracking
          (Not Submitted / Submitted / Funded / Rejected / Complete).
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Project Creation Overhaul</div>
        <div className={bodyCls}>
          {bullet([
            'Required fields: Customer Name, Address, Phone, Email, Dealer, Financier',
            'Equipment section: Module, Inverter, Battery with quantities',
            'AHJ and Utility use searchable autocomplete from reference tables',
            'Added zip code, HOA, consultant email fields',
            'Evaluation tasks auto-set to Ready To Start on creation',
            'New Project button available on Command, Queue, and Pipeline pages',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Project Lifecycle</div>
        <div className={bodyCls}>
          Cancel Project sets disposition to Cancelled (removed from active pipeline).
          Reactivate restores cancelled projects. Delete is super-admin-only with double
          confirmation and full cascade across all related tables.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Testing & CI</div>
        <div className={bodyCls}>
          156 automated tests (Vitest + React Testing Library) covering utility functions,
          SLA logic, funding calculations, filter composition, BOM, task detection, auth flow.
          Pre-commit hook blocks commits with failing tests. GitHub Actions CI runs tests + build
          on every push.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>AHJ & Utility Edit Popups</div>
        <div className={bodyCls}>
          Clicking the AHJ or Utility name in ProjectPanel opens an edit popup for the
          reference record (phone, website, permit notes, electric code). Changes save
          directly to the AHJ/utility table and refresh inline.
        </div>
      </div>

      <div className={sectionCls}>Session 8 - March 18, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Full codebase audit</div>
        <div className={bodyCls}>
          Every file audited for bugs, silent failures, and architecture issues.
          ProjectPanel Info fields fully editable. Save Changes pre-loads all current values.
          AHJ info card uses fuzzy match. Drive folder lookup fixed. Header syncs after stage advance.
        </div>
      </div>

      <div className={sectionCls}>Session 7 - March 18, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Bug fixes and refactoring</div>
        <div className={bodyCls}>
          {bullet([
            'AHJ, Utility, and HOA clickable info modals in ProjectPanel',
            'Stage label corrected, funding days waiting fixed, BOM key error fixed',
            'SLA thresholds and task lists centralized in lib/utils.ts',
          ])}
        </div>
      </div>

      <div className={sectionCls}>Session 6 - March 17, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Admin Portal</div>
        <div className={bodyCls}>
          AHJ Manager (1,633 records, paginated), Utility Manager, Users CRUD,
          Crews with role-based members, SLA Thresholds editor, CRM Info stats.
          AHJ/Utility autocomplete in project edit. Export field picker. Help page.
        </div>
      </div>

      <div className={sectionCls}>Sessions 3-5 - Earlier</div>

      <div className={cardCls}>
        <div className={titleCls}>Core Features</div>
        <div className={bodyCls}>
          Schedule view with crew calendar. Service calls with status tracking.
          Funding milestones (M1/M2/M3). ProjectPanel Info tab edit mode with
          stage advance and prerequisite checking.
        </div>
      </div>
    </div>
  )
}
