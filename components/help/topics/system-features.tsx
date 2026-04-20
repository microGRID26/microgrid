import type { HelpTopicData } from './index'

function Automations() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">When task statuses change, a chain of automations fires:</p>
      <div className="bg-gray-800/50 rounded-lg p-4 mb-3">
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="bg-green-900 text-green-300 px-2 py-1 rounded font-medium">Task Complete</span>
          <span className="text-gray-500">&rarr;</span>
          <span className="bg-blue-900 text-blue-300 px-2 py-1 rounded font-medium">Date Populated</span>
          <span className="text-gray-500">&rarr;</span>
          <span className="bg-amber-900 text-amber-300 px-2 py-1 rounded font-medium">Funding Eligible</span>
          <span className="text-gray-500">&rarr;</span>
          <span className="bg-green-900 text-green-300 px-2 py-1 rounded font-medium">Stage Advanced</span>
        </div>
      </div>
      <div className="space-y-1 text-xs">
        {[
          'Auto-populate project dates (11 task-to-date mappings)',
          'Auto-advance stage when all required tasks complete',
          'Auto-detect blockers on Pending Resolution',
          'Auto-clear blockers when stuck tasks resolve',
          'M2 Eligible on Install Complete, M3 on PTO',
          'Track task duration (In Progress to Complete)',
          'Auto-set dependent tasks to Ready To Start',
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

function BulkOperations() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Select multiple projects on Pipeline or Queue for bulk actions. Click Select toggle, pick projects (or Select All), then choose an action:</p>
      <div className="space-y-1 text-xs">
        {[
          'Reassign PM -- change PM on all selected projects',
          'Set/Clear Blocker -- apply or remove blockers in bulk',
          'Change Disposition -- set Sale, Loyalty, or Cancelled',
          'Set Follow-up Date -- schedule follow-ups in bulk',
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-gray-400">
            <span className="text-gray-600 mt-0.5">&bull;</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-2">Every change is logged to audit_log. A progress bar shows during execution.</p>
    </div>
  )
}

function ProjectAdders() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">The Info tab includes an Adders section for extras (EV charger, critter guard, ground mount). Each adder shows name, quantity, and price. In edit mode, add new adders and delete existing ones.</p>
    </div>
  )
}

function BlockerDetection() {
  return (
    <div>
      <div className="space-y-2 text-xs">
        <div className="flex items-start gap-2">
          <span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded flex-shrink-0">Pending Resolution</span>
          <span className="text-gray-400">Auto-sets the project blocker to the task reason.</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded flex-shrink-0">Resolved</span>
          <span className="text-gray-400">Auto-clears the blocker (only if auto-set, not manually set).</span>
        </div>
      </div>
    </div>
  )
}

function AskAtlasWidget() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Click the sparkle button in the bottom-right on any page (except the login screen) to open Ask Atlas. It answers questions about MicroGRID using the internal knowledge base, with citations and a confidence level.</p>
      <div className="space-y-2 text-xs">
        <div className="bg-gray-800 rounded-lg px-4 py-3 border-l-2 border-green-500">
          <span className="text-green-400 font-bold">Ask Tab</span>
          <p className="text-gray-400 mt-1">Type a question (minimum 3 chars) and submit. Atlas returns an answer, the KB entries it cited (with owner and similarity), and a confidence label -- high, medium, or low. Give a thumbs-up or thumbs-down so answers can be tuned over time.</p>
        </div>
        <div className="bg-gray-800 rounded-lg px-4 py-3 border-l-2 border-amber-500">
          <span className="text-amber-400 font-bold">Escalate to Greg</span>
          <p className="text-gray-400 mt-1">If Atlas isn&apos;t confident, an Escalate option appears. Add an optional note and send the question to Greg&apos;s action queue. You&apos;ll get the reply back in the Inbox tab when he answers.</p>
        </div>
        <div className="bg-gray-800 rounded-lg px-4 py-3 border-l-2 border-blue-500">
          <span className="text-blue-400 font-bold">Inbox Tab</span>
          <p className="text-gray-400 mt-1">Answers to your escalated questions land here. The widget polls every 2 minutes in the background, so new replies show up automatically. The widget opens to the Inbox tab when there&apos;s unread mail.</p>
        </div>
        <div className="bg-gray-800 rounded-lg px-4 py-3 border-l-2 border-purple-500">
          <span className="text-purple-400 font-bold">Citations & Confidence</span>
          <p className="text-gray-400 mt-1">Each answer lists the KB entries it pulled from with owner and source-of-truth. Low confidence means the KB doesn&apos;t have a strong match -- treat the answer as a guess and escalate if it matters.</p>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-3">KB entries are curated by tier: sales (Mark/Paul), employee (ops leads). Ask Atlas pulls from the tier appropriate to your role.</p>
    </div>
  )
}

