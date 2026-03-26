import type { HelpTopicData } from './index'

function CommandCenter() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Your morning dashboard. Auto-selects your PM filter so you see your own projects. Personal stats at top, action items in the middle, pipeline snapshot and sortable project table below.</p>
      {/* Stats row mock */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Active', value: '24', color: 'text-white' },
          { label: 'Portfolio', value: '$1.2M', color: 'text-green-400' },
          { label: 'Installs', value: '3', color: 'text-blue-400' },
          { label: 'Today', value: '2 jobs', color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800 rounded-md px-2 py-2 text-center">
            <div className="text-[10px] text-gray-500 uppercase">{s.label}</div>
            <div className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>
      {/* Action items mock */}
      <div className="space-y-1.5 text-xs">
        {[
          { label: 'Follow-ups Due', color: 'bg-amber-900 text-amber-300', count: 4 },
          { label: 'Blocked', color: 'bg-red-900 text-red-300', count: 3 },
          { label: 'Stuck Tasks', color: 'bg-red-900/80 text-red-300', count: 5 },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 bg-gray-800 rounded-md px-3 py-2">
            <span className={`px-2 py-0.5 rounded font-medium text-[10px] ${s.color}`}>{s.count}</span>
            <span className="text-gray-200">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CommandSections() {
  return (
    <div className="space-y-3 text-xs">
      <p className="text-gray-400">The Command Center has three action item sections plus a sortable project table:</p>
      <div className="space-y-2">
        {[
          { section: 'Follow-ups Due', desc: 'Tasks and projects with follow-up dates due today or overdue. Shows task name and days overdue.' },
          { section: 'Blocked', desc: 'Projects with an active blocker. Shows blocker reason. Sorted by days in stage (longest first).' },
          { section: 'Stuck Tasks', desc: 'Tasks in Pending Resolution or Revision Required. Shows task name, status, and reason.' },
        ].map(s => (
          <div key={s.section} className="flex items-start gap-2">
            <span className="text-green-500 mt-0.5 font-bold shrink-0">&bull;</span>
            <span><span className="text-white font-medium">{s.section}</span> -- {s.desc}</span>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <p className="text-gray-400 mb-1.5">Below the action items, the <span className="text-white font-medium">Pipeline Snapshot</span> shows project counts by stage as a bar chart. Click a stage to filter the table.</p>
        <p className="text-gray-400">The <span className="text-white font-medium">Project Table</span> lists all active projects with sortable columns: Project, Stage, Days, Blocker, Next Task, Contract, and Follow-up.</p>
      </div>
    </div>
  )
}

function QueuePage() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Your daily worklist with smart filters, clickable stats, inline actions, funding badges, and sortable sections.</p>
      {/* Smart filters mock */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-500 uppercase mb-1.5">Smart Filters</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {['Evaluation', 'Survey', 'Design', 'Permit'].map(s => (
            <span key={s} className={`text-[10px] px-2 py-0.5 rounded-full border ${s === 'Permit' ? 'bg-green-900/60 border-green-600 text-green-300' : 'border-gray-700 text-gray-500'}`}>{s}</span>
          ))}
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-500">Financier: All</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-500">&lt;7d</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-600 bg-red-900/60 text-red-300">Blocked Only</span>
        </div>
      </div>
      {/* Clickable stat cards mock */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Total', value: '42', color: 'text-white', border: 'border-green-600' },
          { label: 'Blocked', value: '5', color: 'text-red-400', border: 'border-gray-700' },
          { label: 'Follow-ups', value: '3', color: 'text-amber-400', border: 'border-gray-700' },
          { label: 'Portfolio', value: '$2.1M', color: 'text-white', border: 'border-gray-700' },
        ].map(s => (
          <div key={s.label} className={`bg-gray-800 rounded-md px-2 py-2 text-center border ${s.border}`}>
            <div className="text-[10px] text-gray-500 uppercase">{s.label}</div>
            <div className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-gray-500 mb-1">Click Total to clear filters, Blocked to toggle filter, Follow-ups to scroll to section.</div>
      {/* Sections mock */}
      <div className="space-y-1.5 text-xs mb-2">
        {[
          { label: 'Follow-ups Today', count: 3, color: 'text-amber-400' },
          { label: 'City Permit Ready', count: 5, color: 'text-blue-400' },
          { label: 'Blocked', count: 5, color: 'text-red-400' },
          { label: 'Active', count: 24, color: 'text-gray-400' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 bg-gray-800 rounded-md px-3 py-1.5">
            <span className="text-[10px]">&#9660;</span>
            <span className={`font-medium ${s.color}`}>{s.label}</span>
            <span className="text-gray-500 ml-auto text-[10px]">{s.count}</span>
            <span className="text-[10px] text-gray-600 border border-gray-700 rounded px-1">Days</span>
          </div>
        ))}
      </div>
      {/* Inline actions mock */}
      <div className="bg-gray-800 rounded-lg px-3 py-2 text-xs mb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          <span className="text-white font-medium">Smith Residence</span>
          <span className="text-gray-500">PROJ-30456</span>
          <span className="text-green-400 text-[10px]">Permit</span>
          <span className="text-blue-400 text-[10px] ml-1">M2: Sub</span>
          <span className="ml-auto text-red-400 font-mono text-[10px]">12d</span>
        </div>
        <div className="mt-1 text-[10px] text-gray-500 flex items-center gap-3">
          <span>Houston</span>
          <span>&middot;</span>
          <span>Mosaic</span>
          <span className="ml-auto text-amber-400">Stale 8d</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] bg-red-950 text-red-300 px-1.5 py-0.5 rounded">Pending Resolution -- MPU Review</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="text-gray-600 text-[10px]" title="Set follow-up">&#128197;</span>
            <span className="text-gray-600 text-[10px]" title="Quick note">&#128172;</span>
          </span>
        </div>
      </div>
      <div className="text-[10px] text-gray-500">Hover cards for inline actions: set follow-up date, add quick note, clear blocker.</div>
    </div>
  )
}

function OpeningProject() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Click any project row or card anywhere to open the detail panel. It slides in from the right as a modal.</p>
      <div className="bg-gray-800 rounded-lg px-4 py-3 text-xs">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-green-400 font-mono">PROJ-30456</span>
          <span className="text-white font-medium">Johnson Residence</span>
          <span className="ml-auto text-[10px] bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">Design</span>
        </div>
        <div className="flex gap-2">
          {['Tasks', 'Notes', 'Info', 'BOM', 'Files'].map(tab => (
            <span key={tab} className={`text-[10px] px-2 py-1 rounded ${tab === 'Tasks' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>{tab}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function SearchAndFilter() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Search matches project name, ID, city, and address simultaneously. Combine with dropdown filters for PM, financier, AHJ, and utility.</p>
      <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-3 text-xs">
        <div className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 text-gray-500">Search by name, ID, city, address...</div>
        <span className="bg-gray-700 text-gray-300 px-2 py-1 rounded text-[10px]">PM: All</span>
        <span className="bg-gray-700 text-gray-300 px-2 py-1 rounded text-[10px]">AHJ: All</span>
      </div>
    </div>
  )
}

function CsvExport() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Click Export in the Command nav. Pick exactly which fields to include (50+ available, grouped by category). Respects your active PM filter and search.</p>
    </div>
  )
}

function SlaIndicators() {
  return (
    <div>
      <div className="space-y-2 text-xs mb-3">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-green-900 text-green-300 font-medium">2d</span>
          <span className="text-gray-400">Green -- on track</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-amber-900 text-amber-300 font-medium">5d</span>
          <span className="text-gray-400">Amber -- approaching risk threshold</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-red-900 text-red-300 font-medium">12d</span>
          <span className="text-gray-400">Red -- past risk threshold</span>
        </div>
      </div>
      <p className="text-xs text-amber-400">Note: SLA thresholds are currently paused (all set to 999 days). Projects will show as On Track until re-enabled.</p>
    </div>
  )
}

function StuckTasks() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Stuck task badges appear below project rows throughout the system:</p>
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded text-[10px]">Pending Resolution</span>
          <span className="text-red-400 text-[10px]">MPU Review</span>
          <span className="text-gray-500">-- blocked, waiting on external action</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded text-[10px]">Revision Required</span>
          <span className="text-amber-400 text-[10px]">Panel Count Change</span>
          <span className="text-gray-500">-- needs rework</span>
        </div>
      </div>
    </div>
  )
}

export const dailyWorkflowTopics: HelpTopicData[] = [
  {
    id: 'command-center',
    title: 'Command Center',
    description: 'Your morning dashboard with personal stats and action items',
    category: 'Daily Workflow',
    keywords: ['command', 'dashboard', 'home', 'overview', 'morning', 'stats', 'action items', 'pipeline snapshot'],
    tryItLink: '/command',
    relatedTopics: ['command-sections', 'sla-indicators'],
    content: CommandCenter,
  },
  {
    id: 'command-sections',
    title: 'Action Items and Project Table',
    description: 'Follow-ups, blocked, stuck tasks, and sortable project list',
    category: 'Daily Workflow',
    keywords: ['follow-ups', 'blocked', 'stuck', 'action items', 'project table', 'pipeline snapshot', 'sort'],
    relatedTopics: ['command-center', 'stuck-tasks'],
    content: CommandSections,
  },
  {
    id: 'queue-page',
    title: 'My Queue',
    description: 'Smart worklist with filters, clickable stats, inline actions, and funding badges',
    category: 'Daily Workflow',
    keywords: ['queue', 'worklist', 'daily', 'follow-up', 'permit', 'blocked', 'active', 'smart filters', 'inline actions', 'funding badge', 'sortable'],
    tryItLink: '/queue',
    relatedTopics: ['setting-pm-filter', 'command-center'],
    content: QueuePage,
  },
  {
    id: 'opening-project',
    title: 'Opening a Project',
    description: 'Click to open the ProjectPanel with tabs',
    category: 'Daily Workflow',
    keywords: ['project', 'panel', 'open', 'detail', 'modal', 'tabs'],
    relatedTopics: ['task-statuses', 'adding-notes'],
    content: OpeningProject,
  },
  {
    id: 'search-and-filter',
    title: 'Search and Filter',
    description: 'Search bar, PM/financier/AHJ dropdowns',
    category: 'Daily Workflow',
    keywords: ['search', 'filter', 'find', 'pm', 'financier', 'ahj', 'utility', 'dropdown'],
    content: SearchAndFilter,
  },
  {
    id: 'csv-export',
    title: 'CSV Export',
    description: 'Export projects with custom field picker',
    category: 'Daily Workflow',
    keywords: ['export', 'csv', 'download', 'spreadsheet', 'excel', 'fields'],
    tryItLink: '/command',
    content: CsvExport,
  },
  {
    id: 'sla-indicators',
    title: 'SLA Indicators',
    description: 'Green/amber/red badges (currently paused)',
    category: 'Daily Workflow',
    keywords: ['sla', 'threshold', 'green', 'amber', 'red', 'days', 'stage', 'paused'],
    relatedTopics: ['command-sections'],
    content: SlaIndicators,
  },
  {
    id: 'stuck-tasks',
    title: 'Stuck Task Badges',
    description: 'Red/amber badges with reasons',
    category: 'Daily Workflow',
    keywords: ['stuck', 'badge', 'pending', 'revision', 'reason', 'blocked'],
    relatedTopics: ['task-statuses', 'blocker-detection'],
    content: StuckTasks,
  },
]
