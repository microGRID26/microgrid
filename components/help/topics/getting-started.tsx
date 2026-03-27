import type { HelpTopicData } from './index'

function LoggingIn() {
  return (
    <div>
      <div className="space-y-3">
        <div className="bg-gray-800/50 rounded-lg px-4 py-3 border-l-2 border-green-500">
          <div className="text-xs font-bold text-green-400 mb-1">Step 1</div>
          <div className="text-xs text-gray-400">Navigate to <a href="https://microgrid-crm.vercel.app" target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300 underline">MicroGRID</a> and click <span className="text-white font-medium">Sign in with Google</span>.</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg px-4 py-3 border-l-2 border-blue-500">
          <div className="text-xs font-bold text-blue-400 mb-1">Step 2</div>
          <div className="text-xs text-gray-400">Use your company account: <span className="text-white font-mono">@gomicrogridenergy.com</span> or <span className="text-white font-mono">@energydevelopmentgroup.com</span>. Legacy <span className="text-white font-mono">@trismartsolar.com</span> accounts also work.</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg px-4 py-3 border-l-2 border-amber-500">
          <div className="text-xs font-bold text-amber-400 mb-1">Trouble?</div>
          <div className="text-xs text-gray-400">Clear browser cookies and try again. If it persists, contact your administrator.</div>
        </div>
      </div>
    </div>
  )
}

function FirstDay() {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="space-y-3 text-xs">
        {[
          { n: 1, title: 'Go to Command', desc: 'Your home base. All active projects grouped by urgency.' },
          { n: 2, title: 'Open a project', desc: 'Click any row to open its detail panel. Browse Tasks, Notes, Info, BOM, Files.' },
          { n: 3, title: 'Check the Tasks tab', desc: 'See where the project stands. Click stage pills to navigate. Update statuses.' },
          { n: 4, title: 'Use My Queue for daily work', desc: 'Queue shows only your projects, sorted by what needs attention first.' },
        ].map(s => (
          <div key={s.n} className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-green-700 text-white flex items-center justify-center font-bold flex-shrink-0">{s.n}</span>
            <div>
              <span className="text-white font-medium">{s.title}</span>
              <p className="text-gray-400 mt-0.5">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function UnderstandingRoles() {
  return (
    <div className="space-y-1.5 text-xs">
      {[
        { role: 'Sales', desc: 'Energy consultants. View only their own projects. No financial data, no editing, no Atlas.', color: 'text-purple-300' },
        { role: 'User', desc: 'Standard access. Create/edit projects, update tasks, add notes.', color: 'text-gray-300' },
        { role: 'Manager', desc: 'Same as User with additional visibility and Atlas access.', color: 'text-blue-300' },
        { role: 'Finance', desc: 'Access to funding pages and financial data.', color: 'text-amber-300' },
        { role: 'Admin', desc: 'Full access including Admin portal, user/crew management.', color: 'text-green-300' },
        { role: 'Super Admin', desc: 'Everything Admin can do, plus project deletion.', color: 'text-red-300' },
      ].map(r => (
        <div key={r.role} className="flex items-center gap-3 bg-gray-800 rounded-md px-3 py-2">
          <span className={`font-medium w-24 ${r.color}`}>{r.role}</span>
          <span className="text-gray-400">{r.desc}</span>
        </div>
      ))}
    </div>
  )
}

function SettingPmFilter() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">On the Queue page, select your name from the PM dropdown at the top right. Your selection is saved in localStorage and remembered for future visits.</p>
      <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-3 text-xs">
        <span className="text-gray-500">PM:</span>
        <span className="bg-gray-700 text-gray-200 px-3 py-1.5 rounded-md border border-gray-600">Greg Kelsch</span>
        <span className="text-gray-600 ml-2">Filters all queue sections to your projects only</span>
      </div>
    </div>
  )
}

function NavigatingApp() {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-3">The nav bar has two tiers:</div>
      <div className="space-y-2 text-xs">
        <div>
          <span className="text-gray-300 font-medium">Primary:</span>
          <span className="text-gray-400"> Command, Queue, Pipeline, Schedule, Funding, Inventory, Analytics</span>
        </div>
        <div>
          <span className="text-gray-300 font-medium">More dropdown:</span>
          <span className="text-gray-400"> Service, Change Orders, Documents, Atlas, Redesign, Legacy, Audit Trail</span>
        </div>
        <div>
          <span className="text-gray-300 font-medium">Icons:</span>
          <span className="text-gray-400"> Admin (gear, admin only), Help (?), Notification Bell, Sign Out</span>
        </div>
      </div>
    </div>
  )
}

export const gettingStartedTopics: HelpTopicData[] = [
  {
    id: 'logging-in',
    title: 'Logging In',
    description: 'Google OAuth, supported email domains',
    category: 'Getting Started',
    keywords: ['login', 'sign in', 'google', 'oauth', 'email', 'password', 'account'],
    content: LoggingIn,
  },
  {
    id: 'first-day',
    title: 'Your First Day',
    description: '4-step walkthrough to get started',
    category: 'Getting Started',
    keywords: ['first', 'start', 'begin', 'new', 'onboarding', 'walkthrough'],
    tryItLink: '/command',
    relatedTopics: ['command-center', 'queue-page'],
    content: FirstDay,
  },
  {
    id: 'understanding-roles',
    title: 'Understanding Roles',
    description: 'Sales, User, Manager, Finance, Admin, Super Admin',
    category: 'Getting Started',
    keywords: ['role', 'permission', 'access', 'admin', 'manager', 'finance', 'super admin', 'sales', 'consultant'],
    relatedTopics: ['admin-portal', 'permission-matrix'],
    content: UnderstandingRoles,
  },
  {
    id: 'setting-pm-filter',
    title: 'Setting Your PM Filter',
    description: 'Queue page filter saved in your browser',
    category: 'Getting Started',
    keywords: ['pm', 'filter', 'queue', 'my projects', 'localStorage'],
    tryItLink: '/queue',
    relatedTopics: ['queue-page'],
    content: SettingPmFilter,
  },
  {
    id: 'navigating-app',
    title: 'Navigating the App',
    description: 'Primary nav, More dropdown, Admin',
    category: 'Getting Started',
    keywords: ['nav', 'navigation', 'menu', 'pages', 'sidebar', 'dropdown'],
    content: NavigatingApp,
  },
]
