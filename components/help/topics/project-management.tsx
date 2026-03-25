import type { HelpTopicData } from './index'

function TaskStatuses() {
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center gap-2"><span className="bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">Not Ready</span><span className="text-gray-400">-- prerequisites not done (locked)</span></div>
      <div className="flex items-center gap-2"><span className="bg-gray-700 text-gray-200 px-1.5 py-0.5 rounded">Ready To Start</span><span className="text-gray-400">-- prerequisites done, waiting to begin</span></div>
      <div className="flex items-center gap-2"><span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">In Progress</span><span className="text-gray-400">-- actively being worked</span></div>
      <div className="flex items-center gap-2"><span className="bg-indigo-900 text-indigo-300 px-1.5 py-0.5 rounded">Scheduled</span><span className="text-gray-400">-- work scheduled for a specific date</span></div>
      <div className="flex items-center gap-2"><span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded">Pending Resolution</span><span className="text-gray-400">-- blocked, waiting on external action</span></div>
      <div className="flex items-center gap-2"><span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded">Revision Required</span><span className="text-gray-400">-- needs rework (triggers cascade)</span></div>
      <div className="flex items-center gap-2"><span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete</span><span className="text-gray-400">-- done</span></div>
    </div>
  )
}

function UpdatingTask() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Open a project, go to the Tasks tab, and use the status dropdown on any unlocked task. When setting Pending Resolution or Revision Required, a reason dropdown appears.</p>
      <div className="border border-gray-700 rounded-lg overflow-hidden text-xs">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 border-l-2 border-l-blue-500 bg-blue-950/10">
          <span className="text-green-500 font-bold w-3 text-center">*</span>
          <span className="w-4 text-center text-gray-500">&#9654;</span>
          <span className="flex-1 text-gray-100">Scope of Work</span>
          <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">In Progress</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-l-2 border-l-red-500 bg-red-950/20">
          <span className="text-green-500 font-bold w-3 text-center">*</span>
          <span className="w-4 text-center text-gray-500">&#9654;</span>
          <span className="flex-1 text-gray-100">Build Engineering</span>
          <span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded">Pending Resolution</span>
        </div>
      </div>
    </div>
  )
}

function TaskPrerequisites() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Tasks with a lock icon are waiting on prerequisite tasks. When all prerequisites are Complete, the task auto-unlocks to <span className="bg-gray-700 text-gray-200 px-1 py-0.5 rounded text-[10px]">Ready To Start</span>. The chain flows within and across stages.</p>
      <div className="text-xs text-gray-500">Example: Engineering Approval requires Build Engineering, which requires Scope of Work.</div>
    </div>
  )
}

function RevisionCascade() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Setting a task to Revision Required resets all downstream tasks (same stage) to Not Ready. A confirmation dialog shows exactly what will reset:</p>
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 max-w-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-amber-400 text-lg">&#8617;</span>
          <span className="text-sm font-semibold text-white">Revision Required</span>
        </div>
        <p className="text-xs text-gray-300 mb-3">
          Setting <span className="text-white font-medium">Build Design</span> to Revision Required will reset 3 downstream tasks:
        </p>
        <div className="bg-gray-900 rounded-lg p-2 mb-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-200">Scope of Work</span>
            <span className="text-[10px] bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete &rarr; Not Ready</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-200">Build Engineering</span>
            <span className="text-[10px] bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">In Progress &rarr; Not Ready</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-200">Engineering Approval</span>
            <span className="text-[10px] bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Complete &rarr; Not Ready</span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <span className="px-3 py-1.5 text-xs text-gray-400 border border-gray-700 rounded-md">Cancel</span>
          <span className="px-3 py-1.5 text-xs bg-amber-700 text-white rounded-md font-medium">Reset 3 tasks &amp; continue</span>
        </div>
      </div>
    </div>
  )
}

function TaskHistory() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Click the arrow next to any task to expand its history log:</p>
      <div className="bg-gray-800 rounded-lg p-3 text-[11px]">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">History (4)</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-14">Mar 18</span>
            <span className="bg-red-900 text-red-300 px-1 py-0.5 rounded">Pending Resolution</span>
            <span className="text-red-400">MPU Review</span>
            <span className="text-gray-600 ml-auto">Greg K</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-14">Mar 15</span>
            <span className="bg-green-900 text-green-300 px-1 py-0.5 rounded">Complete</span>
            <span className="text-gray-600 ml-auto">Jen H</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-14">Mar 10</span>
            <span className="bg-blue-900 text-blue-300 px-1 py-0.5 rounded">In Progress</span>
            <span className="text-gray-600 ml-auto">Jen H</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskNotes() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Each task has its own notes section -- separate from project notes. Click the chat icon next to a task name. Notes are timestamped with the author. The icon turns green with a count badge when notes exist.</p>
      <p className="text-xs text-gray-400">You can also set a <span className="text-white font-medium">follow-up date</span> from the task notes panel. It surfaces in the Queue under Follow-ups Today.</p>
    </div>
  )
}

