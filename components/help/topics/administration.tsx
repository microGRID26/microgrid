import type { HelpTopicData } from './index'

function AdminPortal() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Click the gear icon in the nav bar. Admin and Super Admin roles only. Sections include:</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          'Users -- CRUD, roles, active status',
          'Crews -- 5 crews, 10 member roles each',
          'AHJ -- 1,633 TX AHJ records',
          'Utilities -- 203 utility companies',
          'HOA -- 421 HOA records',
          'Financiers -- 10 financing companies',
          'SLA -- Editable thresholds per stage',
          'Equipment -- Catalog management',
          'Vendors -- Supplier/contractor directory',
          'Feedback -- User-submitted bugs/features',
          'Audit Trail -- Session + change tracking',
          'Email Onboarding -- 30-day training series',
        ].map((item, i) => (
          <div key={i} className="bg-gray-800 rounded-md px-3 py-2 text-gray-400">{item}</div>
        ))}
      </div>
    </div>
  )
}

function UserManagement() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Full CRUD for team members. Fields: name, email, department, position, role, active status, avatar color. Use Add User to create accounts. Roles control access level throughout the system.</p>
    </div>
  )
}

function PermissionMatrix() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Role-based permissions:</p>
      <div className="border border-gray-700 rounded-lg overflow-hidden text-xs">
        <div className="grid grid-cols-4 gap-0 px-3 py-2 bg-gray-800/50 border-b border-gray-700">
          <span className="text-gray-500 font-medium">Action</span>
          <span className="text-gray-500 font-medium text-center">User</span>
          <span className="text-gray-500 font-medium text-center">Admin</span>
          <span className="text-gray-500 font-medium text-center">Super</span>
        </div>
        {[
          { action: 'Create/edit projects', user: true, admin: true, superA: true },
          { action: 'Update tasks & notes', user: true, admin: true, superA: true },
          { action: 'Admin portal', user: false, admin: true, superA: true },
          { action: 'Delete projects', user: false, admin: false, superA: true },
          { action: 'Manage users', user: false, admin: true, superA: true },
        ].map(r => (
          <div key={r.action} className="grid grid-cols-4 gap-0 px-3 py-1.5 border-b border-gray-800/50">
            <span className="text-gray-300">{r.action}</span>
            <span className="text-center">{r.user ? <span className="text-green-400">&#10003;</span> : <span className="text-gray-600">--</span>}</span>
            <span className="text-center">{r.admin ? <span className="text-green-400">&#10003;</span> : <span className="text-gray-600">--</span>}</span>
            <span className="text-center">{r.superA ? <span className="text-green-400">&#10003;</span> : <span className="text-gray-600">--</span>}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EdgeIntegration() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">
        NOVA syncs project data and funding events bidirectionally with the EDGE Portal via webhooks.
        All sync activity is logged and visible in the Admin portal.
      </p>
      <div className="space-y-2 text-xs">
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-blue-400 font-medium">Outbound (NOVA → EDGE):</span>
          <span className="text-gray-400 ml-1">Project creation, stage changes, install complete, PTO received, in service, funding milestones</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-purple-400 font-medium">Inbound (EDGE → NOVA):</span>
          <span className="text-gray-400 ml-1">M2/M3 funded, funding rejected, milestone status updates</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-green-400 font-medium">Admin panel:</span>
          <span className="text-gray-400 ml-1">Connection status, manual project sync, recent sync log (last 20 events)</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-amber-400 font-medium">Security:</span>
          <span className="text-gray-400 ml-1">HMAC-SHA256 signed payloads, timing-safe verification</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-3">Requires NEXT_PUBLIC_EDGE_WEBHOOK_URL and EDGE_WEBHOOK_SECRET environment variables.</p>
    </div>
  )
}

function EquipmentManager() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">Admin catalog CRUD for the 2,517-item equipment database. Add panels, inverters, batteries, and optimizers with manufacturer, model, wattage, and specifications. Equipment added here appears in project panel autocomplete dropdowns.</p>
    </div>
  )
}

function VendorManagement() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Track suppliers and contractors with contact info, equipment types, lead times, and payment terms. Accessible from the nav bar or Admin portal.</p>
      <div className="space-y-2 text-xs">
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-blue-400 font-medium">Categories:</span>
          <span className="text-gray-400 ml-1">Manufacturer, Distributor, Subcontractor, Other</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-purple-400 font-medium">Equipment Types:</span>
          <span className="text-gray-400 ml-1">Modules, Inverters, Batteries, Racking, Electrical, Other</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-green-400 font-medium">Fields:</span>
          <span className="text-gray-400 ml-1">Name, contact info, address, website, lead time (days), payment terms, notes</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-amber-400 font-medium">Permissions:</span>
          <span className="text-gray-400 ml-1">All users can view/add/edit. Only Super Admins can delete.</span>
        </div>
      </div>
    </div>
  )
}

