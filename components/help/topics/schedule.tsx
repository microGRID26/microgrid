import type { HelpTopicData } from './index'

function SchedulePage() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Weekly calendar showing crew assignments by day. Each cell shows the job type, project, and crew. Filter by crew or job type. Supports multi-day jobs -- set an end date when scheduling to span across multiple days (e.g., 2-day installs show &quot;Day 1 of 2&quot;, &quot;Day 2 of 2&quot;).</p>
      <div className="border border-gray-700 rounded-lg overflow-hidden text-xs">
        <div className="grid grid-cols-6 gap-0 bg-gray-800/50 border-b border-gray-700">
          <span className="px-2 py-2 text-gray-500 font-medium">Crew</span>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => (
            <span key={d} className="px-2 py-2 text-gray-500 font-medium text-center">{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-0 border-b border-gray-800">
          <span className="px-2 py-2 text-gray-300 font-medium">HOU1</span>
          <span className="px-2 py-2 text-center"><span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">Install</span></span>
          <span className="px-2 py-2 text-center"><span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">Install</span></span>
          <span className="px-2 py-2 text-center"><span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-[10px]">Survey</span></span>
          <span className="px-2 py-2 text-center text-gray-600">--</span>
          <span className="px-2 py-2 text-center"><span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">Inspect</span></span>
        </div>
      </div>
    </div>
  )
}

