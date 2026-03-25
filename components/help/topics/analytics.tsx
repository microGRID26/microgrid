import type { HelpTopicData } from './index'

function AnalyticsOverview() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">6 tabs of analytics and reporting:</p>
      <div className="space-y-2 text-xs">
        {[
          { tab: 'Leadership', desc: 'Executive metrics: sales, installs, M2/M3 funded, 90-day forecast' },
          { tab: 'Pipeline Health', desc: 'Stage distribution, SLA health summary, blocked/aging counts' },
          { tab: 'By PM', desc: 'Per-PM performance: active count, blocked, portfolio, installs' },
          { tab: 'Funding', desc: 'Outstanding amounts, funded percentages, avg days to fund, NF codes' },
          { tab: 'Cycle Times', desc: 'Avg days per stage, median cycle times, top 10 longest projects' },
          { tab: 'Dealers', desc: 'Projects by dealer, consultant, advisor with bar charts' },
        ].map(t => (
          <div key={t.tab} className="bg-gray-800 rounded-md px-3 py-2">
            <span className="text-white font-medium">{t.tab}</span>
            <span className="text-gray-500"> -- {t.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AtlasReports() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Ask natural language questions about your projects. Atlas generates SQL, displays results in sortable tables, supports CSV export. Available to Managers and above.</p>
      <div className="bg-gray-800 rounded-lg px-4 py-3 text-xs mb-3">
        <div className="text-gray-500 mb-2">Example questions:</div>
        <div className="space-y-1">
          <div className="text-gray-300">&quot;Show me all blocked projects&quot;</div>
          <div className="text-gray-300">&quot;Which PMs have the most installs?&quot;</div>
          <div className="text-gray-300">&quot;Average cycle time by financier&quot;</div>
        </div>
      </div>
      <div className="space-y-1 text-xs">
        {[
          'Click starter prompts for common queries',
          'Sort results by clicking column headers',
          'Click project IDs to open the Project Panel',
          'Export any result to CSV',
          'Limits: 25 queries/day, 500 rows max',
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
      <p className="text-xs text-gray-400 mb-2">Period selector at top: Week to Date, This Month, This Quarter, etc. Shows revenue recognized, M2/M3 funded, pending funding, 90-day forecast, monthly install trend (6-month bar chart), PM breakdown, and revenue by dealer.</p>
    </div>
  )
}

export const analyticsTopics: HelpTopicData[] = [
  {
    id: 'analytics-overview',
    title: 'Analytics Overview',
    description: '6 tabs of charts, metrics, and reports',
    category: 'Reports & Analytics',
    keywords: ['analytics', 'reports', 'charts', 'metrics', 'dashboard', 'tabs'],
    tryItLink: '/analytics',
    relatedTopics: ['atlas-reports', 'leadership-dashboard'],
    content: AnalyticsOverview,
  },
  {
    id: 'atlas-reports',
    title: 'Atlas AI Reports',
    description: 'Natural language queries with CSV export',
    category: 'Reports & Analytics',
    keywords: ['atlas', 'ai', 'natural language', 'query', 'report', 'csv', 'export', 'sql'],
    tryItLink: '/reports',
    relatedTopics: ['analytics-overview'],
    content: AtlasReports,
  },
  {
    id: 'leadership-dashboard',
    title: 'Leadership Dashboard',
    description: 'Period-selectable executive metrics',
    category: 'Reports & Analytics',
    keywords: ['leadership', 'executive', 'revenue', 'forecast', 'trend', 'period'],
    tryItLink: '/analytics',
    relatedTopics: ['analytics-overview'],
    content: LeadershipDashboard,
  },
]