function DispositionWorkflow() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Controlled disposition flow ensures retention is attempted before cancellation:</p>
      <div className="flex items-center gap-2 text-xs flex-wrap mb-3">
        <span className="bg-green-900 text-green-300 px-2 py-1 rounded font-medium">Sale</span>
        <span className="text-gray-500">&rarr;</span>
        <span className="bg-purple-900 text-purple-300 px-2 py-1 rounded font-medium">Loyalty</span>
        <span className="text-gray-500">&rarr;</span>
        <span className="bg-red-900 text-red-300 px-2 py-1 rounded font-medium">Cancelled</span>
      </div>
      <p className="text-xs text-amber-400">You cannot skip from Sale directly to Cancelled. The project must go through Loyalty first.</p>
    </div>
  )
}

function StageAdvancement() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">When the last required task in a stage completes, the project auto-advances. You can also manually advance via the button in the project panel header.</p>
      <div className="space-y-2">
        <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-3 text-xs">
          <span className="text-white font-medium">PROJ-30245</span>
          <span className="ml-auto px-3 py-1.5 rounded-md bg-green-700 text-white font-medium">&rarr; Site Survey</span>
        </div>
        <div className="bg-gray-800 rounded-lg px-4 py-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-white font-medium">PROJ-30198</span>
            <span className="ml-auto px-3 py-1.5 rounded-md bg-gray-700 text-gray-500 font-medium">&rarr; Site Survey</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-400">Complete required tasks first: Welcome Call, NTP Procedure</div>
        </div>
      </div>
    </div>
  )
}

function PendingAndRevision() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-4">These are the two &quot;problem&quot; statuses. They signal that something is wrong and needs attention before the project can move forward.</p>

      {/* Pending Resolution */}
      <div className="bg-gray-800 rounded-lg p-4 mb-4 border-l-2 border-red-500">
        <div className="flex items-center gap-2 mb-2">
          <span className="bg-red-900 text-red-300 px-2 py-0.5 rounded text-xs font-medium">Pending Resolution</span>
          <span className="text-xs text-gray-500">— waiting on someone or something external</span>
        </div>
        <p className="text-xs text-gray-400 mb-3">Use when a task is <span className="text-white">blocked by something outside your control</span>. The project cannot move forward until this is resolved.</p>
        <div className="text-xs text-gray-400 space-y-1.5">
          <div className="font-medium text-gray-300 mb-1">When to use:</div>
          <div className="flex items-start gap-2">
            <span className="text-red-400 mt-0.5">&#8226;</span>
            <span>City permit was submitted but the city hasn&apos;t responded</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-400 mt-0.5">&#8226;</span>
            <span>Waiting on the customer to sign a document or provide information</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-400 mt-0.5">&#8226;</span>
            <span>Utility company hasn&apos;t processed the interconnection application</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-400 mt-0.5">&#8226;</span>
            <span>HOA review is pending</span>
          </div>
        </div>
        <div className="mt-3 bg-red-950/50 rounded px-3 py-2 text-xs text-red-300">
          <span className="font-medium">What happens:</span> A reason dropdown appears — select why it&apos;s pending. The project&apos;s blocker field is auto-set. The project shows as &quot;Blocked&quot; in Command Center and Queue.
        </div>
      </div>

      {/* Revision Required */}
      <div className="bg-gray-800 rounded-lg p-4 border-l-2 border-amber-500">
        <div className="flex items-center gap-2 mb-2">
          <span className="bg-amber-900 text-amber-300 px-2 py-0.5 rounded text-xs font-medium">Revision Required</span>
          <span className="text-xs text-gray-500">— work needs to be redone</span>
        </div>
        <p className="text-xs text-gray-400 mb-3">Use when a task&apos;s output was <span className="text-white">rejected or needs rework</span>. This triggers a cascade that resets downstream tasks.</p>
        <div className="text-xs text-gray-400 space-y-1.5">
          <div className="font-medium text-gray-300 mb-1">When to use:</div>
          <div className="flex items-start gap-2">
            <span className="text-amber-400 mt-0.5">&#8226;</span>
            <span>Design was rejected by engineering — needs a new design</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-400 mt-0.5">&#8226;</span>
            <span>City permit was denied — need to fix plans and resubmit</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-400 mt-0.5">&#8226;</span>
            <span>Inspection failed — rework needed before re-inspection</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-400 mt-0.5">&#8226;</span>
            <span>Customer requested a system change after design was complete</span>
          </div>
        </div>
        <div className="mt-3 bg-amber-950/50 rounded px-3 py-2 text-xs text-amber-300">
          <span className="font-medium">What happens:</span> A confirmation dialog appears showing which downstream tasks will reset to &quot;Not Ready.&quot; Corresponding auto-populated dates are cleared. The project may need to redo those tasks from scratch.
        </div>
      </div>

      {/* Key difference */}
      <div className="mt-4 bg-gray-800/50 rounded-lg px-4 py-3 text-xs">
        <div className="text-white font-medium mb-1">Key difference:</div>
        <div className="text-gray-400"><span className="text-red-300">Pending Resolution</span> = waiting on someone else. <span className="text-amber-300">Revision Required</span> = our work needs to be redone.</div>
      </div>
    </div>
  )
}