function CrewView() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Mobile-optimized daily job view at <span className="text-green-400 font-mono">/crew</span>. Shows jobs grouped by date with:</p>
      <div className="space-y-1 text-xs">
        {[
          'Customer name and address (tap for Google Maps)',
          'Phone number (tap to call)',
          'Equipment specs and crew assignments',
          'Read-only -- designed for phones and tablets in the field',
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-gray-400">
            <span className="text-gray-600 mt-0.5">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeadershipDashboard() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Mobile-first leadership dashboard at <span className="text-green-400 font-mono">/mobile/leadership</span>. Requires Manager role or above. Shows:</p>
      <div className="space-y-1 text-xs">
        {[
          'Active projects count and portfolio value',
          'Installs, M2 funded, and M3 funded this month (count + amount)',
          'Blocked projects count (highlighted red)',
          'Pipeline stage distribution bar chart',
          'PM performance table (active + blocked per PM)',
          'Avg sale-to-install days and aging project count (90+ cycle days)',
          'Auto-refreshes every 5 minutes; manual refresh button in header',
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-gray-400">
            <span className="text-gray-600 mt-0.5">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FieldOperatorView() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Mobile-first field operator view at <span className="text-green-400 font-mono">/mobile/field</span>. Unlike the read-only Crew view, field operators can update job status and complete tasks:</p>
      <div className="space-y-1 text-xs">
        {[
          "Today's scheduled jobs sorted by status (In Progress first, then Scheduled, then Complete)",
          'Job cards with type badge, status, time, customer name, address, and crew',
          'Quick actions: tap to call, navigate (Google Maps), or view notes',
          'Start Job / Mark Job Complete buttons to progress job status',
          'Mark Task Complete auto-completes the corresponding MicroGRID task and populates project dates',
          'Project search by name, ID, or address with instant results',
          'Full project detail modal with customer info, system specs, status, dates, and note submission',
          'Realtime updates via schedule table subscription',
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-gray-400">
            <span className="text-gray-600 mt-0.5">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkOrdersPage() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Field work tracking at <span className="text-green-400 font-mono">/work-orders</span>. Create, assign, and complete work orders for installs, surveys, inspections, repairs, and service calls.</p>
      <div className="space-y-2 text-xs">
        <div>
          <span className="text-gray-300 font-medium block mb-1">Status Flow</span>
          <div className="flex items-center gap-1.5 text-gray-400">
            <span className="bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded text-[10px]">Draft</span>
            <span className="text-gray-600">&rarr;</span>
            <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">Assigned</span>
            <span className="text-gray-600">&rarr;</span>
            <span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">In Progress</span>
            <span className="text-gray-600">&rarr;</span>
            <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-[10px]">Complete</span>
          </div>
        </div>
        <div>
          <span className="text-gray-300 font-medium block mb-1">Features</span>
          {[
            'Type-specific checklist templates (install, survey, inspection, repair, service)',
            'Crew and person assignment with scheduled date',
            'Checklist progress bar with per-item completion tracking',
            'Customer signature collection with timestamp',
            'Time on site tracking (minutes)',
            'Notes and special instructions',
            'Search by WO#, project, crew, or person',
            'Filter by status and type',
            'Realtime updates across all users',
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-gray-400">
              <span className="text-gray-600 mt-0.5">&bull;</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FleetManagement() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Track company vehicles at <span className="text-green-400 font-mono">/fleet</span>. Manage vehicle details, assign to crews/drivers, and track maintenance schedules.</p>
      <div className="space-y-2 text-xs">
        <div>
          <span className="text-gray-300 font-medium block mb-1">Vehicle Status</span>
          <div className="flex items-center gap-1.5 text-gray-400">
            <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-[10px]">Active</span>
            <span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">Maintenance</span>
            <span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded text-[10px]">Out of Service</span>
            <span className="bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded text-[10px]">Retired</span>
          </div>
        </div>
        <div>
          <span className="text-gray-300 font-medium block mb-1">Features</span>
          {[
            'Vehicle details: VIN, year, make, model, license plate, color',
            'Assign vehicles to crews and drivers',
            'Insurance and registration expiry tracking with alerts',
            'Odometer tracking -- auto-updates from maintenance records',
            'Maintenance history with 6 service types (oil change, tires, brakes, inspection, repair, other)',
            'Upcoming maintenance alerts (within 30 days)',
            'Next due date and odometer scheduling',
            'Cost tracking per maintenance record',
            'CSV export of fleet data',
            'Search by vehicle #, make, model, plate, VIN, or driver',
            'Filter by status and crew assignment',
            'Delete restricted to super admin',
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-gray-400">
              <span className="text-gray-600 mt-0.5">&bull;</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CalendarSync() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Sync schedule entries to Google Calendar so crews see jobs on their phones. Managed in <span className="text-green-400 font-mono">Admin &gt; Calendar Sync</span>.</p>
      <div className="space-y-2 text-xs">
        <div>
          <span className="text-gray-300 font-medium block mb-1">Setup</span>
          {[
            'Admin sets GOOGLE_CALENDAR_CREDENTIALS env var with a Google service account JSON',
            'Enable sync per crew in the Admin portal Calendar Sync section',
            'A Google Calendar is auto-created for each crew on first sync',
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-gray-400">
              <span className="text-gray-600 mt-0.5">&bull;</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div>
          <span className="text-gray-300 font-medium block mb-1">Features</span>
          {[
            'Manual "Sync Calendar" button on the Schedule page syncs the visible week',
            'Per-crew "Sync Now" in Admin for full sync (last 30 days + future)',
            'Auto-sync toggle per crew for automatic sync on schedule changes',
            'Color-coded events by job type (blue=survey, green=install, amber=inspection, red=service)',
            'Multi-day job support with correct start/end dates',
            'Bidirectional: Google Calendar changes can update NOVA schedule via webhook',
            'Blue calendar icon on synced job cards in the schedule grid',
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-gray-400">
              <span className="text-gray-600 mt-0.5">&bull;</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const scheduleTopics: HelpTopicData[] = [
  {
    id: 'schedule-page',
    title: 'Schedule Page',
    description: 'Weekly calendar with crew assignments',
    category: 'Schedule & Crews',
    keywords: ['schedule', 'calendar', 'crew', 'week', 'job', 'assign', 'install', 'survey', 'multi-day', 'end date'],
    tryItLink: '/schedule',
    relatedTopics: ['crew-view', 'calendar-sync'],
    content: SchedulePage,
  },
  {
    id: 'crew-view',
    title: 'Crew Mobile View',
    description: 'Mobile-optimized daily jobs for field crews',
    category: 'Schedule & Crews',
    keywords: ['crew', 'mobile', 'field', 'daily', 'job', 'phone', 'tablet'],
    tryItLink: '/crew',
    relatedTopics: ['schedule-page', 'leadership-dashboard', 'field-operator-view'],
    content: CrewView,
  },
  {
    id: 'leadership-dashboard',
    title: 'Leadership Dashboard (Mobile)',
    description: 'Mobile-first executive snapshot of portfolio health and PM performance',
    category: 'Schedule & Crews',
    keywords: ['leadership', 'mobile', 'dashboard', 'executive', 'portfolio', 'metrics', 'funding', 'pipeline', 'pm performance', 'manager'],
    tryItLink: '/mobile/leadership',
    relatedTopics: ['analytics-page', 'crew-view', 'field-operator-view'],
    content: LeadershipDashboard,
  },
  {
    id: 'field-operator-view',
    title: 'Field Operator View (Mobile)',
    description: 'Mobile-first daily job view with status updates, task completion, and project search',
    category: 'Schedule & Crews',
    keywords: ['field', 'mobile', 'operator', 'installer', 'surveyor', 'inspector', 'job', 'task', 'complete', 'status', 'navigate', 'call'],
    tryItLink: '/mobile/field',
    relatedTopics: ['crew-view', 'leadership-dashboard', 'schedule-page'],
    content: FieldOperatorView,
  },
  {
    id: 'work-orders',
    title: 'Work Orders',
    description: 'Create, assign, and track field work orders with checklists and customer signatures',
    category: 'Schedule & Crews',
    keywords: ['work order', 'checklist', 'install', 'survey', 'inspection', 'repair', 'service', 'crew', 'signature', 'field', 'tracking'],
    tryItLink: '/work-orders',
    relatedTopics: ['schedule-page', 'crew-view', 'field-operator-view'],
    content: WorkOrdersPage,
  },
  {
    id: 'fleet-management',
    title: 'Fleet Management',
    description: 'Track company vehicles, maintenance history, and expiry alerts',
    category: 'Schedule & Crews',
    keywords: ['fleet', 'vehicle', 'truck', 'maintenance', 'oil change', 'inspection', 'insurance', 'registration', 'odometer', 'driver', 'crew'],
    tryItLink: '/fleet',
    relatedTopics: ['schedule-page', 'crew-view', 'work-orders'],
    content: FleetManagement,
  },
  {
    id: 'calendar-sync',
    title: 'Google Calendar Sync',
    description: 'Sync crew schedules to Google Calendar for mobile access',
    category: 'Schedule & Crews',
    keywords: ['google', 'calendar', 'sync', 'crew', 'schedule', 'mobile', 'event', 'gcal', 'auto-sync', 'webhook'],
    relatedTopics: ['schedule-page', 'crew-view', 'work-orders'],
    content: CalendarSync,
  },
]
