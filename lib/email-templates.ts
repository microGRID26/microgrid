// ── Email Template Helpers ────────────────────────────────────────────────────

/** Escape HTML special characters to prevent XSS in email templates */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://microgrid-crm.vercel.app'

function layout(day: number, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:12px;border:1px solid #1f2937;overflow:hidden;">
  <!-- Header -->
  <tr><td style="background:#111827;padding:24px 32px 16px;border-bottom:1px solid #1f2937;">
    <table width="100%"><tr>
      <td><span style="color:#1D9E75;font-size:20px;font-weight:700;letter-spacing:-0.5px;">MicroGRID CRM</span></td>
      <td align="right"><span style="color:#6b7280;font-size:11px;">Day ${day} of 30</span></td>
    </tr></table>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:28px 32px 32px;color:#e5e7eb;font-size:14px;line-height:1.6;">
    ${body}
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:16px 32px;background:#0d1117;border-top:1px solid #1f2937;">
    <table width="100%"><tr>
      <td><span style="color:#4b5563;font-size:11px;">MicroGRID Energy &middot; MicroGRID CRM</span></td>
      <td align="right"><span style="color:#4b5563;font-size:11px;">Day ${day} of 30</span></td>
    </tr></table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function ctaButton(text: string, path: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
<tr><td style="background:#1D9E75;border-radius:8px;padding:12px 28px;">
  <a href="${BASE_URL}${path}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">${text}</a>
</td></tr></table>`
}

function sectionBadge(label: string, color: string = '#1D9E75'): string {
  return `<span style="display:inline-block;background:${color}20;color:${color};font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;border:1px solid ${color}40;margin:2px 4px 2px 0;">${label}</span>`
}

function visualBox(content: string): string {
  return `<div style="background:#0d1117;border:1px solid #1f2937;border-radius:8px;padding:16px 20px;margin:16px 0;">
${content}
</div>`
}

// ── 30-Day Email Series ──────────────────────────────────────────────────────

export interface EmailTemplate {
  subject: string
  html: string
}

type TemplateFactory = (name: string) => EmailTemplate

const templates: Record<number, TemplateFactory> = {

  // ── WEEK 1: Foundations ─────────────────────────────────────────────────────

  1: (name) => ({
    subject: 'Welcome to MicroGRID CRM — Your Command Center',
    html: layout(1, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Welcome to MicroGRID CRM, ${name}!</h2>
      <p>Your Command Center is your morning dashboard. It auto-selects your projects and surfaces what needs attention first -- personal stats, action items, and a sortable project table.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:8px;">YOUR MORNING DASHBOARD</div>
        <div style="display:flex;gap:12px;margin-bottom:12px;">
          <div style="flex:1;background:#1f293750;border-radius:6px;padding:8px;text-align:center;">
            <div style="color:#6b7280;font-size:10px;">ACTIVE</div>
            <div style="color:#ffffff;font-size:18px;font-weight:700;">24</div>
          </div>
          <div style="flex:1;background:#1f293750;border-radius:6px;padding:8px;text-align:center;">
            <div style="color:#6b7280;font-size:10px;">PORTFOLIO</div>
            <div style="color:#1D9E75;font-size:18px;font-weight:700;">$1.2M</div>
          </div>
          <div style="flex:1;background:#1f293750;border-radius:6px;padding:8px;text-align:center;">
            <div style="color:#6b7280;font-size:10px;">INSTALLS</div>
            <div style="color:#3b82f6;font-size:18px;font-weight:700;">3</div>
          </div>
        </div>
        ${sectionBadge('4 Follow-ups Due', '#f59e0b')}
        ${sectionBadge('3 Blocked', '#ef4444')}
        ${sectionBadge('5 Stuck Tasks', '#ef4444')}
      `)}
      <p>Action items expand to show each follow-up, blocker, or stuck task. The pipeline snapshot and project table give you the full picture below.</p>
      ${ctaButton('Open Command Center →', '/command')}
    `),
  }),

  2: (name) => ({
    subject: 'Your Queue — What Needs Attention Today',
    html: layout(2, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Your personal task list, ${name}</h2>
      <p>The Queue page shows only your projects, organized by what action is needed. Follow-ups, permits ready for pickup, blocked projects — all in one view.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">QUEUE SECTIONS</div>
        <div style="color:#f59e0b;font-size:13px;margin-bottom:6px;">&#9733; Follow-ups Today <span style="background:#f59e0b20;color:#f59e0b;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:4px;">3</span></div>
        <div style="color:#3b82f6;font-size:13px;margin-bottom:6px;">&#9635; City Permit Ready <span style="background:#3b82f620;color:#3b82f6;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:4px;">5</span></div>
        <div style="color:#ef4444;font-size:13px;margin-bottom:6px;">&#9888; Blocked <span style="background:#ef444420;color:#ef4444;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:4px;">2</span></div>
        <div style="color:#1D9E75;font-size:13px;">&#10004; Active <span style="background:#1D9E7520;color:#1D9E75;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:4px;">18</span></div>
      `)}
      <p>Set your PM filter once and it remembers your selection. Each section collapses for a cleaner view.</p>
      ${ctaButton('Open Your Queue →', '/queue')}
    `),
  }),

  3: (name) => ({
    subject: 'Opening a Project — The Project Panel',
    html: layout(3, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Everything about a project, one click away</h2>
      <p>Click any project card to open the Project Panel. Five tabs give you complete visibility: Overview, Tasks, Notes, Files, and BOM.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">PROJECT PANEL TABS</div>
        <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#1D9E75;font-size:12px;font-weight:600;padding:6px 0;border-bottom:2px solid #1D9E75;text-align:center;">Info</td>
          <td style="color:#6b7280;font-size:12px;padding:6px 0;text-align:center;">Tasks</td>
          <td style="color:#6b7280;font-size:12px;padding:6px 0;text-align:center;">Notes</td>
          <td style="color:#6b7280;font-size:12px;padding:6px 0;text-align:center;">Files</td>
          <td style="color:#6b7280;font-size:12px;padding:6px 0;text-align:center;">BOM</td>
        </tr></table>
      `)}
      <p>The Info tab shows all project details. Click "Edit" to update equipment, financier, AHJ, and more. Changes are audited automatically.</p>
      ${ctaButton('Try Opening a Project →', '/pipeline')}
    `),
  }),

  4: (name) => ({
    subject: 'Task Management — Moving Projects Forward',
    html: layout(4, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Tasks drive your pipeline</h2>
      <p>Each stage has defined tasks with prerequisites. Mark a task Complete and MicroGRID CRM automatically advances the project, sets dates, and unlocks the next tasks.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">TASK AUTOMATION</div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Site Survey Complete</span> <span style="color:#6b7280;font-size:11px;">→ sets survey_date</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Install Complete</span> <span style="color:#6b7280;font-size:11px;">→ sets install_date, M2 Eligible</span></div>
        <div><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">PTO Received</span> <span style="color:#6b7280;font-size:11px;">→ sets pto_date, M3 Eligible</span></div>
      `)}
      <p>Set a task to "Revision Required" and all downstream tasks reset automatically. Blockers appear across the platform instantly.</p>
      ${ctaButton('View Tasks on a Project →', '/pipeline')}
    `),
  }),

  5: (name) => ({
    subject: 'Adding Notes and @Mentions',
    html: layout(5, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Communicate right inside MicroGRID CRM</h2>
      <p>Add timestamped notes to any project or specific task. Type <span style="color:#1D9E75;font-weight:600;">@</span> to mention a team member — they will get an instant notification.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:8px;">PROJECT NOTES</div>
        <div style="margin-bottom:8px;padding:8px 12px;background:#1f293750;border-radius:6px;">
          <span style="color:#6b7280;font-size:11px;">Mar 25, 2:30 PM · Sarah K.</span>
          <div style="color:#e5e7eb;font-size:13px;margin-top:4px;">Called AHJ — permit ready for pickup. <span style="color:#1D9E75;font-weight:600;">@Mike</span> can you schedule?</div>
        </div>
      `)}
      <p>Notes are also available per-task in the Tasks tab. The notification bell in the nav bar shows unread mentions.</p>
      ${ctaButton('Try Adding a Note →', '/pipeline')}
    `),
  }),

  6: (name) => ({
    subject: 'Search and Filter — Find Any Project',
    html: layout(6, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Find any project in seconds</h2>
      <p>Every page has search that matches project name, ID, city, and address simultaneously. Combine with PM, stage, and status filters to narrow results instantly.</p>
      ${visualBox(`
        <div style="background:#1f2937;border-radius:6px;padding:10px 14px;display:flex;align-items:center;">
          <span style="color:#6b7280;font-size:13px;">&#128269;</span>
          <span style="color:#9ca3af;font-size:13px;margin-left:8px;">Search by name, ID, city, address...</span>
        </div>
        <div style="margin-top:10px;">
          ${sectionBadge('PM: Sarah K.')}
          ${sectionBadge('Stage: Permit')}
          ${sectionBadge('Financier: Mosaic')}
        </div>
      `)}
      <p>Pipeline, Queue, and Funding pages all support the same search and filter pattern. Results update as you type.</p>
      ${ctaButton('Search Your Projects →', '/pipeline')}
    `),
  }),

  7: (name) => ({
    subject: 'Week 1 Recap — You\'re a MicroGRID CRM Pro',
    html: layout(7, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Week 1 complete! Nice work, ${name}.</h2>
      <p>Here is what you have learned so far:</p>
      ${visualBox(`
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Command Center — your morning dashboard with stats and action items</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Queue — your personal task-based worklist</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Project Panel — full project detail in one view</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Task Management — automations that save you time</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Notes and @Mentions — in-app communication</span></div>
        <div><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Search and Filter — find anything instantly</span></div>
      `)}
      <p>Next week: Funding, Scheduling, Equipment, and Inventory. You are building real momentum.</p>
      ${ctaButton('Keep Going →', '/command')}
    `),
  }),

  // ── WEEK 2: Operations ──────────────────────────────────────────────────────

  8: (name) => ({
    subject: 'Funding Milestones — M1, M2, M3',
    html: layout(8, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Track every dollar</h2>
      <p>The Funding page tracks three milestones per project: M1 (contract), M2 (install complete), and M3 (PTO). Sort by any column to find what needs action.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">FUNDING MILESTONES</div>
        <table width="100%" cellpadding="4" cellspacing="0" style="font-size:12px;">
        <tr style="color:#6b7280;border-bottom:1px solid #1f2937;">
          <td>Project</td><td>M1</td><td>M2</td><td>M3</td>
        </tr>
        <tr style="color:#e5e7eb;">
          <td>PROJ-00142</td>
          <td>${sectionBadge('Funded', '#1D9E75')}</td>
          <td>${sectionBadge('Sub', '#3b82f6')}</td>
          <td>${sectionBadge('—', '#6b7280')}</td>
        </tr>
        </table>
      `)}
      <p>M2 and M3 eligibility are set automatically when Install Complete and PTO tasks are marked done.</p>
      ${ctaButton('View Funding Dashboard →', '/funding')}
    `),
  }),

  9: (name) => ({
    subject: 'The Schedule Page — Crew Assignments',
    html: layout(9, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Coordinate your crews</h2>
      <p>The Schedule page shows survey, install, inspection, and service appointments on a calendar view. Each crew is color-coded for quick scanning.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">SCHEDULE VIEW</div>
        <div style="margin-bottom:6px;"><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:3px;margin-right:8px;"></span><span style="color:#e5e7eb;font-size:13px;">Mon 3/24 — Crew Alpha — Survey — PROJ-00331</span></div>
        <div style="margin-bottom:6px;"><span style="display:inline-block;width:10px;height:10px;background:#1D9E75;border-radius:3px;margin-right:8px;"></span><span style="color:#e5e7eb;font-size:13px;">Tue 3/25 — Crew Bravo — Install — PROJ-00215</span></div>
        <div><span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:3px;margin-right:8px;"></span><span style="color:#e5e7eb;font-size:13px;">Wed 3/26 — Crew Charlie — Inspection — PROJ-00198</span></div>
      `)}
      <p>Filter by crew, job type, or date range. Crew details show license holders, electricians, and team members.</p>
      ${ctaButton('View Schedule →', '/schedule')}
    `),
  }),

  10: (name) => ({
    subject: 'Equipment Catalog — Smart Dropdowns',
    html: layout(10, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Standardized equipment selection</h2>
      <p>When editing a project, module, inverter, and battery fields use smart dropdowns populated from the Equipment Catalog. No more typos or inconsistent names.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">EQUIPMENT DROPDOWN</div>
        <div style="background:#1f2937;border-radius:6px;padding:8px 12px;margin-bottom:4px;">
          <span style="color:#e5e7eb;font-size:13px;">Module: REC Alpha Pure 430W</span>
        </div>
        <div style="background:#1f2937;border-radius:6px;padding:8px 12px;margin-bottom:4px;">
          <span style="color:#e5e7eb;font-size:13px;">Inverter: Enphase IQ8M-72</span>
        </div>
        <div style="background:#1f2937;border-radius:6px;padding:8px 12px;">
          <span style="color:#e5e7eb;font-size:13px;">Battery: Tesla Powerwall 3</span>
        </div>
      `)}
      <p>Admins manage the catalog from the Admin portal. Equipment entries include wattage, manufacturer, and model details.</p>
      ${ctaButton('Edit a Project →', '/pipeline')}
    `),
  }),

  11: (name) => ({
    subject: 'Inventory — Track Project Materials',
    html: layout(11, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Know what every project needs</h2>
      <p>The Inventory page tracks materials per project: what has been ordered, what has been delivered, and what is still outstanding. Each material links to a vendor and PO.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">PROJECT MATERIALS</div>
        <div style="margin-bottom:6px;">
          ${sectionBadge('Delivered', '#1D9E75')} <span style="color:#e5e7eb;font-size:13px;">24x REC Alpha 430W</span>
        </div>
        <div style="margin-bottom:6px;">
          ${sectionBadge('Ordered', '#3b82f6')} <span style="color:#e5e7eb;font-size:13px;">1x Enphase IQ8M-72</span>
        </div>
        <div>
          ${sectionBadge('Needed', '#f59e0b')} <span style="color:#e5e7eb;font-size:13px;">1x Tesla Powerwall 3</span>
        </div>
      `)}
      <p>Material statuses update automatically when linked purchase orders progress. Filter by project, status, or vendor.</p>
      ${ctaButton('View Inventory →', '/inventory')}
    `),
  }),

  12: (name) => ({
    subject: 'Purchase Orders — Order to Delivery',
    html: layout(12, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Track every purchase order</h2>
      <p>Create POs linked to projects, add line items, and track status from Draft through Delivered. Each PO has a unique number and full audit trail.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">PO LIFECYCLE</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${sectionBadge('Draft', '#6b7280')}
          <span style="color:#4b5563;font-size:11px;padding:4px 0;">→</span>
          ${sectionBadge('Submitted', '#3b82f6')}
          <span style="color:#4b5563;font-size:11px;padding:4px 0;">→</span>
          ${sectionBadge('Confirmed', '#8b5cf6')}
          <span style="color:#4b5563;font-size:11px;padding:4px 0;">→</span>
          ${sectionBadge('Shipped', '#f59e0b')}
          <span style="color:#4b5563;font-size:11px;padding:4px 0;">→</span>
          ${sectionBadge('Delivered', '#1D9E75')}
        </div>
      `)}
      <p>Track expected delivery dates, shipping info, and total amounts. POs connect materials to vendors for a complete supply chain view.</p>
      ${ctaButton('View Purchase Orders →', '/inventory')}
    `),
  }),

  13: (name) => ({
    subject: 'Warehouse — BOS Stock Management',
    html: layout(13, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Balance-of-system at your fingertips</h2>
      <p>The Warehouse section tracks BOS stock levels: rails, clamps, conduit, wire, and more. Checkout materials to projects and track reorder points.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">WAREHOUSE STOCK</div>
        <table width="100%" cellpadding="4" cellspacing="0" style="font-size:12px;">
        <tr style="color:#6b7280;"><td>Item</td><td>On Hand</td><td>Reorder</td><td>Status</td></tr>
        <tr style="color:#e5e7eb;"><td>IronRidge Rail 14ft</td><td>42</td><td>20</td><td>${sectionBadge('OK', '#1D9E75')}</td></tr>
        <tr style="color:#e5e7eb;"><td>MC4 Connectors</td><td>8</td><td>50</td><td>${sectionBadge('Low', '#ef4444')}</td></tr>
        </table>
      `)}
      <p>Transactions are logged: checkout, check-in, adjustments, and recounts. Every movement has a timestamp and user.</p>
      ${ctaButton('View Warehouse →', '/inventory')}
    `),
  }),

  14: (name) => ({
    subject: 'Week 2 Recap — Inventory Master',
    html: layout(14, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Two weeks down, ${name}!</h2>
      <p>This week you explored the operational backbone of MicroGRID CRM:</p>
      ${visualBox(`
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Funding — M1/M2/M3 milestone tracking</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Schedule — crew assignments and calendar</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Equipment Catalog — standardized selections</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Inventory — per-project material tracking</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Purchase Orders — order lifecycle management</span></div>
        <div><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Warehouse — BOS stock and reorder management</span></div>
      `)}
      <p>Next week: Work Orders, Vendors, Change Orders, Documents, Atlas AI, and Analytics. The power features are coming.</p>
      ${ctaButton('Keep Exploring →', '/command')}
    `),
  }),

  // ── WEEK 3: Power Features ──────────────────────────────────────────────────

  15: (name) => ({
    subject: 'Work Orders — Field Checklists',
    html: layout(15, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Structured field operations</h2>
      <p>Work Orders give your crews structured checklists for every job. Track time on site, materials used, and customer signatures — all linked to the project.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">WORK ORDER WO-0142</div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#9745;</span> <span style="color:#e5e7eb;font-size:13px;">Verify panel layout matches design</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#9745;</span> <span style="color:#e5e7eb;font-size:13px;">Install racking and rails</span></div>
        <div style="margin-bottom:6px;"><span style="color:#6b7280;">&#9744;</span> <span style="color:#e5e7eb;font-size:13px;">Run conduit and wire</span></div>
        <div><span style="color:#6b7280;">&#9744;</span> <span style="color:#e5e7eb;font-size:13px;">Final electrical connections</span></div>
      `)}
      <p>Each checklist item can include notes and photos. Work orders track priority, crew assignment, and scheduling.</p>
      ${ctaButton('View Work Orders →', '/work-orders')}
    `),
  }),

  16: (name) => ({
    subject: 'Vendors — Manage Your Suppliers',
    html: layout(16, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Your supplier network in one place</h2>
      <p>The Vendor Manager stores contacts, lead times, payment terms, and equipment specialties for every supplier. Link vendors to POs for full traceability.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">VENDOR DIRECTORY</div>
        <div style="margin-bottom:8px;padding:8px 12px;background:#1f293750;border-radius:6px;">
          <div style="color:#e5e7eb;font-size:13px;font-weight:600;">Soligent</div>
          <div style="color:#6b7280;font-size:11px;">Lead time: 5 days &middot; Net 30 &middot; Modules, Inverters</div>
        </div>
        <div style="padding:8px 12px;background:#1f293750;border-radius:6px;">
          <div style="color:#e5e7eb;font-size:13px;font-weight:600;">CED Greentech</div>
          <div style="color:#6b7280;font-size:11px;">Lead time: 3 days &middot; Net 15 &middot; BOS, Racking</div>
        </div>
      `)}
      <p>Admins manage vendors from the Admin portal. Each vendor includes category, equipment types, and full contact details.</p>
      ${ctaButton('View Vendors →', '/vendors')}
    `),
  }),

  17: (name) => ({
    subject: 'Change Orders — Design Revisions',
    html: layout(17, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">When designs change, track it here</h2>
      <p>Change Orders track design revisions with a 6-step workflow. See original vs. new specs, follow the approval process, and keep a clear paper trail.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">CHANGE ORDER WORKFLOW</div>
        <div style="margin-bottom:4px;">${sectionBadge('1. Request Submitted', '#1D9E75')}</div>
        <div style="margin-bottom:4px;">${sectionBadge('2. Design In Progress', '#1D9E75')}</div>
        <div style="margin-bottom:4px;">${sectionBadge('3. Pending Approval', '#3b82f6')}</div>
        <div style="margin-bottom:4px;">${sectionBadge('4. Approved', '#6b7280')}</div>
        <div style="margin-bottom:4px;">${sectionBadge('5. Design Complete', '#6b7280')}</div>
        <div>${sectionBadge('6. Signed', '#6b7280')}</div>
      `)}
      <p>Original and new values for panel count, system size, financing, and more are captured side by side.</p>
      ${ctaButton('View Change Orders →', '/change-orders')}
    `),
  }),

  18: (name) => ({
    subject: 'Document Management — File Tracking',
    html: layout(18, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Every document, accounted for</h2>
      <p>The Documents page tracks required files per project stage. Know at a glance what has been uploaded, what is missing, and what needs verification.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">DOCUMENT STATUS</div>
        <div style="margin-bottom:6px;">${sectionBadge('Present', '#1D9E75')} <span style="color:#e5e7eb;font-size:13px;">Contract (signed)</span></div>
        <div style="margin-bottom:6px;">${sectionBadge('Missing', '#ef4444')} <span style="color:#e5e7eb;font-size:13px;">Utility Application</span></div>
        <div style="margin-bottom:6px;">${sectionBadge('Pending', '#f59e0b')} <span style="color:#e5e7eb;font-size:13px;">Engineering Stamp</span></div>
        <div>${sectionBadge('Verified', '#3b82f6')} <span style="color:#e5e7eb;font-size:13px;">Permit Package</span></div>
      `)}
      <p>Each project auto-creates a Google Drive folder with 16 subfolders. Document requirements are configurable per stage in the Admin portal.</p>
      ${ctaButton('View Documents →', '/documents')}
    `),
  }),

  19: (name) => ({
    subject: 'Atlas — AI-Powered Reports',
    html: layout(19, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Meet Atlas, your AI analyst</h2>
      <p>The Reports page lets you ask questions about your data in plain English. Atlas generates portfolio summaries, identifies trends, and flags anomalies automatically.</p>
      ${visualBox(`
        <div style="background:#1f2937;border-radius:6px;padding:10px 14px;margin-bottom:10px;">
          <span style="color:#9ca3af;font-size:13px;">&#128269; "Show me all projects stuck in permitting for more than 30 days"</span>
        </div>
        <div style="padding:8px 12px;background:#1D9E7510;border-left:3px solid #1D9E75;border-radius:0 6px 6px 0;">
          <span style="color:#1D9E75;font-size:12px;font-weight:600;">Atlas:</span>
          <span style="color:#e5e7eb;font-size:13px;"> Found 7 projects. Average wait: 42 days. Top blocker: AHJ backlog (4 projects).</span>
        </div>
      `)}
      <p>Atlas pulls from live data and includes executive summaries, leadership dashboards, and automated weekly digests.</p>
      ${ctaButton('Try Atlas →', '/reports')}
    `),
  }),

  20: (name) => ({
    subject: 'Analytics — 6 Tabs of Insights',
    html: layout(20, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Data-driven decisions</h2>
      <p>The Analytics page has 6 specialized tabs, each designed for a different perspective on your portfolio.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">ANALYTICS TABS</div>
        <div style="margin-bottom:4px;">${sectionBadge('Leadership', '#1D9E75')} <span style="color:#6b7280;font-size:11px;">Sales, installs, funding, forecast</span></div>
        <div style="margin-bottom:4px;">${sectionBadge('Pipeline Health', '#3b82f6')} <span style="color:#6b7280;font-size:11px;">Stage distribution, SLA, blockers</span></div>
        <div style="margin-bottom:4px;">${sectionBadge('By PM', '#8b5cf6')} <span style="color:#6b7280;font-size:11px;">Per-PM performance metrics</span></div>
        <div style="margin-bottom:4px;">${sectionBadge('Funding', '#f59e0b')} <span style="color:#6b7280;font-size:11px;">Outstanding amounts, financier breakdown</span></div>
        <div style="margin-bottom:4px;">${sectionBadge('Cycle Times', '#ef4444')} <span style="color:#6b7280;font-size:11px;">Average days per stage, trends</span></div>
        <div>${sectionBadge('Dealers', '#14b8a6')} <span style="color:#6b7280;font-size:11px;">Projects by dealer and consultant</span></div>
      `)}
      <p>Each tab supports period selection. Leadership view includes monthly install trend charts and 90-day forecasts.</p>
      ${ctaButton('Explore Analytics →', '/analytics')}
    `),
  }),

  21: (name) => ({
    subject: 'Week 3 Recap — Power Features Unlocked',
    html: layout(21, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Three weeks in, ${name}!</h2>
      <p>You now know the advanced features that make MicroGRID CRM a complete platform:</p>
      ${visualBox(`
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Work Orders — structured field checklists</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Vendors — supplier network management</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Change Orders — design revision tracking</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Documents — file requirement compliance</span></div>
        <div style="margin-bottom:6px;"><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Atlas — AI-powered reporting</span></div>
        <div><span style="color:#1D9E75;">&#10004;</span> <span style="color:#e5e7eb;font-size:13px;">Analytics — 6 tabs of data insights</span></div>
      `)}
      <p>Final week: Bulk operations, mobile views, legacy projects, exports, admin tools, and the Help Center.</p>
      ${ctaButton('Almost There →', '/command')}
    `),
  }),

  // ── WEEK 4: Mastery ─────────────────────────────────────────────────────────

  22: (name) => ({
    subject: 'Bulk Operations — Multi-Select Actions',
    html: layout(22, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Update dozens of projects at once</h2>
      <p>On Pipeline and Queue pages, enter Select Mode to check multiple projects, then apply bulk actions: reassign PM, set blockers, change disposition, or set follow-up dates.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">BULK ACTION BAR</div>
        <div style="background:#1f2937;border-radius:8px;padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <span style="color:#1D9E75;font-size:13px;font-weight:600;">5 selected</span>
          <span style="color:#6b7280;">|</span>
          ${sectionBadge('Reassign PM')}
          ${sectionBadge('Set Blocker')}
          ${sectionBadge('Change Disposition')}
          ${sectionBadge('Set Follow-up')}
        </div>
      `)}
      <p>Every bulk change is logged to the audit trail. A progress bar shows real-time status during execution.</p>
      ${ctaButton('Try Bulk Actions →', '/pipeline')}
    `),
  }),

  23: (name) => ({
    subject: 'Mobile — Leadership Dashboard',
    html: layout(23, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Your portfolio on the go</h2>
      <p>The mobile Leadership Dashboard gives executives a read-only view of key metrics: active projects, blocked count, funding totals, and install pace. Designed for quick check-ins from your phone.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">MOBILE LEADERSHIP</div>
        <table width="100%" cellpadding="6" cellspacing="0" style="font-size:13px;">
        <tr>
          <td style="background:#1D9E7520;border-radius:6px;text-align:center;color:#1D9E75;"><div style="font-size:20px;font-weight:700;">938</div><div style="font-size:10px;">Active</div></td>
          <td style="background:#ef444420;border-radius:6px;text-align:center;color:#ef4444;"><div style="font-size:20px;font-weight:700;">12</div><div style="font-size:10px;">Blocked</div></td>
          <td style="background:#3b82f620;border-radius:6px;text-align:center;color:#3b82f6;"><div style="font-size:20px;font-weight:700;">$2.4M</div><div style="font-size:10px;">Funded</div></td>
        </tr></table>
      `)}
      <p>No app to install. Just bookmark the URL and access it from any mobile browser. Optimized for small screens.</p>
      ${ctaButton('Open Mobile Dashboard →', '/mobile/leadership')}
    `),
  }),

  24: (name) => ({
    subject: 'Mobile — Field Operator View',
    html: layout(24, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Built for the field</h2>
      <p>The Field Operator view is designed for crew members on-site. See today's assignments, project details, and complete work order checklists — all from your phone.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">TODAY'S JOBS</div>
        <div style="margin-bottom:8px;padding:8px 12px;background:#1f293750;border-radius:6px;">
          <div style="color:#e5e7eb;font-size:13px;font-weight:600;">9:00 AM — PROJ-00331</div>
          <div style="color:#6b7280;font-size:11px;">Install &middot; 123 Main St, Houston &middot; 8.4 kW</div>
        </div>
        <div style="padding:8px 12px;background:#1f293750;border-radius:6px;">
          <div style="color:#e5e7eb;font-size:13px;font-weight:600;">2:00 PM — PROJ-00445</div>
          <div style="color:#6b7280;font-size:11px;">Survey &middot; 456 Oak Ave, Katy &middot; 10.2 kW</div>
        </div>
      `)}
      <p>Crews can check off items, add photos, record time on site, and capture customer signatures right in the app.</p>
      ${ctaButton('Open Field View →', '/mobile/field')}
    `),
  }),

  25: (name) => ({
    subject: 'Legacy Projects — Historical Lookup',
    html: layout(25, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Your NetSuite archive, searchable</h2>
      <p>Legacy Projects preserves historical data from NetSuite. Search completed and older projects by name, address, or ID. View equipment specs, milestones, and original notes.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">LEGACY SEARCH</div>
        <div style="background:#1f2937;border-radius:6px;padding:10px 14px;">
          <span style="color:#6b7280;font-size:13px;">&#128269;</span>
          <span style="color:#9ca3af;font-size:13px;margin-left:8px;">Search legacy projects...</span>
        </div>
        <div style="color:#6b7280;font-size:11px;margin-top:8px;">Covers all historical projects from NetSuite (pre-MicroGRID CRM)</div>
      `)}
      <p>Legacy data is read-only and separate from active projects. Useful for warranty lookups, customer history, and reference.</p>
      ${ctaButton('Search Legacy Projects →', '/legacy')}
    `),
  }),

  26: (name) => ({
    subject: 'CSV Export — Take Data Anywhere',
    html: layout(26, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Export exactly what you need</h2>
      <p>The CSV export lets you pick from 50+ fields across project details, dates, equipment, and funding. Create custom exports for reports, meetings, or analysis.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">EXPORT FIELD PICKER</div>
        <div style="margin-bottom:4px;"><span style="color:#1D9E75;">&#9745;</span> <span style="color:#e5e7eb;font-size:13px;">Project ID, Name, Stage</span></div>
        <div style="margin-bottom:4px;"><span style="color:#1D9E75;">&#9745;</span> <span style="color:#e5e7eb;font-size:13px;">PM, Financier, Contract Value</span></div>
        <div style="margin-bottom:4px;"><span style="color:#6b7280;">&#9744;</span> <span style="color:#e5e7eb;font-size:13px;">Equipment (Module, Inverter, Battery)</span></div>
        <div><span style="color:#6b7280;">&#9744;</span> <span style="color:#e5e7eb;font-size:13px;">Dates (Sale, Survey, Install, PTO)</span></div>
      `)}
      <p>Export is available on the Command Center. Select your fields, click Export, and get a clean CSV instantly.</p>
      ${ctaButton('Try CSV Export →', '/command')}
    `),
  }),

  27: (name) => ({
    subject: 'Keyboard Shortcuts and Tips',
    html: layout(27, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Work faster with these tips</h2>
      <p>A few shortcuts and patterns that will speed up your daily workflow in MicroGRID CRM:</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">POWER USER TIPS</div>
        <div style="margin-bottom:8px;">
          <span style="color:#1D9E75;font-weight:600;">Esc</span>
          <span style="color:#e5e7eb;font-size:13px;margin-left:8px;">Close any modal or panel</span>
        </div>
        <div style="margin-bottom:8px;">
          <span style="color:#1D9E75;font-weight:600;">PM Filter</span>
          <span style="color:#e5e7eb;font-size:13px;margin-left:8px;">Persists in localStorage — set once, see your projects everywhere</span>
        </div>
        <div style="margin-bottom:8px;">
          <span style="color:#1D9E75;font-weight:600;">@Mentions</span>
          <span style="color:#e5e7eb;font-size:13px;margin-left:8px;">Type @ then start typing a name to trigger autocomplete</span>
        </div>
        <div>
          <span style="color:#1D9E75;font-weight:600;">Collapse Sections</span>
          <span style="color:#e5e7eb;font-size:13px;margin-left:8px;">Click any section header to collapse/expand on Queue page</span>
        </div>
      `)}
      <p>The more you use MicroGRID CRM, the more these patterns become second nature. Speed comes from knowing where things live.</p>
      ${ctaButton('Jump into MicroGRID CRM →', '/command')}
    `),
  }),

  28: (name) => ({
    subject: 'The Admin Portal',
    html: layout(28, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Configure MicroGRID CRM your way</h2>
      <p>The Admin Portal (admin role required) lets you manage reference data, users, crews, SLA thresholds, notification rules, queue sections, and more — all without code changes.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">ADMIN MODULES</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${sectionBadge('AHJs')}
          ${sectionBadge('Utilities')}
          ${sectionBadge('HOAs')}
          ${sectionBadge('Financiers')}
          ${sectionBadge('Equipment')}
          ${sectionBadge('Vendors')}
          ${sectionBadge('Users')}
          ${sectionBadge('Crews')}
          ${sectionBadge('SLA')}
          ${sectionBadge('Notifications')}
          ${sectionBadge('Queue Config')}
          ${sectionBadge('Documents')}
        </div>
      `)}
      <p>Each module has search, CRUD operations, and validation. Changes take effect immediately across the platform.</p>
      ${ctaButton('Explore Admin →', '/admin')}
    `),
  }),

  29: (name) => ({
    subject: 'Help Center — 55 Visual Guides',
    html: layout(29, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Stuck? The Help Center has you covered.</h2>
      <p>55 searchable help topics organized by category: Getting Started, Daily Workflow, Project Management, Financial, Inventory, and more. Each topic includes step-by-step instructions.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">HELP CATEGORIES</div>
        <div style="margin-bottom:4px;">${sectionBadge('Getting Started', '#1D9E75')} <span style="color:#6b7280;font-size:11px;">First login, navigation, basics</span></div>
        <div style="margin-bottom:4px;">${sectionBadge('Daily Workflow', '#3b82f6')} <span style="color:#6b7280;font-size:11px;">Queue, tasks, notes</span></div>
        <div style="margin-bottom:4px;">${sectionBadge('Project Management', '#8b5cf6')} <span style="color:#6b7280;font-size:11px;">Pipeline, stages, tasks</span></div>
        <div style="margin-bottom:4px;">${sectionBadge('Financial', '#f59e0b')} <span style="color:#6b7280;font-size:11px;">Funding, change orders</span></div>
        <div>${sectionBadge('Administration', '#ef4444')} <span style="color:#6b7280;font-size:11px;">Admin portal, configuration</span></div>
      `)}
      <p>Can not find what you need? Use the Feedback button in the bottom-right corner of any page to request help or report an issue.</p>
      ${ctaButton('Browse Help Topics →', '/help')}
    `),
  }),

  30: (name) => ({
    subject: 'You\'re a MicroGRID CRM Expert — What\'s Next?',
    html: layout(30, `
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 12px;">Congratulations, ${name}! You made it.</h2>
      <p>Over 30 days, you have learned every major feature in MicroGRID CRM. You are now equipped to manage your solar portfolio like a pro.</p>
      ${visualBox(`
        <div style="color:#9ca3af;font-size:12px;margin-bottom:10px;">YOUR MicroGRID CRM JOURNEY</div>
        <div style="margin-bottom:6px;">
          <span style="color:#1D9E75;font-weight:600;">Week 1:</span>
          <span style="color:#e5e7eb;font-size:13px;"> Command Center, Queue, Projects, Tasks, Notes, Search</span>
        </div>
        <div style="margin-bottom:6px;">
          <span style="color:#3b82f6;font-weight:600;">Week 2:</span>
          <span style="color:#e5e7eb;font-size:13px;"> Funding, Schedule, Equipment, Inventory, POs, Warehouse</span>
        </div>
        <div style="margin-bottom:6px;">
          <span style="color:#8b5cf6;font-weight:600;">Week 3:</span>
          <span style="color:#e5e7eb;font-size:13px;"> Work Orders, Vendors, Change Orders, Docs, Atlas, Analytics</span>
        </div>
        <div>
          <span style="color:#f59e0b;font-weight:600;">Week 4:</span>
          <span style="color:#e5e7eb;font-size:13px;"> Bulk Ops, Mobile, Legacy, Export, Admin, Help</span>
        </div>
      `)}
      <p>New features are being added regularly. Keep an eye on the Release Notes in Admin, and use the Feedback button to tell us what you want next. Welcome to the team!</p>
      ${ctaButton('Go to MicroGRID CRM →', '/command')}
    `),
  }),
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getTemplate(day: number, userName: string): EmailTemplate | null {
  const factory = templates[day]
  if (!factory) return null
  // Escape user name to prevent XSS — all template factories interpolate this into HTML
  return factory(escapeHtml(userName || 'there'))
}

export function getMaxDay(): number {
  return 30
}