export const projectManagementTopics: HelpTopicData[] = [
  {
    id: 'task-statuses',
    title: 'Task Statuses',
    description: 'All 7 statuses with colored badges',
    category: 'Project Management',
    keywords: ['task', 'status', 'not ready', 'in progress', 'complete', 'pending', 'revision', 'scheduled'],
    relatedTopics: ['updating-task', 'stuck-tasks'],
    content: TaskStatuses,
  },
  {
    id: 'updating-task',
    title: 'Updating a Task',
    description: 'Status dropdown and reason selection',
    category: 'Project Management',
    keywords: ['update', 'change', 'task', 'status', 'dropdown', 'reason'],
    relatedTopics: ['task-statuses', 'revision-cascade'],
    content: UpdatingTask,
  },
  {
    id: 'task-prerequisites',
    title: 'Task Prerequisites',
    description: 'Chain, auto-unlock when prereqs complete',
    category: 'Project Management',
    keywords: ['prerequisite', 'prereq', 'lock', 'unlock', 'chain', 'dependency'],
    relatedTopics: ['task-statuses', 'stage-advancement'],
    content: TaskPrerequisites,
  },
  {
    id: 'pending-and-revision',
    title: 'Pending Resolution & Revision Required',
    description: 'When and how to use the two problem statuses',
    category: 'Project Management',
    keywords: ['pending', 'resolution', 'revision', 'required', 'blocked', 'rework', 'stuck', 'reason', 'cascade'],
    relatedTopics: ['task-statuses', 'revision-cascade', 'stuck-tasks'],
    content: PendingAndRevision,
  },
  {
    id: 'revision-cascade',
    title: 'Revision Cascade',
    description: 'Downstream reset with confirmation dialog',
    category: 'Project Management',
    keywords: ['revision', 'cascade', 'reset', 'downstream', 'not ready', 'rework'],
    relatedTopics: ['pending-and-revision', 'task-prerequisites'],
    content: RevisionCascade,
  },
  {
    id: 'task-history',
    title: 'Task History',
    description: 'Inline expandable change history',
    category: 'Project Management',
    keywords: ['history', 'log', 'change', 'audit', 'timeline', 'who changed'],
    content: TaskHistory,
  },
  {
    id: 'task-notes',
    title: 'Task Notes & Follow-ups',
    description: 'Per-task notes with timestamps and follow-up dates',
    category: 'Project Management',
    keywords: ['task', 'notes', 'follow-up', 'follow up', 'date', 'reminder'],
    relatedTopics: ['queue-page', 'adding-notes'],
    content: TaskNotes,
  },
  {
    id: 'disposition-workflow',
    title: 'Disposition Workflow',
    description: 'Sale, Loyalty, Cancelled, In Service',
    category: 'Project Management',
    keywords: ['disposition', 'sale', 'loyalty', 'cancelled', 'in service', 'workflow', 'retention'],
    content: DispositionWorkflow,
  },
  {
    id: 'stage-advancement',
    title: 'Stage Advancement',
    description: 'Auto-advance and manual stage progression',
    category: 'Project Management',
    keywords: ['stage', 'advance', 'next', 'pipeline', 'progression', 'auto'],
    relatedTopics: ['task-prerequisites', 'automations'],
    content: StageAdvancement,
  },
]