function EmailOnboarding() {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">30-day automated training email series for new NOVA users. Managed in the Admin portal under "Email Onboarding".</p>
      <div className="space-y-2 text-xs">
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-green-400 font-medium">Enroll All Users:</span>
          <span className="text-gray-400 ml-1">Enrolls every active user not already in the series and sends Day 1 immediately</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-blue-400 font-medium">Trigger Daily Send:</span>
          <span className="text-gray-400 ml-1">Manually fires the daily email job (auto-runs weekdays 8 AM CT)</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-amber-400 font-medium">Pause / Resume:</span>
          <span className="text-gray-400 ml-1">Pause or resume an individual user's training series</span>
        </div>
        <div className="bg-gray-800 rounded-md px-3 py-2">
          <span className="text-purple-400 font-medium">Send Announcement:</span>
          <span className="text-gray-400 ml-1">One-off email to all users or a specific role</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-3">4 weeks: Foundations (1-7), Operations (8-14), Power Features (15-21), Mastery (22-30).</p>
    </div>
  )
}

export const administrationTopics: HelpTopicData[] = [
  {
    id: 'admin-portal',
    title: 'Admin Portal',
    description: 'Access via gear icon, admin roles only',
    category: 'Administration',
    keywords: ['admin', 'portal', 'gear', 'settings', 'configuration', 'manage'],
    tryItLink: '/admin',
    relatedTopics: ['user-management', 'permission-matrix'],
    content: AdminPortal,
  },
  {
    id: 'user-management',
    title: 'User Management',
    description: 'CRUD users, assign roles, toggle active',
    category: 'Administration',
    keywords: ['user', 'create', 'edit', 'delete', 'role', 'active', 'team'],
    relatedTopics: ['admin-portal', 'understanding-roles'],
    content: UserManagement,
  },
  {
    id: 'permission-matrix',
    title: 'Permission Matrix',
    description: 'Who can do what by role',
    category: 'Administration',
    keywords: ['permission', 'role', 'access', 'matrix', 'user', 'admin', 'super'],
    relatedTopics: ['understanding-roles', 'admin-portal'],
    content: PermissionMatrix,
  },
  {
    id: 'equipment-manager',
    title: 'Equipment Manager',
    description: 'Admin catalog CRUD for equipment',
    category: 'Administration',
    keywords: ['equipment', 'catalog', 'admin', 'panel', 'inverter', 'battery', 'manage'],
    relatedTopics: ['equipment-catalog', 'admin-portal'],
    content: EquipmentManager,
  },
  {
    id: 'edge-integration',
    title: 'EDGE Integration',
    description: 'Bidirectional webhook sync between NOVA and EDGE Portal',
    category: 'Administration',
    keywords: ['edge', 'integration', 'webhook', 'sync', 'funding', 'portal', 'outbound', 'inbound'],
    tryItLink: '/admin',
    relatedTopics: ['admin-portal', 'funding-milestones'],
    content: EdgeIntegration,
  },
  {
    id: 'vendor-management',
    title: 'Vendor Management',
    description: 'Track suppliers, contractors, lead times, and equipment types',
    category: 'Administration',
    keywords: ['vendor', 'supplier', 'contractor', 'manufacturer', 'distributor', 'lead time', 'payment terms', 'equipment'],
    tryItLink: '/vendors',
    relatedTopics: ['admin-portal', 'equipment-manager', 'materials-tab'],
    content: VendorManagement,
  },
  {
    id: 'email-onboarding',
    title: 'Email Onboarding',
    description: '30-day automated training email series for new users',
    category: 'Administration',
    keywords: ['email', 'onboarding', 'training', 'series', 'enroll', 'resend', 'announcement', 'daily'],
    tryItLink: '/admin',
    relatedTopics: ['admin-portal', 'user-management'],
    content: EmailOnboarding,
  },
]