function OrgSwitcher() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">If you belong to more than one organization, the Org Switcher appears in the nav bar. Click it to switch between orgs -- all data reloads automatically.</p>
      <div className="space-y-2 text-xs">
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-green-400 font-medium">Switching:</span>
          <span className="text-gray-400 ml-1">Click the org name in the nav bar, select a different org. All cached data clears and reloads for the new org.</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-blue-400 font-medium">Org Types:</span>
          <span className="text-gray-400 ml-1">Platform (purple), EPC (green), Sales (blue), Engineering (amber), Supply (cyan), Customer (gray)</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-purple-400 font-medium">Data Isolation:</span>
          <span className="text-gray-400 ml-1">Each org sees only its own projects, crews, vendors, and warehouse stock. Platform users can see across all orgs.</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-amber-400 font-medium">Keyboard Navigation:</span>
          <span className="text-gray-400 ml-1">Arrow keys to navigate, Enter/Space to select, Escape to close</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-3">Only visible when you belong to 2+ organizations. Your selection is saved in localStorage.</p>
    </div>
  )
}

export const systemFeaturesTopics: HelpTopicData[] = [
  {
    id: 'automations',
    title: 'Automation Engine',
    description: 'Task, date, funding, stage chain',
    category: 'System Features',
    keywords: ['automation', 'auto', 'trigger', 'chain', 'date', 'stage', 'funding', 'engine'],
    relatedTopics: ['funding-triggers', 'stage-advancement', 'blocker-detection'],
    content: Automations,
  },
  {
    id: 'bulk-operations',
    title: 'Bulk Operations',
    description: 'Multi-select and bulk actions',
    category: 'System Features',
    keywords: ['bulk', 'multi', 'select', 'batch', 'reassign', 'blocker', 'disposition'],
    tryItLink: '/pipeline',
    relatedTopics: ['queue-page'],
    content: BulkOperations,
  },
  {
    id: 'project-adders',
    title: 'Project Adders',
    description: 'Extras like EV charger, critter guard',
    category: 'System Features',
    keywords: ['adder', 'extra', 'ev charger', 'critter guard', 'ground mount', 'price'],
    content: ProjectAdders,
  },
  {
    id: 'blocker-detection',
    title: 'Blocker Detection',
    description: 'Auto-set and auto-clear blockers',
    category: 'System Features',
    keywords: ['blocker', 'auto', 'detect', 'set', 'clear', 'pending', 'resolution'],
    relatedTopics: ['automations', 'stuck-tasks'],
    content: BlockerDetection,
  },
  {
    id: 'ask-atlas-widget',
    title: 'Ask Atlas Widget',
    description: 'In-app AI Q&A with citations, confidence, and escalation to Greg',
    category: 'System Features',
    keywords: ['atlas', 'ask', 'ai', 'chat', 'widget', 'help', 'kb', 'knowledge base', 'citation', 'confidence', 'escalate', 'inbox', 'question'],
    relatedTopics: ['atlas-reports'],
    content: AskAtlasWidget,
  },
  {
    id: 'org-switcher',
    title: 'Organization Switching',
    description: 'Switch between organizations for multi-org users',
    category: 'System Features',
    keywords: ['org', 'organization', 'switch', 'multi-tenant', 'company', 'epc', 'platform'],
    relatedTopics: ['system-page', 'permission-matrix'],
    content: OrgSwitcher,
  },
]
